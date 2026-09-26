import { tierResolved, type Archetype, type Element, type Property, type SkillDef, type SkillTier, type WeaponType } from '../../engine/types';
import { weightOf } from '../../engine/types';
import { AURA_RULE_ENTRY, HEAVY_RULE_ENTRY, LIGHTWEIGHT_RULE_ENTRY, MULTI_HIT_RULE_ENTRY, TRUE_RULE_ENTRY, ruleEntriesOf, withTermEntries } from '../../engine/keywords/text';

/**
 * CARD GLOSSARY — the short, mid-decision explanations for the parts of a
 * card its face cannot fit: property/element/weapon matchups, archetype,
 * weight, board footprint, tier, Power Level, and one entry per mechanical
 * keyword the card's effects use.
 *
 * THE KEYWORD ENTRIES ARE NO LONGER WRITTEN HERE. They are one lookup into
 * `src/engine/keywords/text.ts`'s `ruleSentence` facet — exhaustive by its
 * mapped type, and PARAMETER-FREE, so the helper a player presses reads
 * identically on every card carrying that keyword. The three
 * re-derivations this file used to carry (burn’s halving tick preview and
 * the poison/bleed triangular totals, each duplicating `tickTurnDot`'s rule
 * from `src/engine/combat/simulate.ts`) went with them: they interpolated
 * the card’s own stack count into what is supposed to be a definition, and
 * a definition that quotes one card’s numbers is the same defect as a card
 * face that quotes the rule.
 *
 * Everything still here is CARD-SCOPED rather than keyword-scoped (this
 * card's tier, this card's weight, this card's type matchup) — which is
 * exactly why it may name this card’s numbers.
 */

/**
 * Player-facing names for the CARD TYPES the affinity gate can name — the
 * weapon and element vocabularies `cardType`
 * (engine/combat/typeIdentity.ts) draws from. Display data, because the
 * engine’s own identifiers are lowercase and a card face should not print
 * them raw.
 */
const TYPE_NAME: Record<string, string> = {
  sword: 'Sword', axe: 'Axe', lance: 'Lance', bow: 'Bow', beast: 'Beast',
  fire: 'Fire', frost: 'Frost', lightning: 'Lightning', nature: 'Nature', holy: 'Holy', dark: 'Dark',
};

export interface GlossaryEntry {
  title: string;
  body: string;
}

const ARCHETYPE_EXPLANATION: Record<Archetype, string> = {
  offense: 'Attack cards.',
  defensive: 'Shields, guards, damage prevention.',
  healing: 'Restores HP.',
  support: 'Buffs your stats or empowers other cards.',
  debuff: 'Weakens the enemy — poison, stat drain, or delay.',
};

const PROPERTY_EXPLANATION: Record<Property, string> = {
  physical: 'Physical damage scales with ATK. Physical healing and Shield scale with DEF.',
  magical: 'Magical damage scales with MATK. Magical healing and Shield scale with MDEF.',
  true: 'Ignores type matchups.',
};

const ELEMENT_ORDER: readonly Element[] = ['fire', 'nature', 'lightning', 'frost'];

const WEAPON_TRIANGLE: Partial<Record<WeaponType, WeaponType>> = {
  sword: 'axe',
  axe: 'lance',
  lance: 'sword',
};

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function archetypeEntry(archetype: Archetype): GlossaryEntry {
  return { title: `${capitalize(archetype)} archetype`, body: ARCHETYPE_EXPLANATION[archetype] };
}

/**
 * AFFINITY IS ITS OWN ENTRY, and a gated keyword KEEPS ITS OWN.
 *
 * A gated action once returned one entry that glued the gate and action rule
 * together. The gate is now its own entry, emitted once per card, and the
 * gated action's entry is byte-identical to the ungated one. Desktop hover
 * and card detail therefore consume the same complete canonical entries.
 */
function affinityGateEntry(_ownType?: Element | WeaponType): GlossaryEntry {
  return {
    title: 'Affinity',
    body: 'Requires 3 cards of this type on your board to activate this effect.',
  };
}

export function propertyEntry(property: Property): GlossaryEntry {
  return {
    title: property === 'true' ? '(T) TRUE' : `${capitalize(property)} property`,
    body: PROPERTY_EXPLANATION[property],
  };
}

