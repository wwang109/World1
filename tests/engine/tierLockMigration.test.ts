import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { applyTier, autoScaleTier, resolveEffectiveSkill } from '../../src/engine/cards';
import { capViolations, powerLevelBreakdown, powerLevelDeci, TIER_BUDGET_DECI } from '../../src/engine/balance';
import { skillBook } from '../../src/data/skills';
import { skillDefOfDocument, validateSkillDocument } from '../../src/data/validateSkillContent';
import { TIER_ORDER, tierResolved } from '../../src/engine/types';
import type { Action, SkillDef, SkillTier } from '../../src/engine/types';

/**
 * THE Q1 `minTier` MIGRATION, PROVED AGAINST THE DEFINITIONS IT REPLACED.
 *
 * 24 cards used to restate their whole `effects` list inside a
 * `tierUpgrades.<tier>.effects` block, once per rank, purely so one extra line
 * could appear from that rank upward. Each now carries ONE definition whose extra
 * line is flagged `minTier` (`TierLocked`, engine/types.ts), and the
 * budget-honest scaler (`autoScaleTier`) re-derives every rung instead of a human
 * hand-solving each one.
 *
 * WHY THIS FILE READS GIT AND NOT `skillBook`. Every other assertion in the suite
 * is necessarily self-consistent: it measures the migrated book against itself, so
 * it can only prove the NEW cards are internally coherent — never that they are
 * the SAME CARDS. The one claim worth making is a before/after one, and the
 * "before" no longer exists in the working tree. So it is read out of git, at the
 * commit immediately preceding the migration, through the REAL loader
 * (`validateSkillDocument` + `skillDefOfDocument`) so the pre-migration defs are
 * built exactly as the shipped book built them.
 *
 * THE BAR IS BYTE-IDENTICAL RESOLVED OUTPUT: for every migrated card, at each of
 * the four tiers, `applyTier` must hand back the same effects in the same order
 * with the same numbers, the same aura/weight/cooldown/scope, the same `text`, and
 * the same price — and `resolveEffectiveSkill` (the value the combat loop actually
 * casts) must match too, since that is the layer a reordering normalizer sits in.
 *
 * COROBORATING EVIDENCE, already in the suite and not restated here: 14 of the 24
 * migrated cards sit in `FROZEN_SWEEP_SKILL_IDS`, the pool the 200-fight
 * `outcomeBaseline.json` sweep draws boards from, and that baseline did NOT move.
 */

/** The commit immediately BEFORE the migration — the "before" side of this test. */
const PRE_MIGRATION_REV = 'd695eaa';
const CONTENT_PATH = 'src/data/content/skills.v1.json';

/**
 * The pre-migration book, read from git and built through the production loader.
 *
 * NOT `JSON.parse` into a hand-shaped object: the loader is what strips the
 * authoring-only `notes` sidecar and picks the highest `version` per id, and a
 * second copy of those rules here could disagree with the real one and make the
 * comparison meaningless. `validateSkillDocument` is run for the same reason —
 * if the old document would not have loaded, comparing against it proves nothing.
 */
