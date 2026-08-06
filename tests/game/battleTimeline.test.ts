import { describe, expect, it } from 'vitest';
import { buildBattleTimeline, type BattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import { battleRequestOf } from '../../src/game/battleApi';
import { resolveBattle, type BattleLog } from '../../src/run/resolveBattle';
import type { CombatEvent } from '../../src/engine/combat/events';

const BASE: BattleTimelineInput = {
  pieces: [
    { instanceId: 'c1', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
    { instanceId: 'c2', skillId: 'second_wind', tier: 'bronze', slot: 1 },
  ],
  heroLevel: 3,
  heroAllocation: {},
  enemyId: 'bandit_duelist',
  enemyLevel: 1,
  enemyTitle: 'elite',
  enemyRank: 2,
  seed: 7,
};

/** Stands in for the battle service: resolve the log, then fold it. */
function timeline(input: BattleTimelineInput): BattleTimeline {
  return buildBattleTimeline(input, resolveBattle(battleRequestOf(input)));
}

describe('game/battleTimeline', () => {
  it('opens with a START baseline step at full HP', () => {
    const model = timeline(BASE);
    const first = model.steps[0]!;
    const line = model.linesByTurn.get(first.turn)![first.lineIndex]!;
    expect(line.tag).toBe('START');
    const hp = model.hpByStep[0]!;
    expect(hp.player).toBe(hp.playerMax);
    expect(hp.enemy).toBe(hp.enemyMax);
  });

  it('is deterministic — same input, same timeline', () => {
    const a = timeline(BASE);
    const b = timeline(BASE);
    expect(b.steps).toEqual(a.steps);
    expect(b.hpByStep).toEqual(a.hpByStep);
    expect(b.outcome).toBe(a.outcome);
  });

  it('resolves a 2-foe team with per-unit HP arrays and foe models', () => {
    const model = timeline({
      ...BASE,
      enemyTeam: [
        { enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2, modifiers: [] },
        { enemyId: 'giant_rat', level: 1, title: 'normal', rank: 0, modifiers: [] },
      ],
    });
    expect(model.foes).toHaveLength(2);
    expect(model.foes[1]!.name).toBe('Giant Rat');
    for (const snap of model.hpByStep) {
      expect(snap.enemies).toHaveLength(2);
      expect(snap.enemy).toBe(snap.enemies![0]);
    }
    expect(['VICTORY', 'DEFEAT']).toContain(model.outcome); // no draw exists
    // unit-0 compatibility views stay pointed at the first foe
    expect(model.foeName).toBe(model.foes[0]!.name);
  });

  it('exposes a per-step focus foe aligned with the playback steps', () => {
    const model = timeline({
      ...BASE,
      enemyTeam: [
        { enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2, modifiers: [] },
        { enemyId: 'giant_rat', level: 1, title: 'normal', rank: 0, modifiers: [] },
        { enemyId: 'giant_rat', level: 1, title: 'normal', rank: 0, modifiers: [] },
      ],
    });
    expect(model.focusFoeByStep).toHaveLength(model.steps.length);
    // Every defined focus points at a real enemy unit.
    for (const f of model.focusFoeByStep) {
      if (f !== undefined) {
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(model.foes.length);
      }
    }
    // A real fight involves the enemy side — at least one step must focus a foe.
    expect(model.focusFoeByStep.some((f) => f !== undefined)).toBe(true);
    // The START baseline step has no specific foe.
    expect(model.focusFoeByStep[0]).toBeUndefined();
  });

  it('a size-3 card logs its full span: cast 1/3 then WAIT lines 2/3 and 3/3', () => {
    const model = timeline({
      ...BASE,
      pieces: [{ instanceId: 'c1', skillId: 'crushing_blow', tier: 'bronze', slot: 0 }],
    });
    const lines = [...model.linesByTurn.values()].flat();
    expect(lines.some((l) => l.tag === 'PLAY' && l.text.includes('Crushing Blow · 1/3'))).toBe(true);
    // The busy turns must be visible — a span turn with no line vanishes from playback.
    expect(lines.some((l) => l.tag === 'WAIT' && l.text.includes('Crushing Blow · 2/3'))).toBe(true);
    expect(lines.some((l) => l.tag === 'WAIT' && l.text.includes('Crushing Blow · 3/3'))).toBe(true);
    // WAIT lines are playback steps, so the scrubber pauses on span turns.
    const waitStep = model.steps.find((s) =>
      model.linesByTurn.get(s.turn)![s.lineIndex]!.tag === 'WAIT');
    expect(waitStep).toBeDefined();
  });

  it('single-enemy input still resolves identically through the team path', () => {
    const single = timeline(BASE);
    const teamOfOne = timeline({
      ...BASE,
      enemyTeam: [{ enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2, modifiers: [] }],
    });
    expect(teamOfOne.steps).toEqual(single.steps);
    expect(teamOfOne.hpByStep).toEqual(single.hpByStep);
    expect(teamOfOne.outcome).toBe(single.outcome);
  });

  describe('step-scoped combat summary (summaryByStep)', () => {
    it('is aligned 1:1 with steps, and the LAST entry deep-equals the final combatSummary', () => {
      const model = timeline(BASE);
      expect(model.summaryByStep).toHaveLength(model.steps.length);
      expect(model.summaryByStep[model.summaryByStep.length - 1]).toEqual(model.combatSummary);
    });

    it('never regresses — every cumulative total is monotonically non-decreasing step to step', () => {
      const model = timeline(BASE);
      for (let i = 1; i < model.summaryByStep.length; i++) {
        const prev = model.summaryByStep[i - 1]!;
        const cur = model.summaryByStep[i]!;
        expect(cur.playerDamage).toBeGreaterThanOrEqual(prev.playerDamage);
        expect(cur.enemyDamage).toBeGreaterThanOrEqual(prev.enemyDamage);
        expect(cur.playerHealing).toBeGreaterThanOrEqual(prev.playerHealing);
        for (const prevRow of prev.cards) {
          const curRow = cur.cards.find((r) => r.side === prevRow.side && r.name === prevRow.name);
          expect(curRow).toBeDefined();
          expect(curRow!.damage).toBeGreaterThanOrEqual(prevRow.damage);
          expect(curRow!.shield).toBeGreaterThanOrEqual(prevRow.shield);
          expect(curRow!.healing).toBeGreaterThanOrEqual(prevRow.healing);
          expect(curRow!.dots).toBeGreaterThanOrEqual(prevRow.dots);
        }
      }
    });

    it('a mid-fight step reads strictly less than the final totals for a real (damage-dealing) fight', () => {
      const model = timeline(BASE);
      // This fight deals damage on both sides — find the first step where SOME
      // damage has landed, and confirm it's not already the final tally.
      const firstDamageStep = model.summaryByStep.findIndex((s) => s.playerDamage > 0 || s.enemyDamage > 0);
      expect(firstDamageStep).toBeGreaterThanOrEqual(0);
      const final = model.combatSummary;
      const mid = model.summaryByStep[firstDamageStep]!;
      const midTotal = mid.playerDamage + mid.enemyDamage + mid.playerHealing;
      const finalTotal = final.playerDamage + final.enemyDamage + final.playerHealing;
      expect(midTotal).toBeLessThan(finalTotal);
    });

    it('a card row only appears once that card has actually contributed (damage/shield/healing/dots)', () => {
      const model = timeline(BASE);
      for (const snap of model.summaryByStep) {
        for (const row of snap.cards) {
          expect(row.damage > 0 || row.shield > 0 || row.healing > 0 || row.dots > 0).toBe(true);
        }
      }
    });

    it('step 0 (the START baseline) has an empty, zeroed summary — nothing has happened yet', () => {
      const model = timeline(BASE);
      const first = model.summaryByStep[0]!;
      expect(first.playerDamage).toBe(0);
      expect(first.enemyDamage).toBe(0);
      expect(first.playerHealing).toBe(0);
      expect(first.cards).toHaveLength(0);
    });
  });

  // ---- Synthetic-log tests below: `buildBattleTimeline` folds ANY `BattleLog`
  // (events are the only combat-service contract), so these hand-author a log
  // to pin exact presentation grammar without depending on which real cards/
  // seeds happen to produce a shielded hit or a stat-scaled shield gain.
  describe('blocked-damage and shield presentation', () => {
    const events: CombatEvent[] = [
      // Partly blocked physical hit: 12 HP damage got through, 24 was BLOCKED
      // by a physical shield pool — must read the pool it came from, never a
      // bare "12" with the block silently dropped.
      {
        turn: 1, kind: 'damage', side: 'enemy', unit: 0, amount: 36, property: 'physical',
        blocked: 24, hpAfter: 76, source: 'skill',
      },
      // Fully blocked TRUE hit: 0 HP damage must never read as an unexplained
      // "0" — the BLOCKED amount and the TRUE pool must both show.
      {
        turn: 1, kind: 'damage', side: 'player', unit: 0, amount: 24, property: 'true',
        blocked: 24, hpAfter: 100, source: 'skill',
      },
      // Typed (magical) shield gain WITH a stat breakdown: card base 96 +
      // 12 MAG (Magic Power) scaling — must show the breakdown AND which
      // pool token ('M.SHIELD').
      {
        turn: 1, kind: 'shieldGain', side: 'player', unit: 0, property: 'magical',
        amount: 108, wasted: 0, totalAfter: 108, calculation: { power: 96, statBonus: 12 },
      },
      // TRUE shield gain (Prism Barrier-style): flat by design, statBonus 0 —
      // stays a PLAIN number, no breakdown, but still tagged 'T.SHIELD' so it
      // reads distinctly from a typed shield.
      {
        turn: 1, kind: 'shieldGain', side: 'enemy', unit: 0, property: 'true',
        amount: 92, wasted: 0, totalAfter: 92, calculation: { power: 92, statBonus: 0 },
      },
      // Legacy shape: no `calculation` at all (fallback path — the parallel
      // engine task that adds it may not have landed for every emitter yet).
      {
        turn: 1, kind: 'shieldGain', side: 'player', unit: 0, property: 'physical',
        amount: 48, wasted: 0, totalAfter: 48,
      },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 2 };
    const model = timeline({ ...BASE, seed: 1 } as BattleTimelineInput);
    void model; // keep the real-engine model import path exercised elsewhere
    const synthetic = buildBattleTimeline(BASE, log);
    const lines = [...synthetic.linesByTurn.values()].flat();

    it('shows HP damage AND the blocked amount + pool token for a partly-blocked hit', () => {
      const line = lines.find((l) => l.tag === 'HIT' && l.text.includes('12 DMG'));
      expect(line).toBeDefined();
      expect(line!.text).toContain('12 DMG · 24 BLOCKED (P.SHIELD)');
    });

    it('never renders a fully-blocked hit as a bare "0 damage" line', () => {
      const line = lines.find((l) => l.tag === 'HIT' && l.text.includes('BLOCKED 24 (T.SHIELD)'));
      expect(line).toBeDefined();
      expect(line!.text).not.toMatch(/−0(?!\d)/);
    });

    it('shows the card-power + stat-bonus breakdown for a typed shield gain, tagged with its pool', () => {
      const line = lines.find((l) => l.tag === 'BUFF' && l.text.includes('M.SHIELD'));
      expect(line).toBeDefined();
      // The stat named must be the DEFENSIVE one the engine actually added
      // (`scaleDefStat`: magical -> Magic Resist), not MATK. Shields stopped
      // scaling off Magic Power on 2026-08-04; this label had not followed.
      expect(line!.text).toContain('+108 M.SHIELD (96 + 12 MDEF)');
      expect(line!.text).not.toContain('MATK');
    });

    it('carries the shield derivation as an expandable S: strip, same grammar as a HIT D: strip', () => {
      const line = lines.find((l) => l.tag === 'BUFF' && l.text.includes('M.SHIELD'));
      expect(line!.detail).toBe('S: base 96 + (12 MDEF) = 108');
    });

    it('renders a TRUE shield gain as a plain number tagged T.SHIELD, no breakdown', () => {
      const line = lines.find((l) => l.tag === 'BUFF' && l.text.includes('T.SHIELD'));
      expect(line).toBeDefined();
      expect(line!.text).toContain('+92 T.SHIELD');
      expect(line!.text).not.toContain('(');
    });

    it('falls back to a plain shield number when `calculation` is absent (pre-migration events)', () => {
      const line = lines.find((l) => l.tag === 'BUFF' && l.text.includes('P.SHIELD'));
      expect(line).toBeDefined();
      expect(line!.text).toContain('+48 P.SHIELD');
      expect(line!.text).not.toContain('(');
    });
  });

  // A healed number used to appear from nowhere: the line printed the post-tax
  // total and the tax, but never the request they came from, so a player could
  // not check the arithmetic (the HIT line has done this properly for ages).
  describe('heal derivation (expandable H: strip)', () => {
    const events: CombatEvent[] = [
      // Mending Light (base 48) cast by a 1-MDEF hero on a target carrying one
      // affliction category: request 49, anti-heal floors the REDUCTION
      // (floor(49*20/100) = 9), so 40 HP lands.
      {
        turn: 1, kind: 'heal', side: 'player', unit: 0, amount: 40, overheal: 0, flat: false,
        hpAfter: 46, antiHeal: { categories: ['dot'], pct: 20, reduced: 9 },
        calculation: { power: 48, statBonus: 1, healFlat: 0, property: 'magical' },
      },
      // Physical heal boosted by a flat aura/gem heal bonus: 20 + 6 DEF + 4.
      {
        turn: 1, kind: 'heal', side: 'player', unit: 0, amount: 30, overheal: 0, flat: false,
        hpAfter: 76, calculation: { power: 20, statBonus: 6, healFlat: 4, property: 'physical' },
      },
      // TRUE (flat) heal that mostly overheals — the wasted part was invisible.
      {
        turn: 1, kind: 'heal', side: 'enemy', unit: 0, amount: 10, overheal: 15, flat: true, hpAfter: 100,
        calculation: { power: 25, statBonus: 0, healFlat: 0, property: 'true' },
      },
      // LIFESTEAL: a percentage of damage dealt, so the engine sends no
      // `calculation` — there is no card base or stat term to split.
      {
        turn: 1, kind: 'heal', side: 'player', unit: 0, amount: 33, overheal: 0, flat: false,
        hpAfter: 91, antiHeal: { categories: ['dot'], pct: 20, reduced: 8 },
      },
      // Nothing taxed, nothing wasted, no stat/aura term: the printed number IS
      // the request, with and without a calculation block.
      {
        turn: 1, kind: 'heal', side: 'player', unit: 0, amount: 12, overheal: 0, flat: false, hpAfter: 58,
        calculation: { power: 12, statBonus: 0, healFlat: 0, property: 'magical' },
      },
      { turn: 1, kind: 'heal', side: 'player', unit: 0, amount: 7, overheal: 0, flat: false, hpAfter: 65 },
      // Shield gain that overflows the maxHp shield cap.
      {
        turn: 1, kind: 'shieldGain', side: 'player', unit: 0, property: 'physical',
        amount: 20, wasted: 8, totalAfter: 100, calculation: { power: 24, statBonus: 4 },
      },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const lines = [...buildBattleTimeline(BASE, { events, result: 'win', turns: 2 }).linesByTurn.values()].flat();

    it('spells out base + stat − anti-heal = landed, so the printed total is reconstructable', () => {
      // The request (49) used to appear from nowhere; now the card's flat base
      // and the caster's defensive stat are both named, straight off the
      // engine's `calculation` block — never re-derived in the renderer.
      const line = lines.find((l) => l.text.includes('+40 HP'));
      expect(line).toBeDefined();
      expect(line!.text).toContain('(anti-heal −20%: −9)');
      expect(line!.detail).toBe('H: base 48 + (1 MDEF) − (9 ANTI-HEAL) = 40');
    });

    it('names the PHYSICAL defensive stat DEF and a flat aura/gem bonus SKILL', () => {
      const line = lines.find((l) => l.text.includes('+30 HP'));
      expect(line!.detail).toBe('H: base 20 + (6 DEF) + (4 SKILL) = 30');
      expect(line!.detail).not.toContain('ATK');
    });

    it('surfaces OVERHEAL, and still opens a TRUE heal with `flat` (no stat term by identity)', () => {
      const line = lines.find((l) => l.text.includes('+10 HP'));
      expect(line!.detail).toBe('H: flat 25 − (15 OVERHEAL) = 10');
      expect(line!.detail).not.toContain('MDEF');
    });

    it('opens a LIFESTEAL heal with the whole request — it has no card base to split', () => {
      // The engine deliberately omits `calculation` there (percentage of damage
      // dealt); the strip must not invent a `base 0` term.
      const line = lines.find((l) => l.text.includes('+33 HP'));
      expect(line!.detail).toBe('H: heal 41 − (8 ANTI-HEAL) = 33');
      expect(line!.detail).not.toContain('base');
    });

    it('omits the strip when the calculation has nothing to break down', () => {
      const line = lines.find((l) => l.text.includes('+12 HP'));
      expect(line!.detail).toBeUndefined();
    });

    it('omits the strip for a calculation-less heal with nothing to derive', () => {
      const line = lines.find((l) => l.text.includes('+7 HP'));
      expect(line!.detail).toBeUndefined();
    });

    it('shows the shield cap as a CAPPED term rather than silently shrinking the number', () => {
      const line = lines.find((l) => l.text.includes('P.SHIELD'));
      expect(line!.detail).toBe('S: base 24 + (4 DEF) − (8 CAPPED) = 20');
    });
  });

  describe('status explanations (expandable detail, no hover)', () => {
    const events: CombatEvent[] = [
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'guard', property: 'physical', pct: 20, turns: 2 },
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'negate', property: 'magical', charges: 1, turns: 0 },
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'expose', pct: 30, turns: 2 },
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'buff', stat: 'attack', pct: 50, turns: 2 },
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'debuff', stat: 'armor', amount: 15, turns: 2 },
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'poison', stacks: 9, turns: 9 },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ];
    const log: BattleLog = { events, result: 'win', turns: 2 };
    const model = buildBattleTimeline(BASE, log);
    const lines = [...model.linesByTurn.values()].flat();

    it('names a guard by the PROPERTY it covers (P./M./T.GUARD, mirroring the shield pools)', () => {
      // A guard only reduces damage of its OWN property, and that property is
      // not inferable from the card (a gem can graft a TRUE guard onto any
      // card) — a bare "Guard" left the player guessing.
      const line = lines.find((l) => l.text.includes('GUARD'));
      expect(line?.text).toContain('P.GUARD');
      expect(line?.detail).toBe('-20% incoming physical damage, 2 turns.');
    });

    it('names a negate by the PROPERTY it covers (P./M./T.NEGATE, mirroring guard)', () => {
      // Same gap as guard had: a negate only blocks hits of its OWN property,
      // not inferable from the card, so a bare "Negate" told the player
      // nothing about what it stops.
      const line = lines.find((l) => l.text.includes('NEGATE'));
      expect(line?.text).toContain('M.NEGATE');
      expect(line?.detail).toBe('Fully blocks the next 1 magical hit.');
    });

    it('explains an expose status as +pct% damage taken', () => {
      const line = lines.find((l) => l.text.includes('Expose'));
      expect(line?.detail).toBe('+30% damage taken from direct hits, 2 turns.');
    });

    it('explains a buff status with the affected stat abbreviation', () => {
      const line = lines.find((l) => l.text.includes('Buff'));
      expect(line?.detail).toBe('+50% ATK, 2 turns.');
    });

    it('explains a debuff status carrying a flat (TRUE) amount rather than a pct', () => {
      const line = lines.find((l) => l.text.includes('Debuff'));
      expect(line?.detail).toBe('-15 DEF, 2 turns.');
    });

    it('leaves DoT statuses (poison/burn/bleed/stun) without a detail — they already show stacks inline', () => {
      const line = lines.find((l) => l.text.includes('Poison'));
      expect(line).toBeDefined();
      expect(line!.detail).toBeUndefined();
    });
  });
});
