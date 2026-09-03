import { describe, expect, it } from 'vitest';
import { buildBattleTimeline, slotModKey, type BattleTimeline, type BattleTimelineInput, type StatusChip } from '../../src/game/battleTimeline';
import type { CombatEvent } from '../../src/engine/combat/events';

/**
 * STATUS CHIPS + SLOT MODS — the view-model derivation behind the battle
 * scenes' per-combatant chip row (`chipsByTurn`) and the board cards'
 * burden/curse overlay (`slotModsByTurn`).
 *
 * Every case here drives `buildBattleTimeline` with a SCRIPTED event log (the
 * exact idiom `battleTimeline.test.ts`'s `model_lines` uses) — the thin-client
 * rule means the chips must be derivable from events alone, and these logs
 * exercise the full lifecycle the chips must track: application, per-tick
 * decay, cleanse, natural expiry, charge spends, and the turn AFTER each of
 * those (where a stale chip is exactly the bug the feature exists to end).
 */

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

function model(events: CombatEvent[], input: BattleTimelineInput = BASE): BattleTimeline {
  return buildBattleTimeline(input, { events, result: 'win', turns: events[events.length - 1]?.turn ?? 1 });
}

/** The chip row for one side/unit at one turn ([] when the turn has none). */
function chipsAt(m: BattleTimeline, turn: number, side: 'player' | 'enemy', unit = 0): StatusChip[] {
  const snap = m.chipsByTurn.get(turn);
  if (!snap) return [];
  if (side === 'player') return snap.player;
  return snap.enemyUnits?.[unit] ?? snap.enemy;
}

function texts(chips: StatusChip[]): string[] {
  return chips.map((c) => c.text);
}

/** Minimal end-of-turn marker so a later turn HAS a snapshot to assert on. */
function endTurn(turn: number): CombatEvent {
  return { turn, kind: 'end' };
}

describe('chipsByTurn: DoT lifecycle (applied → ticking → cleansed → gone)', () => {
  const events: CombatEvent[] = [
    // T1: hero's cast poisons the foe for 5 stacks.
    { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'poison', stacks: 5, turns: 5 },
    // T2: the pile ticks — deals its 5, sheds one stack (engine tickTurnDot).
    { turn: 2, kind: 'damage', side: 'enemy', unit: 0, amount: 5, property: 'true', blocked: 0, hpAfter: 95, source: 'poison', sourceCard: { side: 'player', unit: 0, slot: 0, skillId: 'sword_slash' } },
    // T3: ticks again (4), then a cleanse strips the remaining 3 stacks.
    { turn: 3, kind: 'damage', side: 'enemy', unit: 0, amount: 4, property: 'true', blocked: 0, hpAfter: 91, source: 'poison', sourceCard: { side: 'player', unit: 0, slot: 0, skillId: 'sword_slash' } },
    { turn: 3, kind: 'cleansed', side: 'enemy', unit: 0, removed: 3 },
    // T4: a later turn with any event at all — the chip must STAY gone.
    endTurn(4),
    { turn: 5, kind: 'combatEnd', result: 'win', turns: 5 },
  ];

  it('shows the applied total, then the post-tick totals, matching engine decay', () => {
    const m = model(events);
    expect(texts(chipsAt(m, 1, 'enemy'))).toEqual(['PSN 5']);
    expect(texts(chipsAt(m, 2, 'enemy'))).toEqual(['PSN 4']);
  });

  it('vanishes on the cleanse turn AND stays gone the turn after', () => {
    const m = model(events);
    expect(texts(chipsAt(m, 3, 'enemy'))).toEqual([]);
    expect(texts(chipsAt(m, 4, 'enemy'))).toEqual([]);
  });

  it('a PARTIAL cleanse reduces the total instead of clearing it', () => {
    const m = model([
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'poison', stacks: 5, turns: 5 },
      { turn: 2, kind: 'cleansed', side: 'enemy', unit: 0, removed: 2 },
      { turn: 3, kind: 'combatEnd', result: 'win', turns: 3 },
    ]);
    expect(texts(chipsAt(m, 2, 'enemy'))).toEqual(['PSN 3']);
  });

  it('burn halves per tick on the chip, exactly like the engine pile', () => {
    const m = model([
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'burn', stacks: 8, turns: 8 },
      { turn: 2, kind: 'damage', side: 'player', unit: 0, amount: 16, property: 'true', blocked: 0, hpAfter: 80, source: 'burn' },
      { turn: 3, kind: 'combatEnd', result: 'win', turns: 3 },
    ]);
    expect(texts(chipsAt(m, 1, 'player'))).toEqual(['BRN 8']);
    expect(texts(chipsAt(m, 2, 'player'))).toEqual(['BRN 4']);
  });
});

