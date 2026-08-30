import { describe, expect, it } from 'vitest';
import type { SkillDef } from '../../src/engine/types';
import { skillBook } from '../../src/data/skills';
import { summarizeEffects, summarizeEffectSegments } from '../../src/game/ui/skillPresentation';

function makeSkill(overrides: Partial<SkillDef>): SkillDef {
  return {
    id: 'test_skill',
    name: 'Test Skill',
    archetypes: ['offense'],
    property: 'physical',
    size: 1,
    rarity: 'common',
    tier: 'bronze',
    effects: [],
    text: '',
    ...overrides,
  };
}

describe('summarizeEffects — live stat scaling', () => {
  it('falls back to the bare base number with no stats supplied', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    expect(summarizeEffects(skill)).toBe('DMG 20');
  });

  it('renders physical damage as the summed effective number (base + Attack)', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    expect(summarizeEffects(skill, { attack: 17, magicPower: 4, armor: 0, magicResist: 0 })).toBe('DMG 37');
  });

  it('renders magical damage as the summed effective number (base + Magic Power)', () => {
    const skill = makeSkill({ property: 'magical', element: 'fire', effects: [{ kind: 'damage', power: 18 }] });
    expect(summarizeEffects(skill, { attack: 5, magicPower: 12, armor: 0, magicResist: 0 })).toBe('DMG 30');
  });

  it('renders TRUE damage summed off whichever stat is higher, tagged (T)', () => {
    const skill = makeSkill({ property: 'true', effects: [{ kind: 'damage', power: 10 }] });
    expect(summarizeEffects(skill, { attack: 20, magicPower: 8, armor: 0, magicResist: 0 })).toBe('DMG 30 (T)');
    expect(summarizeEffects(skill, { attack: 8, magicPower: 20, armor: 0, magicResist: 0 })).toBe('DMG 30 (T)');
  });

  // DEFENSIVE output sums off the DEFENSIVE stat (2026-08-05). Magic Power is
  // deliberately set HIGH and Magic Resist low here: under the old offense-only
  // rule these read HEAL 32 / SHLD 28, so the numbers below only pass if the
  // defensive side is what's actually being summed.
  it('renders magical heal/shield summed off Magic Resist, NOT Magic Power', () => {
    const heal = makeSkill({ property: 'magical', element: 'nature', effects: [{ kind: 'heal', power: 20 }] });
    expect(summarizeEffects(heal, { attack: 4, magicPower: 12, armor: 3, magicResist: 7 })).toBe('HEAL 27');
    const shield = makeSkill({ property: 'magical', element: 'frost', effects: [{ kind: 'shield', power: 16 }] });
    expect(summarizeEffects(shield, { attack: 4, magicPower: 12, armor: 3, magicResist: 7 })).toBe('SHLD 23');
  });

  it('renders physical heal/shield summed off Armor, NOT Attack', () => {
    const heal = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'heal', power: 20 }] });
    expect(summarizeEffects(heal, { attack: 30, magicPower: 0, armor: 5, magicResist: 0 })).toBe('HEAL 25');
    const shield = makeSkill({ property: 'physical', weapon: 'axe', effects: [{ kind: 'shield', power: 16 }] });
    expect(summarizeEffects(shield, { attack: 30, magicPower: 0, armor: 5, magicResist: 0 })).toBe('SHLD 21');
  });

  it('never scales TRUE heal/shield — stays flat even with stats supplied, tagged (T)', () => {
    const heal = makeSkill({ property: 'true', effects: [{ kind: 'heal', power: 20 }] });
    expect(summarizeEffects(heal, { attack: 99, magicPower: 99, armor: 0, magicResist: 0 })).toBe('HEAL 20 (T)');
    const shield = makeSkill({ property: 'true', effects: [{ kind: 'shield', power: 16 }] });
    expect(summarizeEffects(shield, { attack: 99, magicPower: 99, armor: 0, magicResist: 0 })).toBe('SHLD 16 (T)');
  });

  it('falls back to bare base when the stat contribution is zero', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    expect(summarizeEffects(skill, { attack: 0, magicPower: 0, armor: 0, magicResist: 0 })).toBe('DMG 20');
  });

  it('keeps non-scaling extras (DoTs, riders) unchanged alongside the scaled line', () => {
    const skill = makeSkill({
      property: 'physical',
      weapon: 'axe',
      effects: [{ kind: 'damage', power: 12 }, { kind: 'poison', stacks: 5 }],
    });
    expect(summarizeEffects(skill, { attack: 6, magicPower: 0, armor: 0, magicResist: 0 })).toBe('DMG 18 · PSN 5');
  });

  it('leaves aura cards and passives untouched by the stats param', () => {
    const passive = makeSkill({ effects: [] });
    expect(summarizeEffects(passive, { attack: 10, magicPower: 10, armor: 0, magicResist: 0 })).toBe('PASSIVE');
  });
});