function trueRuleEntry(skill: SkillDef): GlossaryEntry {
  if (skill.effects.some((action) => action.kind === 'damage')) return TRUE_RULE_ENTRY.damage;
  if (skill.effects.some((action) => action.kind === 'heal')) return TRUE_RULE_ENTRY.heal;
  if (skill.effects.some((action) => action.kind === 'shield')) return TRUE_RULE_ENTRY.shield;
  return TRUE_RULE_ENTRY.other;
}

export function elementEntry(element: Element): GlossaryEntry {
  if (element === 'holy' || element === 'dark') {
    const opposite = element === 'holy' ? 'Dark' : 'Holy';
    return {
      title: `${capitalize(element)} element`,
      body: `Deals +50% damage against ${opposite} Affinity.`,
    };
  }
  const index = ELEMENT_ORDER.indexOf(element);
  const beats = ELEMENT_ORDER[(index + 1) % ELEMENT_ORDER.length]!;
  return {
    title: `${capitalize(element)} element`,
    body: `Deals +50% damage against ${capitalize(beats)} Affinity.`,
  };
}

export function weaponEntry(weapon: WeaponType): GlossaryEntry {
  if (weapon === 'bow') {
    return { title: 'Bow weapon', body: 'Deals +50% damage against Beast Affinity.' };
  }
  if (weapon === 'beast') {
    return { title: 'Beast weapon', body: 'Deals neutral damage to all types.' };
  }
  const beats = WEAPON_TRIANGLE[weapon]!;
  return {
    title: `${capitalize(weapon)} weapon`,
    body: `Deals +50% damage against ${capitalize(beats)} Affinity.`,
  };
}

export function tierEntry(tier: SkillTier): GlossaryEntry {
  return {
    title: `Rank ${capitalize(tier)}`,
    body: '',
  };
}

export function weightEntry(skill: SkillDef): GlossaryEntry {
  const weight = weightOf(skill);
  return {
    title: `Weight ${weight}`,
    body: `Requires ${weight} readiness to play.`,
  };
}

/**
 * The face's "AOE" token unpacked — same idiom as every other keyword entry
 * below (a face abbreviation always has a matching explanation reachable via
 * hover/inspect). Callers gate this on `isAoeSkill` (`skillPresentation.ts`)
 * so it only attaches to a card whose EFFECTIVE (post-tier) scope is `'all'`.
 */
export function targetingEntry(): GlossaryEntry {
  return {
    title: 'AoE targeting',
    body: 'Applies offensive effects to every living foe in board order.',
  };
}

/** "Power Level (PL)" — the standalone concept entry (as opposed to
 * `tierEntry`, which is about the TIER label). Any UI that shows a bare "PL"
 * number (card face, socket panel, hover tip) should attach this once so a
 * player can learn what the number IS, not just which tier it belongs to. */
export function powerLevelEntry(): GlossaryEntry {
  return {
    title: 'Power Level (PL)',
    body: 'Measures the total cost of the card’s effects and gems.',
  };
}

export function slotEntry(skill: SkillDef): GlossaryEntry {
  const size = skill.size;
  if (size <= 1) {
    return { title: 'Size 1', body: 'Uses 1 of 10 board slots.' };
  }
  return {
    title: `Size ${size}`,
    body: `Uses ${size} of 10 board slots. After playing, remains busy for ${size - 1} additional turn${size > 2 ? 's' : ''}.`,
  };
}

/**
 * THE KEYWORD HELPER, looked up rather than switched on.
 *
 * This used to be a hand-written `switch` ending in `default: return
 * undefined` — non-exhaustive by construction, which is how `attunedShield`
 * printed nothing on any card face for nine days and how 12 rider kinds
 * shipped with no glossary entry at all. It is now ONE lookup into the
 * keyword registry (`src/engine/keywords/text.ts`), whose mapped type
 * (`{ [K in Action['kind']]: ... }`) makes a missing row a `tsc` error.
 *
 * THE BODY IS A DEFINITION, NOT A DESCRIPTION OF THIS CARD (user-locked
 * 2026-09-06: "I dont think you should be explaining the amount of x debuff
 * like poison 8 or thorn 5 as other cards that have other amounts"). Every
 * body used to interpolate the action — `Applies ${action.stacks} poison`,
 * `Grants ${action.stacks} thorn stacks`, `Prevents the next
 * ${action.charges} ailments` — so the helper a player pressed said
 * something different on every card carrying the same keyword. The card
 * face carries the amount; this reads identically everywhere.
 *
 * The gate sentence is a separate entry (`affinityGateEntry`), so no entry
 * mixes a card-specific requirement into a keyword’s definition.
 */

