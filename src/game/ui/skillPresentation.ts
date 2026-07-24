import type { BuffableStat, SkillDef } from '../../engine/types';

const STAT_ABBREV: Record<BuffableStat, string> = {
  attack: 'ATK',
  magicPower: 'MAG',
  armor: 'DEF',
  magicResist: 'MDEF',
  speed: 'SPD',
};

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
 * Compact effect summary for the card face — the numbers the player actually
 * plays for (damage, heal, shield, DoTs, buffs), not metadata like PL or size.
 *
 * When `stats` (the current combatant's live Attack/Magic Power) is supplied,
 * the scalable damage/heal/shield lines render as the SUMMED effective number
 * (base + live stat) — e.g. `Sword Slash` with 17 Attack shows `DMG 37`, not
 * a breakdown. Physical scales off Attack, magical off Magic Power, TRUE
 * damage off the higher of the two — TRUE heal/shield are flat (no stat
 * added, sum == base). Omitting `stats` (or a zero contribution) falls back
 * to the bare base number, e.g. `DMG 20`.
 */
export function summarizeEffects(skill: SkillDef, stats?: ScalingStats): string {
  if (skill.aura) return `AURA ${formatAuraModifiers(skill.aura.mods, true)}`;

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
      case 'buffStat': extras.push(`+${action.pct}% ${STAT_ABBREV[action.stat]}`); break;
      case 'debuffStat': extras.push(`-${action.pct}% ${STAT_ABBREV[action.stat]}`); break;
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
  if (damage) parts.push(scaledLabel('DMG', damage, property, stats, true));
  if (heal) parts.push(scaledLabel('HEAL', heal, property, stats, property !== 'true'));
  if (shield) parts.push(scaledLabel('SHLD', shield, property, stats, property !== 'true'));
  parts.push(...extras);
  return parts.join(' · ') || 'PASSIVE';
}

export function describeAura(skill: SkillDef): string | null {
  const aura = skill.aura;
  if (!aura) return null;
  const range = describeAuraRange(skill);
  return [range, formatAuraModifiers(aura.mods)].filter(Boolean).join(' — ');
}
