import { TIER_ORDER, tierResolved, weightOf, type Action, type Property, type SkillDef, type SkillTier } from '../../engine/types';
import type { GemDef } from '../../data/gems';
import { skillBook } from '../../data/skills';
import { applyTier, gemCardMods, resolveDisplaySkill } from '../../engine/cards';
import { AFFINITY_SEPARATOR, cooldownClause, renderCtxOf, renderSkillClauses } from '../../engine/keywords/compose';
import { faceClauseOf, ruleSentenceOf, ruleTitleOf, STAT_TOKEN, withTermEntries, type RenderCtx } from '../../engine/keywords/text';
import { renderGemText } from '../../engine/keywords/gemText';
import { typeBadgeEntries } from './cardGlossary';
import { stripCardTextMarkup } from './cardTextMarkup';
import type { TierProgress } from '../../run/shop';
import { tierProgressLine } from './tierProgressDisplay';
export interface CardDetailsEntry { title: string; body: string }
export interface CardDetailsContent {
  weight: number;
  roles: string[];
  entries: CardDetailsEntry[];
  gem?: CardDetailsEntry;
  /** "1/2 to Gold"-style merge progress line, or `null` when no `progress`
   * was supplied or the tier is Diamond. */
  progressLine: string | null;
}
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
export function cardDetailsPreviewTiers(skill: SkillDef): readonly SkillTier[] { return skillBook[skill.id] ? TIER_ORDER : [skill.tier]; }
export function resolveCardDetailsPreview(skill: SkillDef, tier: SkillTier, gem?: GemDef | null): SkillDef {
  const base = skillBook[skill.id];
  if (!base || tier === skill.tier) return skill;
  const preview = applyTier(base, tier);
  return gem ? resolveDisplaySkill(preview, { skillId: skill.id, slot: 0, gem }) : preview;
}

/** Bind each registry parameter to its typed meaning. Positional bindings are
 * deliberately per action kind: percentages, duration and caps are not one X. */
const GUARD_WORD: Record<Property, string> = { physical: 'physical', magical: 'magic', true: 'TRUE' };
const SHIELD_WORD: Record<Property, string> = { physical: 'P. Shield', magical: 'M. Shield', true: 'True Shield' };
const turnsOf = (turns: number) => `${turns} ${turns === 1 ? 'turn' : 'turns'}`;

function specificRule(action: Action, ctx: RenderCtx): { rule: string; standalone: boolean } {
  const rule = ruleSentenceOf(action);
  const generic = (text: string) => ({ rule: text, standalone: false });
  const own = (text: string) => ({ rule: text, standalone: true });
  let parameters: Array<string | number>;
  switch (action.kind) {
    case 'guard': return own(`Reduce ${GUARD_WORD[action.property]} damage by ${action.pct}% for ${turnsOf(action.turns)}.`);
    case 'negate': return own(`Prevent the next ${action.charges} ${action.property === 'true' ? 'TRUE' : action.property} ${action.charges === 1 ? 'attack' : 'attacks'}.`);
    case 'overhealShield': return own(`Convert up to ${action.cap} excess healing into ${SHIELD_WORD[ctx.property]}.`);
    case 'stackBonus': return own(action.status === 'burden'
      ? `Each Burdened card adds ${action.per} damage, up to ${action.cap}.`
      : `Each ${titleCase(action.status)} stack ${action.of === 'caster' ? 'you have' : 'on the target'} adds ${action.per} damage, up to ${action.cap}.`);
    case 'empowerNext': {
      const type = ctx.element ?? ctx.weapon;
      return own(`Add ${action.amount} damage to the next ${type ? `${titleCase(type)} ` : ''}card.`);
    }
    case 'shieldBreak': parameters = [action.amount]; break;
    // The generated shield clause already includes the DEF/MDEF contribution;
    // binding only base power here would falsely cap the resolved shield.
    case 'shield': return generic('Prevents Bleed while active.');
    case 'statStrike': parameters = [`1/${action.shareOf}`, `1/${action.shareOf}`]; break;
    case 'lifesteal': parameters = [`${action.pct}%`]; break;
    // These rules read a changing status pile, not this card's applied amount.
    // The generated clause above carries the actual stacks this card adds.
    case 'poison': return generic('At the end of each turn, deal damage equal to current Poison stacks, then lose 1 Poison.');
    case 'burn': return generic('At the start of each turn, deal damage equal to twice current Burn stacks, then halve Burn.');
    case 'bleed': return generic('After the first card played each turn, deal damage equal to current Bleed stacks and lose 1 Bleed.');
    case 'thorns': return generic('When hit by an attack, deal physical damage equal to current Thorns stacks, then lose 1 Thorns.');
    case 'regen': return generic('At the end of each turn, heal HP equal to current Regen stacks, then lose 1 Regen.');
    case 'buffStat': case 'debuffStat': case 'expose': parameters = [action.pct, action.turns]; break;
    case 'slow': case 'burden': parameters = [action.weight]; break;
    case 'curse': parameters = [action.amount, action.turns]; break;
    case 'disrupt': case 'taunt': case 'comboBonus': case 'desperation': case 'haste': case 'execute': parameters = [action.amount]; break;
    case 'ward': case 'cleanse': parameters = [action.charges]; break;
    case 'chainBonus': parameters = [action.amount, titleCase(action.after)]; break;
    case 'cleanseConvert': parameters = [action.per, action.cap]; break;
    default: return generic(/\bX\b|2X/.test(rule) ? '' : rule);
  }
  const slots = rule.match(/2X|1\/X|\bX\b/g) ?? [];
  // A future registry grammar change falls back to the exact generated clause
  // instead of silently binding a quantity to the wrong meaning.
  if (slots.length !== parameters.length) return generic('');
  let index = 0;
  return { rule: rule.replace(/2X|1\/X|\bX\b/g, () => String(parameters[index++])), standalone: true };
}

