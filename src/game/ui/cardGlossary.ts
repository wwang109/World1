import type { Action, Archetype, Element, Property, SkillDef, SkillTier, WeaponType } from '../../engine/types';
import { MAX_WARD_CHARGES, weightOf } from '../../engine/types';
import { burnTotalDamage } from '../../engine/balance';

/**
 * "10 → 4 → 2" — the tick sequence of a halving burn pile.
 *
 * RE-DERIVATION NOTICE (src/game may not touch src/engine — CLAUDE.md layer
 * rule — and no exported helper for the SEQUENCE exists there today, only the
 * TOTAL via `burnTotalDamage`, imported below): this loop duplicates burn's
 * halving rule from its one authoritative implementation, `tickTurnDot` in
 * `src/engine/combat/simulate.ts` (`status.stacks = Math.floor(stacks / 2)`
 * for burn). If that rule ever changes, this function and its two siblings —
 * the poison/bleed triangular `stacks*(stacks+1)/2` re-derivations inlined in
 * `keywordEntry`'s `'poison'` and `'bleed'` cases just below — are the other
 * two places that must change with it. Left as three separate re-derivations
 * on purpose rather than a new shared `src/game`-local helper (2026-08-17
 * scope call): consolidating them was judged riskier than clearly marking
 * all three so the next reader finds every copy.
 */
function burnTickPreview(stacks: number): string {
  const ticks: number[] = [];
  for (let s = Math.max(0, Math.floor(stacks)); s > 0; s = Math.floor(s / 2)) ticks.push(2 * s);
  return ticks.join(' → ');
}

/**
 * Short mid-decision explanations for the parts of a card the printed text
 * can't fit: property/element/weapon matchups, archetype meaning, weight,
 * board footprint, and the mechanical keywords used by the card's effects.
 * Every entry answers "what does this do to my fight" — the mechanic and its
 * numbers only. Surprising edges a player could misread as a bug (poison
 * bypassing shields, a guard only covering its own property, etc.) are kept
 * in short form; general rationale and design justification are not. Pure
 * text — the source of truth for the rules is the engine + CLAUDE.md "Core
 * mechanics (locked)"; keep wording in sync with docs/card-text-style-guide.md §1.
 */

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
  physical: 'Reduced by the enemy’s Armor, scales with your Attack. Only Physical shields block it.',
  magical: 'Reduced by the enemy’s Magic Resist, scales with your Magic Power. Only Magical shields block it.',
  true: 'TRUE ignores Armor and Magic Resist; only TRUE shields block it. Your added power stat is still reduced by matching defense. TRUE heals/shields are flat — no stat added.',
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
      body: `Opposes ${opposite}: +50% vs ${opposite}-attuned enemies, −25% vs ${capitalize(element)}-attuned.`,
    };
  }
  const index = ELEMENT_ORDER.indexOf(element);
  const beats = ELEMENT_ORDER[(index + 1) % ELEMENT_ORDER.length]!;
  const beatenBy = ELEMENT_ORDER[(index + ELEMENT_ORDER.length - 1) % ELEMENT_ORDER.length]!;
  return {
    title: `${capitalize(element)} element`,
    body: `${capitalize(element)} beats ${capitalize(beats)} (+50%) and loses to ${capitalize(beatenBy)} (−25%) vs attuned enemies.`,
  };
}

export function weaponEntry(weapon: WeaponType): GlossaryEntry {
  if (weapon === 'bow') {
    return { title: 'Bow weapon', body: 'Outside the weapon triangle: +50% vs Beasts, no other matchup.' };
  }
  if (weapon === 'beast') {
    return { title: 'Beast weapon', body: 'Outside the weapon triangle. Bows deal +50% against Beasts.' };
  }
  const beats = WEAPON_TRIANGLE[weapon]!;
  const beatenBy = (Object.keys(WEAPON_TRIANGLE) as WeaponType[]).find((key) => WEAPON_TRIANGLE[key] === weapon)!;
  return {
    title: `${capitalize(weapon)} weapon`,
    body: `${capitalize(weapon)} beats ${capitalize(beats)} (+50%) and loses to ${capitalize(beatenBy)} (−25%).`,
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
    body: `${TIER_PL_BUDGET[tier]} Power Level budget (Bronze ${TIER_PL_BUDGET.bronze} · Silver ${TIER_PL_BUDGET.silver} · Gold ${TIER_PL_BUDGET.gold} · Diamond ${TIER_PL_BUDGET.diamond}).`,
  };
}