/** Glossary entries for every mechanical keyword this card's effects use.
 *
 * Tier-lock resolved first, for the reason `summarizeEffectSegments` states
 * (skillPresentation.ts): a keyword whose only source is a line locked above
 * this copy's tier must not be explained on this copy's face. Idempotent — an
 * already-resolved skill comes back by reference. */
export function skillKeywordEntries(raw: SkillDef): GlossaryEntry[] {
  const skill = tierResolved(raw);
  const entries: GlossaryEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: GlossaryEntry): void => {
    if (seen.has(entry.title)) return;
    seen.add(entry.title);
    entries.push(entry);
  };
  // THE GATE FIRST, once, if ANY line on this card is gated — it is a fact
  // about the card, not about the keyword behind it.
  if (skill.effects.some((action) => action.affinity === true)) {
    push(affinityGateEntry(skill.element ?? skill.weapon));
  }
  if (skill.aura) {
    push(AURA_RULE_ENTRY);
  }
  // ONLY UNCONDITIONAL damage lines count toward Multi-Hit. An `affinity`-gated
  // second hit is exactly what `countDamageActions` (combat/interpreter.ts)
  // excludes from its own divisor, and what `kindred_flame`'s content notes
  // spell out as a pricing rule: "the premium prices a hit COUNT the card
  // RELIABLY has, and a gated hit makes that count board-dependent — one hit
  // off-type, two on-type." A card that hits once off its own type and twice
  // on it is not reliably a two-hit card, so it does not get the keyword.
  // (`minTier` needs no matching check of its OWN here — but a `minTier`
  // action that SURVIVES `tierResolved` above is not automatically
  // unconditional: `{ affinity: true, minTier: 'diamond' }` is a documented
  // composite (`src/engine/types.ts`, the five capstones' shape) that exists
  // only from Diamond and, once it exists, still only fires on the right
  // board. `tierResolved` only ever removes the tier gate; it is the
  // `affinity !== true` clause below — already needed for the ungated
  // `affinity` case — that catches this one too, because the composite still
  // carries `affinity: true` after the tier strip.)
  if (skill.effects.filter((action) => action.kind === 'damage' && action.affinity !== true).length > 1) {
    push(MULTI_HIT_RULE_ENTRY);
  }
  if (weightOf(skill) < skill.size * 10) {
    push(LIGHTWEIGHT_RULE_ENTRY);
  } else if (weightOf(skill) > skill.size * 10) {
    push(HEAVY_RULE_ENTRY);
  }
  // ...then every keyword’s OWN definition, gated or not, unchanged. A
  // `buffStat`/`debuffStat` line also opens the STAT it names
  // (`ruleEntriesOf`, the seam the gem pass exported for exactly this): a
  // face printing `+20% ATK` should be able to answer "what is ATK".
  for (const action of skill.effects) {
    for (const entry of ruleEntriesOf(action)) push(entry);
  }
  return withTermEntries(entries);
}

/** The tooltip for the type badge: element or weapon matchup, else property. */
export function typeBadgeEntry(skill: SkillDef): GlossaryEntry {
  if (skill.element) return elementEntry(skill.element);
  if (skill.weapon) return weaponEntry(skill.weapon);
  return propertyEntry(skill.property);
}

/**
 * All entries the type badge should teach. Every card is typed by a weapon or
 * element, but a TRUE-property card's type is cosmetic — its badge must also
 * explain that TRUE ignores defenses and matchups.
 */
export function typeBadgeEntries(skill: SkillDef): GlossaryEntry[] {
  const entries = [typeBadgeEntry(skill)];
  if (skill.property === 'true') entries.push(trueRuleEntry(skill));
  return entries;
}