describe('chipsByTurn: stat buffs/debuffs', () => {
  it('aggregates per stat with pct and flat parts, and expires on schedule', () => {
    const m = model([
      // T1: +30% ATK for 2 turns and +2 flat ATK for 2 turns → ONE chip, both parts.
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'buff', stat: 'attack', pct: 30, turns: 2 },
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'buff', stat: 'attack', amount: 2, turns: 2 },
      // T2: a −20% SPD debuff lands on the same unit.
      { turn: 2, kind: 'statusApplied', side: 'player', unit: 0, status: 'debuff', stat: 'speed', pct: 20, turns: 3 },
      // T3: both buffs expire naturally (turn 1 + 2 turns).
      { turn: 3, kind: 'statusExpired', side: 'player', unit: 0, status: 'buff' },
      { turn: 3, kind: 'statusExpired', side: 'player', unit: 0, status: 'buff' },
      endTurn(4),
      { turn: 5, kind: 'combatEnd', result: 'win', turns: 5 },
    ]);
    expect(texts(chipsAt(m, 1, 'player'))).toEqual(['ATK +30%+2']);
    // Debuffs order BEFORE buffs (threats first — CHIP_KIND_ORDER).
    expect(texts(chipsAt(m, 2, 'player'))).toEqual(['SPD −20%', 'ATK +30%+2']);
    expect(texts(chipsAt(m, 3, 'player'))).toEqual(['SPD −20%']);
    expect(texts(chipsAt(m, 4, 'player'))).toEqual(['SPD −20%']);
  });

  it('a cleanse with only debuffs standing drops the soonest-expiring pile', () => {
    const m = model([
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'debuff', stat: 'attack', pct: 20, turns: 2 },
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'debuff', stat: 'speed', pct: 10, turns: 5 },
      // One cleanse charge: the ATK debuff (expires turn 3) goes before the
      // SPD one (turn 6) — interpreter.ts drains soonest-expiring first.
      { turn: 2, kind: 'cleansed', side: 'enemy', unit: 0, removed: 1 },
      { turn: 3, kind: 'combatEnd', result: 'win', turns: 3 },
    ]);
    expect(texts(chipsAt(m, 1, 'enemy'))).toEqual(['ATK −20%', 'SPD −10%']);
    expect(texts(chipsAt(m, 2, 'enemy'))).toEqual(['SPD −10%']);
  });
});

describe('chipsByTurn: charge-spent kinds (negate, ward) and the rest', () => {
  it('negate counts down per NEGATED hit, per property, and disappears at zero', () => {
    const m = model([
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'negate', property: 'magical', turns: 0, charges: 2 },
      { turn: 2, kind: 'negated', side: 'player', unit: 0, property: 'magical' },
      { turn: 3, kind: 'negated', side: 'player', unit: 0, property: 'magical' },
      endTurn(4),
      { turn: 5, kind: 'combatEnd', result: 'win', turns: 5 },
    ]);
    expect(texts(chipsAt(m, 1, 'player'))).toEqual(['NGT 2M']);
    expect(texts(chipsAt(m, 2, 'player'))).toEqual(['NGT 1M']);
    // The engine never emits statusExpired for negate — the chip must still
    // vanish on its own bookkeeping (the exact reason the tracker exists).
    expect(texts(chipsAt(m, 3, 'player'))).toEqual([]);
    expect(texts(chipsAt(m, 4, 'player'))).toEqual([]);
  });

  it('ward re-syncs to each spend event\'s own chargesLeft and clears on expiry', () => {
    const m = model([
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'ward', turns: 0, charges: 2 },
      { turn: 2, kind: 'warded', side: 'player', unit: 0, status: 'poison', chargesLeft: 1 },
      { turn: 3, kind: 'warded', side: 'player', unit: 0, status: 'debuff', chargesLeft: 0 },
      { turn: 3, kind: 'statusExpired', side: 'player', unit: 0, status: 'ward' },
      endTurn(4),
      { turn: 5, kind: 'combatEnd', result: 'win', turns: 5 },
    ]);
    expect(texts(chipsAt(m, 1, 'player'))).toEqual(['WRD 2']);
    expect(texts(chipsAt(m, 2, 'player'))).toEqual(['WRD 1']);
    expect(texts(chipsAt(m, 3, 'player'))).toEqual([]);
    expect(texts(chipsAt(m, 4, 'player'))).toEqual([]);
  });

  it('stun is a bare glyph (no dishonest count) and guard/expose ride their effective values', () => {
    const m = model([
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'stun', turns: 1 },
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'expose', pct: 40, turns: 3 },
      // Two same-property guards compound multiplicatively: 50% then 50% → 75%.
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'guard', property: 'physical', pct: 50, turns: 3 },
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 0, status: 'guard', property: 'physical', pct: 50, turns: 3 },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ]);
    // Fixed order: stun → expose → guard.
    expect(texts(chipsAt(m, 1, 'enemy'))).toEqual(['STN', 'EXP +40%', 'GRD 75%P']);
  });

  it('thorns decays one stack per sting (the attacker-side damage event)', () => {
    const m = model([
      { turn: 1, kind: 'statusApplied', side: 'player', unit: 0, status: 'thorns', stacks: 3, turns: 3 },
      // A foe hits the holder; the sting lands on the ENEMY side, attributed
      // to the holder's granting card via sourceCard.
      { turn: 2, kind: 'damage', side: 'enemy', unit: 0, amount: 3, property: 'physical', blocked: 0, hpAfter: 90, source: 'thorns', sourceCard: { side: 'player', unit: 0, slot: 1, skillId: 'second_wind' } },
      { turn: 3, kind: 'combatEnd', result: 'win', turns: 3 },
    ]);
    expect(texts(chipsAt(m, 1, 'player'))).toEqual(['THR 3']);
    expect(texts(chipsAt(m, 2, 'player'))).toEqual(['THR 2']);
  });

  it('keys every chip for the shared color map and keeps rows per enemy unit', () => {
    const m = model([
      { turn: 1, kind: 'statusApplied', side: 'enemy', unit: 1, status: 'poison', stacks: 4, turns: 4 },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ], {
      ...BASE,
      enemyTeam: [
        { enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2, modifiers: [] },
        { enemyId: 'giant_rat', level: 1, title: 'normal', rank: 0, modifiers: [] },
      ],
    });
    // The poisoned SECOND unit carries the chip; unit 0 (and the 1v1
    // compatibility view, which mirrors unit 0) stays clean.
    expect(chipsAt(m, 1, 'enemy', 1)).toEqual([{ kind: 'poison', text: 'PSN 4' }]);
    expect(texts(chipsAt(m, 1, 'enemy', 0))).toEqual([]);
    expect(m.chipsByTurn.get(1)!.enemy).toEqual([]);
  });
});