// User ruling (2026-08-19): a stun denies the victim's next action WHENEVER
// it happens, not "1 turn" from now — the old "STUN 1" face token read like a
// 1-turn duration, and the number was the lie (every stun-carrying card in the
// current data always applies exactly `turns: 1`; the face token drops the
// number entirely rather than reintroduce a misleading count in a new shape).
// User ruling (2026-08-20): drop the "NEXT ACTION" qualifier too — bare
// "STUN" is enough on the card face.
describe('summarizeEffects — stun is a bare token, not a turn count', () => {
  it('names a 1-charge stun STUN, no number', () => {
    const skill = makeSkill({ effects: [{ kind: 'stun', turns: 1 }] });
    expect(summarizeEffects(skill)).toBe('STUN');
  });

  it('keeps the same face token for a multi-charge stun (the count moves to the tap-to-expand glossary)', () => {
    const skill = makeSkill({ effects: [{ kind: 'stun', turns: 3 }] });
    expect(summarizeEffects(skill)).toBe('STUN');
  });
});

// Guard and negate each cover ONE property carried by the action itself (not
// inferable from the card — a gem can graft a differently-typed one onto any
// card), so the card face names it P./M./T.GUARD and P./M./T.NEGATE, mirroring
// the P./M./T.SHIELD pool tokens. A bare "GUARD 20%"/"NEGATE ×1" told the
// player nothing about what it actually stops.
describe('summarizeEffects — guard/negate property tokens', () => {
  it('names a physical guard P.GUARD', () => {
    const skill = makeSkill({ effects: [{ kind: 'guard', property: 'physical', pct: 20, turns: 2 }] });
    expect(summarizeEffects(skill)).toBe('P.GUARD 20%');
  });

  it('names a magical guard M.GUARD', () => {
    const skill = makeSkill({ effects: [{ kind: 'guard', property: 'magical', pct: 15, turns: 1 }] });
    expect(summarizeEffects(skill)).toBe('M.GUARD 15%');
  });

  it('names a TRUE guard T.GUARD', () => {
    const skill = makeSkill({ effects: [{ kind: 'guard', property: 'true', pct: 10, turns: 1 }] });
    expect(summarizeEffects(skill)).toBe('T.GUARD 10%');
  });

  it('names a physical negate P.NEGATE', () => {
    const skill = makeSkill({ effects: [{ kind: 'negate', property: 'physical', charges: 1 }] });
    expect(summarizeEffects(skill)).toBe('P.NEGATE ×1');
  });

  it('names a magical negate M.NEGATE', () => {
    const skill = makeSkill({ effects: [{ kind: 'negate', property: 'magical', charges: 2 }] });
    expect(summarizeEffects(skill)).toBe('M.NEGATE ×2');
  });

  it('names a TRUE negate T.NEGATE', () => {
    const skill = makeSkill({ effects: [{ kind: 'negate', property: 'true', charges: 1 }] });
    expect(summarizeEffects(skill)).toBe('T.NEGATE ×1');
  });
});

// User ruling (2026-08-20): "aura card should just say aura, not this far
// near thing." The face used to lead with a reach word (ALL/NEAR) — an
// all-board +5 and an adjacent +15 price the same and the OLD face token
// distinguished them for that reason — but the user overruled it for the
// compact face; reach now lives only in the full card text + wiki detail
// pane (see the comment above `summarizeEffectSegments`'s aura branch).
describe('summarizeEffects — aura cards just say AURA', () => {
  it('an all-board aura reads AURA, no reach word', () => {
    const skill = makeSkill({ aura: { affects: 'allBoard', mods: { damageFlat: 5 } } });
    expect(summarizeEffects(skill)).toBe('AURA +5 DMG');
  });

  it('an adjacent aura ALSO reads AURA — same token as all-board, on purpose', () => {
    const skill = makeSkill({
      aura: { affects: 'adjacent', archetypeFilter: 'offense', mods: { damageFlat: 15 } },
    });
    expect(summarizeEffects(skill)).toBe('AURA +15 DMG');
  });

  it('weight auras drop the reach word too', () => {
    const skill = makeSkill({ aura: { affects: 'adjacent', mods: { weightDelta: -5 } } });
    expect(summarizeEffects(skill)).toBe('AURA -5 WT');
    expect(summarizeEffects(skill, { attack: 10, magicPower: 10, armor: 0, magicResist: 0 })).toBe('AURA -5 WT');
  });
});

