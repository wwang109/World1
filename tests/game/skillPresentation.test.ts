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

// The COLOUR itself is a CardToken.ts rendering concern (`effectFaceSegments`,
// `UI.textCalculated`) — this suite only pins the DATA CONTRACT it reads:
// `EffectSegment.calculated`, set by `scaledLabel`/`effectLine`
// (skillPresentation.ts) exactly when a printed number folds in the caster's
// LIVE stat right now, never when a number merely differs from SOME other
// value (tier/gem folding happen upstream and leave nothing here to diff
// against — see `EffectSegment.calculated`'s own doc comment).
describe('summarizeEffectSegments — the "calculated" flag (2026-09-06)', () => {
  it('is true on a summed DMG number when the live stat actually contributed', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    const [dmg] = summarizeEffectSegments(skill, { attack: 17, magicPower: 0, armor: 0, magicResist: 0 });
    expect(dmg).toMatchObject({ text: 'DMG 37', calculated: true });
  });

  it('is false with no stats supplied at all', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    const [dmg] = summarizeEffectSegments(skill);
    expect(dmg).toMatchObject({ text: 'DMG 20', calculated: false });
  });

  it('is false when the stat contribution is exactly zero — a zero-Attack caster prints the SAME number a no-stats caller does', () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    const [dmg] = summarizeEffectSegments(skill, { attack: 0, magicPower: 0, armor: 0, magicResist: 0 });
    expect(dmg).toMatchObject({ text: 'DMG 20', calculated: false });
  });

  it('is always false on TRUE heal/shield — defensive TRUE output never adds a stat, so there is never anything to mark', () => {
    const heal = makeSkill({ property: 'true', effects: [{ kind: 'heal', power: 20 }] });
    const [line] = summarizeEffectSegments(heal, { attack: 99, magicPower: 99, armor: 0, magicResist: 0 });
    expect(line).toMatchObject({ text: 'HEAL 20 (T)', calculated: false });
  });

  it('is true on a TRUE DMG number, since TRUE offense sums off the higher of Attack/Magic Power', () => {
    const skill = makeSkill({ property: 'true', effects: [{ kind: 'damage', power: 10 }] });
    const [dmg] = summarizeEffectSegments(skill, { attack: 20, magicPower: 8, armor: 0, magicResist: 0 });
    expect(dmg).toMatchObject({ text: 'DMG 30 (T)', calculated: true });
  });

  it("is never set on 'composition' mode — the base and the scaling stat print as two separate pieces instead, so there is no folded number to flag", () => {
    const skill = makeSkill({ property: 'physical', weapon: 'sword', effects: [{ kind: 'damage', power: 20 }] });
    const [dmg] = summarizeEffectSegments(skill, { attack: 17, magicPower: 0, armor: 0, magicResist: 0 }, 'composition');
    expect(dmg).toMatchObject({ text: 'DMG 20 +ATK', calculated: false });
  });

  it('carries BOTH `keyword` and `calculated` on a scaling SHLD line — CardToken.ts, not this module, decides which one wins the colour', () => {
    const shield = makeSkill({ property: 'physical', weapon: 'axe', effects: [{ kind: 'shield', power: 16 }] });
    const [shld] = summarizeEffectSegments(shield, { attack: 0, magicPower: 0, armor: 5, magicResist: 0 });
    expect(shld).toMatchObject({ text: 'SHLD 21', keyword: 'shield', calculated: true });
  });

  it('never appears on a non-scaling extra (poison stacks are an authored/tier-resolved field, not a folded stat sum)', () => {
    const skill = makeSkill({
      property: 'physical', weapon: 'axe',
      effects: [{ kind: 'damage', power: 12 }, { kind: 'poison', stacks: 5 }],
    });
    const segments = summarizeEffectSegments(skill, { attack: 6, magicPower: 0, armor: 0, magicResist: 0 });
    const poison = segments.find((s) => s.text === 'PSN 5');
    expect(poison).toMatchObject({ text: 'PSN 5' });
    expect(poison?.calculated).toBeFalsy();
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
    expect(summarizeEffects(skill)).toBe('P.GUARD 20% 2t');
  });

  it('names a magical guard M.GUARD', () => {
    const skill = makeSkill({ effects: [{ kind: 'guard', property: 'magical', pct: 15, turns: 1 }] });
    expect(summarizeEffects(skill)).toBe('M.GUARD 15% 1t');
  });

  it('names a TRUE guard T.GUARD', () => {
    const skill = makeSkill({ effects: [{ kind: 'guard', property: 'true', pct: 10, turns: 1 }] });
    expect(summarizeEffects(skill)).toBe('T.GUARD 10% 1t');
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
// you to change other only the ones i requested"). CLEANSE keeps its
// long-standing form; SLOW was separately re-ruled on 2026-09-13 as `SLOW N`.
// comboBonus was RE-RULED later the same day: it may say
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

  it('SLOW uses the compact amount with no redundant sign or unit', () => {
    const skill = makeSkill({ effects: [{ kind: 'slow', weight: 6 }] });
    expect(summarizeEffects(skill)).toBe('SLOW 6');
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
  it('prints the plating and the type it is tuned to, as its own label', () => {
    // LABEL RENAMED 2026-09-12 (user-locked): `SHIELD: LANCE` IS the label
    // now — the 2-for-1 rate moved to the glossary (`Attuned Shield` entry,
    // unchanged) rather than being spelled out on the face as `(2x vs LANCE)`.
    const skill = makeSkill({ weapon: 'lance', effects: [{ kind: 'attunedShield', power: 24 }] });
    expect(summarizeEffects(skill)).toBe('SHIELD: LANCE 24');
  });

  it('takes the defensive stat, exactly like the plain shield line beside it', () => {
    // The interpreter adds `scaleDefStat` to an attuned pool the same way it
    // does to a plain `shield` (see its `attunedShield` case), so the face's
    // summed number must add Armor for a physical card and Magic Resist for a
    // magical one — never Attack.
    const physical = makeSkill({ weapon: 'lance', effects: [{ kind: 'attunedShield', power: 24 }] });
    expect(summarizeEffects(physical, { attack: 99, magicPower: 0, armor: 6, magicResist: 0 }))
      .toBe('SHIELD: LANCE 30');
    const magical = makeSkill({ property: 'magical', element: 'fire', effects: [{ kind: 'attunedShield', power: 24 }] });
    expect(summarizeEffects(magical, { attack: 0, magicPower: 99, armor: 0, magicResist: 4 }))
      .toBe('SHIELD: FIRE 28');
  });

  it("composition mode names the stat, the same as the plain shield line", () => {
    const skill = makeSkill({ weapon: 'lance', effects: [{ kind: 'attunedShield', power: 24 }] });
    expect(summarizeEffects(skill, undefined, 'composition')).toBe('SHIELD: LANCE 24 +DEF');
  });

  it('does NOT fold into the plain shield total — they are different currencies', () => {
    // `oathplate`'s shape. Summing 14 + 8 would print a 22-point wall the card
    // never builds: the attuned points spend at a different rate and are held
    // in a separate pool (`combatant.attunedShields`).
    const skill = makeSkill({
      weapon: 'sword',
      effects: [{ kind: 'shield', power: 14 }, { kind: 'attunedShield', power: 8 }],
    });
    expect(summarizeEffects(skill)).toBe('SHLD 14 · SHIELD: SWORD 8');
  });

  it('an AFFINITY-gated attuned shield fills its gate label instead of dangling', () => {
    const skill = makeSkill({
      weapon: 'sword',
      effects: [{ kind: 'shield', power: 14 }, { kind: 'attunedShield', power: 8, affinity: true }],
    });
    // The label and payload remain separate rich segments so only the payload
    // can dim, but they form one grammatical badge with a plain-space joiner.
    // The type is named twice here (gate label + the payload's own new
    // "SHIELD: SWORD" label) — a pre-existing quirk of the gate wrap, not
    // introduced by the rename: the old string named it twice too
    // ("SWORD: ATTUNED SHLD 8 (2x vs SWORD)").
    expect(summarizeEffects(skill)).toBe('SHLD 14 · SWORD: SHIELD: SWORD 8');
  });

  it('every shipped card carrying the keyword actually prints it', () => {
    const cards = Object.values(skillBook).filter((c) => c.effects.some((a) => a.kind === 'attunedShield'));
    expect(cards.length, 'the keyword has shipped content — this test is not vacuous').toBeGreaterThan(0);
    for (const card of cards) {
      expect(summarizeEffects(card), card.id).toContain('SHIELD:');
    }
  });
});

/**
 * AFFINITY-GATE DISPLAY STATE (2026-09-06). The user's report: watching a live
 * battle where `Cinder Sprite` (2 Fire cards, `elementAffinity: "fire"`
 * authored) cast `kindling_rite`, the face read `DMG 12 +MATK · FIRE: NEXT
 * FIRE +16` with no visual difference from an ON board — "the FIRE: part as
 * normal color but the next fire +16 should show as greyed out". This is the
 * DISPLAY half of that fix: `summarizeEffectSegments`'s new `affinityOpen`
 * parameter, and the `EffectSegment.gateClosed` flag it produces. Whether the
 * gate is ACTUALLY open is a battle fact this pure formatter cannot know on
 * its own — the caller (`battleTimeline.ts`'s `cardAffinityOpen`, reading the
 * combatant's real resolved `elementAffinity`/`weaponAffinity`, exactly as the
 * engine's own `affinityOpen` does — NOT a naive "3+ on-type cards" recount,
 * which would be WRONG for `cinder_sprite` itself: authored affinity wins
 * regardless of board count) passes the answer in as a plain boolean.
 */
describe('summarizeEffectSegments — affinity gate display state (2026-09-06)', () => {
  const gatedEmpower = () => makeSkill({
    element: 'fire',
    effects: [{ kind: 'damage', power: 12 }, { kind: 'empowerNext', amount: 16, affinity: true }],
  });

  it('gate CLOSED (affinityOpen: false) — the label stays normal, only the payload is flagged dimmed', () => {
    const segments = summarizeEffectSegments(gatedEmpower(), undefined, 'summed', false);
    const label = segments.find((s) => s.text === 'FIRE:');
    const payload = segments.find((s) => s.text === 'NEXT FIRE +16');
    expect(label).toBeDefined();
    expect(payload).toBeDefined();
    // The label never carries the dim flag — only its payoff does.
    expect(label!.gateClosed).toBeFalsy();
    expect(payload!.gateClosed).toBe(true);
    // Both segments keep the 'affinity' keyword — a renderer needs it to know
    // this is the same badge family even while dimming only one half of it.
    expect(label!.keyword).toBe('affinity');
    expect(payload!.keyword).toBe('affinity');
    expect(label!.joinWithPrevious).toBeFalsy();
    expect(payload!.joinWithPrevious).toBe(true);
  });

  it('gate OPEN (affinityOpen: true) — normal, not dimmed', () => {
    const segments = summarizeEffectSegments(gatedEmpower(), undefined, 'summed', true);
    const payload = segments.find((s) => s.text === 'NEXT FIRE +16');
    expect(payload!.gateClosed).toBeFalsy();
  });

  it('NO BOARD CONTEXT (affinityOpen omitted — deck build / shop / wiki) — normal, unknown is not closed', () => {
    // The exact case the brief calls out: a shop/deck-build/wiki render has no
    // caster to check a gate against, so it must NOT read as "closed" — only
    // an explicit `false` may dim the payload.
    const withNoArg = summarizeEffectSegments(gatedEmpower());
    const withUndefinedArg = summarizeEffectSegments(gatedEmpower(), undefined, 'summed', undefined);
    for (const segments of [withNoArg, withUndefinedArg]) {
      const payload = segments.find((s) => s.text === 'NEXT FIRE +16');
      expect(payload!.gateClosed).toBeFalsy();
    }
  });

  it('an UNGATED card is completely unaffected by the affinityOpen argument', () => {
    const plain = makeSkill({ effects: [{ kind: 'damage', power: 20 }] });
    const closed = summarizeEffectSegments(plain, undefined, 'summed', false);
    const open = summarizeEffectSegments(plain, undefined, 'summed', true);
    const none = summarizeEffectSegments(plain);
    expect(closed).toEqual(open);
    expect(closed).toEqual(none);
    expect(closed.some((s) => s.gateClosed)).toBe(false);
  });

  it('a card carrying MULTIPLE gated actions of its own type dims every payload the same way', () => {
    const skill = makeSkill({
      weapon: 'sword',
      effects: [
        { kind: 'shield', power: 14 },
        { kind: 'attunedShield', power: 8, affinity: true },
      ],
    });
    const segments = summarizeEffectSegments(skill, undefined, 'summed', false);
    const payload = segments.find((s) => s.text.startsWith('SHIELD:'));
    expect(payload!.gateClosed).toBe(true);
    expect(segments.find((s) => s.text === 'SWORD:')!.gateClosed).toBeFalsy();
  });

  /**
   * THE FLAT STRING, PINNED (2026-09-06 follow-up). The two-segment split
   * above is what lets the payload dim independently, but `summarizeEffects`'s
   * flat join must still read as ONE grammatical clause: `TYPE:` glued to its
   * payload by a single SPACE (`EffectSegment.joinWithPrevious` /
   * `effectSegmentJoiner`), not the ` · ` that separates every OTHER pair of
   * independent clauses on the face. Regression this guards: joining the pair
   * with the default separator printed `FIRE: · NEXT FIRE +16` — `FIRE:` then
   * read as a dangling clause of its own rather than the qualifier on the
   * clause after it. Pinned on two real shipped cards (not a synthetic
   * fixture) across all three gate states, because the flat STRING is
   * identical in all three — only the segment-level `gateClosed`/color
   * differs, never the text — so one assertion covers open/closed/unknown at
   * once.
   */
  it('the flat string joins TYPE: to its payload with a SPACE, in every gate state', () => {
    const kindlingRite = skillBook['kindling_rite']!;
    const brambleCovenant = skillBook['bramble_covenant']!;
    for (const affinityOpen of [false, true, undefined] as const) {
      expect(summarizeEffects(kindlingRite, undefined, 'summed', affinityOpen), `kindling_rite affinityOpen=${affinityOpen}`)
        .toBe('DMG 12 · FIRE: NEXT FIRE +16');
      expect(summarizeEffects(brambleCovenant, undefined, 'summed', affinityOpen), `bramble_covenant affinityOpen=${affinityOpen}`)
        .toBe('SHLD 12 · NATURE: PSN 8');
    }
  });
});

/**
 * DURATION ON THE FACE (2026-09-06). `expose`, `guard`, `buffStat` and
 * `debuffStat` all carry a `turns` field (engine/types.ts) exactly like
 * `curse` — which already prints it as the `Nt` suffix — but printed NO
 * duration at all: `EXPOSE 20%` looked identical whether `turns` was 2 or 4.
 * Every authored card happens to use the same `turns: 2`, so nothing looked
 * wrong, but a future longer-duration variant would have been indistinguishable
 * on the face. Each pair below proves the SAME pct/amount renders a DIFFERENT
 * face string when only `turns` changes — a test pinned to just the shipped
 * value would pass even if the duration were silently dropped.
 *
 * `stun` also carries a `turns` field and is DELIBERATELY EXCLUDED — see the
 * two user rulings quoted above `summarizeEffects — stun is a bare token, not
 * a turn count` (2026-08-19, 2026-08-20): a stun denies the victim's next
 * ACTION whenever it happens, not a real-time turn count, and content is
 * capped at `turns: 1` (`MAX_STUN_PER_CARD`) so the number could never vary
 * anyway. Reintroducing a number there would resurrect the exact "STUN 1 read
 * like a 1-turn duration" defect those rulings fixed.
 */
describe('summarizeEffects — duration-bearing keywords print their window', () => {
  it('EXPOSE prints its turns window, and a longer one reads differently', () => {
    const twoTurn = makeSkill({ effects: [{ kind: 'expose', pct: 20, turns: 2 }] });
    expect(summarizeEffects(twoTurn)).toBe('EXPOSE 20% 2t');
    const fourTurn = makeSkill({ effects: [{ kind: 'expose', pct: 20, turns: 4 }] });
    expect(summarizeEffects(fourTurn)).toBe('EXPOSE 20% 4t');
    expect(summarizeEffects(fourTurn)).not.toBe(summarizeEffects(twoTurn));
  });

  it('GUARD prints its turns window, and a longer one reads differently', () => {
    const oneTurn = makeSkill({ effects: [{ kind: 'guard', property: 'physical', pct: 20, turns: 1 }] });
    expect(summarizeEffects(oneTurn)).toBe('P.GUARD 20% 1t');
    const threeTurn = makeSkill({ effects: [{ kind: 'guard', property: 'physical', pct: 20, turns: 3 }] });
    expect(summarizeEffects(threeTurn)).toBe('P.GUARD 20% 3t');
    expect(summarizeEffects(threeTurn)).not.toBe(summarizeEffects(oneTurn));
  });

  it('buffStat prints its turns window, and a longer one reads differently', () => {
    const twoTurn = makeSkill({ effects: [{ kind: 'buffStat', stat: 'attack', pct: 20, turns: 2 }] });
    expect(summarizeEffects(twoTurn)).toBe('+20% ATK 2t');
    const fourTurn = makeSkill({ effects: [{ kind: 'buffStat', stat: 'attack', pct: 20, turns: 4 }] });
    expect(summarizeEffects(fourTurn)).toBe('+20% ATK 4t');
    expect(summarizeEffects(fourTurn)).not.toBe(summarizeEffects(twoTurn));
  });

  it('debuffStat prints its turns window, and a longer one reads differently', () => {
    const twoTurn = makeSkill({ effects: [{ kind: 'debuffStat', stat: 'attack', pct: 20, turns: 2 }] });
    expect(summarizeEffects(twoTurn)).toBe('-20% ATK 2t');
    const fourTurn = makeSkill({ effects: [{ kind: 'debuffStat', stat: 'attack', pct: 20, turns: 4 }] });
    expect(summarizeEffects(fourTurn)).toBe('-20% ATK 4t');
    expect(summarizeEffects(fourTurn)).not.toBe(summarizeEffects(twoTurn));
  });

  it('matches the CURSE precedent exactly — same Nt suffix shape, no second dialect', () => {
    const curse = makeSkill({ effects: [{ kind: 'curse', amount: 4, turns: 2 }] });
    const expose = makeSkill({ effects: [{ kind: 'expose', pct: 20, turns: 2 }] });
    expect(summarizeEffects(curse)).toMatch(/ 2t$/);
    expect(summarizeEffects(expose)).toMatch(/ 2t$/);
  });
});

describe('summarizeEffectSegments — no token may be empty or dangle', () => {
  it('NO card in the book prints a blank segment, or a colon-label segment with nothing after it', () => {
    // The general form of `oathplate`'s "SWORD: " — an affinity gate whose
    // payload produced no tokens. Any future keyword that lands without a case
    // in `summarizeEffectSegments` reopens exactly this hole, on every card
    // face in the game at once, so it is checked across the whole book rather
    // than card by card.
    //
    // 2026-09-06: the gate badge is now DELIBERATELY two segments — a `TYPE:`
    // label (so it can render normal-colored) immediately followed by its
    // payload (so it alone can dim when the gate is shut). A label segment
    // ending in ':' is therefore no longer an offense BY ITSELF; the check
    // walks pairs instead and still fails the exact bug this test was written
    // for — a label with nothing (or only blank) after it.
    const offenders: string[] = [];
    for (const card of Object.values(skillBook)) {
      const segments = summarizeEffectSegments(card);
      segments.forEach((segment, i) => {
        const text = segment.text.trim();
        if (text.length === 0) { offenders.push(`${card.id}: blank segment at index ${i}`); return; }
        if (text.endsWith(':')) {
          const next = segments[i + 1];
          if (!next || next.text.trim().length === 0) {
            offenders.push(`${card.id}: ${JSON.stringify(segment.text)} has no payload after it`);
          }
        }
      });
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
