import { OFFENSIVE_KINDS } from '../../engine/balance';
import { renderCtxOf } from '../../engine/keywords/compose';
import { attunedShieldLabel, CARD_MOD_KEYS, CARD_MOD_TEXT, faceTokenOf, HEADLINE_LABEL, multiHitPowersEqual } from '../../engine/keywords/text';
import { tierResolved, weightOf, type BuffableStat, type SkillDef } from '../../engine/types';
import { STAT_TOKEN } from './statLabels';

interface AuraModifierShape {
  damageFlat?: number;
  healFlat?: number;
  weightDelta?: number;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function isAuraSkill(skill: SkillDef): boolean {
  return Boolean(skill.aura);
}

/**
 * True when this card's cast fans out to every living foe — the EFFECTIVE
 * `scope` (the caller must pass an already-tier/gem-resolved `SkillDef`, e.g.
 * via `resolveDisplaySkill`/`applyTier`; `scope` can flip on at a tier above
 * bronze — see `TierUpgrade.scope`, engine/types.ts). Gated on the card
 * actually carrying an offensive action (mirrors the engine's own
 * `OFFENSIVE_KINDS`, engine/balance.ts): `scope` only changes targeting for
 * those, so a stray flag on a pure support/aura card would mislabel it.
 */
export function isAoeSkill(skill: SkillDef): boolean {
  return skill.scope === 'all' && skill.effects.some((action) => OFFENSIVE_KINDS.has(action.kind));
}

/**
 * An aura's three mods, in words — READ FROM THE REGISTRY (2026-09-06).
 *
 * The three long words (`damage` / `healing` / `weight`) and the three compact
 * ones (`DMG` / `HEAL` / `WT`) used to be typed here, and a Core gem's
 * `StatGemMods.card` bundle carries THE SAME THREE MODS (it is AuraMods-shaped
 * by design, see `engine/types.ts#StatGemMods`). Rather than let a gem invent a
 * second wording for `damageFlat`, both now read `CARD_MOD_TEXT`
 * (`engine/keywords/text.ts`) — one reference for the whole game, the same rule
 * every keyword already follows. Output is byte-identical: `faceClause` is the
 * same `signed(v) + ' ' + word` this function always produced.
 */
export function formatAuraModifiers(mods: AuraModifierShape, compact = false): string {
  // FLAT damage/heal (no %).
  return CARD_MOD_KEYS
    .map((key) => {
      const value = mods[key];
      if (value === undefined) return '';
      return compact
        ? `${signed(value)} ${CARD_MOD_TEXT[key].compactToken}`
        : CARD_MOD_TEXT[key].faceClause(value);
    })
    .filter(Boolean).join(' · ');
}

/** Human-readable "which cards this aura reaches" — direction + range + filter. */
export function describeAuraRange(skill: SkillDef): string | null {
  const aura = skill.aura;
  if (!aura) return null;

  // The kind of card affected (the filter), used as the noun.
  const target = aura.archetypeFilter
    ? `${aura.archetypeFilter} cards`
    : aura.propertyFilter
      ? `${aura.propertyFilter} cards`
      : 'cards';

  const reach = aura.reach ?? 1;
  if (aura.affects === 'allBoard') return `All ${target} on the board`;

  const where = aura.affects === 'adjacent' ? 'on either side' : `to the ${aura.affects}`;
  // reach 1 = physically touching; reach N = up to N-1 empty slots further out.
  return reach <= 1 ? `${target} touching this one ${where}` : `${target} up to ${reach} slots away ${where}`;
}

/** Live scaling stats (current combatant) used to compute the actual number a card deals. */
export interface ScalingStats {
  attack: number;
  magicPower: number;
  armor: number;
  magicResist: number;
}

/**
 * Which SIDE of the stat sheet a line reads — the presentation mirror of the
 * engine's `scaleStat` / `scaleDefStat` pair (src/engine/combat/interpreter.ts).
 * A card's `property` picks WHICH stat; the ROLE of the line picks which side.
 * Damage is offense; heal and shield are defensive output.
 *
 * This module MUST track that engine split. It previously had only the offense
 * rule, so after the 2026-08-05 change every defensive line was wrong twice
 * over: 'composition' mode printed the wrong TOKEN (`DEF 20 +ATK`), and
 * 'summed' mode added the wrong STAT to the number itself (`SHLD 68` for a
 * 48-base shield on a 20-Attack hero whose Armor was what actually applied).
 */
type ScalingRole = 'offense' | 'defense';

/** The caster's scaling stat contribution, per the engine's `scaleStat` / `scaleDefStat` rules. */
function statContribution(property: SkillDef['property'], stats: ScalingStats, role: ScalingRole): number {
  if (role === 'defense') {
    switch (property) {
      case 'physical': return stats.armor;
      case 'magical': return stats.magicResist;
      // TRUE defensive output is FLAT BY IDENTITY — no stat term at all, so
      // there is no "higher of the two" case here (unlike TRUE damage).
      case 'true': return 0;
    }
  }
  switch (property) {
    case 'physical': return stats.attack;
    case 'magical': return stats.magicPower;
    case 'true': return Math.max(stats.attack, stats.magicPower);
  }
}

/**
 * One face number plus whether ITS OWN printed value folded in a live-stat
 * contribution — the `calculated` half of `EffectSegment` (see that
 * interface's doc comment for the exact rule this flag follows and why it
 * covers only the live-stat term, not tier/gem folding too).
 */
interface ScaledText {
  text: string;
  calculated: boolean;
}

/** `DMG 37` — the summed EFFECTIVE number (base + live stat) when stats are known and contribute; else the bare base number. */
function scaledLabel(
  label: string, base: number, property: SkillDef['property'],
  stats: ScalingStats | undefined, statScales: boolean, role: ScalingRole,
): ScaledText {
  if (stats && statScales) {
    const contribution = statContribution(property, stats, role);
    if (contribution) return { text: `${label} ${base + contribution}`, calculated: true };
  }
  return { text: `${label} ${base}`, calculated: false };
}

/**
 * Platform-appropriate card-face number treatment (coordinator-locked
 * 2026-08-01): `'summed'` (mobile — space-constrained) keeps the pre-summed
 * effective number; `'composition'` (desktop — room for it) shows the
 * FORMULA instead (base + which stat), so the flat-vs-scaling split is
 * visible without a tooltip. Both modes mark TRUE effects with a `(T)`
 * suffix (a TRUE flat number reads identically to a physical/magical one
 * otherwise).
 */
export type SkillFaceMode = 'summed' | 'composition';

/** The stat a non-TRUE effect scales off, per the engine's `scaleStat` / `scaleDefStat` rules. */
function scalingStatKey(property: 'physical' | 'magical', role: ScalingRole): BuffableStat {
  if (role === 'defense') return property === 'physical' ? 'armor' : 'magicResist';
  return property === 'physical' ? 'attack' : 'magicPower';
}

/**
 * One damage/heal/shield line, in the mode the calling platform wants:
 * `'summed'` → `scaledLabel`'s base+live-stat number (or bare base with no
 * stats); `'composition'` → the formula itself, e.g. `DMG 20 +ATK`, REGARDLESS
 * of whether `stats` was supplied (the point is showing the card's structure,
 * not a live total). TRUE effects ignore `mode` entirely — the flat/summed
 * number from `scaledLabel` (unchanged behavior) plus a `(T)` marker so a
 * flat TRUE number is never mistaken for a scaling one.
 *
 * `calculated` (2026-09-06) rides along on the same return so callers can tag
 * the `EffectSegment` without recomputing anything — see that field's doc
 * comment. `'composition'` mode is ALWAYS `calculated: false`: it prints the
 * authored base and the scaling STAT NAME as two visibly separate pieces
 * (`DMG 20 +ATK`), which already shows the flat-vs-scaling split without a
 * colour — there is no folded-together number on this line to mark.
 */
function effectLine(
  label: string, base: number, property: SkillDef['property'],
  stats: ScalingStats | undefined, statScales: boolean, mode: SkillFaceMode, role: ScalingRole,
): ScaledText {
  if (property === 'true') {
    const scaled = scaledLabel(label, base, property, stats, statScales, role);
    return { text: `${scaled.text} (T)`, calculated: scaled.calculated };
  }
  if (mode === 'composition' && statScales) {
    return { text: `${label} ${base} +${STAT_TOKEN[scalingStatKey(property, role)]}`, calculated: false };
  }
  return scaledLabel(label, base, property, stats, statScales, role);
}

/**
 * The `DMG` line for a MULTI-HIT card (>=2 ungated `damage` actions — the hit
 * count itself is a separate `MULTI-HIT N` badge, pushed alongside this line
 * by the caller, never folded into this number).
 *
 * PER-HIT, NOT SUMMED (user-ruling 2026-09-14): the number prints one hit's
 * base, not the total across hits — `rapid_volley` bronze (10 + 10) reads
 * `DMG 10`, not `DMG 20`. Equal hits (the common case) print that one shared
 * base; unequal hits (`rapid_volley`/`twin_slash`/`barrage` at the ranks their
 * even-power pricing forces two apart) print every hit's base, comma-joined
 * in authored order — REUSING `multiHitPowersEqual`
 * (`engine/keywords/text.ts`), the exact split `damageClause` uses for its own
 * "Deal X" / "Deal X, then Y" choice, so the face and the long description
 * can never disagree about which cards get which form.
 *
 * `+ATK`/`+DEF` stays the bare SYMBOLIC suffix `effectLine` already prints for
 * a single hit — never multiplied by the hit count. The engine SPLITS the
 * caster's stat contribution across a cast's hits (`statShare`,
 * `engine/combat/interpreter.ts`, front-loaded remainder) rather than paying
 * it per hit, so a face form that reads as "this stat, doubled" (the withdrawn
 * `DMG 10 +ATK ×2`) promised damage the card never delivers. Putting the hit
 * count on its OWN badge removes that binding entirely, in both modes.
 */
function multiHitEffectLine(
  label: string, powers: readonly number[], property: SkillDef['property'],
  stats: ScalingStats | undefined, statScales: boolean, mode: SkillFaceMode, role: ScalingRole,
): ScaledText {
  if (powers.length <= 1) return effectLine(label, powers[0] ?? 0, property, stats, statScales, mode, role);
  const equal = multiHitPowersEqual(powers);
  if (property === 'true') {
    if (equal) {
      const scaled = scaledLabel(label, powers[0]!, property, stats, statScales, role);
      return { text: `${scaled.text} (T)`, calculated: scaled.calculated };
    }
    const contribution = stats && statScales ? statContribution(property, stats, role) : 0;
    const effective = powers.map((p) => p + contribution);
    return { text: `${label} ${effective.join(', ')} (T)`, calculated: Boolean(contribution) };
  }
  if (mode === 'composition' && statScales) {
    const suffix = ` +${STAT_TOKEN[scalingStatKey(property, role)]}`;
    return equal
      ? { text: `${label} ${powers[0]}${suffix}`, calculated: false }
      : { text: `${label} ${powers.join(', ')}${suffix}`, calculated: false };
  }
  const contribution = stats && statScales ? statContribution(property, stats, role) : 0;
  if (equal) {
    return contribution
      ? { text: `${label} ${powers[0]! + contribution}`, calculated: true }
      : { text: `${label} ${powers[0]}`, calculated: false };
  }
  const effective = powers.map((p) => p + contribution);
  return { text: `${label} ${effective.join(', ')}`, calculated: Boolean(contribution) };
}

/**
 * Compact effect summary for the card face — the numbers the player actually
 * plays for (damage, heal, shield, DoTs, buffs), not metadata like PL or size.
 *
 * `mode` (default `'summed'`, mobile's long-standing behavior) picks the
 * number treatment for damage/heal/shield lines — see `SkillFaceMode`/
 * `effectLine`. WHICH stat each line reads is the `ScalingRole` split: DMG is
 * offense (physical → Attack, magical → Magic Power, TRUE → higher of the
 * two), while HEAL and SHLD/DEF are defensive output (physical → Armor,
 * magical → Magic Resist, TRUE → flat, no stat add) — see `cardGlossary.ts`'s
 * `true` entry.
 */
/**
 * One token of the card face's compact effects line, tagged with the
 * `KEYWORD_TEXT_COLOR` id (`cardTextMarkup.ts`) it corresponds to when one
 * exists — e.g. `{ text: 'PSN 5', keyword: 'poison' }` — so a renderer can tint
 * it to match the SAME keyword's color everywhere else (flavor-text markup,
 * status bars). `keyword` is omitted for tokens with no 1:1 keyword mapping
 * (AOE, DMG, HEAL, stat buffs/debuffs, TAUNT, the Echo gem's STRIKE/ECHO) —
 * those render in the line's neutral fallback color, same as before this
 * split existed.
 */
export interface EffectSegment {
  text: string;
  keyword?: string;
  /**
   * Render this segment as a differently colored continuation of the previous
   * segment, separated by one space instead of the normal middle dot. This is
   * used by affinity badges so `FIRE:` and its independently dimmable payload
   * remain one grammatical `FIRE: PAYLOAD` clause.
   */
  joinWithPrevious?: boolean;
  /**
   * CALCULATED-NUMBER FLAG (2026-09-06, `theme.ts`'s `UI.textCalculated`).
   * True when this segment's own printed number is the card's flat resolved
   * base PLUS the caster's live scaling stat, folded in by `scaledLabel` right
   * here — i.e. the SAME card (same tier, same gems, same fight) prints a
   * DIFFERENT number for a different caster's Attack/Magic Power/Armor/Magic
   * Resist. Renderers (`CardToken.ts`'s `effectFaceSegments`) tint a
   * `calculated` segment in `UI.textCalculated` instead of its usual colour so
   * a player can tell "this is MY number" from "this is what's printed on the
   * card" at a glance.
   *
   * DELIBERATELY NARROWER than "differs from the true authored-bronze value
   * for ANY reason" — tier scaling and gem folding are the other two ways a
   * printed number can move (see the feature request this flag was added
   * for), and both are ALREADY folded into `raw`/`base` before this module
   * ever sees them (`applyTier` / `resolveEffectiveSkill` /
   * `resolveDisplaySkill`, `engine/cards.ts`). By the time
   * `summarizeEffectSegments` runs, the pre-scale/pre-gem value is gone — this
   * module has no authored number left to diff against, and guessing "was
   * this number changed" by comparing it to something is exactly the
   * renderer-side re-derivation this codebase keeps getting bitten by (see
   * `cardTextMarkup.ts`'s own doc block on the same failure mode). The
   * live-stat term is also the one of the three that is NOT fixed once a card
   * is owned: tier and gems bake in once, at purchase/socket time, and stay
   * constant for that card copy; the live-stat term moves every time the
   * caster's OWN stat does (buffs, debuffs, curses, gear later) — the number a
   * player must actually re-read on every card, every turn.
   *
   * Only ever set by `scaledLabel` (via `effectLine`) — the one function in
   * this module that folds a stat into a printed number at all (DMG / HEAL /
   * SHLD / ATTUNED SHLD). Every other token (PSN, BRN, AOE, STUN, the stat
   * buff/debuff riders, …) prints an authored/tier-resolved field verbatim and
   * is never flagged, `'composition'` mode is never flagged either (see
   * `effectLine`'s doc comment) — both stay at their existing colour
   * (keyword colour if they have one, the line's neutral fallback otherwise),
   * unchanged from before this flag existed.
   */
  calculated?: boolean;
  /**
   * AFFINITY-GATE CLOSED FLAG. Set ONLY on the PAYLOAD half of an
   * `affinity: true` badge (see the `action.affinity === true` block below,
   * which splits the badge into a `TYPE:` label segment and a payload segment
   * so a renderer can dim the second without touching the first — the exact
   * split the user asked for: "the FIRE: part as normal color but the next
   * fire +16 should show as greyed out"). `true` only when the caller's
   * `affinityOpen` argument is EXACTLY `false` (the gate is shut on THIS
   * caster right now); `undefined`/`true` both leave it unset, so a segment
   * renders in its ordinary keyword colour whenever the gate is open OR the
   * caller has no caster to check at all (deck build / shop / wiki — see
   * `summarizeEffectSegments`'s `affinityOpen` parameter doc). The label
   * segment never carries this flag: the gate's NAME is not what closed, only
   * its payoff. Renderers (`CardToken.ts`'s `effectFaceSegments`) tint a
   * `gateClosed` segment in `UI.textDisabled` — the same tone `comboLive`
   * already uses for "not live right now" — ahead of every other colour rule.
   */
  gateClosed?: boolean;
}

/** Visible joiner before a rich effect segment. */
export function effectSegmentJoiner(segment: Pick<EffectSegment, 'joinWithPrevious'>, index: number): string {
  if (index === 0) return '';
  return segment.joinWithPrevious ? ' ' : ' · ';
}

// The compact status abbreviations a conditional rider borrows (PSN / BRN /
// BLD / THORN / STUN / DEBUFF / EXPOSE) moved into the keyword registry
// (`src/engine/keywords/text.ts`) with the badges that use them, so one status
// reads as one word in the badge, the card body and the scaffolder alike.

/**
 * The structured form behind `summarizeEffects()` — same tokens, same order,
 * each one tagged with its keyword id (see `EffectSegment`) instead of being
 * pre-joined into one flat string. `summarizeEffects()` below joins these
 * with the shared `effectSegmentJoiner`; CardToken uses the same joiner while
 * retaining separate text nodes so each token can keep its own color.
 *
 * `affinityOpen` (2026-09-06) is the CASTER'S resolved affinity-gate state for
 * THIS card's own type — a battle-context fact this module cannot know on its
 * own (whether a gate is open depends on the CASTER's board identity, not the
 * card), so it is a PLAIN BOOLEAN PASSED IN, never re-derived here from
 * `skill.element`/`skill.weapon` plus some ambient combatant. The caller (a
 * battle scene, via `CardToken`/`BoardColumn` — see `battleTimeline.ts`'s
 * `cardAffinityOpen`) computes it once against the real fight; this function
 * only decides how to PRINT a state it is told. Tri-state, matching
 * `EffectSegment.gateClosed`'s doc comment: `false` dims the gated payload
 * (the gate is shut on this caster right now); `true` or `undefined` (the
 * default — deck build / shop / wiki, anywhere there is no caster to check a
 * gate against) both print normally, because "unknown" is not "closed".
 */
export function summarizeEffectSegments(
  raw: SkillDef, stats?: ScalingStats, mode: SkillFaceMode = 'summed', affinityOpen?: boolean,
): EffectSegment[] {
  /**
   * TIER LOCKS RESOLVED HERE TOO, idempotently (`tierResolved`,
   * engine/types.ts): a line locked above `skill.tier` does not exist on this
   * copy, so it must not appear on its face. The contract above still asks the
   * caller for an already-resolved skill and every board/shop path obliges via
   * `resolveDisplaySkill`; the one path that does NOT is a wiki pane rendering a
   * book def at its own base tier, which never calls `applyTier` at all. Folding
   * it in here costs a reference comparison for an unlocked card and makes "the
   * face never prints an effect this copy does not have" true structurally
   * rather than by convention.
   */
  const skill = tierResolved(raw);
  // User ruling (2026-08-20): "aura card should just say aura, not this far
  // near thing." This branch used to lead with a reach word (ALL/NEAR)
  // because an all-board +5 and an adjacent +15 price the same and the face
  // must not present them as the same kind of card — that PL argument is
  // still true, but the user judged it a bad trade for a face token nobody
  // could decode on sight.
  //
  // WHERE REACH LIVES NOW (rewritten 2026-09-06 — this comment described the
  // pre-migration world and was invalidated by it): `auraClause` in
  // `src/engine/keywords/compose.ts` generates the reach sentence from
  // `AuraDef` itself ("Passive: adjacent Offense cards get +15 damage" /
  // "Passive: ALL cards get +6 damage" — the mod words come from
  // `CARD_MOD_TEXT`, the same table this file's own `formatAuraModifiers` and
  // every gem chip read, since 2026-09-07), and it reaches a player through
  // the card BODY that
  // clause is part of — i.e. `renderSkillText`, drawn on the face by
  // `FantasyCardTemplateV2` and in full by `renderCardInfoBox` on every detail
  // surface (both Wiki panes, both Shop panes, DeckBuild, Draft). There is no
  // authored `text` field any more, and no card carries a `flavor`.
  //
  const auraSegment: EffectSegment | undefined = skill.aura
    ? { text: `AURA ${formatAuraModifiers(skill.aura.mods, true)}` }
    : undefined;
  const segments: EffectSegment[] = [];
  // AoE is load-bearing the way aura reach used to be (see the aura branch
  // above, before the 2026-08-20 ruling dropped that one from the face): a
  // card that reaches every living foe must not present as the same kind of
  // card as an otherwise-identical single-target one. Led so it survives this
  // line's own ellipsis clamp (CardToken.ts) rather than being the first
  // thing truncated off a crowded face.
  if (isAoeSkill(skill)) segments.push({ text: HEADLINE_LABEL.aoe });
  let damage = 0;
  let heal = 0;
  let shield = 0;
  // Every UNGATED `damage` action's own base, in authored order — the same
  // set `cardGlossary.ts` counts to decide whether to show
  // `MULTI_HIT_RULE_ENTRY` (`effects.filter(kind === 'damage' && affinity !==
  // true).length > 1`). `damage` above stays the SUMMED total (still needed
  // for the affinity roll-back math below); this array is what the face's
  // per-hit `DMG` line and its sibling `MULTI-HIT N` badge read.
  const damagePowers: number[] = [];
  const extras: EffectSegment[] = [];
  // The registry needs the card around the action (its type, property,
  // reach) to render a badge — built once, never per action.
  const ctx = renderCtxOf(skill);
  for (const action of skill.effects) {
    // AFFINITY, handled ONCE for every keyword. The action is rendered by its own
    // case below exactly as an ungated one would be, then — if it is gated — that
    // output is pulled back out of the headline numbers and re-emitted as a
    // single gated badge.
    //
    // WHY IT MUST LEAVE THE HEADLINE: `damage`/`heal`/`shield` accumulate into
    // the big number on the face rather than into a badge, so a gated hit would
    // otherwise be added to a total the card only reaches on the right board — a
    // face promising 52 damage on a card that deals 32 off-type. Rolling the
    // delta back out is what keeps the printed total honest for every board.
    const beforeExtras = extras.length;
    const beforeDamage = damage;
    const beforeDamagePowersLen = damagePowers.length;
    const beforeHeal = heal;
    const beforeShield = shield;
    // THE COMPACT BADGE, LOOKED UP RATHER THAN SWITCHED ON.
    //
    // This was a 36-arm `switch (action.kind)` with no `assertNever` — the
    // shape that let `attunedShield` print NOTHING on any face for nine days
    // (2026-08-30) and that left `taunt`'s badge un-tinted despite
    // `KEYWORD_TEXT_COLOR.taunt` existing. Every badge now comes from the
    // keyword registry's `faceToken` facet
    // (`src/engine/keywords/text.ts`), whose mapped type makes a missing kind
    // a `tsc` error, and which the generated card BODY reads too — so badge
    // and body cannot drift into two vocabularies.
    //
    // THREE KINDS STAY LOCAL, and only because they need something the pure
    // layer must not have: `damage`/`heal`/`shield` ACCUMULATE into the
    // face's big number and then fold in the caster's LIVE stat via
    // `effectLine` (`stats`/`mode` — battle-context, not card data). Their
    // registry rows exist and are used by the card body; this function's
    // headline is the one place that needs the live fold.
    switch (action.kind) {
      case 'damage': damage += action.power; damagePowers.push(action.power); break;
      case 'heal': heal += action.power; break;
      case 'shield': shield += action.power; break;
      // ATTUNED SHIELD gets the same `effectLine` treatment as the plain
      // shield line (the interpreter gives it the same `scaleDefStat` add),
      // so composition mode shows `+DEF` and summed mode adds the live stat —
      // then the two facts that make it a different card from a plain shield:
      // the RATE and the TYPE it is tuned to.
      case 'attunedShield': {
        // THIS CASE SURVIVES (2026-09-12 audit) only for what the pure
        // registry cannot do: `effectLine` folds the CASTER's live
        // Armor/Magic Resist into the printed number, the same live-stat
        // treatment the plain `shield` line above gets. The LABEL WORD
        // itself is not re-derived here any more — `attunedShieldLabel`
        // (`engine/keywords/text.ts`) is the one place that decides "SHIELD"
        // vs "SHIELD: LANCE", read by this case AND by that row's own
        // `faceToken`, so the two cannot drift back into two spellings the
        // way they did before this fix. `attunedType` is undefined only for
        // a hypothetical TRUE-property card with neither element nor weapon
        // (no shipped card does this — attunement has nothing to attune to);
        // `attunedShieldLabel` already returns the bare `SHIELD` fallback for
        // that case, never a dangling `SHIELD:`.
        const attunedType = skill.element ?? skill.weapon;
        const attunedLabel = attunedShieldLabel(attunedType);
        const attunedLine = effectLine(attunedLabel, action.power, skill.property, stats, skill.property !== 'true', mode, 'defense');
        extras.push({
          text: attunedLine.text,
          keyword: 'attuned',
          calculated: attunedLine.calculated,
        });
        break;
      }
      default: {
        const token = faceTokenOf(action, ctx);
        extras.push(token.keyword === undefined ? { text: token.text } : { text: token.text, keyword: token.keyword });
        break;
      }
    }
    if (action.affinity === true) {
      const parts: string[] = [];
      if (damage !== beforeDamage) parts.push(`${damage - beforeDamage} ${HEADLINE_LABEL.damage}`);
      if (heal !== beforeHeal) parts.push(`${heal - beforeHeal} ${HEADLINE_LABEL.heal}`);
      if (shield !== beforeShield) parts.push(`${shield - beforeShield} ${HEADLINE_LABEL.shieldFull}`);
      damage = beforeDamage;
      damagePowers.length = beforeDamagePowersLen;
      heal = beforeHeal;
      shield = beforeShield;
      for (let i = beforeExtras; i < extras.length; i += 1) parts.push(extras[i]!.text);
      extras.length = beforeExtras;
      const ownType = skill.element ?? skill.weapon;
      // TWO segments, not one: the `TYPE:` label (never dims — the gate's NAME
      // isn't what closed) and the payload (dims when `affinityOpen === false`
      // — see `EffectSegment.gateClosed`'s doc comment for the exact rule and
      // why this is a caller-supplied boolean rather than something computed
      // here from `skill.element`/`skill.weapon` alone).
      extras.push({ text: `${ownType === undefined ? HEADLINE_LABEL.affinity : ownType.toUpperCase()}:`, keyword: 'affinity' });
      extras.push({
        text: parts.join(' '),
        keyword: 'affinity',
        gateClosed: affinityOpen === false,
        joinWithPrevious: true,
      });
    }
  }
  const property = skill.property;
  // Shield is ALWAYS 'SHLD'. Its composition-mode label used to be 'DEF', to
  // match the "+96 DEF (+Attack)" grammar the card data used at the time — but
  // once shields started scaling off Armor (2026-08-05) that data grammar became
  // "Gain 96 (+DEF) physical shield", and a 'DEF' label beside a now-'DEF' stat
  // token rendered the useless "DEF 96 +DEF". The label names the OUTPUT, the
  // token names the STAT; they must not be the same word.
  const shieldLabel = HEADLINE_LABEL.shield;
  if (damagePowers.length > 0) {
    const line = multiHitEffectLine(HEADLINE_LABEL.damage, damagePowers, property, stats, true, mode, 'offense');
    segments.push({ text: line.text, calculated: line.calculated });
    // MULTI-HIT N — its own badge, right beside the DMG line it counts,
    // never folded into that line's number (see `multiHitEffectLine`'s doc
    // comment for why: the engine SPLITS the caster's stat across hits
    // rather than paying it per hit, so a `×N` bound to `+ATK` misreads as
    // "this stat, doubled").
    if (damagePowers.length > 1) segments.push({ text: `${HEADLINE_LABEL.multiHit} ${damagePowers.length}` });
  }
  if (heal) {
    const line = effectLine(HEADLINE_LABEL.heal, heal, property, stats, property !== 'true', mode, 'defense');
    segments.push({ text: line.text, calculated: line.calculated });
  }
  // Shield gets the 'shield' keyword color (KEYWORD_TEXT_COLOR) — unlike bare
  // DMG/HEAL, a typed shield IS one of the markup keywords the flavor-text
  // renderer already colors, so this token can actually match it. Renderers
  // resolve keyword color OVER `calculated` when both are set (see
  // `CardToken.ts`'s `effectFaceSegments`) — the shield-blue identity stays
  // stable rather than flickering to the calculated colour on a caster whose
  // Armor/Magic Resist happens to be nonzero — so `calculated` is still
  // carried here (never lost) even though it wins nothing on THIS token today.
  if (shield) {
    const line = effectLine(shieldLabel, shield, property, stats, property !== 'true', mode, 'defense');
    segments.push({ text: line.text, keyword: 'shield', calculated: line.calculated });
  }
  const weightReduction = skill.size * 10 - weightOf(skill);
  if (weightReduction > 0) segments.push({ text: `${HEADLINE_LABEL.lightweight} ${weightReduction}` });
  else if (weightReduction < 0) segments.push({ text: `${HEADLINE_LABEL.heavy} ${-weightReduction}` });
  segments.push(...extras);
  if (auraSegment) segments.push(auraSegment);
  return segments.length > 0 ? segments : [{ text: HEADLINE_LABEL.passive }];
}

export function summarizeEffects(skill: SkillDef, stats?: ScalingStats, mode: SkillFaceMode = 'summed', affinityOpen?: boolean): string {
  return summarizeEffectSegments(skill, stats, mode, affinityOpen)
    .map((segment, index) => `${effectSegmentJoiner(segment, index)}${segment.text}`)
    .join('');
}

export function describeAura(skill: SkillDef): string | null {
  const aura = skill.aura;
  if (!aura) return null;
  const range = describeAuraRange(skill);
  return [range, formatAuraModifiers(aura.mods)].filter(Boolean).join(' — ');
}
