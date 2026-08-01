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
}

/** The caster's scaling stat contribution for a given property, per the engine's `scaleStat` rule. */
function statContribution(property: SkillDef['property'], stats: ScalingStats): number {
  switch (property) {
    case 'physical': return stats.attack;
    case 'magical': return stats.magicPower;
    case 'true': return Math.max(stats.attack, stats.magicPower);
  }
}

/** `DMG 37` — the summed EFFECTIVE number (base + live stat) when stats are known and contribute; else the bare base number. */
function scaledLabel(label: string, base: number, property: SkillDef['property'], stats: ScalingStats | undefined, statScales: boolean): string {
  if (stats && statScales) {
    const contribution = statContribution(property, stats);
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

/** The stat a non-TRUE effect scales off, per the engine's `scaleStat` rule. */
function scalingStatKey(property: 'physical' | 'magical'): BuffableStat {
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
  stats: ScalingStats | undefined, statScales: boolean, mode: SkillFaceMode,
): string {
  if (property === 'true') return `${scaledLabel(label, base, property, stats, statScales)} (T)`;
  if (mode === 'composition' && statScales) return `${label} ${base} +${STAT_TOKEN[scalingStatKey(property)]}`;
  return scaledLabel(label, base, property, stats, statScales);
}

/**
 * Compact effect summary for the card face — the numbers the player actually
 * plays for (damage, heal, shield, DoTs, buffs), not metadata like PL or size.
 *
 * `mode` (default `'summed'`, mobile's long-standing behavior) picks the
 * number treatment for damage/heal/shield lines — see `SkillFaceMode`/
 * `effectLine`. Physical scales off Attack, magical off Magic Power, TRUE
 * damage off the higher of the two (and still gets a stat add, unlike TRUE
 * heal/shield, which are pure flat numbers) — see `cardGlossary.ts`'s `true`
 * entry.
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
      case 'buffStat': extras.push(`+${action.pct}% ${STAT_TOKEN[action.stat]}`); break;
      case 'debuffStat': extras.push(`-${action.pct}% ${STAT_TOKEN[action.stat]}`); break;
      case 'expose': extras.push(`EXPOSE ${action.pct}%`); break;
      case 'guard': extras.push(`GUARD ${action.pct}%`); break;
      case 'negate': extras.push(`NEGATE ×${action.charges}`); break;
      case 'cleanse': extras.push(`CLEANSE ${action.charges}`); break;
      case 'taunt': extras.push('TAUNT'); break;
      case 'lifesteal': extras.push(`LSTEAL ${action.pct}%`); break;
      case 'shieldBreak': extras.push(`SHATTER ${action.amount}`); break;
      case 'comboBonus': extras.push(`SKILL +${action.amount}`); break;
      case 'slow': extras.push(`SLOW +${action.weight}`); break;
      case 'disrupt': extras.push(`STAG ${action.amount}`); break;
    }
  }
  const property = skill.property;
  // Shield's composition-mode label is 'DEF' (matching the "+96 DEF (+Attack)"
  // grammar the card data itself already uses) — 'summed'/mobile keeps 'SHLD'.
  const shieldLabel = mode === 'composition' && property !== 'true' ? 'DEF' : 'SHLD';
  if (damage) parts.push(effectLine('DMG', damage, property, stats, true, mode));
  if (heal) parts.push(effectLine('HEAL', heal, property, stats, property !== 'true', mode));
  if (shield) parts.push(effectLine(shieldLabel, shield, property, stats, property !== 'true', mode));
  parts.push(...extras);
  return parts.join(' · ') || 'PASSIVE';
}

export function describeAura(skill: SkillDef): string | null {
  const aura = skill.aura;
  if (!aura) return null;
  const range = describeAuraRange(skill);
  return [range, formatAuraModifiers(aura.mods)].filter(Boolean).join(' — ');
}
