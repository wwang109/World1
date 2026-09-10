import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { AURA_RULE_ENTRY } from '../../src/engine/keywords/text';
import { cardHoverEntries } from '../../src/game/ui/cardHoverEntries';
import {
  archetypeEntry,
  elementEntry,
  powerLevelEntry,
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
    expect(fire.body).toContain('damage against Nature Affinity');
    expect(fire.body).toContain('+50%');
    expect(fire.body).toContain('damage against Frost Affinity');
    expect(fire.body).toContain('-25%');

    const holy = elementEntry('holy');
    expect(holy.body).toContain('Dark');
  });

  it('states Holy and Dark mutual advantage without a same-type penalty', () => {
    expect(elementEntry('holy').body).toBe(
      'Deals +50% damage against Dark Affinity. Deals normal damage against Holy Affinity.',
    );
    expect(elementEntry('dark').body).toBe(
      'Deals +50% damage against Holy Affinity. Deals normal damage against Dark Affinity.',
    );
  });

  it('explains the weapon triangle and the bow/beast exception', () => {
    expect(weaponEntry('sword').body).toContain('damage against Axe Affinity');
    expect(weaponEntry('sword').body).toContain('damage against Lance Affinity');
    expect(weaponEntry('bow').body).toContain('Beast Affinity');
    expect(weaponEntry('beast').body).toContain('Bow cards');
  });

  it('states both directions of the Beast and Bow matchup', () => {
    expect(weaponEntry('beast').body).toBe(
      'Deals -25% damage against Bow Affinity. Bow cards deal +50% damage against Beast Affinity. Has no other weapon matchup.',
    );
  });

  it('explains properties, weight, and board footprint', () => {
    expect(propertyEntry('true')).toEqual({ title: '(T) TRUE', body: 'Ignores type matchups.' });
    const fireball = skillBook.fireball!;
    expect(weightEntry(fireball).body).toContain('readiness');
    expect(slotEntry({ ...fireball, size: 2 }).body).toContain('2 of 10 board slots');
    expect(slotEntry({ ...fireball, size: 1 }).body).toContain('1 of 10 board slots');
  });

  it('derives keyword entries from the card effects', () => {
    const venomFang = skillBook.venom_fang!;
    const entries = skillKeywordEntries(venomFang);
    expect(entries.some((entry) => entry.title === 'Poison')).toBe(true);
    expect(entries.find((entry) => entry.title === 'Poison')!.body).toContain('Ignores shields');
  });

  it('derives the canonical Aura entry from the card aura', () => {
    const entries = skillKeywordEntries(skillBook.enfilade_volley!);
    expect(entries.find((entry) => entry.title === 'Aura')).toBe(AURA_RULE_ENTRY);
  });

  it('does not add Aura to a card without an aura', () => {
    expect(skillKeywordEntries(skillBook.fireball!).some((entry) => entry.title === 'Aura')).toBe(false);
  });

  it('desktop hover uses the same exported Aura entry', () => {
    const hoverAura = cardHoverEntries(skillBook.enfilade_volley!)
      .find((entry) => entry.title === 'Aura');
    expect(hoverAura).toBe(AURA_RULE_ENTRY);
  });

  // USER-LOCKED 2026-09-06: "I dont think you should be explaining the amount
  // of x debuff like poison 8 or thorn 5 as other cards that have other
  // amounts." The card face carries the amount; the helper a player presses is
  // a DEFINITION and reads identically on every card carrying that keyword.
  // Before this, every body interpolated the action — "Applies 4 poison",
  // "Applies 5 poison" — so the same mechanic had as many explanations as it
  // had cards.
  it('the SAME keyword hands back the SAME body whatever the card carries', () => {
    const four = skillKeywordEntries({ ...skillBook.fireball!, effects: [{ kind: 'poison', stacks: 4 }] });
    const twelve = skillKeywordEntries({ ...skillBook.fireball!, effects: [{ kind: 'poison', stacks: 12 }] });
    expect(four.find((e) => e.title === 'Poison')!.body)
      .toBe(twelve.find((e) => e.title === 'Poison')!.body);
  });

  it('no keyword body quotes a number, a percentage or keyword markup', () => {
    // A digit in a definition can only have come from one card's parameters.
    const offenders: string[] = [];
    for (const skill of Object.values(skillBook)) {
      for (const entry of skillKeywordEntries(skill)) {
        // The AFFINITY WRAP is the one exception and is card-scoped by design:
        // it states the board REQUIREMENT (IDENTITY_THRESHOLD cards of the
        // card's own named type), which is a fact about this card's gate.
        if (entry.title === 'Affinity') continue;
        if (/\d/.test(entry.body)) offenders.push(`${skill.id}: ${entry.title} — "${entry.body}"`);
        if (entry.body.includes('%')) offenders.push(`${skill.id}: ${entry.title} has a %`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('picks element, weapon, or property for the type badge', () => {
    expect(typeBadgeEntry(skillBook.fireball!).title).toBe('Fire element');
    expect(typeBadgeEntry(skillBook.crippling_strike!).title).toContain('weapon');
  });

  it('shows each tier as one rank label while keeping Power Level separate', () => {
    const rankLabels = {
      bronze: 'Rank Bronze',
      silver: 'Rank Silver',
      gold: 'Rank Gold',
      diamond: 'Rank Diamond',
    } as const;
    for (const [tier, title] of Object.entries(rankLabels)) {
      expect(tierEntry(tier as keyof typeof rankLabels)).toEqual({ title, body: '' });
    }
    expect(powerLevelEntry().body).toBe('Measures the total cost of the card’s effects and gems.');
  });

  it('names every archetype', () => {
    for (const archetype of ['offense', 'defensive', 'healing', 'support', 'debuff'] as const) {
      expect(archetypeEntry(archetype).body.length).toBeGreaterThan(10);
    }
  });

  // Proven false: `simulate.ts`'s stun branch sets `c.readiness = 0` — a
  // stunned unit's ENTIRE banked readiness is wiped, not carried, but this
  // entry used to say "still banks Speed" (the opposite claim).
  it('says a stun zeroes readiness, not that it "still banks Speed"', () => {
    const entries = skillKeywordEntries({ ...skillBook.fireball!, effects: [{ kind: 'stun', turns: 2 }] });
    const stun = entries.find((entry) => entry.title === 'Stun')!;
    expect(stun.body).toContain('readiness to zero');
    expect(stun.body).not.toContain('banked');
    expect(stun.body).not.toContain('still banks Speed');
  });

  // The Resonant Echo gem's `statStrike` action had no glossary entry at all.
  // The card-targeting family (2026-08-21 split). The one thing a player must
  // NOT read off these entries is "splash is a weight tax" — that was the
  // pre-split misread, and the tap-to-expand body is where the SPREADER model is
  // actually taught, since the compact face token is just `SPLASH`.
  describe('burden / curse / splash', () => {
    it('BURDEN states the card tax and lifetime directly', () => {
      const entries = skillKeywordEntries({ ...skillBook.fireball!, effects: [{ kind: 'burden', weight: 6 }] });
      const burden = entries.find((e) => e.title === 'Burden')!;
      // The AMOUNT is on the card face ({{Burden}} +6wt), never in the helper.
      expect(burden.body).toBe('Adds weight to the target card. Remains until that card is played.');
    });

    it('CURSE states the damage reduction and floor directly', () => {
      const entries = skillKeywordEntries({ ...skillBook.fireball!, effects: [{ kind: 'curse', amount: 4, turns: 2 }] });
      const curse = entries.find((e) => e.title === 'Curse')!;
      // Same rule: the numbers ({{Curse}} -4 (2t)) are the card's, the
      // mechanism is the keyword's — including the floor, which is a RULE
      // constant and so is spelled as words rather than as a digit.
      expect(curse.body).toBe(
        'Reduces the damage of the target card. Damage cannot fall below one. '
        + 'Reapplying Curse keeps the greater reduction and later expiry.',
      );
    });

    it('SPLASH states which effects spread and that board edges do not wrap', () => {
      const entries = skillKeywordEntries({
        ...skillBook.fireball!,
        effects: [{ kind: 'burden', weight: 6 }, { kind: 'splash' }],
      });
      const splash = entries.find((e) => e.title === 'Splash')!;
      // NOT a tax: no weight number, no "+N weight" claim of its own.
      expect(splash.body).toBe(
        "Also applies this card's Burden or Curse to adjacent cards. Does not wrap around board edges.",
      );
    });
  });

  describe('statStrike (Resonant Echo gem)', () => {
    // ONE definition covers BOTH forms, because the SHARE (`1/2` vs `1/4`) and
    // which form it is are the CARD's parameters — printed on the face as
    // `Echo 1/2` / `Strike 1/4` — while what an extra self-contained hit means
    // is the keyword's. Two entries titled differently per action was the old
    // shape, and it made the same mechanic look like two.
    it('one parameter-free definition covers the echo and the bare strike', () => {
      const echoEntries = skillKeywordEntries({
        ...skillBook.fireball!,
        effects: [{ kind: 'statStrike', shareOf: 2, echoHostPower: true }],
      });
      const bareEntries = skillKeywordEntries({
        ...skillBook.fireball!,
        effects: [{ kind: 'statStrike', shareOf: 4 }],
      });
      const echo = echoEntries.find((entry) => entry.title === 'Echo');
      const bare = bareEntries.find((entry) => entry.title === 'Echo');
      expect(echo, 'the echo form has an entry').toBeDefined();
      expect(bare, 'the bare form has the SAME entry').toBeDefined();
      expect(bare!.body).toBe(echo!.body);
      expect(echo!.body).toContain('resolves mitigation, shields, and Negate separately');
      expect(echo!.body).not.toMatch(/\d/);
    });
  });
  // REGRESSION: affinity gates and gated action keywords must remain separate.
  // Both halves are pinned because either alone can regress.
  describe('a gated keyword keeps its own definition', () => {
    it('uses the exact approved Affinity requirement without a tie clause', () => {
      const affinity = skillKeywordEntries(skillBook.bramble_covenant!)
        .find((entry) => entry.title === 'Affinity');
      expect(affinity).toEqual({
        title: 'Affinity',
        body: 'Requires 3 cards of this type on your board to activate this effect.',
      });
    });

    it('no entry title is a compound — the gate is its own entry', () => {
      const offenders: string[] = [];
      for (const skill of Object.values(skillBook)) {
        for (const entry of skillKeywordEntries(skill)) {
          if (entry.title.includes('(')) offenders.push(`${skill.id}: ${entry.title}`);
        }
      }
      expect(offenders, offenders.join('\n')).toEqual([]);
    });

    it('the gated card hands back the SAME body as the ungated one', () => {
      // bramble_covenant gates its poison behind Nature affinity;
      // venom_fang applies poison unconditionally.
      const gated = skillKeywordEntries(skillBook.bramble_covenant!);
      const ungated = skillKeywordEntries(skillBook.venom_fang!);
      const gatedPoison = gated.find((entry) => entry.title === 'Poison');
      const ungatedPoison = ungated.find((entry) => entry.title === 'Poison');
      expect(gatedPoison, 'the gated card still reaches the Poison rule').toBeDefined();
      expect(ungatedPoison).toBeDefined();
      expect(gatedPoison!.body).toBe(ungatedPoison!.body);
      // ...and the gate is reachable ALONGSIDE it, not instead of it.
      expect(gated.map((entry) => entry.title)).toContain('Affinity');
    });

    it('holds for EVERY gated card in the catalog, not just the sample', () => {
      // Every keyword body a gated card serves must be byte-identical to the
      // body the same keyword serves from an ungated action.
      const ungatedBodies = new Map<string, string>();
      for (const skill of Object.values(skillBook)) {
        if (skill.effects.some((action) => action.affinity === true)) continue;
        for (const entry of skillKeywordEntries(skill)) ungatedBodies.set(entry.title, entry.body);
      }
      const offenders: string[] = [];
      let compared = 0;
      for (const skill of Object.values(skillBook)) {
        if (!skill.effects.some((action) => action.affinity === true)) continue;
        for (const entry of skillKeywordEntries(skill)) {
          if (entry.title === 'Affinity') continue;
          const plain = ungatedBodies.get(entry.title);
          if (plain === undefined) continue;
          compared += 1;
          if (entry.body !== plain) offenders.push(`${skill.id}: ${entry.title}`);
        }
      }
      expect(compared, 'the sweep actually compared gated cards').toBeGreaterThan(20);
      expect(offenders, offenders.join('\n')).toEqual([]);
    });
  });
});
