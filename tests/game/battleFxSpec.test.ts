import { describe, expect, it } from 'vitest';
import {
  ALL_ARCHETYPES, ALL_ELEMENTS, ALL_PROPERTIES, ALL_WEAPONS,
  FX_TIERS, battleFxRecipe, fxTierFor, paletteFor, recipeForIdentity,
} from '../../src/game/ui/battleFxSpec';

describe('game/ui/battleFxSpec', () => {
  it('resolves a complete recipe for every archetype × element combination', () => {
    for (const archetype of ALL_ARCHETYPES) {
      for (const element of ALL_ELEMENTS) {
        const recipe = battleFxRecipe(archetype, 'magical', element);
        expect(recipe.motion.archetype).toBe(archetype);
        expect(recipe.motion.activeMs).toBeGreaterThan(0);
        expect(Number.isFinite(recipe.motion.driftY)).toBe(true);
        expect(recipe.palette.key).toBe(element);
        expect(recipe.palette.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(recipe.palette.colorNum).toBeGreaterThanOrEqual(0);
        expect(recipe.palette.glowNum).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('resolves a complete recipe for every archetype × weapon combination', () => {
    for (const archetype of ALL_ARCHETYPES) {
      for (const weapon of ALL_WEAPONS) {
        const recipe = battleFxRecipe(archetype, 'physical', undefined, weapon);
        expect(recipe.motion.archetype).toBe(archetype);
        expect(recipe.palette.key).toBe(weapon);
        expect(recipe.palette.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('resolves a complete recipe for every archetype × property combination (no element/weapon)', () => {
    for (const archetype of ALL_ARCHETYPES) {
      for (const property of ALL_PROPERTIES) {
        const recipe = battleFxRecipe(archetype, property);
        expect(recipe.motion.archetype).toBe(archetype);
        expect(recipe.palette.key).toBe(property);
        expect(recipe.palette.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('gives TRUE a dedicated white/prismatic fallback, distinct from the card-token cream stripe', () => {
    const p = paletteFor('true');
    expect(p.color).toBe('#ffffff');
    expect(p.key).toBe('true');
  });

  it('element beats weapon beats property when more than one is present', () => {
    const withBoth = paletteFor('physical', 'fire', 'sword');
    expect(withBoth.key).toBe('fire');
    const weaponOnly = paletteFor('physical', undefined, 'sword');
    expect(weaponOnly.key).toBe('sword');
  });

  it('every motion profile is short and returns to rest (no archetype leaves a permanent offset)', () => {
    for (const archetype of ALL_ARCHETYPES) {
      const m = battleFxRecipe(archetype, 'physical').motion;
      expect(m.activeMs).toBeLessThanOrEqual(400);
      expect(m.scalePeak).toBeGreaterThanOrEqual(1);
      expect(m.scalePeak).toBeLessThan(1.5);
    }
  });

  it('recipeForIdentity returns undefined without a full identity, and the same recipe otherwise', () => {
    expect(recipeForIdentity(undefined, 'physical')).toBeUndefined();
    expect(recipeForIdentity('offense', undefined)).toBeUndefined();
    const r = recipeForIdentity('offense', 'magical', 'fire');
    expect(r).toEqual(battleFxRecipe('offense', 'magical', 'fire'));
  });

  it('damage-number tiers are sorted ascending and monotonically non-decreasing in emphasis', () => {
    for (let i = 1; i < FX_TIERS.length; i++) {
      expect(FX_TIERS[i]!.min).toBeGreaterThan(FX_TIERS[i - 1]!.min);
      expect(FX_TIERS[i]!.fontScale).toBeGreaterThanOrEqual(FX_TIERS[i - 1]!.fontScale);
    }
    // Only the top tier flashes.
    const flashing = FX_TIERS.filter((t) => t.flash);
    expect(flashing).toHaveLength(1);
    expect(flashing[0]).toBe(FX_TIERS[FX_TIERS.length - 1]);
  });

  it('fxTierFor resolves the highest tier the amount clears, and is monotonic in amount', () => {
    expect(fxTierFor(0)).toBe(FX_TIERS[0]);
    expect(fxTierFor(19)).toBe(FX_TIERS[0]);
    expect(fxTierFor(20)).toBe(FX_TIERS[1]);
    expect(fxTierFor(44)).toBe(FX_TIERS[1]);
    expect(fxTierFor(45)).toBe(FX_TIERS[2]);
    expect(fxTierFor(9999)).toBe(FX_TIERS[FX_TIERS.length - 1]);
    let lastScale = 0;
    for (let amount = 0; amount <= 100; amount += 5) {
      const scale = fxTierFor(amount).fontScale;
      expect(scale).toBeGreaterThanOrEqual(lastScale);
      lastScale = scale;
    }
  });
});
