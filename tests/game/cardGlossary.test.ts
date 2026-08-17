import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import {
  archetypeEntry,
  elementEntry,
  propertyEntry,
  skillKeywordEntries,
  slotEntry,
  tierEntry,
  typeBadgeEntry,
  weaponEntry,
  weightEntry,
} from '../../src/game/ui/cardGlossary';

describe('card glossary', () => {
  it('explains the element wheel with matchup percentages', () => {
    const fire = elementEntry('fire');
    expect(fire.title).toBe('Fire element');
    expect(fire.body).toContain('beats Nature');
    expect(fire.body).toContain('+50%');
    expect(fire.body).toContain('loses to Frost');
    expect(fire.body).toContain('−25%');

    const holy = elementEntry('holy');
    expect(holy.body).toContain('Dark');
  });

  it('explains the weapon triangle and the bow/beast exception', () => {
    expect(weaponEntry('sword').body).toContain('beats Axe');
    expect(weaponEntry('sword').body).toContain('loses to Lance');
    expect(weaponEntry('bow').body).toContain('Beasts');
    expect(weaponEntry('beast').body).toContain('Bows');
  });

  it('explains properties, weight, and board footprint', () => {
    expect(propertyEntry('true').body).toContain('ignores Armor and Magic Resist');
    const fireball = skillBook.fireball!;
    expect(weightEntry(fireball).body).toContain('readiness');
    expect(slotEntry({ ...fireball, size: 2 }).body).toContain('2 of your 10 board slots');
    expect(slotEntry({ ...fireball, size: 1 }).body).toContain('1 of your 10 board slots');
  });

  it('derives keyword entries from the card effects', () => {
    const venomFang = skillBook.venom_fang!;
    const entries = skillKeywordEntries(venomFang);
    expect(entries.some((entry) => entry.title === 'Poison')).toBe(true);
    expect(entries.find((entry) => entry.title === 'Poison')!.body).toContain('bypasses shields');
  });

  it('picks element, weapon, or property for the type badge', () => {
    expect(typeBadgeEntry(skillBook.fireball!).title).toBe('Fire element');
    expect(typeBadgeEntry(skillBook.crippling_strike!).title).toContain('weapon');
  });

  it('explains tiers with their PL budgets', () => {
    expect(tierEntry('bronze').body).toContain('10 Power Level');
    expect(tierEntry('diamond').body).toContain('25 Power Level');
  });

  it('names every archetype', () => {
    for (const archetype of ['offense', 'defensive', 'healing', 'support', 'debuff'] as const) {
      expect(archetypeEntry(archetype).body.length).toBeGreaterThan(10);
    }
  });

  // Proven false: `simulate.ts`'s stun branch sets `c.readiness = 0` — a
  // stunned unit's ENTIRE banked readiness is wiped, not carried, but this
  // entry used to say "still banks Speed" (the opposite claim).
  it('says a stun wipes banked readiness, not that it "still banks Speed"', () => {
    const entries = skillKeywordEntries({ ...skillBook.fireball!, effects: [{ kind: 'stun', turns: 2 }] });
    const stun = entries.find((entry) => entry.title === 'Stun')!;
    expect(stun.body).toContain('wipes');
    expect(stun.body).not.toContain('still banks Speed');
  });

  // The Resonant Echo gem's `statStrike` action had no glossary entry at all.
  describe('statStrike (Resonant Echo gem)', () => {
    it('explains an echoHostPower strike as a share of the whole attack', () => {
      const entries = skillKeywordEntries({
        ...skillBook.fireball!,
        effects: [{ kind: 'statStrike', shareOf: 2, echoHostPower: true }],
      });
      const echo = entries.find((entry) => entry.title === 'Echo');
      expect(echo).toBeDefined();
      expect(echo!.body).toContain('1/2');
    });

    it('explains a bare statStrike as a share of the caster\'s stat', () => {
      const entries = skillKeywordEntries({
        ...skillBook.fireball!,
        effects: [{ kind: 'statStrike', shareOf: 4 }],
      });
      const strike = entries.find((entry) => entry.title === 'Stat strike');
      expect(strike).toBeDefined();
      expect(strike!.body).toContain('1/4');
    });
  });
});
