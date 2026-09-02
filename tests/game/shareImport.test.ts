import { beforeEach, describe, expect, it } from 'vitest';
import {
  demoState,
  resetDemoState,
  EMPTY_BOARD_OVERRIDES,
  type EnemyFightConfig,
} from '../../src/game/demoState';
import { applyAsFoe, applyAsHero, captureLoadout } from '../../src/game/shareActions';
import { decodeCode, encodeLoadout } from '../../src/run/shareCode';
import { buildEnemyEncounter } from '../../src/run/encounter';
import { battleRequestOf } from '../../src/game/battleApi';
import { buildBattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import { resolveBattle } from '../../src/run/resolveBattle';
import { monsterLevelPL, totalLevelPL } from '../../src/run/leveling';
import { gemBook } from '../../src/data/gems';

/**
 * The share-code apply paths (docs/sandbox-features-proposal.md §3.2/§3.3):
 * `captureLoadout` (demoState -> codec struct), PLAY IT (`applyAsHero`,
 * lossless) and FIGHT IT (`applyAsFoe`, writes Feature A's `deck` shape with
 * the documented drops). T2 — the round-trip-as-enemy property — lands here.
 */

/** The board as the codec sees it — instanceIds are minted per-import and
 * deliberately not part of a loadout's identity. */
const boardOf = () => [...demoState.pieces]
  .sort((a, b) => a.slot - b.slot)
  .map((p) => ({ skillId: p.skillId, tier: p.tier, slot: p.slot, gemId: p.gem?.id ?? null }));

beforeEach(() => resetDemoState());

describe('game/shareActions: captureLoadout', () => {
  it('reads the sandbox build in canonical form', () => {
    const loadout = captureLoadout();
    expect(loadout.board).toEqual(boardOf());
    expect(loadout.board.map((b) => b.slot)).toEqual([0, 1, 2, 3, 4]);
    // Socketed gems travel as ids; the default board carries two.
    expect(loadout.board.filter((b) => b.gemId !== null)).toHaveLength(2);
    // Bag: cards only, in slot order — gaps are not carried.
    expect(loadout.bag.map((b) => b.skillId)).toEqual(
      ['fireball', 'mana_ward', 'follow_through', 'armor_break', 'crippling_strike', 'arcane_bolt'],
    );
    expect(loadout.gems).toEqual(demoState.gemInventory);
    expect(loadout.heroLevel).toBe(demoState.heroLevel);
    expect(loadout.allocation).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('game/shareActions: PLAY IT (applyAsHero) — the lossless path (T1 on real state)', () => {
  it('capture -> encode -> decode -> apply reproduces the DEFAULT sandbox loadout exactly', () => {
    resetDemoState({ heroLevel: 6, heroAllocation: { maxHp: 4, attack: 3, speed: 2 } }); // 4+3+4=11 of 15 PL
    const source = captureLoadout();
    const { loadout, report } = decodeCode(encodeLoadout(source));
    expect(report).toEqual({ unknownCards: 0, unknownGems: 0, clamped: [] });

    // Wreck the state so the apply provably rebuilds everything.
    resetDemoState(EMPTY_BOARD_OVERRIDES);
    const lines = applyAsHero(loadout);
    expect(lines).toEqual([]);
    expect(captureLoadout()).toEqual(source);
  });

  it('round-trips the EMPTY_BOARD_OVERRIDES loadout (empty board, loose gems, full bag)', () => {
    resetDemoState(EMPTY_BOARD_OVERRIDES);
    const source = captureLoadout();
    expect(source.board).toEqual([]);
    const { loadout, report } = decodeCode(encodeLoadout(source));
    expect(report).toEqual({ unknownCards: 0, unknownGems: 0, clamped: [] });

    resetDemoState();
    applyAsHero(loadout);
    expect(captureLoadout()).toEqual(source);
  });

  it('mints fresh owned instances through createOwnedCard and sockets real gemBook gems', () => {
    const source = captureLoadout();
    const before = demoState.nextCardInstanceId;
    applyAsHero(decodeCode(encodeLoadout(source)).loadout);
    expect(demoState.nextCardInstanceId).toBeGreaterThan(before);
    const ids = [
      ...demoState.pieces.map((p) => p.instanceId),
      ...demoState.bagSlots.flatMap((s) => (s ? [s.instanceId] : [])),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const banner = demoState.pieces.find((p) => p.skillId === 'war_banner')!;
    expect(banner.gem).toBe(gemBook.swift_charm);
  });

  it('re-packs the bag by card size onto the 10-slot rail (covered slots stay null)', () => {
    applyAsHero(decodeCode(encodeLoadout(captureLoadout())).loadout);
    // fireball (size 2) at 0 covering 1, then the size-1s, crippling_strike
    // (size 2) at 5 covering 6 — the DEFAULT_BAG_SLOTS shape re-derived.
    expect(demoState.bagSlots.map((s) => s?.skillId ?? null)).toEqual([
      'fireball', null, 'mana_ward', 'follow_through', 'armor_break', 'crippling_strike', null, 'arcane_bolt', null, null,
    ]);
  });

  it('drops bag overflow with a report line, never silently', () => {
    const lines = applyAsHero({
      heroLevel: 1,
      allocation: [0, 0, 0, 0, 0, 0],
      board: [],
      // Six size-2 cards need 12 slots; the sixth is dropped.
      bag: Array.from({ length: 6 }, () => ({ skillId: 'fireball', tier: 'bronze' as const })),
      gems: [],
    });
    expect(demoState.bagSlots.filter((s) => s !== null)).toHaveLength(5);
    expect(lines.some((l) => l.includes('dropped'))).toBe(true);
  });

  it('re-fits an over-spent allocation with the LV stepper\'s un-buy loop, reported', () => {
    const lines = applyAsHero({
      heroLevel: 2, // banks 3 PL
      allocation: [2, 2, 0, 0, 0, 0], // spends 4
      board: [],
      bag: [],
      gems: [],
    });
    expect(demoState.heroAllocation).toEqual({ maxHp: 2, attack: 1 });
    expect(lines.some((l) => l.includes('re-fit'))).toBe(true);
  });
});

describe('game/shareActions: FIGHT IT (applyAsFoe) — round-trip as enemy (T2)', () => {
  it('encode(hero) -> applyAsFoe -> resolver: foe board is card/tier/slot/gem-identical; documented drops absent', () => {
    resetDemoState({ heroLevel: 7, heroAllocation: { attack: 6 } });
    const source = captureLoadout();
    expect(source.bag.length).toBeGreaterThan(0);
    expect(source.gems.length).toBeGreaterThan(0);

    const { loadout } = decodeCode(encodeLoadout(source));
    const drops = applyAsFoe(loadout);
    const foe = demoState.enemyTeam[demoState.activeFoe]!;

    // The deck IS the source board, field for field.
    expect(foe.deck).toEqual(source.board.map((b) => ({
      skillId: b.skillId, slot: b.slot, tier: b.tier, gemId: b.gemId,
    })));
    // LV -> foe LV rides the SAME PL budget (totalLevelPL === monsterLevelPL for L >= 1).
    expect(foe.level).toBe(7);
    expect(monsterLevelPL(foe.level)).toBe(totalLevelPL(7));
    expect(foe.title).toBe('normal');
    expect(foe.affix).toBeNull();
    // The singular mirrors follow the team entry.
    expect(demoState.enemyLevel).toBe(7);
    expect(demoState.enemyTitle).toBe('normal');

    // Through the REAL resolver: pieces equal the source board card-for-card,
    // tier-for-tier, slot-for-slot, gem-for-gem.
    const unit = buildEnemyEncounter(foe.enemyId, foe.level, foe.title, foe.rank, foe.modifiers, foe.affix ?? null, undefined, foe.deck);
    expect(unit.setup.pieces.map((p) => ({
      skillId: p.skillId, slot: p.slot, tier: p.tier, gemId: p.gem?.id ?? null,
    }))).toEqual(source.board);
    // The foe side has nowhere to carry bag/loose gems/hand spend — and the
    // drop report says so instead of dropping silently.
    expect(drops.some((l) => l.includes('bag'))).toBe(true);
    expect(drops.some((l) => l.includes('loose gem'))).toBe(true);
    expect(drops.some((l) => l.includes('stat spend'))).toBe(true);
  });

  it('leaves the challenger\'s own dials alone — chassis, modifiers, rank field', () => {
    const foe = demoState.enemyTeam[0]!;
    foe.modifiers = ['swift'];
    const rankBefore = foe.rank;
    applyAsFoe(captureLoadout());
    expect(foe.enemyId).toBe('bandit_duelist');
    expect(foe.modifiers).toEqual(['swift']);
    expect(foe.rank).toBe(rankBefore);
  });

  it('throws on an empty-board loadout (the import dialog disables FIGHT IT instead)', () => {
    resetDemoState(EMPTY_BOARD_OVERRIDES);
    const empty = captureLoadout();
    expect(() => applyAsFoe(empty)).toThrow(/empty-board/);
  });
});

describe('game/demoState + plumbing: the deck travels', () => {
  const DECKED_INPUT: BattleTimelineInput = {
    pieces: [
      { instanceId: 'c1', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
      { instanceId: 'c2', skillId: 'second_wind', tier: 'bronze', slot: 1 },
    ],
    heroLevel: 3,
    heroAllocation: {},
    enemyId: 'bandit_duelist',
    enemyLevel: 1,
    enemyTitle: 'normal',
    enemyRank: 0,
    enemyTeam: [{
      enemyId: 'bandit_duelist', level: 1, title: 'normal', rank: 0, modifiers: [],
      deck: [{ skillId: 'fireball', slot: 0, tier: 'silver', gemId: 'swift_charm' }],
    }],
    seed: 7,
  };

  it('resetDemoState deep-copies a deck-carrying enemyTeam override', () => {
    const cfg: EnemyFightConfig = {
      enemyId: 'bandit_duelist', level: 2, title: 'normal', rank: 0, modifiers: [],
      deck: [{ skillId: 'sword_slash', slot: 0, tier: 'gold', gemId: null }],
    };
    resetDemoState({ enemyTeam: [cfg] });
    const live = demoState.enemyTeam[0]!;
    expect(live.deck).toEqual(cfg.deck);
    expect(live.deck).not.toBe(cfg.deck);
    live.deck![0]!.tier = 'bronze';
    expect(cfg.deck![0]!.tier).toBe('gold');
  });

  it('battleRequestOf maps the deck onto the request as a detached copy', () => {
    const request = battleRequestOf(DECKED_INPUT);
    expect(request.foes[0]!.deck).toEqual(DECKED_INPUT.enemyTeam![0]!.deck);
    expect(request.foes[0]!.deck).not.toBe(DECKED_INPUT.enemyTeam![0]!.deck);
    // The legacy singular branch (no enemyTeam) has no deck to ship.
    const singular = battleRequestOf({ ...DECKED_INPUT, enemyTeam: undefined });
    expect('deck' in singular.foes[0]!).toBe(false);
  });

  it('buildBattleTimeline renders the CUSTOM board the service resolved (both read the same config)', () => {
    const model = buildBattleTimeline(DECKED_INPUT, resolveBattle(battleRequestOf(DECKED_INPUT)));
    expect(model.foes[0]!.skills.map((s) => s.id)).toEqual(['fireball']);
    expect(model.foes[0]!.pieces[0]!.tier).toBe('silver');
    // The authored chassis kit is fully replaced in the render too.
    expect(model.foes[0]!.skills.some((s) => s.id === 'sword_slash')).toBe(false);
  });
});
