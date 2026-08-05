import type { Action, Archetype, Element, Property, SkillDef, SkillTier, WeaponType } from '../../engine/types';
import { weightOf } from '../../engine/types';
import { burnTotalDamage } from '../../engine/balance';

/** "10 → 4 → 2" — the tick sequence of a halving burn pile. */
function burnTickPreview(stacks: number): string {
  const ticks: number[] = [];
  for (let s = Math.max(0, Math.floor(stacks)); s > 0; s = Math.floor(s / 2)) ticks.push(2 * s);
  return ticks.join(' → ');
}

/**
 * Plain-language explanations for the parts of a card that the printed text
 * can't fit: property/element/weapon matchups, archetype meaning, weight,
 * board footprint, and the mechanical keywords used by the card's effects.
 * Pure text — the source of truth for the rules is the engine + CLAUDE.md
 * "Core mechanics (locked)"; keep wording in sync with
 * docs/card-text-style-guide.md §1.
 */

export interface GlossaryEntry {
  title: string;
  body: string;
}

const ARCHETYPE_EXPLANATION: Record<Archetype, string> = {
  offense: 'Offense — attack cards. Synergies and auras that boost Offense apply to this card.',
  defensive: 'Defense — shields, guards, and damage prevention.',
  healing: 'Healing — restores HP.',
  support: 'Support — buffs your stats or empowers other cards.',
  debuff: 'Debuff — weakens the enemy with poisons, stat drains, or delays.',
};