// The Resonant Echo gem (src/data/gems.ts: `{ kind: 'statStrike', shareOf: 2,
// echoHostPower: true }`) had NO face token at all — a card whose only effect
// was a `statStrike` fell through every case in `summarizeEffects`'s switch
// and rendered as the literal string 'PASSIVE', hiding a real second hit that
// the printed WEIGHT already charged the player for (proven: bare card face
// "DMG 20 +ATK · weight 10", echoed face "DMG 20 +ATK · weight 12" — same
// visible DMG line, heavier card, nothing showing why).
describe('summarizeEffects — statStrike (Resonant Echo gem)', () => {
  it('renders an echoHostPower statStrike as an ECHO share, alongside the host damage line', () => {
    const skill = makeSkill({
      property: 'physical',
      weapon: 'sword',
      effects: [{ kind: 'damage', power: 20 }, { kind: 'statStrike', shareOf: 2, echoHostPower: true }],
    });
    expect(summarizeEffects(skill, undefined, 'composition')).toBe('DMG 20 +ATK · ECHO 1/2');
  });

  it('a card whose ONLY effect is a statStrike is no longer PASSIVE', () => {
    const skill = makeSkill({ effects: [{ kind: 'statStrike', shareOf: 2, echoHostPower: true }] });
    expect(summarizeEffects(skill)).toBe('ECHO 1/2');
    expect(summarizeEffects(skill)).not.toBe('PASSIVE');
  });

  it('a bare (non-echo) statStrike renders as a plain STRIKE share', () => {
    const skill = makeSkill({ effects: [{ kind: 'statStrike', shareOf: 4 }] });
    expect(summarizeEffects(skill)).toBe('STRIKE 1/4');
  });

  it('shows a capped statStrike\'s ceiling', () => {
    const skill = makeSkill({ effects: [{ kind: 'statStrike', shareOf: 2, cap: 40 }] });
    expect(summarizeEffects(skill)).toBe('STRIKE 1/2 (cap 40)');
  });
});

describe('summarizeEffects — desktop composition mode', () => {
  it('shows the formula (base +ATK) for physical damage, regardless of live stats', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    expect(summarizeEffects(skill, undefined, 'composition')).toBe('DMG 20 +ATK');
    expect(summarizeEffects(skill, { attack: 17, magicPower: 4, armor: 0, magicResist: 0 }, 'composition')).toBe('DMG 20 +ATK');
  });

  it('shows the DEFENSIVE formula (base +MDEF) for magical heal — not +MATK', () => {
    const skill = makeSkill({ property: 'magical', element: 'nature', effects: [{ kind: 'heal', power: 20 }] });
    expect(summarizeEffects(skill, { attack: 4, magicPower: 12, armor: 0, magicResist: 0 }, 'composition')).toBe('HEAL 20 +MDEF');
  });

  // The label names the OUTPUT, the token names the STAT. Shield's composition
  // label used to be 'DEF' to match the old card-data grammar; once the token
  // itself became 'DEF' that produced the useless "DEF 96 +DEF", so the label
  // is 'SHLD' in both modes now.
  it('keeps the shield label SHLD so it never collides with the +DEF token', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'axe', effects: [{ kind: 'shield', power: 96 }] });
    expect(summarizeEffects(skill, undefined, 'composition')).toBe('SHLD 96 +DEF');
    const magical = makeSkill({ property: 'magical', element: 'frost', effects: [{ kind: 'shield', power: 30 }] });
    expect(summarizeEffects(magical, undefined, 'composition')).toBe('SHLD 30 +MDEF');
  });

  it('TRUE effects ignore composition mode — flat/summed number plus (T), same as summed mode', () => {
    const heal = makeSkill({ property: 'true', effects: [{ kind: 'heal', power: 60 }] });
    expect(summarizeEffects(heal, { attack: 99, magicPower: 99, armor: 0, magicResist: 0 }, 'composition')).toBe('HEAL 60 (T)');
    const dmg = makeSkill({ property: 'true', effects: [{ kind: 'damage', power: 10 }] });
    expect(summarizeEffects(dmg, { attack: 20, magicPower: 8, armor: 0, magicResist: 0 }, 'composition')).toBe('DMG 30 (T)');
  });

  it('leaves non-scaling extras (DoTs, stat riders) unaffected by mode', () => {
    const skill = makeSkill({
      property: 'physical',
      weapon: 'axe',
      effects: [{ kind: 'damage', power: 12 }, { kind: 'poison', stacks: 5 }],
    });
    expect(summarizeEffects(skill, { attack: 6, magicPower: 0, armor: 0, magicResist: 0 }, 'composition')).toBe('DMG 12 +ATK · PSN 5');
  });

  it('leaves aura cards untouched by mode', () => {
    const skill = makeSkill({ aura: { affects: 'allBoard', mods: { damageFlat: 5 } } });
    expect(summarizeEffects(skill, undefined, 'composition')).toBe('AURA +5 DMG');
  });
});

