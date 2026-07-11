import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { enemies } from '../../src/data/enemies';
import { enchantBook } from '../../src/data/enchants';

// Card/enemy/enchant data is authored in src/data/*.json, which TypeScript
// cannot narrow against the engine unions — this suite is the safety net that
// the compiler used to be. Every literal field is checked against the exact
// unions in src/engine/types.ts; update both together when adding a verb.

const ARCHETYPES = ['offense', 'defensive', 'healing', 'support', 'debuff'];
const PROPERTIES = ['physical', 'magical', 'true'];
const ELEMENTS = ['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'];
const WEAPONS = ['sword', 'axe', 'lance', 'bow', 'beast'];
const TIERS = ['bronze', 'silver', 'gold', 'diamond'];
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const TARGET_MODES = ['aggro', 'lowAggro', 'lowestHp', 'all'];
const BUFFABLE = ['attack', 'magicPower', 'armor', 'magicResist', 'speed', 'critPct', 'resolve'];

/** kind -> required numeric fields (and 'stat' where a BuffableStat is required). */
const ACTION_SHAPES: Record<string, string[]> = {
  damage: ['power'],
  heal: ['power'],
  shield: ['power'],
  poison: ['amount', 'turns'],
  burn: ['amount', 'turns'],
  stun: ['turns'],
  buffStat: ['stat', 'pct', 'turns'],
  debuffStat: ['stat', 'pct', 'turns'],
  cleanse: [],
  slowNext: ['weight'],
  weakenNext: ['pct'],
  curseCard: ['power'],
  stagger: ['amount'],
  lifesteal: ['pct'],
  shieldBreak: ['amount'],
  comboBonus: ['pct'],
  execute: ['pct', 'belowPct'],
  quicken: ['weight'],
  thorns: ['pct', 'turns'],
  multiHit: ['power', 'hits'],
  purge: [],
  regen: ['amount', 'turns'],
  dodge: ['hits'],
  guard: ['pct', 'turns'],
  empower: ['pct'],
  bloodCost: ['amount'],
};

describe('skills.json integrity', () => {
  const cards = Object.values(skillBook);

  it('has cards and unique ids', () => {
    expect(cards.length).toBeGreaterThan(0);
    for (const [id, card] of Object.entries(skillBook)) expect(card.id).toBe(id);
  });

  it.each(cards.map((c) => [c.id, c] as const))('%s is well-formed', (_id, c) => {
    expect(c.name.length).toBeGreaterThan(0);
    expect(c.text.length).toBeGreaterThan(0);
    expect(c.archetypes.length).toBeGreaterThan(0);
    for (const a of c.archetypes) expect(ARCHETYPES).toContain(a);
    expect(PROPERTIES).toContain(c.property);
    expect([1, 2, 3]).toContain(c.size);
    expect(TIERS).toContain(c.tier);
    expect(RARITIES).toContain(c.rarity);
    if (c.element !== undefined) expect(ELEMENTS).toContain(c.element);
    if (c.weapon !== undefined) expect(WEAPONS).toContain(c.weapon);
    if (c.targeting !== undefined) expect(TARGET_MODES).toContain(c.targeting);
    // Minimum weight 5: keeps the chain rule's doubling cost honest.
    if (c.speedWeight !== undefined) expect(c.speedWeight).toBeGreaterThanOrEqual(5);
    if (c.uses !== undefined) expect(c.uses).toBeGreaterThan(0);

    for (const action of c.effects) {
      const shape = ACTION_SHAPES[action.kind];
      expect(shape, `unknown action kind '${action.kind}'`).toBeDefined();
      if (action.onlyIf !== undefined) expect(['faster', 'slower']).toContain(action.onlyIf);
      for (const field of shape!) {
        const value = (action as unknown as Record<string, unknown>)[field];
        if (field === 'stat') expect(BUFFABLE).toContain(value);
        else {
          expect(typeof value, `${action.kind}.${field}`).toBe('number');
          expect(value as number).toBeGreaterThan(0);
        }
      }
    }

    if (c.aura) {
      expect(['adjacent', 'allBoard']).toContain(c.aura.affects);
      expect(Object.keys(c.aura.mods).length).toBeGreaterThan(0);
    }
  });
});

describe('enemies.json integrity', () => {
  const all = Object.values(enemies);

  it('has enemies and unique ids', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const [id, e] of Object.entries(enemies)) expect(e.id).toBe(id);
  });

  it.each(all.map((e) => [e.id, e] as const))('%s is well-formed', (_id, e) => {
    expect(e.name.length).toBeGreaterThan(0);
    expect(e.stats.hp).toBe(e.stats.maxHp);
    expect(e.stats.maxHp).toBeGreaterThan(0);
    if (e.elementAffinity !== undefined) expect(ELEMENTS).toContain(e.elementAffinity);
    if (e.weaponAffinity !== undefined) expect(WEAPONS).toContain(e.weaponAffinity);

    // Every piece must reference a real card and fit on the board.
    expect(e.pieces.length).toBeGreaterThan(0);
    const taken = new Set<number>();
    for (const p of e.pieces) {
      const def = skillBook[p.skillId];
      expect(def, `${e.id} references unknown skill '${p.skillId}'`).toBeDefined();
      expect(p.slot).toBeGreaterThanOrEqual(0);
      expect(p.slot + def!.size).toBeLessThanOrEqual(e.boardSize);
      for (let s = p.slot; s < p.slot + def!.size; s++) {
        expect(taken.has(s), `${e.id} overlapping slot ${s}`).toBe(false);
        taken.add(s);
      }
    }
  });
});

describe('enchants.json integrity', () => {
  it.each(Object.entries(enchantBook))('%s is well-formed', (id, e) => {
    expect(e.id).toBe(id);
    expect(e.name.length).toBeGreaterThan(0);
    expect(e.icon.length).toBeGreaterThan(0);
    expect(e.text.length).toBeGreaterThan(0);
    expect(TARGET_MODES).toContain(e.targeting);
    if (e.aoeDamagePct !== undefined) expect(e.aoeDamagePct).toBeGreaterThan(0);
    if (e.powerPct !== undefined) expect(e.powerPct).toBeGreaterThan(0);
    if (e.uses !== undefined) expect(e.uses).toBeGreaterThan(0);
  });
});