export function weightEntry(skill: SkillDef): GlossaryEntry {
  const weight = weightOf(skill);
  return {
    title: `Weight ${weight}`,
    body: `Costs ${weight} readiness to play — lighter cards come out sooner.`,
  };
}

/** "Power Level (PL)" — the standalone concept entry (as opposed to
 * `tierEntry`, which is about the TIER label). Any UI that shows a bare "PL"
 * number (card face, socket panel, hover tip) should attach this once so a
 * player can learn what the number IS, not just which tier it belongs to. */
export function powerLevelEntry(): GlossaryEntry {
  return {
    title: 'Power Level (PL)',
    body: 'A card’s total power budget — damage, shields, riders, and gems all price into it. Tier caps it: Bronze 10 · Silver 15 · Gold 20 · Diamond 25.',
  };
}

/** The "(+ATK)" / "(+MATK)" parenthetical printed on scaling card text —
 * explains that the flat number gets the caster's stat added at cast time. */
export function statScalingSuffixEntry(): GlossaryEntry {
  return {
    title: '(+ATK) / (+MATK) suffix',
    body: 'Adds your current Attack ("+ATK") or Magic Power ("+MATK") to the flat number on resolve.',
  };
}

export function slotEntry(skill: SkillDef): GlossaryEntry {
  const size = skill.size;
  if (size <= 1) {
    return { title: 'Board footprint: 1 slot', body: 'Takes 1 of your 10 board slots.' };
  }
  return {
    title: `Board footprint: ${size} slots`,
    body: `Takes ${size} of your 10 board slots. Casting spans ${size} turns — busy ${size - 1} extra turn${size > 2 ? 's' : ''} after.`,
  };
}