function preMigrationBook(): Record<string, SkillDef> {
  let raw: string;
  try {
    raw = execFileSync('git', ['show', `${PRE_MIGRATION_REV}:${CONTENT_PATH}`], {
      cwd: new URL('../..', import.meta.url).pathname,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (cause) {
    // Loud, never skipped: a before/after test that quietly stops comparing is
    // worse than no test, because the suite still reads as if it were checking.
    throw new Error(
      `cannot read the PRE-migration content from git (${PRE_MIGRATION_REV}:${CONTENT_PATH}). `
      + 'This test is a real before/after and has no self-consistent fallback by design. '
      + `Cause: ${String(cause)}`,
    );
  }
  const document = JSON.parse(raw) as unknown;
  const problems = validateSkillDocument(document);
  expect(problems, `the PRE-migration document must itself be valid: ${JSON.stringify(problems.slice(0, 5))}`).toEqual([]);
  const doc = document as { cards: { id: string; versions: { version: number; def: Record<string, unknown> }[] }[] };
  const book: Record<string, SkillDef> = {};
  for (const entry of doc.cards) {
    const current = entry.versions.reduce((a, b) => (b.version > a.version ? b : a));
    book[entry.id] = skillDefOfDocument(entry.id, current.def);
  }
  return book;
}

const BEFORE = preMigrationBook();

/**
 * Every card the migration TOUCHED, derived from the two books rather than listed:
 * it carries a lock now AND restated an effects list before. The second half is
 * what keeps this file honest as content grows — a card authored WITH a lock from
 * the start (`rimebarb_vigil`) has no "before" to be compared against, and
 * silently pulling it in here would either fail for no reason or, worse, make one
 * of the sweeps below look bigger than the claim it is proving.
 */
const MIGRATED: string[] = Object.keys(skillBook)
  .filter((id) => skillBook[id]!.effects.some((a) => a.minTier !== undefined))
  .filter((id) => Object.values(BEFORE[id]?.tierUpgrades ?? {}).some((up) => up.effects !== undefined))
  .sort();

/** Cards that use the lock but were AUTHORED with it — not part of the migration. */
const LOCK_NATIVE: string[] = Object.keys(skillBook)
  .filter((id) => skillBook[id]!.effects.some((a) => a.minTier !== undefined))
  .filter((id) => !MIGRATED.includes(id))
  .sort();

/** Effects with the lock flag itself removed — the flag is authoring, not behaviour. */
function shapeOf(effects: readonly Action[]): unknown {
  return effects.map((a) => {
    const copy: Record<string, unknown> = { ...a };
    delete copy['minTier'];
    return copy;
  });
}

/** Everything about a resolved card that the engine or the card face can read. */
function observable(skill: SkillDef): unknown {
  return {
    effects: shapeOf(skill.effects),
    aura: skill.aura,
    speedWeight: skill.speedWeight,
    cooldownTurns: skill.cooldownTurns,
    scope: skill.scope,
    text: skill.text,
    property: skill.property,
    size: skill.size,
    element: skill.element,
    weapon: skill.weapon,
    archetypes: skill.archetypes,
    rarity: skill.rarity,
    special: skill.special,
  };
}

/**
 * THE FACE TEXT IS BACK INSIDE `observable`, at full strength, and the exception
 * that briefly stood here is GONE.
 *
 * The one-class CAST ORDER RULING (2026-08-31) reordered the resolved kit of 14
 * cards and retexted their faces to match, eight of which are in this migration
 * set — so this file carried a `FACE_TEXT_REORDERED` allow-list whose members'
 * faces were only required to match as a clause MULTISET. The user REFINED the
 * ruling the same day ("posion/bleed/burn are after attacks but stats debuff/buff
 * are applied before the atk"), which put all eight of those cards back to their
 * pre-ruling order, and their faces back to their pre-migration wording byte for
 * byte. The allow-list emptied out, so it was deleted rather than left standing
 * as a zero-member exception: an exception nothing uses is an invitation.
 *
 * The five cards the refinement did NOT put back (`gutting_cleave`, `hemorrhage`,
 * `barbed_rampart`, `crippling_gore`, `sundering_roar` — DoT carriers, whose
 * bleed still trails the hit) are not in `MIGRATED`: none of them carries a
 * `minTier` lock, so none has a pre-migration restatement to compare against.
 * That is why the bar can be whole again rather than merely smaller.
 */

describe('Q1 migration: the one-definition ladder reproduces the deleted restatements EXACTLY', () => {
  it('the before/after really is a before and an after — this suite is not vacuous', () => {
    expect(MIGRATED.length, 'no card carries a lock — nothing to compare').toBe(24);
    expect(Object.keys(BEFORE).length, 'the pre-migration book must load in full').toBe(156);
    for (const id of MIGRATED) {
      const before = BEFORE[id];
      expect(before, `${id} must exist before the migration`).toBeDefined();
      // The "before" must be the shape being replaced: a restated effects list.
      const restated = Object.values(before!.tierUpgrades ?? {}).filter((up) => up.effects !== undefined);
      expect(restated.length, `${id}: nothing was restated, so nothing was deleted`).toBeGreaterThan(0);
      // ...and it must NOT have used the feature already.
      expect(before!.effects.some((a) => a.minTier !== undefined), `${id} already had a lock`).toBe(false);
    }
    // And the deletion is real: the migrated card restates nothing.
    for (const id of MIGRATED) {
      const after = skillBook[id]!;
      expect(Object.values(after.tierUpgrades ?? {}).some((up) => up.effects !== undefined), `${id} still restates`).toBe(false);
    }
    // The feature is not only a migration target any more: content authored AFTER
    // it lands here, and is deliberately OUT of every before/after sweep above.
    expect(LOCK_NATIVE, 'lock users with no pre-migration form').toEqual(['rimebarb_vigil']);
    for (const id of LOCK_NATIVE) {
      expect(BEFORE[id], `${id} must not exist before the migration`).toBeUndefined();
    }
  });

  it('every migrated card, at every one of the four tiers, resolves to the SAME card', () => {
    const diffs: string[] = [];
    let compared = 0;
    for (const id of MIGRATED) {
      for (const tier of TIER_ORDER) {
        compared += 1;
        const before = applyTier(BEFORE[id]!, tier);
        const after = applyTier(skillBook[id]!, tier);
        const b = JSON.stringify(observable(before));
        const a = JSON.stringify(observable(after));
        if (b !== a) diffs.push(`${id}@${tier}\n  before: ${b}\n  after : ${a}`);
      }
    }
    expect(diffs, `the migration changed a resolved card:\n${diffs.join('\n')}`).toEqual([]);
    expect(compared, 'four tiers of every migrated card').toBe(MIGRATED.length * TIER_ORDER.length);
  });

  it('...and the same FACE TEXT — no allow-list, no clause-multiset softening', () => {
    // `observable` above already compares `text` byte for byte, so this case is
    // the SHARP ERROR MESSAGE for the one field most likely to drift, not a
    // second bar. It exists because a face mismatch inside a whole-object diff
    // reads as an unhelpful wall; here it names the card, the tier and both
    // strings. See the block comment above for why the exception is gone.
    const drifted: string[] = [];
    let compared = 0;
    for (const id of MIGRATED) {
      for (const tier of TIER_ORDER) {
        const before = applyTier(BEFORE[id]!, tier).text;
        const after = applyTier(skillBook[id]!, tier).text;
        compared += 1;
        if (before !== after) drifted.push(`${id}@${tier}\n  before: ${before}\n  after : ${after}`);
      }
    }
    expect(drifted, `a card face drifted:\n${drifted.join('\n')}`).toEqual([]);
    expect(compared, 'four faces of every migrated card').toBe(MIGRATED.length * TIER_ORDER.length);
  });

  it('...and the same PRICE, part by part, not merely the same total', () => {
    // A total can match while the parts moved (a smaller hit paid for by a
    // different weight refund), so the breakdown is compared line by line — the
    // same granularity the whole-PL invariant is asserted at.
    const diffs: string[] = [];
    for (const id of MIGRATED) {
      for (const tier of TIER_ORDER) {
        const before = applyTier(BEFORE[id]!, tier);
        const after = applyTier(skillBook[id]!, tier);
        const b = JSON.stringify(powerLevelBreakdown(before));
        const a = JSON.stringify(powerLevelBreakdown(after));
        if (b !== a) diffs.push(`${id}@${tier}\n  before: ${b}\n  after : ${a}`);
        expect(powerLevelDeci(after), `${id}@${tier} budget`).toBe(TIER_BUDGET_DECI[tier]);
        expect(capViolations(after), `${id}@${tier} caps`).toEqual([]);
      }
    }
    expect(diffs, `the migration moved a priced part:\n${diffs.join('\n')}`).toEqual([]);
  });

  it('...and the SKILL THE LOOP CASTS is identical too, normalizer and all', () => {
    // `applyTier` is not the last word: `resolveEffectiveSkill` runs
    // `orderCastRiders` over the assembled kit (THE CAST ORDER RULE — a cast's
    // AFTERMATH riders, the DoTs and the `lifesteal` sink, trail its every hit;
    // its SETUP lines do not move). `leeching_fang` is the one card in this
    // migration set reordered there — its leech, since 2026-08-26 — because the
    // 2026-08-31 refinement put every stat/control line back where it was
    // authored. So the comparison still has to be made at the layer the combat
    // loop actually reads. BOTH SIDES go through today's normalizer, which is the
    // point: the migration must not have changed the kit, and it did not.
    const diffs: string[] = [];
    for (const id of MIGRATED) {
      for (const tier of TIER_ORDER) {
        const b = JSON.stringify(observable(resolveEffectiveSkill(BEFORE[id]!, { skillId: id, slot: 0, tier })));
        const a = JSON.stringify(observable(resolveEffectiveSkill(skillBook[id]!, { skillId: id, slot: 0, tier })));
        if (b !== a) diffs.push(`${id}@${tier}\n  before: ${b}\n  after : ${a}`);
      }
    }
    expect(diffs, `the cast kit changed:\n${diffs.join('\n')}`).toEqual([]);
  });

  it('the LOCK is what reproduces them — the same list unlocked is a different, off-budget card', () => {
    // The control that stops every assertion above from passing for free. Strip the
    // `minTier` flags and the extra line exists at Bronze too, so the card either
    // blows its own budget or resolves to a different kit at some rank.
    let broken = 0;
    for (const id of MIGRATED) {
      const card = skillBook[id]!;
      const unlocked: SkillDef = {
        ...card,
        effects: card.effects.map((a) => {
          const copy: Record<string, unknown> = { ...a };
          delete copy['minTier'];
          return copy as unknown as Action;
        }),
      };
      const overBudget = powerLevelDeci(unlocked) !== TIER_BUDGET_DECI[unlocked.tier];
      const differentBronze = JSON.stringify(shapeOf(tierResolved(unlocked).effects))
        !== JSON.stringify(shapeOf(applyTier(BEFORE[id]!, 'bronze').effects));
      if (overBudget || differentBronze) broken += 1;
    }
    expect(broken, 'removing the lock must break every migrated card').toBe(MIGRATED.length);
  });

  it('and the rungs are SOLVED, not restated — the solver is what produces every number', () => {
    // The migration's actual claim: no human hand-solves a rung any more. At and
    // above its lock, a migrated card's kit is exactly what `autoScaleTier` returns
    // for the tier-resolved definition — the `tierUpgrades` blocks that remain
    // carry nothing but `text`.
    for (const id of MIGRATED) {
      const card = skillBook[id]!;
      for (const tier of TIER_ORDER.slice(1) as Exclude<SkillTier, 'bronze'>[]) {
        const solved = autoScaleTier(tierResolved(card, tier), tier);
        expect(shapeOf(applyTier(card, tier).effects), `${id}@${tier}`).toEqual(shapeOf(solved.effects));
        const block = card.tierUpgrades?.[tier];
        if (block) expect(Object.keys(block).sort(), `${id}@${tier} block`).toEqual(['text']);
      }
    }
  });
});