// User ruling (2026-08-20): splash's face unit is WT — "BAND" was internal
// jargon. A broader token sweep was reverted the same day ("I didn't tell
// you to change other only the ones i requested") — SLOW/CLEANSE keep their
// long-standing forms. comboBonus was RE-RULED later the same day: it may say
// COMBO (the user's own word), but ONLY paired with battle playback greying
// the token out when the combo isn't live (see CardToken's `comboLive` /
// battleTimeline's `isComboLive` — tests in battleTimeline.test.ts pin that
// half of the ruling).
describe('summarizeEffects — ruled token forms', () => {
  it('BURDEN carries the WT unit — the weight tax keeps the ruled form', () => {
    // The 2026-08-20 ruling was about the UNIT ("BAND" was jargon, WT is the
    // unit the tax is actually in). The 2026-08-21 keyword split moved that
    // token from `splash` to `burden`, which is the keyword that owns the +N WT.
    const skill = makeSkill({ effects: [{ kind: 'burden', weight: 6 }] });
    expect(summarizeEffects(skill)).toBe('BURDEN +6 WT');
  });

  it('SPLASH prints NO number — the spreader has none', () => {
    // A weight on this token is exactly the misread the keyword split undid:
    // splash carries no payload, it widens the burden/curse beside it.
    const skill = makeSkill({ effects: [{ kind: 'burden', weight: 6 }, { kind: 'splash' }] });
    expect(summarizeEffects(skill)).toBe('BURDEN +6 WT · SPLASH');
  });

  it('CURSE prints the denial and its window, signed', () => {
    const skill = makeSkill({ effects: [{ kind: 'curse', amount: 4, turns: 2 }] });
    expect(summarizeEffects(skill)).toBe('CURSE -4 DMG 2t');
  });

  it('SLOW keeps its long-standing bare form (sweep reverted per user)', () => {
    const skill = makeSkill({ effects: [{ kind: 'slow', weight: 6 }] });
    expect(summarizeEffects(skill)).toBe('SLOW +6');
  });

  it('CLEANSE keeps its long-standing bare count (sweep reverted per user)', () => {
    const skill = makeSkill({ effects: [{ kind: 'cleanse', charges: 2 }] });
    expect(summarizeEffects(skill)).toBe('CLEANSE 2');
  });

  it('comboBonus renders COMBO +N (user-ruled 2026-08-20, paired with battle-playback greying)', () => {
    const skill = makeSkill({ effects: [{ kind: 'comboBonus', amount: 20 }] });
    expect(summarizeEffects(skill)).toBe('COMBO +20');
  });
});


/**
 * ATTUNED SHIELD — the keyword that printed NOTHING (2026-08-30).
 *
 * `summarizeEffectSegments` had no `case 'attunedShield'`, so the action fell
 * through every branch and contributed no token at all. That is not a cosmetic
 * gap: `CardToken` draws this line on EVERY card surface in the game — shop,
 * board, bag, draft, merge offers, wiki, both platforms — so four shipped
 * cards showed only the smaller half of their kit (`bulwark_of_the_line`
 * "SHLD 12" with its 24-point Lance wall missing, `riposte_guard` "DMG 24",
 * `emberguard` "DMG 12"), and `oathplate` — the one card where the action is
 * `affinity`-gated — rendered its gate label with an EMPTY payload after it:
 * the literal string "SHLD 14 · SWORD: ". A label with nothing after it is
 * the loudest possible form of this bug, and it is what these tests pin.
 */