const PROPERTY_EXPLANATION: Record<Property, string> = {
  physical: 'Physical — damage is reduced by the enemy’s Armor and scales with the caster’s Attack. Blocked only by Physical shields.',
  magical: 'Magical — damage is reduced by the enemy’s Magic Resist and scales with the caster’s Magic Power. Blocked only by Magical shields.',
  true: 'TRUE — the card’s flat amount ignores Armor and Magic Resist and is blocked only by TRUE shields. The caster’s higher power stat is added on top, but that part IS reduced by the enemy’s matching defense (Attack vs Armor, Magic Power vs Magic Resist). TRUE heals and shields are flat amounts.',
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

export function propertyEntry(property: Property): GlossaryEntry {
  return { title: `${property === 'true' ? 'TRUE' : capitalize(property)} property`, body: PROPERTY_EXPLANATION[property] };
}

export function elementEntry(element: Element): GlossaryEntry {
  if (element === 'holy' || element === 'dark') {
    const opposite = element === 'holy' ? 'Dark' : 'Holy';
    return {
      title: `${capitalize(element)} element`,
      body: `${capitalize(element)} opposes ${opposite}: +50% damage to enemies attuned to ${opposite}, −25% to enemies attuned to ${capitalize(element)}.`,
    };
  }
  const index = ELEMENT_ORDER.indexOf(element);
  const beats = ELEMENT_ORDER[(index + 1) % ELEMENT_ORDER.length]!;
  const beatenBy = ELEMENT_ORDER[(index + ELEMENT_ORDER.length - 1) % ELEMENT_ORDER.length]!;
  return {
    title: `${capitalize(element)} element`,
    body: `${capitalize(element)} beats ${capitalize(beats)} (+50% vs ${capitalize(beats)}-attuned enemies) and loses to ${capitalize(beatenBy)} (−25% vs ${capitalize(beatenBy)}-attuned enemies).`,
  };
}

export function weaponEntry(weapon: WeaponType): GlossaryEntry {
  if (weapon === 'bow') {
    return { title: 'Bow weapon', body: 'Bow sits outside the weapon triangle: +50% damage against Beasts, no other matchup.' };
  }
  if (weapon === 'beast') {
    return { title: 'Beast weapon', body: 'Beast — natural weapons (fangs, claws). Outside the weapon triangle; Bows deal +50% against Beasts.' };
  }
  const beats = WEAPON_TRIANGLE[weapon]!;
  const beatenBy = (Object.keys(WEAPON_TRIANGLE) as WeaponType[]).find((key) => WEAPON_TRIANGLE[key] === weapon)!;
  return {
    title: `${capitalize(weapon)} weapon`,
    body: `${capitalize(weapon)} beats ${capitalize(beats)} (+50%) and loses to ${capitalize(beatenBy)} (−25%) in the weapon triangle.`,
  };
}

const TIER_PL_BUDGET: Record<SkillTier, number> = {
  bronze: 10,
  silver: 15,
  gold: 20,
  diamond: 25,
};

export function tierEntry(tier: SkillTier): GlossaryEntry {
  return {
    title: `${capitalize(tier)} tier`,
    body: `Card tiers: Bronze → Silver → Gold → Diamond. A ${capitalize(tier)} card is built on a ${TIER_PL_BUDGET[tier]} Power Level budget — higher tiers pack more total power onto one card.`,
  };
}

export function weightEntry(skill: SkillDef): GlossaryEntry {
  const weight = weightOf(skill);
  return {
    title: `Weight ${weight}`,
    body: `Playing this card costs ${weight} readiness. Everyone gains their Speed as readiness each turn; heavier cards take longer to afford, lighter cards come out sooner.`,
  };
}

/** "Power Level (PL)" — the standalone concept entry (as opposed to
 * `tierEntry`, which is about the TIER label). Any UI that shows a bare "PL"
 * number (card face, socket panel, hover tip) should attach this once so a
 * player can learn what the number IS, not just which tier it belongs to. */
export function powerLevelEntry(): GlossaryEntry {
  return {
    title: 'Power Level (PL)',
    body: 'A card’s total strength budget — every modifier (damage, shields, riders, gems) is priced in PL, and the tier sets the budget: Bronze 10 · Silver 15 · Gold 20 · Diamond 25. A socketed gem adds its own PL on top of the card’s base.',
  };
}

/** The "(+ATK)" / "(+MATK)" parenthetical printed on scaling card text —
 * explains that the flat number gets the caster's stat added at cast time. */
export function statScalingSuffixEntry(): GlossaryEntry {
  return {
    title: '(+ATK) / (+MATK) suffix',
    body: 'The flat number shown is added to your current Attack (physical cards, "+ATK") or Magic Power (magical cards, "+MATK") when the card resolves — e.g. "+20 (+ATK)" deals 20 plus your Attack stat.',
  };
}

export function slotEntry(skill: SkillDef): GlossaryEntry {
  const size = skill.size;
  if (size <= 1) {
    return { title: 'Board footprint: 1 slot', body: 'Takes 1 of your 10 board slots.' };
  }
  return {
    title: `Board footprint: ${size} slots`,
    body: `Takes ${size} of your 10 board slots, and casting spans ${size} turns — the caster is busy for ${size - 1} extra turn${size > 2 ? 's' : ''}.`,
  };
}

function keywordEntry(action: Action, property: Property): GlossaryEntry | undefined {
  switch (action.kind) {
    case 'shield':
      return {
        title: 'Typed shields',
        body: 'Shields stack, carry over between turns, and cap at max HP. A shield only blocks damage of its own property. TRUE shields block everything — TRUE damage point-for-point, but physical/magical damage drains them 2:1 (2 shield per point blocked).',
      };
    case 'poison':
      return {
        title: 'Poison',
        body: `Applies ${action.stacks} poison. At the END of each turn the victim takes damage equal to their poison count, then one stack falls off (${action.stacks} → ${Math.max(0, action.stacks - 1)} → …, ${(action.stacks * (action.stacks + 1)) / 2} total). They always act before it lands, and it bypasses shields; new poison adds to the pile.`,
      };
    case 'burn':
      return {
        title: 'Burn',
        body: `Applies ${action.stacks} burn — fierce and brief. At the START of each turn the victim takes DOUBLE their burn count in damage, then the stacks halve (${burnTickPreview(action.stacks)} = ${burnTotalDamage(action.stacks)} total) — it can kill before they act. Unlike poison, burn is absorbed by shields; new burn adds to the pile.`,
      };
    case 'bleed':
      return {
        title: 'Bleed',
        body: `Applies ${action.stacks} bleed — but NOT through shields: any active shield blocks the application. Once bleeding, the victim takes damage equal to their bleed count every time they PERFORM a cast, then one stack falls off (${(action.stacks * (action.stacks + 1)) / 2} total). Ticks bypass shields; fast multi-cast enemies bleed out faster, turtling stalls it.`,
      };
    case 'stun':
      return {
        title: 'Stun',
        body: `Consumes the enemy’s next ${action.turns > 1 ? `${action.turns} performances` : 'performance'} — they skip acting but still bank Speed.`,
      };
    case 'buffStat':
    case 'debuffStat':
      return {
        title: action.kind === 'buffStat' ? 'Stat buff' : 'Stat debuff',
        body: `Lasts ${action.turns} global turns — every performance by either side advances the counter, so it can expire mid-exchange.`,
      };
    case 'guard':
      return {
        title: 'Guard',
        body: `Reduces incoming ${action.property === 'true' ? 'all' : action.property} damage by ${action.pct}% for ${action.turns} global turns (capped at 60%).`,
      };
    case 'negate':
      return {
        title: 'Negate',
        body: `Fully cancels the next ${action.charges > 1 ? `${action.charges} direct ${action.property === 'true' ? '' : `${action.property} `}hits` : `direct ${action.property === 'true' ? '' : `${action.property} `}hit`}. DoT ticks never spend a charge; max 3 charges per property.`,
      };
    case 'expose':
      return {
        title: 'Expose',
        body: `The enemy takes +${action.pct}% damage from all direct hits for ${action.turns} global turns (the mirror of Guard). DoT ticks are unaffected. Capped at 50%.`,
      };
    case 'cleanse':
      return {
        title: 'Cleanse',
        body: `Removes up to ${action.charges} ailment stacks from you, soonest-to-expire first (ties by application order). Each charge strips one stack of a poison/burn/bleed pile, or removes a stun/stat debuff/expose whole.`,
      };
    case 'slow':
      return { title: 'Slow', body: `The enemy’s next action becomes ${action.weight} weight heavier, so it comes out later.` };
    case 'disrupt':
      return { title: 'Stagger', body: `Drains ${action.amount} from the enemy’s banked readiness, delaying their next play.` };
    case 'lifesteal':
      return { title: 'Lifesteal', body: `Heals the caster for ${action.pct}% of the damage this cast dealt.` };
    case 'shieldBreak':
      return { title: 'Shield break', body: `Shatters up to ${action.amount} enemy shield before the hit lands.` };
    case 'comboBonus':
      return {
        title: 'Combo',
        body: 'Bonus applies when the caster’s previous cast shared an archetype with this card.',
      };
    case 'heal':
      return property === 'true'
        ? { title: 'TRUE heal', body: 'TRUE heals are flat — no stat is added on top.' }
        : undefined;
    default:
      return undefined;
  }
}

/** Glossary entries for every mechanical keyword this card's effects use. */
export function skillKeywordEntries(skill: SkillDef): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const action of skill.effects) {
    const entry = keywordEntry(action, skill.property);
    if (entry && !seen.has(entry.title)) {
      seen.add(entry.title);
      entries.push(entry);
    }
  }
  return entries;
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
  if (skill.property === 'true') entries.push(propertyEntry('true'));
  return entries;
}