describe('slotModsByTurn: burden and curse per board slot', () => {
  it('burden appears on application, rides until THAT slot plays, then clears', () => {
    const m = model([
      { turn: 1, kind: 'burdened', side: 'player', unit: 0, weight: 8, anchorSlot: 0, slots: [0] },
      endTurn(2),
      // T3: the burdened piece finally plays — the tax is spent with it.
      { turn: 3, kind: 'play', side: 'player', unit: 0, slot: 0, skillId: 'sword_slash', weight: 18, size: 1, slotIndex: 1, slotCount: 1 },
      { turn: 4, kind: 'combatEnd', result: 'win', turns: 4 },
    ]);
    const key = slotModKey('player', 0, 0);
    expect(m.slotModsByTurn.get(1)![key]).toEqual({ burden: 8 });
    expect(m.slotModsByTurn.get(2)![key]).toEqual({ burden: 8 });
    expect(m.slotModsByTurn.get(3)![key]).toBeUndefined();
    expect(m.slotModsByTurn.get(4)![key]).toBeUndefined();
  });

  it('curse marks every splashed slot and clears on its own curseExpired', () => {
    const m = model([
      { turn: 1, kind: 'cursed', side: 'enemy', unit: 0, amount: 12, turns: 2, anchorSlot: 1, slots: [1, 2] },
      endTurn(2),
      { turn: 3, kind: 'curseExpired', side: 'enemy', unit: 0, slots: [1, 2] },
      { turn: 4, kind: 'combatEnd', result: 'win', turns: 4 },
    ]);
    expect(m.slotModsByTurn.get(1)![slotModKey('enemy', 0, 1)]).toEqual({ curse: 12 });
    expect(m.slotModsByTurn.get(1)![slotModKey('enemy', 0, 2)]).toEqual({ curse: 12 });
    // Scrub granularity: present through turn 2, gone from turn 3 on.
    expect(m.slotModsByTurn.get(2)![slotModKey('enemy', 0, 1)]).toEqual({ curse: 12 });
    expect(m.slotModsByTurn.get(3)![slotModKey('enemy', 0, 1)]).toBeUndefined();
    expect(m.slotModsByTurn.get(4)![slotModKey('enemy', 0, 2)]).toBeUndefined();
  });

  it('a burdened AND cursed slot carries both on one entry', () => {
    const m = model([
      { turn: 1, kind: 'burdened', side: 'player', unit: 0, weight: 5, anchorSlot: 1, slots: [1] },
      { turn: 1, kind: 'cursed', side: 'player', unit: 0, amount: 7, turns: 3, anchorSlot: 1, slots: [1] },
      { turn: 2, kind: 'combatEnd', result: 'win', turns: 2 },
    ]);
    expect(m.slotModsByTurn.get(1)![slotModKey('player', 0, 1)]).toEqual({ burden: 5, curse: 7 });
  });
});
