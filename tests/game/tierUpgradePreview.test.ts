import { describe, expect, it } from 'vitest';
import { renderSkillText } from '../../src/engine/keywords/compose';
import { tierUpgradePreview } from '../../src/game/ui/tierUpgradePreview';

describe('game/ui/tierUpgradePreview', () => {
  it('shows Arcane Bolt Gold -> Diamond as the exact conditional destination trade', () => {
    const preview = tierUpgradePreview('arcane_bolt', 'gold', 'diamond');

    expect(preview.available).toBe(true);
    if (!preview.available) throw new Error('Arcane Bolt disappeared from the skill catalog');
    expect(preview.fromSkill.effects).toMatchObject([{ kind: 'damage', power: 38 }]);
    const face = renderSkillText(preview.toSkill);
    expect(face).toContain('Deal 24 (+MATK)');
    // The gated hit REPEATS the headline's kind, so the face says "Hit again
    // for" (2026-09-07) — the words the authored faces used, restored because
    // "Deal 48" beside "Deal 24" read as an unrelated second attack. What this
    // test needs from the face is unchanged: both numbers, and the gate.
    expect(face).toContain('{{Affinity}} Lightning — Hit again for 48 (+MATK)');
    expect(preview.guaranteedDeltaDeci).toBe(-70);
    expect(preview.conditionalTrade).toBe(true);
  });

  it('does not warn for an ordinary guaranteed-power upgrade', () => {
    const preview = tierUpgradePreview('sword_slash', 'bronze', 'silver');

    expect(preview.available).toBe(true);
    if (!preview.available) throw new Error('Sword Slash disappeared from the skill catalog');
    expect(preview.fromSkill.tier).toBe('bronze');
    expect(preview.toSkill.tier).toBe('silver');
    expect(preview.guaranteedDeltaDeci).toBeGreaterThanOrEqual(0);
    expect(preview.conditionalTrade).toBe(false);
  });

  it('returns a typed unavailable result for an unknown skill instead of throwing', () => {
    expect(tierUpgradePreview('not-a-real-skill', 'gold', 'diamond')).toEqual({
      available: false,
      skillId: 'not-a-real-skill',
      from: 'gold',
      to: 'diamond',
    });
  });
});
