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
/**
 * Plain-English names for the statuses a conditional rider (`exploit` /
 * `stackBonus`) can key off — lower case, because they appear mid-sentence in
 * the entries below ("if the target already has poison").
 */
/**
 * Player-facing names for the CARD TYPES a `chainBonus` can name — the weapon
 * and element vocabularies `cardType` (engine/combat/typeIdentity.ts) draws
 * from. Kept as display data here, beside `STATUS_NAME`, because the engine's
 * own identifiers are lowercase and a card face should not print them raw.
 */
const TYPE_NAME: Record<string, string> = {
  sword: 'Sword', axe: 'Axe', lance: 'Lance', bow: 'Bow', beast: 'Beast',
  fire: 'Fire', frost: 'Frost', lightning: 'Lightning', nature: 'Nature', holy: 'Holy', dark: 'Dark',
};
/** "a Sword" but "an Axe" — the article belongs with the name, not the sentence. */
const TYPE_ARTICLE: Record<string, string> = {
  sword: 'a', axe: 'an', lance: 'a', bow: 'a', beast: 'a',
  fire: 'a', frost: 'a', lightning: 'a', nature: 'a', holy: 'a', dark: 'a',
};
const STATUS_NAME: Record<'poison' | 'burn' | 'bleed' | 'stun' | 'debuff' | 'expose' | 'thorns', string> = {
  poison: 'poison',
  burn: 'burn',
  bleed: 'bleed',
  stun: 'a stun',
  debuff: 'a stat debuff',
  expose: 'expose',
  thorns: 'thorn',
};

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

/**
 * The face's "AOE" token unpacked — same idiom as every other keyword entry
 * below (a face abbreviation always has a matching explanation reachable via
 * hover/inspect). Callers gate this on `isAoeSkill` (`skillPresentation.ts`)
 * so it only attaches to a card whose EFFECTIVE (post-tier) scope is `'all'`.
 */
