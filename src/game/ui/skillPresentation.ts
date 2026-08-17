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
export function summarizeEffects(skill: SkillDef, stats?: ScalingStats, mode: SkillFaceMode = 'summed'): string {
  // Reach is the load-bearing word: an all-board +5 and an adjacent +15 are
  // the same PL, and the face must not present them as the same kind of card.
  if (skill.aura) {
    const reach = skill.aura.affects === 'allBoard' ? 'ALL' : 'NEAR';
    return `${reach} ${formatAuraModifiers(skill.aura.mods, true)}`;
  }

  const parts: string[] = [];
  let damage = 0;
  let heal = 0;
  let shield = 0;
  const extras: string[] = [];
  for (const action of skill.effects) {
    switch (action.kind) {
      case 'damage': damage += action.power; break;
      case 'heal': heal += action.power; break;
      case 'shield': shield += action.power; break;
      case 'poison': extras.push(`PSN ${action.stacks}`); break;
      case 'burn': extras.push(`BRN ${action.stacks}`); break;
      case 'bleed': extras.push(`BLD ${action.stacks}`); break;
      case 'stun': extras.push(`STUN ${action.turns}`); break;
      case 'thorns': extras.push(`THORN ${action.stacks}`); break;
      case 'buffStat': extras.push(`+${action.pct}% ${STAT_TOKEN[action.stat]}`); break;
      case 'debuffStat': extras.push(`-${action.pct}% ${STAT_TOKEN[action.stat]}`); break;
      case 'expose': extras.push(`EXPOSE ${action.pct}%`); break;
      // A guard covers ONE property, carried by the ACTION (not by the card —
      // a gem can graft a differently-typed guard onto any card), so the face
      // token names it: P.GUARD / M.GUARD / T.GUARD, mirroring the battle
      // log's P./M./T.SHIELD pool tokens. A bare "GUARD 20%" told the player
      // nothing about which damage it actually stops.
      case 'guard': extras.push(`${action.property === 'physical' ? 'P' : action.property === 'magical' ? 'M' : 'T'}.GUARD ${action.pct}%`); break;
      // A negate covers ONE property, carried by the ACTION exactly like guard
      // above — same gap, same fix: P.NEGATE / M.NEGATE / T.NEGATE, mirroring
      // the battle log's negateToken (battleTimeline.ts).
      case 'negate': extras.push(`${action.property === 'physical' ? 'P' : action.property === 'magical' ? 'M' : 'T'}.NEGATE ×${action.charges}`); break;
      case 'cleanse': extras.push(`CLEANSE ${action.charges}`); break;
      // A ward has NO property axis (unlike guard/negate above) — afflictions
      // carry no attacker property to match — so the face token is unqualified.
      case 'ward': extras.push(`WARD ×${action.charges}`); break;
      case 'taunt': extras.push('TAUNT'); break;
      case 'lifesteal': extras.push(`LSTEAL ${action.pct}%`); break;
      case 'shieldBreak': extras.push(`SHATTER ${action.amount}`); break;
      case 'comboBonus': extras.push(`SKILL +${action.amount}`); break;
      case 'slow': extras.push(`SLOW +${action.weight}`); break;
      case 'disrupt': extras.push(`STAG ${action.amount}`); break;
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
        extras.push(`${action.echoHostPower ? 'ECHO' : 'STRIKE'} 1/${action.shareOf}${capNote}`);
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
  if (damage) parts.push(effectLine('DMG', damage, property, stats, true, mode, 'offense'));
  if (heal) parts.push(effectLine('HEAL', heal, property, stats, property !== 'true', mode, 'defense'));
  if (shield) parts.push(effectLine(shieldLabel, shield, property, stats, property !== 'true', mode, 'defense'));
  parts.push(...extras);
  return parts.join(' · ') || 'PASSIVE';
}

export function describeAura(skill: SkillDef): string | null {
  const aura = skill.aura;
  if (!aura) return null;
  const range = describeAuraRange(skill);
  return [range, formatAuraModifiers(aura.mods)].filter(Boolean).join(' — ');
}
