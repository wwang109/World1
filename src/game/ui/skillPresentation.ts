import { OFFENSIVE_KINDS } from '../../engine/balance';
import { tierResolved, type BuffableStat, type SkillDef } from '../../engine/types';
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

export function formatAuraModifiers(mods: AuraModifierShape, compact = false): string {
  // FLAT damage/heal (no %).
  return [
    mods.damageFlat === undefined ? '' : `${signed(mods.damageFlat)} ${compact ? 'DMG' : 'damage'}`,
    mods.healFlat === undefined ? '' : `${signed(mods.healFlat)} ${compact ? 'HEAL' : 'healing'}`,
    mods.weightDelta === undefined ? '' : `${signed(mods.weightDelta)} ${compact ? 'WT' : 'weight'}`,
  ].filter(Boolean).join(' · ');
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

/** `DMG 37` — the summed EFFECTIVE number (base + live stat) when stats are known and contribute; else the bare base number. */
function scaledLabel(
  label: string, base: number, property: SkillDef['property'],
  stats: ScalingStats | undefined, statScales: boolean, role: ScalingRole,
): string {
  if (stats && statScales) {
    const contribution = statContribution(property, stats, role);
    if (contribution) return `${label} ${base + contribution}`;
  }
  return `${label} ${base}`;
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
 */
function effectLine(
  label: string, base: number, property: SkillDef['property'],
  stats: ScalingStats | undefined, statScales: boolean, mode: SkillFaceMode, role: ScalingRole,
): string {
  if (property === 'true') return `${scaledLabel(label, base, property, stats, statScales, role)} (T)`;
  if (mode === 'composition' && statScales) return `${label} ${base} +${STAT_TOKEN[scalingStatKey(property, role)]}`;
  return scaledLabel(label, base, property, stats, statScales, role);
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
}

/**
 * Compact face names for the statuses a CONDITIONAL RIDER (`exploit` /
 * `stackBonus`) can key off. Deliberately the SAME abbreviations those statuses
 * already use as their own face tokens above (PSN / BRN / BLD / THORN), so a
 * player reads one word for one status wherever it appears; `stun` / `debuff` /
 * `expose` are spelled the way their own tokens spell them too.
 */
const STATUS_TOKEN: Record<'poison' | 'burn' | 'bleed' | 'stun' | 'debuff' | 'expose' | 'thorns', string> = {
  poison: 'PSN',
  burn: 'BRN',
  bleed: 'BLD',
  stun: 'STUN',
  debuff: 'DEBUFF',
  expose: 'EXPOSE',
  thorns: 'THORN',
};

/**
 * The structured form behind `summarizeEffects()` — same tokens, same order,
 * each one tagged with its keyword id (see `EffectSegment`) instead of being
 * pre-joined into one flat string. `summarizeEffects()` below is now a thin
 * `.map(text).join(' · ')` over this; CardToken's segmented line renderer
 * uses THIS form directly so it can color each token independently.
 */
export function summarizeEffectSegments(raw: SkillDef, stats?: ScalingStats, mode: SkillFaceMode = 'summed'): EffectSegment[] {
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
  // could decode on sight. Reach now lives in exactly two places: the full
  // card text every aura card carries ("Passive: adjacent Offense cards deal
  // +15 damage." / "Passive: ALL board cards deal +6 damage.", see
  // skills.v1.json), and the wiki detail pane that renders that text verbatim
  // (`shown.text` in DesktopWikiScene.ts / MobileWikiScene.ts). No keyword
  // color: `aura` names a card MECHANIC (how the mod is delivered), not a
  // status/keyword like poison or guard with its own color elsewhere to
  // match (no card's flavor text ever wraps `{{aura}}` — the six aura cards'
  // text above has no markup at all) — same reasoning that leaves AOE/DMG/
  // HEAL/buffStat/debuffStat neutral, so this token stays neutral too.
  if (skill.aura) {
    return [{ text: `AURA ${formatAuraModifiers(skill.aura.mods, true)}` }];
  }

  const segments: EffectSegment[] = [];
  // AoE is load-bearing the way aura reach used to be (see the aura branch
  // above, before the 2026-08-20 ruling dropped that one from the face): a
  // card that reaches every living foe must not present as the same kind of
  // card as an otherwise-identical single-target one. Led so it survives this
  // line's own ellipsis clamp (CardToken.ts) rather than being the first
  // thing truncated off a crowded face.
  if (isAoeSkill(skill)) segments.push({ text: 'AOE' });
  let damage = 0;
  let heal = 0;
  let shield = 0;
  const extras: EffectSegment[] = [];
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
    const beforeHeal = heal;
    const beforeShield = shield;
    switch (action.kind) {
      case 'damage': damage += action.power; break;
      case 'heal': heal += action.power; break;
      case 'shield': shield += action.power; break;
      case 'poison': extras.push({ text: `PSN ${action.stacks}`, keyword: 'poison' }); break;
      case 'burn': extras.push({ text: `BRN ${action.stacks}`, keyword: 'burn' }); break;
      case 'bleed': extras.push({ text: `BLD ${action.stacks}`, keyword: 'bleed' }); break;
      // User ruling (2026-08-19): a stun denies the victim's next ACTION
      // whenever it happens — a pending stun survives untouched while
      // something else keeps the victim from acting (still building
      // readiness, on cooldown), it does not tick down on a real-time clock.
      // "STUN 1" used to read like a 1-TURN duration (the number was the lie);
      // this face token drops the number entirely rather than reintroduce it
      // in a different shape.
      // User ruling (2026-08-20): drop the "NEXT ACTION" qualifier too — bare
      // "STUN" is enough on the card face. `action.turns` still exists on the
      // action (content is capped at 1 by `MAX_STUN_PER_CARD`, so it is never
      // anything but a single performance in practice) and has no honest
      // one-line face phrasing at this width anyway; the full rule text lives
      // in the tap-to-expand glossary (`cardGlossary.ts`).
      case 'stun': extras.push({ text: 'STUN', keyword: 'stun' }); break;
      case 'thorns': extras.push({ text: `THORN ${action.stacks}`, keyword: 'thorns' }); break;
      case 'buffStat': extras.push({ text: `+${action.pct}% ${STAT_TOKEN[action.stat]}` }); break;
      case 'debuffStat': extras.push({ text: `-${action.pct}% ${STAT_TOKEN[action.stat]}` }); break;
      case 'expose': extras.push({ text: `EXPOSE ${action.pct}%`, keyword: 'expose' }); break;
      // ATTUNED SHIELD — plating tuned to this card's OWN type (`cardType`, never
      // authored separately, see engine/types.ts), which the wall then spends at
      // TWO damage per point against that type and one-for-one against
      // everything else. This case was entirely missing until 2026-08-30, so the
      // keyword printed NOTHING on any card face on either platform: `oathplate`
      // (its only affinity-gated user) rendered the gate's own label with an
      // empty payload after it — the literal string `SHLD 14 · SWORD: ` — and
      // `bulwark_of_the_line`/`riposte_guard`/`emberguard` simply dropped the
      // bigger half of their kit off the face.
      //
      // NOT folded into the `shield` accumulator above: a card can carry BOTH
      // (oathplate is 14 plain + 8 attuned) and they are different currencies,
      // so summing them would print a wall the card never builds. Same
      // `effectLine` treatment as the plain shield line, because the interpreter
      // gives it the same `scaleDefStat` add (interpreter.ts's `attunedShield`
      // case) — so composition mode shows `+DEF` and summed mode adds the live
      // stat, exactly as `SHLD` does. Then the two facts that make it a
      // different card from a plain shield: the RATE and the TYPE it is tuned
      // to. Takes the `attuned` keyword colour the flavour text's own
      // `{{Attuned}}` markup already uses, so the face token and the card text
      // highlight the same word in the same colour.
      case 'attunedShield': {
        const attunedType = skill.element ?? skill.weapon;
        const attunedLine = effectLine('ATTUNED SHLD', action.power, skill.property, stats, skill.property !== 'true', mode, 'defense');
        extras.push({
          text: attunedType === undefined ? attunedLine : `${attunedLine} (2x vs ${attunedType.toUpperCase()})`,
          keyword: 'attuned',
        });
        break;
      }
      // A guard covers ONE property, carried by the ACTION (not by the card —
      // a gem can graft a differently-typed guard onto any card), so the face
      // token names it: P.GUARD / M.GUARD / T.GUARD, mirroring the battle
      // log's P./M./T.SHIELD pool tokens. A bare "GUARD 20%" told the player
      // nothing about which damage it actually stops.
      case 'guard': extras.push({ text: `${action.property === 'physical' ? 'P' : action.property === 'magical' ? 'M' : 'T'}.GUARD ${action.pct}%`, keyword: 'guard' }); break;
      // A negate covers ONE property, carried by the ACTION exactly like guard
      // above — same gap, same fix: P.NEGATE / M.NEGATE / T.NEGATE, mirroring
      // the battle log's negateToken (battleTimeline.ts).
      case 'negate': extras.push({ text: `${action.property === 'physical' ? 'P' : action.property === 'magical' ? 'M' : 'T'}.NEGATE ×${action.charges}`, keyword: 'negate' }); break;
      case 'cleanse': extras.push({ text: `CLEANSE ${action.charges}`, keyword: 'cleanse' }); break;
      // A ward has NO property axis (unlike guard/negate above) — afflictions
      // carry no attacker property to match — so the face token is unqualified.
      case 'ward': extras.push({ text: `WARD ×${action.charges}`, keyword: 'ward' }); break;
      case 'taunt': extras.push({ text: 'TAUNT' }); break;
      case 'lifesteal': extras.push({ text: `LSTEAL ${action.pct}%`, keyword: 'lifesteal' }); break;
      case 'shieldBreak': extras.push({ text: `SHATTER ${action.amount}`, keyword: 'shatter' }); break;
      // User ruling (2026-08-20): the face token may say COMBO — the user's
      // own word for this mechanic — ON THE CONDITION that battle playback
      // greys it out whenever the combo isn't actually live (see CardToken's
      // `comboLive` option and `battleTimeline.ts`'s `isComboLive`/
      // `comboArchetypesByTurn`, which together supply that state). Outside
      // a fight (draft/shop/deck build/wiki) there is no "previous cast" to
      // be live against, so the token always renders in its normal
      // `KEYWORD_TEXT_COLOR.combo` color there — see those call sites.
      case 'comboBonus': extras.push({ text: `COMBO +${action.amount}`, keyword: 'combo' }); break;
      // CHAIN — the type-axis twin. The badge names the PARTNER TYPE, because
      // that (not the number) is the thing the player has to plan the board
      // around: "CHAIN +8 AFTER SWORD" is actionable, a bare "CHAIN +8" is not.
      // NOT wired to the combo badge's live/greyed-out treatment (CardToken's
      // `comboLive`, fed by battleTimeline's `isComboLive`): that machinery reads
      // ARCHETYPES per turn and would need a parallel last-cast-TYPE feed. The
      // badge is honest as static text meanwhile; the live state is a follow-up.
      case 'chainBonus': extras.push({ text: `CHAIN +${action.amount} AFTER ${action.after.toUpperCase()}`, keyword: 'chain' }); break;
      // The chip names the TYPE whose next cast collects, taken from the card
      // itself — the action carries no type of its own.
      case 'empowerNext': {
        const ownType = skill.element ?? skill.weapon;
        // Reads "NEXT" first, because landing on a FUTURE cast is the whole
        // difference between this and every other bonus-damage badge on a face.
        extras.push({ text: `NEXT ${ownType === undefined ? '' : `${ownType.toUpperCase()} `}+${action.amount}`, keyword: 'charge' });
        break;
      }
      // The two CONDITIONAL BONUS-DAMAGE riders (engine/types.ts). Both print
      // the flat number they actually add and the status they key off — no
      // invented noun for the mechanic, and no "x2": the engine adds a FLAT
      // bonus (a multiplier was rejected, see the `exploit` docs), so the face
      // must not imply one. Each token borrows the COLOR of the status it reads
      // (`KEYWORD_TEXT_COLOR.poison` etc.), which is the whole tell a player
      // needs: this number lights up when that status is on the board.
      case 'exploit': extras.push({ text: `+${action.amount} vs ${STATUS_TOKEN[action.status]}`, keyword: action.status === 'debuff' ? undefined : action.status }); break;
      // `per` per stack, and the CAP, because the cap is what the effect is
      // actually worth (and what it is priced on). `of` is spelled as the pile's
      // owner — YOUR stacks vs the target's — since the two play completely
      // differently.
      case 'stackBonus': extras.push({
        text: `+${action.per}/${STATUS_TOKEN[action.status]}${action.of === 'caster' ? '' : ' ON FOE'} (cap ${action.cap})`,
        keyword: action.status,
      }); break;
      // SHIELD BURST — the number it can spend, and WHOSE shield it is, because
      // "SHLD" on a face otherwise reads as plating GAINED. `SPEND` names the
      // direction in a word the player already understands from the glossary
      // entry, and the token borrows the existing `shield` color (no new palette
      // entry for a keyword that trades in the same currency).
      case 'shieldBurst': extras.push({ text: `SPEND SHLD ${action.cap}`, keyword: 'shield' }); break;
      // TAX BONUS — `per` per taxed card and the CAP, the same two numbers
      // `stackBonus` prints and for the same reason (the cap is what it is worth
      // and what it is priced on). "TAXED" is the noun the tempo keywords already
      // use on the face (SLOW +N / BURDEN +N WT are the taxes), so no new one is
      // invented; the token borrows `slow`'s color, the family both taxes share.
      case 'taxBonus': extras.push({ text: `+${action.per}/TAXED CARD (cap ${action.cap})`, keyword: 'slow' }); break;
      // WARD RELEASE — `shieldBurst`'s token one currency over, and worded the same
      // way for the same reason: "WARD" alone on a face reads as charges GAINED, so
      // `SPEND` names the direction. Both numbers print (`per` is what one charge is
      // worth, the cap is what it is worth in total and what it is priced on), and
      // the token borrows the existing `ward` color — same currency, no new palette
      // entry.
      case 'wardRelease': extras.push({ text: `SPEND WARD +${action.per}/CHG (cap ${action.cap})`, keyword: 'ward' }); break;
      // DESPERATION — the flat bonus and the gate, in the shortest honest form.
      // "HALF HP" is the whole condition and it is a RULE, not a card value, so it
      // reads as words rather than a number the player might mistake for tunable.
      // Borrows `bleed`'s red: the palette's one HP-colored entry, and the tell here
      // is "this lights up when your own bar is low".
      case 'desperation': extras.push({ text: `+${action.amount} BELOW HALF HP`, keyword: 'bleed' }); break;
      // OVERHEAL SHIELD — the cap is the only plannable number (how much wasted
      // healing actually banks). "OVERHEAL" is the noun the combat log already uses
      // for the wasted remainder of a heal (`heal.overheal`), so nothing new is
      // invented; borrows `shield`'s color, since plating is what it produces.
      case 'overhealShield': extras.push({ text: `OVERHEAL -> SHLD ${action.cap}`, keyword: 'shield' }); break;
      // CLEANSE CONVERT — `per` per stack cleansed and the cap, the `stackBonus`
      // reading. "HP" rather than "damage" because this one pays out in healing, and
      // it borrows `cleanse`'s color: the keyword it is strapped to is the tell.
      case 'cleanseConvert': extras.push({ text: `+${action.per} HP/CLEANSED (cap ${action.cap})`, keyword: 'cleanse' }); break;
      case 'slow': extras.push({ text: `SLOW +${action.weight}`, keyword: 'slow' }); break;
      // BURDEN — the weight tax at CARD scope, so its number is the SAME weight
      // SLOW prints above and it carries the same WT unit. (User ruling
      // 2026-08-20, on the token this replaces: "I been seeing splash +6 band,
      // what does that even mean." The unit was the fix then; the 2026-08-21
      // split makes the KEYWORD honest too — the +N WT belongs to the tax, which
      // is `burden`, not to the spreader.)
      case 'burden': extras.push({ text: `BURDEN +${action.weight} WT`, keyword: 'burden' }); break;
      // CURSE — the same shape one currency over: how much LESS the cursed card
      // hits for, and for how long. `-N DMG` rather than a bare number because
      // the sign is the whole point (every other DMG token on a face is damage
      // dealt), and the `Nt` turn suffix is the form expose/guard already use.
      case 'curse': extras.push({ text: `CURSE -${action.amount} DMG ${action.turns}t`, keyword: 'curse' }); break;
      // SPLASH — NO NUMBER AT ALL, because the spreader has none (see its docs in
      // engine/types.ts). A bare `SPLASH` token beside `BURDEN +6 WT` reads as
      // "that burden, spread", which is exactly what the card does; printing a
      // weight here is the misread the keyword split undid. The shape it names
      // (the anchor plus its edge-to-edge neighbours: 3 pieces mid-board, 2 at a
      // board edge, 1 on a lone card — it never wraps) is real and still
      // explained in full, just not on the compact face: it lives in
      // `cardGlossary.ts`'s `splash` entry (tap-to-expand) and
      // `combat/splash.ts`. "×3" would be wrong here for the reason the old
      // comment gave — the engine doesn't guarantee a fixed count.
      case 'splash': extras.push({ text: 'SPLASH', keyword: 'splash' }); break;
      case 'disrupt': extras.push({ text: `STAG ${action.amount}`, keyword: 'disrupt' }); break;
      // `statStrike` (the Resonant Echo gem's payload — see gems.ts) is an
      // EXTRA, self-contained hit with no `power` of its own (engine/types.ts):
      // it prints a SHARE of a stat instead of a flat number. This case was
      // entirely missing, so a card carrying only a `statStrike` (e.g. a bare
      // Echo socket) fell through every branch above and rendered as
      // `'PASSIVE'` — the face advertised the gem's weight cost (folded into
      // the printed WEIGHT already) but hid the second hit that weight paid
      // for. `echoHostPower` repeats a share of the WHOLE attack (this card's
      // own base + the caster's stat, see the action's own doc); a bare
      // `statStrike` (no current card content uses this form) shares the
      // caster's stat alone — both print the same terse `1/N` share the card
      // text already uses ("repeats at half strength").
      case 'statStrike': {
        const capNote = action.cap ? ` (cap ${action.cap})` : '';
        extras.push({ text: `${action.echoHostPower ? 'ECHO' : 'STRIKE'} 1/${action.shareOf}${capNote}` });
        break;
      }
    }
    if (action.affinity === true) {
      const parts: string[] = [];
      if (damage !== beforeDamage) parts.push(`${damage - beforeDamage} DMG`);
      if (heal !== beforeHeal) parts.push(`${heal - beforeHeal} HEAL`);
      if (shield !== beforeShield) parts.push(`${shield - beforeShield} SHIELD`);
      damage = beforeDamage;
      heal = beforeHeal;
      shield = beforeShield;
      for (let i = beforeExtras; i < extras.length; i += 1) parts.push(extras[i]!.text);
      extras.length = beforeExtras;
      const ownType = skill.element ?? skill.weapon;
      extras.push({
        text: `${ownType === undefined ? 'AFFINITY' : ownType.toUpperCase()}: ${parts.join(' ')}`,
        keyword: 'affinity',
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
  const shieldLabel = 'SHLD';
  if (damage) segments.push({ text: effectLine('DMG', damage, property, stats, true, mode, 'offense') });
  if (heal) segments.push({ text: effectLine('HEAL', heal, property, stats, property !== 'true', mode, 'defense') });
  // Shield gets the 'shield' keyword color (KEYWORD_TEXT_COLOR) — unlike bare
  // DMG/HEAL, a typed shield IS one of the markup keywords the flavor-text
  // renderer already colors, so this token can actually match it.
  if (shield) segments.push({ text: effectLine(shieldLabel, shield, property, stats, property !== 'true', mode, 'defense'), keyword: 'shield' });
  segments.push(...extras);
  return segments.length > 0 ? segments : [{ text: 'PASSIVE' }];
}

export function summarizeEffects(skill: SkillDef, stats?: ScalingStats, mode: SkillFaceMode = 'summed'): string {
  return summarizeEffectSegments(skill, stats, mode).map((segment) => segment.text).join(' · ');
}

export function describeAura(skill: SkillDef): string | null {
  const aura = skill.aura;
  if (!aura) return null;
  const range = describeAuraRange(skill);
  return [range, formatAuraModifiers(aura.mods)].filter(Boolean).join(' — ');
}