function keywordEntry(action: Action, property: Property): GlossaryEntry | undefined {
  switch (action.kind) {
    case 'shield':
      return {
        title: 'Typed shields',
        body: 'Shields stack, carry over between turns, and cap at max HP. Only blocks its own property — TRUE blocks everything, but is drained 2:1 by physical/magical hits.',
      };
    case 'thorns':
      return {
        title: 'Thorns',
        body: `Grants ${action.stacks} thorn stacks. Each direct hit you take stings the attacker for the current stack count as TRUE damage, then the pile shrinks by 1. DoT ticks don't trigger it.`,
      };
    case 'poison':
      // Re-derives the poison decaying-total triangular sum (`N(N+1)/2` — the
      // pile falls by exactly 1 stack per tick, see `tickTurnDot`,
      // src/engine/combat/simulate.ts) — see `burnTickPreview`'s doc above for
      // why this stays a marked re-derivation rather than a new shared helper.
      return {
        title: 'Poison',
        body: `Applies ${action.stacks} poison — ticks at END of turn (${action.stacks} → ${Math.max(0, action.stacks - 1)} → … = ${(action.stacks * (action.stacks + 1)) / 2} total) and bypasses shields.`,
      };
    case 'burn':
      return {
        title: 'Burn',
        body: `Applies ${action.stacks} burn. Ticks at START of turn — double the stack, then halves (${burnTickPreview(action.stacks)} = ${burnTotalDamage(action.stacks)} total). Unlike poison, shields block it.`,
      };
    case 'bleed':
      // Same triangular-sum re-derivation as poison above (bleed also falls by
      // 1 stack per tick — `tickBleed`, src/engine/combat/simulate.ts) — see
      // `burnTickPreview`'s doc for the full three-copies note.
      return {
        title: 'Bleed',
        body: `Applies ${action.stacks} bleed. A shield blocks the application, but ticks bypass shields once applied — one tick per PERFORM (not per turn), ${(action.stacks * (action.stacks + 1)) / 2} total.`,
      };
    case 'stun':
      // A stunned unit's readiness is wiped to 0, not carried (`simulate.ts`:
      // `c.readiness = 0` on the stun branch) — this used to say "still banks
      // Speed", the opposite of what happens: proven, a 20-point bank is
      // erased, not preserved. Fixed 2026-08-17.
      return {
        title: 'Stun',
        body: `Consumes the enemy’s next ${action.turns > 1 ? `${action.turns} performances` : 'performance'} and wipes their banked readiness to 0 — nothing carries over.`,
      };
    case 'buffStat':
    case 'debuffStat':
      return {
        title: action.kind === 'buffStat' ? 'Stat buff' : 'Stat debuff',
        body: `Lasts ${action.turns} global turns — both sides’ performances count, so it can expire mid-exchange.`,
      };
    case 'guard':
      return {
        title: 'Guard',
        body: `-${action.pct}% incoming ${action.property === 'true' ? 'TRUE' : action.property} damage for ${action.turns} global turns (cap 60%). Only blocks its own property — a TRUE guard won’t reduce physical/magical hits.`,
      };
    case 'negate':
      return {
        title: 'Negate',
        body: `Cancels the next ${action.charges > 1 ? `${action.charges} direct ${action.property === 'true' ? '' : `${action.property} `}hits` : `direct ${action.property === 'true' ? '' : `${action.property} `}hit`}. DoT ticks don’t consume it (max 3 charges/property).`,
      };
    case 'expose':
      return {
        title: 'Expose',
        body: `Enemy takes +${action.pct}% damage from direct hits for ${action.turns} global turns (cap 50%). DoT ticks unaffected.`,
      };
    case 'ward':
      return {
        title: 'Ward',
        body: `Prevents the next ${action.charges > 1 ? `${action.charges} ailments` : 'ailment'} outright — poison, burn, bleed, stat debuffs and expose never land, even onto a pile you already carry. One charge cancels a whole application, however many stacks it carried (max ${MAX_WARD_CHARGES} charges). Buffs and stuns are unaffected.`,
      };
    case 'cleanse':
      return {
        title: 'Cleanse',
        body: `Removes up to ${action.charges} ailment${action.charges > 1 ? 's' : ''}, soonest-to-expire first. Each charge strips ONE stack of poison/burn/bleed, or clears a stun/debuff/expose whole.`,
      };
    case 'slow':
      return { title: 'Slow', body: `Enemy’s next action costs +${action.weight} weight (comes out later).` };
    case 'disrupt':
      return { title: 'Stagger', body: `Drains ${action.amount} banked readiness — delays their next play.` };
    case 'lifesteal':
      return { title: 'Lifesteal', body: `Heals ${action.pct}% of this cast’s damage dealt.` };
    case 'shieldBreak':
      return { title: 'Shield break', body: `Shatters up to ${action.amount} enemy shield before the hit lands.` };
    case 'comboBonus':
      return {
        title: 'Combo',
        body: 'Bonus triggers if your previous cast shared this card’s archetype.',
      };
    case 'heal':
      return property === 'true'
        ? { title: 'TRUE heal', body: 'Flat — no stat added.' }
        : undefined;
    case 'statStrike':
      // The Resonant Echo gem's payload (engine/types.ts) — an EXTRA,
      // self-contained hit with no flat base of its own. `echoHostPower`
      // repeats a share of the whole attack (this card's own base + your
      // stat); a bare `statStrike` (no current card content uses this form)
      // shares only your stat. Blocked/mitigated/negated as its own hit,
      // separately from the card's own.
      return {
        title: action.echoHostPower ? 'Echo' : 'Stat strike',
        body: action.echoHostPower
          ? `A second, separate hit worth 1/${action.shareOf} of this card's own attack (base + your stat)${action.cap ? `, capped at ${action.cap}` : ''}. Its own hit — blocked/mitigated/negated independently of the first.`
          : `A second, separate hit worth 1/${action.shareOf} of your scaling stat${action.cap ? `, capped at ${action.cap}` : ''}. Its own hit — blocked/mitigated/negated independently of the card's own.`,
      };
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
