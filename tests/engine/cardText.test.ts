import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import type { Action, AuraDef, SkillTier } from '../../src/engine/types';

// Drift guard: every numeric magnitude a card's `effects`/`aura` carries must
// be spelled out verbatim in its `text`. This keeps card prose from silently
// diverging from the mechanics it describes (see docs/card-text-style-guide.md).
//
// We don't try to reconstruct the exact sentence — just extract every integer
// that appears in `text` and assert each mechanically-relevant number is one
// of them. `stun` with turns === 1 is exempt: per the style guide its
// canonical phrasing ("the enemy's next performance is consumed") carries no
// numeral for the single-performance case. `negate` with charges === 1 is
// exempt for the same reason ("Negate the next magical attack." — singular, no
// numeral).
//
// 2026-07-24: the guard now ALSO audits every authored `tierUpgrades` entry —
// a tier override that changes effects/aura must carry its own accurate text.

function numbersInText(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}

/**
 * The default arm is `assertNever`, so this switch is compile-time exhaustive
 * over `Action['kind']` (mirrors the trick `validateSkillContent.ts`'s action
 * switch uses) — a new Action kind fails `tsc`, not silently sails through the
 * drift guard unchecked the way `ward`/`thorns` did before this comment.
 */
function assertNever(value: never): never {
  throw new Error('expectedNumbers: unhandled action kind ' + JSON.stringify(value));
}

/** The magnitudes a kit (effects + aura) must spell out in its text. */
function expectedNumbers(effects: readonly Action[], aura: AuraDef | undefined): number[] {
  const expected: number[] = [];

  for (const eff of effects) {
    switch (eff.kind) {
      case 'damage':
      case 'heal':
      case 'shield':
        expected.push(eff.power);
        break;
      case 'poison':
      case 'burn':
      case 'bleed':
        expected.push(eff.stacks);
        break;
      case 'stun':
        if (eff.turns > 1) expected.push(eff.turns);
        break;
      case 'buffStat':
      case 'debuffStat':
      case 'expose':
        expected.push(eff.pct, eff.turns);
        break;
      case 'cleanse':
        expected.push(eff.charges);
        break;
      case 'slow':
      case 'splash':
        expected.push(eff.weight);
        break;
      case 'disrupt':
      case 'shieldBreak':
        expected.push(eff.amount);
        break;
      case 'lifesteal':
        expected.push(eff.pct);
        break;
      case 'comboBonus':
        expected.push(eff.amount);
        break;
      case 'guard':
        expected.push(eff.pct, eff.turns);
        break;
      case 'negate':
        if (eff.charges > 1) expected.push(eff.charges);
        break;
      // WARD/THORNS (closed 2026-08-18, this was the hole): every authored
      // ward/thorns card spells the charge/stack count as a literal digit
      // right after the keyword ("{{Ward}} 2 \u2014 ...", "{{Thorns}} 5
      // \u2014 ..."), including the charges===1 / stacks===low cases — unlike
      // `stun`/`negate`, there is no wordy singular phrasing to exempt.
      case 'ward':
        expected.push(eff.charges);
        break;
      case 'thorns':
        expected.push(eff.stacks);
        break;
      // TAUNT: no card authors this yet, but `amount` is a flat magnitude of
      // the exact same shape as `disrupt`/`shieldBreak`/`comboBonus` above, so
      // it is checked the same way rather than left to drift silently.
      case 'taunt':
        expected.push(eff.amount);
        break;
      // STAT STRIKE: deliberately EXEMPT, same family as the stun/negate
      // singular exemptions above but for the opposite reason — `shareOf` is
      // never spelled as a digit by design (docs/card-text-style-guide.md +
      // the type's own doc comment in src/engine/types.ts): it prints as a
      // word ratio ("half strength", "a quarter"), because the actual damage
      // is proportional to a stat the text cannot know at authoring time. A
      // `cap`, if ever authored, IS a genuine flat number (a hard ceiling on
      // the payload) and is checked like any other magnitude.
      case 'statStrike':
        if (eff.cap !== undefined) expected.push(eff.cap);
        break;
      // EXPLOIT: the flat bonus it adds is the whole magnitude, same shape as
      // `comboBonus` above. The STATUS it keys off is a word, not a number, so
      // there is nothing else to check numerically here (the prose naming it is
      // covered by the style guide, not by this guard).
      case 'exploit':
        expected.push(eff.amount);
        break;
      // STACK BONUS: BOTH numbers are load-bearing and both must be printed —
      // `per` is what a player counts per stack, and `cap` is the ceiling that
      // decides what the effect is worth (it is also the number the card is
      // PRICED on, `actionsPriceDeci`). A text that spelled one and not the
      // other would hide exactly the half a player needs to plan around.
      case 'stackBonus':
        expected.push(eff.per, eff.cap);
        break;
      // TAX BONUS: both numbers, for the identical reason — `per` is what a
      // player counts per taxed card, `cap` is the ceiling that decides what the
      // rider is worth (and the number it is PRICED on).
      case 'taxBonus':
        expected.push(eff.per, eff.cap);
        break;
      // SHIELD BURST: the `cap` is the whole magnitude and it is doubly
      // load-bearing — it is the most damage the rider can add AND the most of
      // your own shield it will spend. A face that hid it would hide the cost.
      case 'shieldBurst':
        expected.push(eff.cap);
        break;
      default:
        assertNever(eff);
    }
  }

  if (aura) {
    const { damageFlat, healFlat, weightDelta } = aura.mods;
    if (damageFlat !== undefined) expected.push(damageFlat);
    if (healFlat !== undefined) expected.push(healFlat);
    if (weightDelta !== undefined) expected.push(Math.abs(weightDelta));
  }

  return expected;
}

