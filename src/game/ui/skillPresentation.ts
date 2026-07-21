import type { BuffableStat, SkillDef } from '../../engine/types';

const STAT_ABBREV: Record<BuffableStat, string> = {
  attack: 'ATK',
  magicPower: 'MAG',
  armor: 'DEF',
  magicResist: 'MDEF',
  speed: 'SPD',
  critPct: 'CRIT',
};

interface AuraModifierShape {
  damageFlat?: number;
  healFlat?: number;
  weightDelta?: number;
  critPctDelta?: number;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function isAuraSkill(skill: SkillDef): boolean {
  return Boolean(skill.aura);
}

export function formatAuraModifiers(mods: AuraModifierShape, compact = false): string {
  // FLAT damage/heal (no %); crit stays a percentage.
  return [
    mods.damageFlat === undefined ? '' : `${signed(mods.damageFlat)} ${compact ? 'DMG' : 'damage'}`,
    mods.healFlat === undefined ? '' : `${signed(mods.healFlat)} ${compact ? 'HEAL' : 'healing'}`,
    mods.weightDelta === undefined ? '' : `${signed(mods.weightDelta)} ${compact ? 'WT' : 'weight'}`,
    mods.critPctDelta === undefined ? '' : `${signed(mods.critPctDelta)}% ${compact ? 'CRIT' : 'critical chance'}`,
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

/**
 * Compact effect summary for the card face — the numbers the player actually
 * plays for (damage, heal, shield, DoTs, buffs), not metadata like PL or size.
 */
export function summarizeEffects(skill: SkillDef): string {
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
      case 'comboBonus': extras.push(`COMBO +${action.amount}`); break;
      case 'slow': extras.push(`SLOW +${action.weight}`); break;
      case 'disrupt': extras.push(`STAG ${action.amount}`); break;
    }
  }
  if (damage) parts.push(`DMG ${damage}`);
  if (heal) parts.push(`HEAL ${heal}`);
  if (shield) parts.push(`SHLD ${shield}`);
  parts.push(...extras);
  return parts.join(' · ') || 'PASSIVE';
}

export function describeAura(skill: SkillDef): string | null {
  const aura = skill.aura;
  if (!aura) return null;
  const range = describeAuraRange(skill);
  return [range, formatAuraModifiers(aura.mods)].filter(Boolean).join(' — ');
}
