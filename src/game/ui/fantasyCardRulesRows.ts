import { tierResolved, type SkillDef } from '../../engine/types';
import { cooldownClause, renderSkillFaceClauses, type SkillFaceClause } from '../../engine/keywords/compose';

export type FantasyRulesCategory = 'target' | 'attack' | 'healing' | 'defense' | 'debuff' | 'support' | 'bonus' | 'affinity' | 'passive' | 'timing' | 'flavor';
export interface FantasyCardRulesRow {
  category: FantasyRulesCategory;
  label: string;
  text: string;
  display: string;
  affinity: boolean;
}

export const FANTASY_RULES_STYLES: Record<FantasyRulesCategory, { label: string; color: string }> = {
  target: { label: 'TARGET', color: '#455c59' },
  attack: { label: 'ATTACK', color: '#983d35' },
  healing: { label: 'HEAL', color: '#346749' },
  defense: { label: 'DEFENSE', color: '#365875' },
  debuff: { label: 'DEBUFF', color: '#703e72' },
  support: { label: 'SUPPORT', color: '#6d5927' },
  bonus: { label: 'BONUS', color: '#8c4931' },
  affinity: { label: 'AFFINITY', color: '#4f4a8c' },
  passive: { label: 'PASSIVE', color: '#39665f' },
  timing: { label: 'TIMING', color: '#505763' },
  flavor: { label: '', color: '#56665a' },
};

function categoryOf(clause: SkillFaceClause): FantasyRulesCategory {
  if (clause.affinity) return 'affinity';
  switch (clause.kind) {
    case 'targeting': return 'target';
    case 'aura': return 'passive';
    case 'damage': case 'statStrike': case 'shieldBreak': return 'attack';
    case 'heal': case 'cleanse': return 'healing';
    case 'shield': case 'attunedShield': case 'guard': case 'negate': case 'ward': case 'thorns': return 'defense';
    default:
      return clause.group === 'payload' ? 'debuff' : clause.group === 'conditional' ? 'bonus' : 'support';
  }
}

function displayText(text: string, category: FantasyRulesCategory): string {
  let display = text.trim().replace(/\.$/, '');
  if (category === 'affinity') display = display.replace(/^\{\{Affinity\}\}\s*/, '');
  if (category === 'passive') display = display.replace(/^Passive:?\s*/, '');
  return display.replace(/^[a-z]/, letter => letter.toUpperCase());
}

function row(category: FantasyRulesCategory, text: string, affinity: boolean): FantasyCardRulesRow {
  return { category, label: FANTASY_RULES_STYLES[category].label, text, display: displayText(text, category), affinity };
}

export function fantasyCardRulesRows(raw: SkillDef): FantasyCardRulesRow[] {
  const skill = tierResolved(raw);
  const rows = renderSkillFaceClauses(skill).map(clause => row(categoryOf(clause), clause.text, clause.affinity));
  const cooldown = cooldownClause(skill);
  if (cooldown) rows.push(row('timing', cooldown, false));
  if (skill.flavor) rows.push(row('flavor', skill.flavor, false));
  if (rows.length === 0) rows.push(row('passive', 'Passive.', false));
  return rows;
}