/**
 * STAT-TOKEN drift guard (added 2026-08-05, after a real miss).
 *
 * The numeric guard above audits HOW MUCH; this audits BOOSTED BY WHAT. When
 * shields/heals moved to defensive-stat scaling (engine commit `9960720`), 16
 * card texts kept advertising "(+ATK)"/"(+MATK)" on defensive clauses and NOT
 * ONE test failed — the numbers were all still correct, so the numeric guard
 * had nothing to catch. The text lied to the player until a human spotted it.
 *
 * The rule audited (docs/card-text-style-guide.md, "Which stat token"): a
 * card's `property` picks WHICH stat, the ROLE of the clause picks WHICH SIDE
 * of the stat sheet — OFFENSE (damage) reads ATK/MATK, DEFENSE (shield/heal)
 * reads DEF/MDEF. TRUE carries no token on defense (flat by identity) and
 * "(+best stat)" on offense.
 *
 * Deliberately asserts only what is UNAMBIGUOUS: a text may not carry a stat
 * token belonging to the OPPOSITE role for a role it actually has. It does not
 * demand a token be present — TRUE clauses correctly have none, and a card
 * mixing both roles legitimately carries one of each, which is why this is a
 * forbidden-token check rather than an exact-template match.
 */
const OFFENSE_TOKENS = ['(+ATK)', '(+MATK)', '(+ATK/MATK)'] as const;
const DEFENSE_TOKENS = ['(+DEF)', '(+MDEF)', '(+DEF/MDEF)'] as const;

function assertStatTokens(label: string, text: string, effects: readonly Action[]): void {
  const hasOffense = effects.some((e) => e.kind === 'damage');
  const hasDefense = effects.some((e) => e.kind === 'shield' || e.kind === 'heal');

  // A purely defensive card must never advertise an offensive stat, and vice
  // versa. A card with BOTH roles is exempt: either token is legitimately its.
  if (hasDefense && !hasOffense) {
    for (const token of OFFENSE_TOKENS) {
      expect(
        text.includes(token),
        `${label}: defensive card advertises the OFFENSIVE token ${token} — shields/heals scale off DEF/MDEF: "${text}"`,
      ).toBe(false);
    }
  }
  if (hasOffense && !hasDefense) {
    for (const token of DEFENSE_TOKENS) {
      expect(
        text.includes(token),
        `${label}: offensive card advertises the DEFENSIVE token ${token} — damage scales off ATK/MATK: "${text}"`,
      ).toBe(false);
    }
  }
}

/**
 * GUARD/NEGATE property-overclaim guard (added 2026-08-06, after a real miss:
 * `purify_echo` shipped with "-20% incoming damage, all types" on a TRUE-
 * property guard, which only ever cuts TRUE damage — see docs/card-text-
 * style-guide.md §2, the `guard`/`negate` rows: "Never say 'all'/'all
 * types'"/"Never say 'any'". A guard/negate covers ONLY its own `property`
 * (`src/engine/combat/interpreter.ts`), and that property is not always the
 * host card's — a gem can graft a TRUE guard onto any card — so "all"/"any"
 * phrasing is a real overclaim, not a harmless generalization.
 *
 * Scoped to TRUE specifically: that's the exact shape of the shipped bug (a
 * single-property effect described as blanket coverage). There is exactly
 * ONE live TRUE-scoped guard/negate in the game today (the gem
 * `purify_echo`) — every other guard/negate is physical- or magical-scoped
 * and short-circuits out of this check before the assertion below ever runs.
 * That one instance had no numeric mismatch — the number was right, the
 * CLAIM was wrong — so the drift guard above had nothing to catch it. This
 * check is deliberately stronger than "words present" (it fails on the
 * literal universal words the style guide bans, not on the property name
 * being absent), but be clear-eyed about its coverage: it is a single-case
 * regression pin for `purify_echo`, not a broad audit of guard/negate
 * phrasing across the catalog — it only ever gets to fire once.
 */
