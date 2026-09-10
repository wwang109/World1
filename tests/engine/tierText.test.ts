import { describe, expect, it } from 'vitest';
import { applyTier } from '../../src/engine/cards';
import { renderSkillText } from '../../src/engine/keywords/compose';
import { skillBook } from '../../src/data/skills';

/**
 * A TIERED COPY'S FACE SHOWS THAT TIER'S NUMBERS.
 *
 * This used to audit `retextScaledNumbers` — the function that rewrote the
 * first standalone occurrence of each changed numeral inside a STORED `text`
 * string, and refused to guess when a number appeared twice (the documented
 * `piercing_reach` defect: "Shatter 16, then deal 16" printed "Shatter 26 ...
 * deal 16" at Silver, both wrong and swapped). There is no stored string and
 * no rewrite any more: the face is COMPOSED from `effects`
 * (`renderSkillText`), so it cannot lag them.
 *
 * The tests below therefore assert the OUTCOME rather than the mechanism —
 * which is the stronger claim, and the one a player can see. Its sibling
 * `tierTextDrift.test.ts` is retired outright: its whole subject (picking the
 * wrong ambiguous numeral to patch) cannot occur.
 */
describe('engine: a tiered copy prints its own numbers', () => {
  it('a scaled damage power reaches the face (arcane_bolt -> diamond)', () => {
    const base = skillBook.arcane_bolt!;
    const diamond = applyTier(base, 'diamond');
    const power = (diamond.effects[0] as { power: number }).power;
    expect(power).toBeGreaterThan((base.effects[0] as { power: number }).power);
    expect(renderSkillText(diamond)).toContain(`Deal ${power} `);
    expect(renderSkillText(diamond)).not.toBe(renderSkillText(base));
  });

  it('a scaled DoT stack count reaches the face (venom_fang -> diamond)', () => {
    const diamond = applyTier(skillBook.venom_fang!, 'diamond');
    const dot = diamond.effects.find((e) => 'stacks' in e) as { stacks: number } | undefined;
    expect(dot).toBeDefined();
    expect(renderSkillText(diamond)).toContain(`{{Poison}} ${dot!.stacks}`);
  });

  it('EVERY card, at EVERY reachable tier, prints every magnitude its kit carries', () => {
    // The old drift guard's real job, kept — but now it audits a GENERATOR
    // rather than 450 authored strings, so a failure means the composer lost a
    // clause, never that an author forgot to retype a number.
    const missing: string[] = [];
    for (const skill of Object.values(skillBook)) {
      for (const tier of ['bronze', 'silver', 'gold', 'diamond'] as const) {
        if (['bronze', 'silver', 'gold', 'diamond'].indexOf(tier) < ['bronze', 'silver', 'gold', 'diamond'].indexOf(skill.tier)) continue;
        const resolved = applyTier(skill, tier);
        const face = renderSkillText(resolved);
        const numerals = new Set((face.match(/\d+/g) ?? []).map(Number));
        for (const action of resolved.effects) {
          // The one magnitude the face deliberately does not print: `stun`'s
          // `turns`, capped at 1 by `MAX_STUN_PER_CARD` and NOT a real-time
          // duration (user rulings 2026-08-19 / 08-20).
          if (action.kind === 'stun') continue;
          // A merged pile prints its TOTAL, not each contributing line.
          if (action.kind === 'poison' || action.kind === 'burn' || action.kind === 'bleed' || action.kind === 'thorns') continue;
          for (const [field, value] of Object.entries(action)) {
            if (typeof value !== 'number') continue;
            // `shareOf` prints as a ratio (`1/2`), whose denominator IS in the
            // face; every other numeric field prints verbatim.
            if (!numerals.has(value)) missing.push(`${skill.id}@${tier}: ${action.kind}.${field} = ${value} not on the face "${face}"`);
          }
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('same-tier applyTier returns the identical def for an unlocked card', () => {
    // Reference identity — what makes "un-featured input resolves
    // byte-identically" true by construction rather than by inspection.
    const unlocked = skillBook.sword_slash!;
    expect(unlocked.effects.some((a) => a.minTier !== undefined), 'the probe must have no lock').toBe(false);
    expect(applyTier(unlocked, 'bronze')).toBe(unlocked);

    // A capstone genuinely has to drop a line at Bronze, so it is a new object;
    // assert on VALUE, which is the strongest claim available there.
    const locked = skillBook.arcane_bolt!;
    expect(locked.effects.some((a) => a.minTier !== undefined), 'the capstone must carry a lock').toBe(true);
    const bronze = applyTier(locked, 'bronze');
    expect(bronze.effects, 'the Bronze copy is the kit minus every locked line')
      .toEqual(locked.effects.filter((a) => a.minTier === undefined));
  });
});