export function targetingEntry(): GlossaryEntry {
  return {
    title: 'AoE targeting',
    body: 'Hits every living foe at once (ascending board order), not a single chosen target.',
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
        body: `Grants ${action.stacks} thorn stacks. Each direct hit you take stings the attacker for the current stack count as physical damage — their armor reduces it (min 1), and their physical guards/shields apply — then the pile shrinks by 1. DoT ticks don't trigger it.`,
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
      // User ruling (2026-08-19): a stun denies the victim's next ACTION
      // WHENEVER IT HAPPENS, not "1 turn" from now — the old "1 turn" framing
      // (both here and on the card face) implied a real-time countdown that
      // isn't how the engine actually reads it. A pending stun does not tick
      // down while something ELSE is already keeping the victim from acting
      // (still banking readiness, on cooldown) — it just waits, unconsumed,
      // until the victim would otherwise have performed; only THEN does it
      // collect, skipping that performance outright and wiping banked
      // readiness to 0 (`simulate.ts`: `c.readiness = 0` on the stun branch —
      // this used to say "still banks Speed", the opposite of what happens,
      // fixed 2026-08-17). Cleanse can strip a stun before it ever collects.
      return {
        title: 'Stun',
        body: `Takes the target's next ${action.turns > 1 ? `${action.turns} actions` : 'action'}, whenever it would have happened — if something else is already stopping them from acting, the stun just waits. The moment it does collect, that performance is skipped outright and it wipes their banked readiness to 0. Cleanse can strip it first.`,
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
    case 'burden':
      return {
        title: 'Burden',
        body: `The card the enemy is about to play costs +${action.weight} weight the next time it is played (once, then spent). It waits on that card however long it takes — unlike a Slow, it never expires unpaid.`,
      };
    case 'curse':
      return {
        title: 'Curse',
        body: `The card the enemy is about to play deals ${action.amount} less damage for ${action.turns} global turns (never below 1 damage). Re-cursing keeps the stronger amount and the longer window, never both added.`,
      };
    // SPLASH — the SPREADER. Its entry describes what it does to the OTHER
    // keywords on the card, because that is all it does: it has no number of its
    // own (the pre-2026-08-21 entry read as a weight tax, which is the misread
    // this split exists to undo). "Card-targeting" is not player language, so the
    // body names the two keywords by their effect instead.
    case 'splash':
      return {
        title: 'Splash',
        body: 'Spreads this card\'s Burden / Curse from the card the enemy is about to play to the cards beside it as well — up to three cards in one go. Board-adjacent only: the band never wraps around the edge, so a card at the end of the board catches fewer.',
      };
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
    // CHAIN — Combo's twin on the TYPE axis. The entry names the partner type
    // explicitly (that is the whole decision the player makes) and states the
    // cold start, which is the one thing they will otherwise get wrong: the
    // FIRST cast of a fight has no previous cast, so it never pays.
    case 'chainBonus':
      return {
        title: 'Chain',
        body: `+${action.amount} damage on this hit if your previous cast was ${TYPE_ARTICLE[action.after] ?? 'a'} ${TYPE_NAME[action.after] ?? action.after} card. Your first cast of a fight has no previous cast, so it never triggers there.`,
      };
    // The two conditional bonus-damage riders (engine/types.ts). Both entries
    // state the ONE rule a player will otherwise get wrong: the condition is
    // read BEFORE this card applies anything, so a card that also applies the
    // status never triggers on its own first cast — the payoff lands on the
    // next one (user-locked 2026-08-21).
    case 'exploit':
      return {
        title: 'Exploit',
        body: `+${action.amount} damage on this hit if the target already has ${STATUS_NAME[action.status]}. Checked before this card applies anything, so if this card is what applies it, the bonus starts on your NEXT cast.`,
      };
    case 'stackBonus':
      return {
        title: 'Stack bonus',
        body: `+${action.per} damage per ${STATUS_NAME[action.status]} stack ${action.of === 'caster' ? 'you are holding' : 'on the target'}, up to +${action.cap}. Counted before this card applies anything — stacks added by this cast pay off on the NEXT one, and the stacks are not consumed.`,
      };
    // The other two riders of the same family. Same rule stated the same way (the
    // resource is read BEFORE this card adds any of its own), plus the one fact
    // each that is unique: a burst SPENDS the shield it reads, and a tax bonus
    // counts a backlog that partly expires at end of turn.
    case 'shieldBurst':
      return {
        title: 'Shield burst',
        body: `Shatters up to ${action.cap} of YOUR OWN shield and adds exactly that much damage to this hit — the shield is gone, physical pool first, then magical, then TRUE. Counted before this card grants anything, so shield from this same cast pays off on your NEXT one.`,
      };
    case 'taxBonus':
      return {
        title: 'Tempo toll',
        body: `+${action.per} damage per weight-taxed card on the target — every Burdened card, plus one if the unit itself is Slowed — up to +${action.cap}. Counted before this card taxes anything, and a slow only lasts the turn it landed on, so tax them FIRST, then collect.`,
      };
    // The four riders of the third pass. The first two keep the family's rule
    // verbatim (read before this card adds any of its own); the last two are the
    // heal-side pair, whose rule is the opposite way round and has to say so.
    case 'wardRelease':
      return {
        title: 'Ward release',
        body: `Spends YOUR OWN ward charges for +${action.per} damage each, up to +${action.cap} — the charges are gone, so the next affliction aimed at you lands. Only charges you were already holding count: ward granted by this same cast pays off on your NEXT one.`,
      };
    case 'desperation':
      return {
        title: 'Desperation',
        body: `+${action.amount} damage on this hit while YOU are at or below half your maximum HP. Nothing to set up and nothing to keep alive — it simply turns on when you are hurt, and off when you are healed past half.`,
      };
    case 'overhealShield':
      return {
        title: 'Overheal shield',
        body: `Healing this card wastes on a full HP bar becomes shield instead of vanishing — up to ${action.cap} of it, in this card's own shield pool, on whoever was healed. Measured AFTER any anti-heal tax, and still bounded by the usual shield ceiling (max HP).`,
      };
    case 'cleanseConvert':
      return {
        title: 'Cleanse convert',
        body: `+${action.per} healing for every affliction stack this card's own cleanse actually removes, up to +${action.cap}. It needs something to strip: cleanse nothing, heal nothing extra. The cleanse happens FIRST, so it can also lift the anti-heal tax off the heal that follows.`,
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
