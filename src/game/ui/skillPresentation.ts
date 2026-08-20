import { OFFENSIVE_KINDS } from '../../engine/balance';
import type { BuffableStat, SkillDef } from '../../engine/types';
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
 * The structured form behind `summarizeEffects()` — same tokens, same order,
 * each one tagged with its keyword id (see `EffectSegment`) instead of being
 * pre-joined into one flat string. `summarizeEffects()` below is now a thin
 * `.map(text).join(' · ')` over this; CardToken's segmented line renderer
 * uses THIS form directly so it can color each token independently.
 */
export function summarizeEffectSegments(skill: SkillDef, stats?: ScalingStats, mode: SkillFaceMode = 'summed'): EffectSegment[] {
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
      // `×N` marks a CHARGE count (one-time uses, spent as consumed) the same
      // way NEGATE and WARD mark theirs just below — a bare "CLEANSE 3" sat
      // inconsistently next to those two for the same kind of number (sweep,
      // 2026-08-20).
      case 'cleanse': extras.push({ text: `CLEANSE ×${action.charges}`, keyword: 'cleanse' }); break;
      // A ward has NO property axis (unlike guard/negate above) — afflictions
      // carry no attacker property to match — so the face token is unqualified.
      case 'ward': extras.push({ text: `WARD ×${action.charges}`, keyword: 'ward' }); break;
      case 'taunt': extras.push({ text: 'TAUNT' }); break;
      case 'lifesteal': extras.push({ text: `LSTEAL ${action.pct}%`, keyword: 'lifesteal' }); break;
      case 'shieldBreak': extras.push({ text: `SHATTER ${action.amount}`, keyword: 'shatter' }); break;
      // The keyword is 'combo' (glossary title "Combo", KEYWORD_TEXT_COLOR
      // has a 'combo' entry), but this face token printed 'SKILL' instead of
      // its own keyword's name. That word IS used elsewhere — battleTimeline's
      // `formatDmg`/`formatHeal` label the runtime `effectBonusDamage`/
      // `healFlat` bucket "SKILL" — but that is a DIFFERENT, wider thing: a
      // combined-at-resolve-time total across every flat bonus source
      // (aura AND comboBonus together), read inside an already-labeled `D: …`
      // derivation. This token instead names ONE card's OWN comboBonus effect
      // before combat ever runs, with no derivation line to lean on, so it
      // needs its own keyword's name to read on its own — "COMBO" (sweep,
      // 2026-08-20). `amount` is a flat damage add, spent by the next
      // `damage` action in this same cast (`CastCtx.bonusFlat`,
      // combat/interpreter.ts), so it gets the DMG unit too.
      case 'comboBonus': extras.push({ text: `COMBO +${action.amount} DMG`, keyword: 'combo' }); break;
      // WT is the established face abbreviation for a weight tax (see
      // `formatAuraModifiers`'s `compact` mode) — SLOW's `action.weight` is
      // exactly that currency, so it gets the same unit rather than a bare
      // number a player has to guess the meaning of.
      case 'slow': extras.push({ text: `SLOW +${action.weight} WT`, keyword: 'slow' }); break;
      // User ruling (2026-08-20): "I been seeing splash +6 band, what does
      // that even mean." SPLASH is `slow` at CARD scope, so its number is the
      // SAME weight tax SLOW prints above — it now carries the same WT unit
      // instead of the invented noun "BAND". The shape BAND used to name (the
      // anchor slot plus its edge-to-edge neighbours: 3 pieces mid-board, but
      // only 2 on a 2-card board or at a board edge — the band never wraps —
      // and 1 on a 1-card board) is real and still explained in full, just not
      // on the compact face: it lives in `cardGlossary.ts`'s `splash` entry
      // (tap-to-expand) and `combat/splash.ts`. "×3" would still be wrong here
      // for the reason the old comment gave — the engine doesn't guarantee a
      // fixed count — so the fix is the established unit, not a corrected count.
      case 'splash': extras.push({ text: `SPLASH +${action.weight} WT`, keyword: 'splash' }); break;
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