function assertNoUniversalGuardNegateOverclaim(label: string, text: string, effects: readonly Action[]): void {
  const trueScoped = effects.some((e) => (e.kind === 'guard' || e.kind === 'negate') && e.property === 'true');
  if (!trueScoped) return;
  expect(
    /\ball\b/i.test(text) || /\bany\b/i.test(text),
    `${label}: TRUE-scoped guard/negate uses universal "all"/"any" phrasing, but it only ever covers TRUE damage/hits: "${text}"`,
  ).toBe(false);
}

function assertTextCoversKit(label: string, text: string, effects: readonly Action[], aura: AuraDef | undefined): void {
  const nums = numbersInText(text);
  for (const n of expectedNumbers(effects, aura)) {
    expect(nums, `${label}: expected number ${n} not found in text: "${text}"`).toContain(n);
  }
  assertStatTokens(label, text, effects);
  assertNoUniversalGuardNegateOverclaim(label, text, effects);
}

describe('card text drift guard', () => {
  for (const skill of Object.values(skillBook)) {
    it(`${skill.id}: every effect/aura magnitude appears in text`, () => {
      assertTextCoversKit(skill.id, skill.text, skill.effects, skill.aura);
    });

    const upgrades = skill.tierUpgrades;
    if (upgrades) {
      it(`${skill.id}: every tierUpgrades entry carries accurate text`, () => {
        for (const tier of Object.keys(upgrades) as Exclude<SkillTier, 'bronze'>[]) {
          const up = upgrades[tier];
          if (!up) continue;
          const effects = up.effects ?? skill.effects;
          const aura = up.aura ?? skill.aura;
          // An override that changes the kit MUST bring its own text — the UI
          // would otherwise show the Bronze prose with the wrong numbers.
          if (up.effects !== undefined || up.aura !== undefined) {
            expect(up.text, `${skill.id}@${tier}: override changes effects/aura but has no text`).toBeDefined();
          }
          assertTextCoversKit(`${skill.id}@${tier}`, up.text ?? skill.text, effects, aura);
        }
      });
    }
  }
});

// A gem's action is appended onto its HOST card and resolved by the SAME role
// rule, so a gem's dual token drifts for exactly the same reason a card's does
// — and drifted in the same 2026-08-05 pass. Gems name both stats they could
// scale with (they can't know the host's property), so the pair is the token.
describe('gem text stat-token drift guard', () => {
  for (const gem of Object.values(gemBook)) {
    // `Gem` is a union: stat gems carry `mods`, not `actions`, and their
    // "Passive: hero +4 SPD" text names a stat that is not a scaling term.
    if (gem.kind !== 'effect') continue;
    const actions: readonly Action[] = gem.actions;
    if (!actions.length) continue;
    it(`${gem.id}: names the stat pair its ROLE actually scales off`, () => {
      // 2026-08-06: widened from a bare `assertStatTokens` call to the full
      // `assertTextCoversKit` — gems previously got only the stat-token half
      // of the drift guard; the numeric drift check and the TRUE-scoped
      // guard/negate overclaim check (this file's real miss, `purify_echo`)
      // now run against gemBook too. Verified against the whole gem catalog
      // first: every 'effect' gem's authored numbers already appear in its
      // text, so this closes the gap without introducing any new failures.
      assertTextCoversKit(gem.id, gem.text, actions, undefined);
      const hasDefense = actions.some((a) => a.kind === 'shield' || a.kind === 'heal');
      const hasOffense = actions.some((a) => a.kind === 'damage');
      if (hasDefense && !hasOffense) {
        expect(
          gem.text.includes('(+ATK/MATK)'),
          `${gem.id}: defensive gem names the offensive pair: "${gem.text}"`,
        ).toBe(false);
      }
      if (hasOffense && !hasDefense) {
        expect(
          gem.text.includes('(+DEF/MDEF)'),
          `${gem.id}: offensive gem names the defensive pair: "${gem.text}"`,
        ).toBe(false);
      }
    });
  }
});
