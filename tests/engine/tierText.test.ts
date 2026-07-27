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
    expect(diamond.text).toContain(`+${power}`);
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
    const base = skillBook.arcane_bolt!;
    expect(applyTier(base, 'bronze')).toBe(base);
  });
});
