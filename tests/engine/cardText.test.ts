import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
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

function assertTextCoversKit(label: string, text: string, effects: readonly Action[], aura: AuraDef | undefined): void {
  const nums = numbersInText(text);
  for (const n of expectedNumbers(effects, aura)) {
    expect(nums, `${label}: expected number ${n} not found in text: "${text}"`).toContain(n);
  }
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