/** Concrete clauses come from the face composer, never generic X-based rules.
 * The sole contextual expansion is an action-kind rule, not per-card prose. */
function ownWeight(skill: SkillDef, gem?: GemDef | null): number {
  return Math.max(1, weightOf(skill) + (gemCardMods(gem).weightDelta ?? 0));
}
function entriesFor(raw: SkillDef, gem?: GemDef | null): CardDetailsEntry[] {
  const skill = tierResolved({ ...raw, speedWeight: ownWeight(raw, gem), effects: raw.effects.filter(action => action.fromGem !== true) });
  const ctx = renderCtxOf(skill);
  const candidates = skill.effects.map(action => {
    if (!action.affinity && (action.kind === 'poison' || action.kind === 'burn' || action.kind === 'bleed' || action.kind === 'thorns')) {
      const stacks = skill.effects.reduce((total, other) => total + (other.kind === action.kind && !other.affinity && 'stacks' in other ? other.stacks : 0), 0);
      return { ...action, stacks };
    }
    return action;
  });
  const entries = renderSkillClauses(skill).map(clause => {
    const gated = clause.startsWith('{{Affinity}}');
    const prefix = gated ? `${stripCardTextMarkup(clause.slice(0, clause.indexOf(AFFINITY_SEPARATOR)))}${AFFINITY_SEPARATOR}` : '';
    const action = candidates.find(candidate => Boolean(candidate.affinity) === gated && (clause === faceClauseOf(candidate, ctx)
      || clause.endsWith(`${AFFINITY_SEPARATOR}${faceClauseOf(candidate, { ...ctx, gated: true })}`)));
    if (action?.kind === 'exploit') {
      const status = titleCase(action.status);
      const target = action.status === 'stun' ? 'stunned targets' : `targets with ${action.status === 'debuff' ? 'a debuff' : status}`;
      return { title: `Exploit — ${status}`, body: `${action.affinity ? `Requires 3 ${titleCase(skill.element ?? skill.weapon ?? 'matching type')} cards on your board. ` : ''}Deal ${action.amount} additional damage against ${target}.` };
    }
    if (action?.kind === 'debuffStat' || action?.kind === 'buffStat') {
      const verb = action.kind === 'debuffStat' ? 'Reduce enemy' : 'Increase';
      return { title: ruleTitleOf(action), body: `${prefix}${verb} ${STAT_TOKEN[action.stat]} by ${action.pct}% for ${action.turns} ${action.turns === 1 ? 'turn' : 'turns'}.` };
    }
    if (action?.kind === 'shieldBurst' || action?.kind === 'wardRelease') {
      const maxCharges = action.kind === 'wardRelease' ? Math.ceil(action.cap / action.per) : 0;
      const rule = action.kind === 'shieldBurst'
        ? `Consume Shield to deal up to ${action.cap} damage.`
        : `Consume Ward charges to deal ${action.per} damage per charge (max ${maxCharges} ${maxCharges === 1 ? 'charge' : 'charges'}).`;
      return { title: ruleTitleOf(action), body: `${prefix}${rule}` };
    }
    const markup = clause.match(/\{\{([^}:|]+)/)?.[1];
    const title = action ? ruleTitleOf(action) : undefined;
    const { rule, standalone } = action ? specificRule(action, ctx) : { rule: '', standalone: false };
    const body = stripCardTextMarkup(clause);
    return { title: title || (clause.startsWith('Deal ') ? 'Damage' : clause.startsWith('Restore ') ? 'Healing' : markup ?? (clause.startsWith('Passive:') ? 'Passive' : 'Ability')),
      body: !rule || /\bX\b|2X/.test(rule) ? body : standalone ? `${prefix}${rule}` : `${body}. ${rule}` };
  });
  if (skill.effects.some(action => action.affinity)) entries.push({ title: 'Affinity', body: `Requires 3 ${titleCase(skill.element ?? skill.weapon ?? 'matching type')} cards on your board to activate the Affinity effects.` });
  const cooldown = cooldownClause(skill);
  if (cooldown) entries.push({ title: 'Cooldown', body: cooldown });
  const hits = skill.effects.filter(action => action.kind === 'damage' && !action.affinity).length;
  if (hits > 1) entries.push({ title: 'Multi-Hit', body: `This card hits ${hits} times. Each hit resolves separately.` });
  // TRUE sink quantities already appear in their exact generated clauses;
  // parameterized glossary definitions would reintroduce generic X amounts.
  entries.push(...typeBadgeEntries(skill).filter(entry => !/\bX\b/.test(entry.body) && (skill.property !== 'true' || entry.title.startsWith('(T)'))).map(entry => ({ ...entry, body: entry.body.replace(' Has no other weapon matchup.', '') })));
  return withTermEntries(entries);
}

/** One inspector projection for Shop, Deck and Draft; catalogs remain read-only. */
export function buildCardDetailsContent(skill: SkillDef, opts: { gem?: GemDef | null; progress?: TierProgress } = {}): CardDetailsContent {
  const entries = entriesFor(skill, opts.gem);
  return {
    weight: ownWeight(skill, opts.gem),
    roles: skill.archetypes.map(titleCase),
    entries,
    gem: opts.gem ? { title: 'Gem effect', body: `${opts.gem.name} — ${stripCardTextMarkup(renderGemText(opts.gem))}` } : undefined,
    progressLine: opts.progress ? tierProgressLine(opts.progress) : null,
  };
}