describe('summarizeEffects — ATTUNED SHIELD', () => {
  it('prints the plating, the 2-for-1 rate, and the type it is tuned to', () => {
    const skill = makeSkill({ weapon: 'lance', effects: [{ kind: 'attunedShield', power: 24 }] });
    expect(summarizeEffects(skill)).toBe('ATTUNED SHLD 24 (2x vs LANCE)');
  });

  it('takes the defensive stat, exactly like the plain shield line beside it', () => {
    // The interpreter adds `scaleDefStat` to an attuned pool the same way it
    // does to a plain `shield` (see its `attunedShield` case), so the face's
    // summed number must add Armor for a physical card and Magic Resist for a
    // magical one — never Attack.
    const physical = makeSkill({ weapon: 'lance', effects: [{ kind: 'attunedShield', power: 24 }] });
    expect(summarizeEffects(physical, { attack: 99, magicPower: 0, armor: 6, magicResist: 0 }))
      .toBe('ATTUNED SHLD 30 (2x vs LANCE)');
    const magical = makeSkill({ property: 'magical', element: 'fire', effects: [{ kind: 'attunedShield', power: 24 }] });
    expect(summarizeEffects(magical, { attack: 0, magicPower: 99, armor: 0, magicResist: 4 }))
      .toBe('ATTUNED SHLD 28 (2x vs FIRE)');
  });

  it("composition mode names the stat, the same as the plain shield line", () => {
    const skill = makeSkill({ weapon: 'lance', effects: [{ kind: 'attunedShield', power: 24 }] });
    expect(summarizeEffects(skill, undefined, 'composition')).toBe('ATTUNED SHLD 24 +DEF (2x vs LANCE)');
  });

  it('does NOT fold into the plain shield total — they are different currencies', () => {
    // `oathplate`'s shape. Summing 14 + 8 would print a 22-point wall the card
    // never builds: the attuned points spend at a different rate and are held
    // in a separate pool (`combatant.attunedShields`).
    const skill = makeSkill({
      weapon: 'sword',
      effects: [{ kind: 'shield', power: 14 }, { kind: 'attunedShield', power: 8 }],
    });
    expect(summarizeEffects(skill)).toBe('SHLD 14 · ATTUNED SHLD 8 (2x vs SWORD)');
  });

  it('an AFFINITY-gated attuned shield fills its gate label instead of dangling', () => {
    const skill = makeSkill({
      weapon: 'sword',
      effects: [{ kind: 'shield', power: 14 }, { kind: 'attunedShield', power: 8, affinity: true }],
    });
    expect(summarizeEffects(skill)).toBe('SHLD 14 · SWORD: ATTUNED SHLD 8 (2x vs SWORD)');
  });

  it('every shipped card carrying the keyword actually prints it', () => {
    const cards = Object.values(skillBook).filter((c) => c.effects.some((a) => a.kind === 'attunedShield'));
    expect(cards.length, 'the keyword has shipped content — this test is not vacuous').toBeGreaterThan(0);
    for (const card of cards) {
      expect(summarizeEffects(card), card.id).toContain('ATTUNED SHLD');
    }
  });
});

describe('summarizeEffectSegments — no token may be empty or dangle', () => {
  it('NO card in the book prints a segment that ends in a colon or is blank', () => {
    // The general form of `oathplate`'s "SWORD: " — an affinity gate whose
    // payload produced no tokens. Any future keyword that lands without a case
    // in `summarizeEffectSegments` reopens exactly this hole, on every card
    // face in the game at once, so it is checked across the whole book rather
    // than card by card.
    const offenders: string[] = [];
    for (const card of Object.values(skillBook)) {
      for (const segment of summarizeEffectSegments(card)) {
        const text = segment.text.trim();
        if (text.length === 0 || text.endsWith(':')) offenders.push(`${card.id}: ${JSON.stringify(segment.text)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no card falls back to 'PASSIVE' while actually carrying effects", () => {
    // The other shape the same hole takes: a card whose ONLY action has no
    // case renders the empty-kit placeholder instead of its kit (this is how
    // the missing `statStrike` case was found in 2026-08).
    const offenders: string[] = [];
    for (const card of Object.values(skillBook)) {
      if (card.effects.length === 0 || card.aura) continue;
      const segments = summarizeEffectSegments(card);
      if (segments.length === 1 && segments[0]!.text === 'PASSIVE') offenders.push(card.id);
    }
    expect(offenders).toEqual([]);
  });
});
