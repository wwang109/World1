import { describe, expect, it } from 'vitest';
import { applyTier } from '../../src/engine/cards';
import { skillBook } from '../../src/data/skills';

/**
 * Auto-scaled tier-ups must keep the display `text` honest: when applyTier's
 * generic path changes an effect's power/stacks, the number in the card text
 * changes with it (authored tierUpgrades carry their own text and are
 * untouched by this rule).
 */
describe('engine/cards: auto-scaled tier text', () => {
  it('rewrites damage power in the text (arcane_bolt → diamond)', () => {
    const base = skillBook.arcane_bolt!;
    const diamond = applyTier(base, 'diamond');
    const power = (diamond.effects[0] as { power: number }).power;
    expect(power).toBeGreaterThan((base.effects[0] as { power: number }).power);
    // Sentence shape is "Deal {power} (+MATK) ... damage." (number-first,
    // no leading "+" on the power itself — see docs/card-text-style-guide.md)
    // so we assert the bare number, not a "+"-prefixed one.
    expect(diamond.text).toContain(`${power}`);
    expect(diamond.text).not.toBe(base.text);
  });

  it('rewrites DoT stacks in the text (venom_fang → diamond)', () => {
    const base = skillBook.venom_fang!;
    const diamond = applyTier(base, 'diamond');
    const dot = diamond.effects.find((e) => 'stacks' in e) as { stacks: number } | undefined;
    expect(dot).toBeDefined();
    expect(diamond.text).toContain(`${dot!.stacks}`);
  });

  it('same-tier applyTier returns the identical def (no retext)', () => {
    // A card with NO tier lock comes back by REFERENCE — that identity is what
    // makes "un-featured input resolves byte-identically" true by construction.
    // `arcane_bolt` used to be the probe here and no longer qualifies: it is a
    // Diamond capstone, so post-migration its ONE definition carries a
    // `minTier: 'diamond'` line that `tierResolved` must strip at Bronze (a new
    // object, necessarily). `sword_slash` carries no lock, so it still proves the
    // reference contract; the capstone is asserted on VALUE below, which is the
    // strongest claim available once an action really has to be removed.
    const unlocked = skillBook.sword_slash!;
    expect(unlocked.effects.some((a) => a.minTier !== undefined), 'the probe must have no lock').toBe(false);
    expect(applyTier(unlocked, 'bronze')).toBe(unlocked);

    const locked = skillBook.arcane_bolt!;
    expect(locked.effects.some((a) => a.minTier !== undefined), 'the capstone must carry a lock').toBe(true);
    const bronze = applyTier(locked, 'bronze');
    expect(bronze.text, 'no retext at the card own tier').toBe(locked.text);
    expect(bronze.effects, 'the Bronze copy is the kit minus every locked line')
      .toEqual(locked.effects.filter((a) => a.minTier === undefined));
  });
});
