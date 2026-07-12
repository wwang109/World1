import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';

// Drift guard: every numeric magnitude a card's `effects`/`aura` carries must
// be spelled out verbatim in its `text`. This keeps card prose from silently
// diverging from the mechanics it describes (see docs/card-text-style-guide.md).
//
// We don't try to reconstruct the exact sentence — just extract every integer
// that appears in `text` and assert each mechanically-relevant number is one
// of them. `stun` with turns === 1 is exempt: per the style guide its
// canonical phrasing ("the enemy's next performance is consumed") carries no
// numeral for the single-performance case.

function numbersInText(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}

describe('card text drift guard', () => {
  for (const skill of Object.values(skillBook)) {
    it(`${skill.id}: every effect/aura magnitude appears in text`, () => {
      const nums = numbersInText(skill.text);
      const expected: number[] = [];

      for (const eff of skill.effects) {
        switch (eff.kind) {
          case 'damage':
          case 'heal':
          case 'shield':
            expected.push(eff.power);
            break;
          case 'poison':
          case 'burn':
            expected.push(eff.amount, eff.turns);
            break;
          case 'stun':
            if (eff.turns > 1) expected.push(eff.turns);
            break;
          case 'buffStat':
          case 'debuffStat':
            expected.push(eff.pct, eff.turns);
            break;
          case 'cleanse':
            break;
          case 'slowNext':
            expected.push(eff.weight);
            break;
          case 'stagger':
          case 'shieldBreak':
            expected.push(eff.amount);
            break;
          case 'lifesteal':
          case 'comboBonus':
            expected.push(eff.pct);
            break;
          case 'guard':
            expected.push(eff.pct, eff.turns);
            break;
          case 'negate':
            expected.push(eff.charges);
            break;
        }
      }

      if (skill.aura) {
        const { damagePct, healPct, weightDelta, critPctDelta } = skill.aura.mods;
        if (damagePct !== undefined) expected.push(damagePct);
        if (healPct !== undefined) expected.push(healPct);
        if (weightDelta !== undefined) expected.push(Math.abs(weightDelta));
        if (critPctDelta !== undefined) expected.push(critPctDelta);
      }

      for (const n of expected) {
        expect(nums, `${skill.id}: expected number ${n} not found in text: "${skill.text}"`).toContain(n);
      }
    });
  }
});
