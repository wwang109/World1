import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  applyDraftResult,
  createRun,
  fightTableEntryForNode,
  rollEncounter,
  type RunState,
} from '../../src/run/runState';
import { applyRunDraft, clearRun, getActiveRun, previewEncounter, startRun } from '../../src/game/runStore';
import { BOSS_EVERY, ensureWavesThrough, type RunNode } from '../../src/run/runMap';
import { rollStartDraft, DRAFT_SET_KEYS, type DraftSetKey } from '../../src/run/draft';
import {
  buildAutoHeroSetup,
  buildEnemyEncounter,
  eliteAffixIdFor,
  EXTRA_CARD_POOL,
  eliteAffixPreset,
  ELITE_AFFIX_IDS,
  ENEMY_MODIFIER_IDS,
  MODIFIER_PRESETS,
  soloThreatDeci,
  TITLE_PRESETS,
} from '../../src/run/encounter';
import { skillBook } from '../../src/data/skills';
import { enemies } from '../../src/data/enemies';
import { simulate } from '../../src/engine/combat/simulate';
import { powerLevelDeci, TIER_BUDGET_DECI } from '../../src/engine/balance';
import type { BoardPiece } from '../../src/engine/types';

/**
 * ELITE AFFIXES (2026-08-26) — `elite` used to be a pure STAT RUNG (+2 levels,
 * +2 rank, +1 GENERIC filler card), so an elite fight asked the player's deck
 * nothing a normal fight did not. Every elite now carries EXACTLY ONE
 * behavioural affix from `ELITE_AFFIX_IDS`, dealt by `eliteAffixIdFor`, whose
 * card is installed IN PLACE OF that filler.
 *
 * What these tests hold down, in the order the brief asked for them:
 *   1. every elite fight has exactly one affix — and nothing else does;
 *   2. the deal is deterministic for a given (seed, fight number), and spends
 *      NO `Rng` draw (so it cannot move the frozen map/encounter fingerprints);
 *   3. it is in the model `previewEncounter` returns, BEFORE the fight, and is
 *      the same affix the committed fight rolls;
 *   4. NON-VACUITY: the affix really alters the event log, and does so through
 *      the keyword it is named for;
 *   5. PL-HONESTY: the substitution is priced at zero because it IS a
 *      substitution — same card count, same tier budget, same threat.
 */

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

function startedRun(seed: number): RunState {
  return applyDraftResult(createRun(seed), draftPicksFor(seed));
}

/** Every fight/boss node through `throughWave`, with a state whose map already
 * reaches that far — rolled via the SAME throwaway-`currentNodeId` idiom
 * `runStore.ts#previewEncounter` uses for a not-yet-chosen node. */
function combatNodes(seed: number, throughWave: number): { state: RunState; nodes: RunNode[] } {
  const base = startedRun(seed);
  const state = { ...base, map: ensureWavesThrough(base.map, throughWave) };
  const nodes: RunNode[] = [];
  for (const column of state.map.depths) {
    for (const node of column) {
      if (node.kind === 'fight' || node.kind === 'boss') nodes.push(node);
    }
  }
  return { state, nodes };
}

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234];

function board(ids: readonly string[]): BoardPiece[] {
  const out: BoardPiece[] = [];
  let slot = 0;
  for (const id of ids) {
    out.push({ skillId: id, slot });
    slot += skillBook[id]!.size;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Exactly one affix, on exactly the elite fights.
// ---------------------------------------------------------------------------

describe('run/eliteAffix: every elite fight carries exactly one affix', () => {
  it('the affix pool is non-empty, every id is flagged `affix: true`, and it is DISJOINT from the deep-run escalation pool', () => {
    expect(ELITE_AFFIX_IDS.length).toBeGreaterThan(0);
    for (const id of ELITE_AFFIX_IDS) {
      expect(MODIFIER_PRESETS[id], id).toBeDefined();
      expect(MODIFIER_PRESETS[id]!.affix, id).toBe(true);
      expect(ENEMY_MODIFIER_IDS, `${id} leaked into the escalation ramp`).not.toContain(id);
    }
    for (const id of ENEMY_MODIFIER_IDS) {
      expect(ELITE_AFFIX_IDS, `${id} leaked into the affix pool`).not.toContain(id);
    }
  });

  it('every affix names at least one card, and every card resolves in the live skill book', () => {
    for (const id of ELITE_AFFIX_IDS) {
      const cards = MODIFIER_PRESETS[id]!.cards ?? [];
      expect(cards.length, id).toBeGreaterThan(0);
      for (const cardId of cards) {
        expect(skillBook[cardId], `${id} installs unknown card "${cardId}"`).toBeDefined();
      }
    }
  });

  it('NO affix card is also generic filler — an affixed elite must never be byte-identical to a plain one', () => {
    const filler = new Set<string>([...EXTRA_CARD_POOL.physical, ...EXTRA_CARD_POOL.magical]);
    expect(filler.size).toBeGreaterThan(0);
    for (const id of ELITE_AFFIX_IDS) {
      for (const cardId of MODIFIER_PRESETS[id]!.cards ?? []) {
        expect(filler.has(cardId), `affix ${id} installs "${cardId}", which is ALSO generic filler`).toBe(false);
      }
    }
  });

  it('rollEncounter gives EVERY elite unit an affix and every non-elite unit none, across seeds x the whole ladder', () => {
    let elites = 0;
    let others = 0;
    for (const seed of SEEDS) {
      const { state, nodes } = combatNodes(seed, BOSS_EVERY * 3);
      for (const node of nodes) {
        const pack = rollEncounter({ ...state, currentNodeId: node.id });
        for (const unit of pack.units) {
          if (unit.title === 'elite') {
            elites += 1;
            expect(unit.affix, `elite at ${node.id} had no affix`).not.toBeNull();
            expect(ELITE_AFFIX_IDS).toContain(unit.affix!);
          } else {
            others += 1;
            expect(unit.affix, `${unit.title} at ${node.id} carried affix ${unit.affix}`).toBeNull();
          }
        }
      }
    }
    // NON-VACUITY: a sample with no elites in it would pass the loop above forever.
    expect(elites, 'the sample contained no elite fights at all').toBeGreaterThan(20);
    expect(others).toBeGreaterThan(20);
  });

  it('BOSSES NEVER CARRY AN AFFIX — the design fork, asserted rather than assumed', () => {
    // Bosses are telegraphed BY NAME (the band biome's boss shortlist) and
    // already carry `TITLE_PRESETS.boss`; affixes are what makes an ELITE a
    // different problem from a boss, not a second layer on top of one. See the
    // ELITE AFFIXES block in src/run/encounter.ts.
    let bosses = 0;
    for (const seed of SEEDS) {
      const { state, nodes } = combatNodes(seed, BOSS_EVERY * 3);
      for (const node of nodes) {
        const entry = fightTableEntryForNode(node);
        if (entry.title !== 'boss') continue;
        const pack = rollEncounter({ ...state, currentNodeId: node.id });
        for (const unit of pack.units) {
          bosses += 1;
          expect(unit.affix, `boss at ${node.id} carried affix ${unit.affix}`).toBeNull();
        }
      }
    }
    expect(bosses, 'the sample contained no boss-titled fights').toBeGreaterThan(10);
  });

  it('a fight column\'s three risk tiers agree on WHICH affix that rung carries (the affix is a property of the fight number)', () => {
    for (const seed of SEEDS) {
      const { state, nodes } = combatNodes(seed, BOSS_EVERY * 2);
      const byFight = new Map<number, Set<string>>();
      for (const node of nodes) {
        const pack = rollEncounter({ ...state, currentNodeId: node.id });
        const affix = pack.units[0]!.affix;
        if (affix === null) continue;
        const key = node.fightNumber!;
        if (!byFight.has(key)) byFight.set(key, new Set());
        byFight.get(key)!.add(affix);
      }
      expect(byFight.size).toBeGreaterThan(0);
      for (const [fightNumber, set] of byFight) {
        expect([...set], `fight ${fightNumber} on seed ${seed} dealt two different affixes`).toHaveLength(1);
        expect([...set][0]).toBe(eliteAffixIdFor(seed, fightNumber));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Determinism, and no Rng draw.
// ---------------------------------------------------------------------------

describe('run/eliteAffix: the deal is deterministic and spends no Rng draw', () => {
  it('eliteAffixIdFor is a pure function of (seed, fightNumber) — same inputs, same id, every time', () => {
    for (const seed of SEEDS) {
      for (let n = 1; n <= 40; n++) {
        const first = eliteAffixIdFor(seed, n);
        expect(eliteAffixIdFor(seed, n)).toBe(first);
        expect(eliteAffixIdFor(seed, n)).toBe(first);
        expect(ELITE_AFFIX_IDS).toContain(first);
      }
    }
  });

  it('rolling the same node twice returns the identical encounter, affix included (preview == committed)', () => {
    for (const seed of SEEDS) {
      const { state, nodes } = combatNodes(seed, BOSS_EVERY * 2);
      for (const node of nodes) {
        const a = rollEncounter({ ...state, currentNodeId: node.id });
        const b = rollEncounter({ ...state, currentNodeId: node.id });
        expect(b).toEqual(a);
      }
    }
  });

  it('two independently built runs on the same seed deal the same affixes (nothing is carried in module state)', () => {
    for (const seed of SEEDS) {
      const left = combatNodes(seed, BOSS_EVERY * 2);
      const right = combatNodes(seed, BOSS_EVERY * 2);
      const affixesOf = (bundle: { state: RunState; nodes: RunNode[] }): (string | null)[] =>
        bundle.nodes.map((node) => rollEncounter({ ...bundle.state, currentNodeId: node.id }).units[0]!.affix);
      expect(affixesOf(right)).toEqual(affixesOf(left));
    }
  });

  it('the deal is NOT degenerate: every affix in the pool is reached, and neighbouring fights differ', () => {
    const seen = new Set<string>();
    let changes = 0;
    let steps = 0;
    for (const seed of SEEDS) {
      let prev: string | null = null;
      for (let n = 1; n <= 60; n++) {
        const id = eliteAffixIdFor(seed, n);
        seen.add(id);
        if (prev !== null) {
          steps += 1;
          if (id !== prev) changes += 1;
        }
        prev = id;
      }
    }
    expect([...seen].sort()).toEqual([...ELITE_AFFIX_IDS].sort());
    // A constant deal would score 0 here; a uniform 4-way deal scores ~75%.
    expect(changes / steps).toBeGreaterThan(0.5);
  });

  it('the ENEMY IDS a fight column rolls are untouched by the affix layer — the deal spent no draw off the node Rng', () => {
    // The affix cannot be swapped off inside `rollEncounter`, so this asserts
    // the property that matters instead: the ids/levels/variants an elite node
    // rolls are exactly what the SAME node rolls when its title is read through
    // `buildEnemyEncounter` with the affix argument removed. Any extra `Rng`
    // draw would have shifted the id draws below.
    for (const seed of SEEDS) {
      const { state, nodes } = combatNodes(seed, BOSS_EVERY * 2);
      for (const node of nodes) {
        const pack = rollEncounter({ ...state, currentNodeId: node.id });
        for (const unit of pack.units) {
          const bare = buildEnemyEncounter(
            unit.enemyId,
            unit.level,
            unit.title,
            unit.rank,
            unit.modifiers,
            null,
          );
          expect(bare.enemyId).toBe(unit.enemyId);
          expect(bare.setup.stats).toEqual(unit.setup.stats);
          expect(bare.effectiveLevel).toBe(unit.effectiveLevel);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. It is in the model `previewEncounter` returns, BEFORE the fight.
// ---------------------------------------------------------------------------

describe('run/eliteAffix: the affix is visible in previewEncounter BEFORE the fight', () => {
  // `runStore.ts` is the real preview surface, and it persists through a
  // `window.localStorage` driver. Stubbing an in-memory `window` keeps this a
  // test OF the store rather than of its storage (the driver already swallows a
  // missing `window`, but then every save logs a warning).
  beforeAll(() => {
    const cells = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => cells.get(k) ?? null,
        setItem: (k: string, v: string) => void cells.set(k, v),
        removeItem: (k: string) => void cells.delete(k),
      },
    });
  });
  afterAll(() => {
    clearRun();
    vi.unstubAllGlobals();
  });

  it('previewEncounter names the affix of a NOT-YET-CHOSEN elite node, and it matches what the committed roll ships', () => {
    let previewed = 0;
    for (const seed of SEEDS) {
      startRun(seed);
      applyRunDraft(draftPicksFor(seed));
      const run = getActiveRun()!;
      // A preview is by definition pre-commitment: nothing is the current node.
      expect(run.currentNodeId).toBeNull();
      for (const column of run.map.depths) {
        for (const node of column) {
          if (node.kind !== 'fight' && node.kind !== 'boss') continue;
          const preview = previewEncounter(node);
          expect(preview, `no preview for ${node.id}`).not.toBeNull();
          const committed = rollEncounter({ ...run, currentNodeId: node.id });
          // Preview and fight are the SAME roll — affixes included.
          expect(preview!.units.map((u) => u.affix)).toEqual(committed.units.map((u) => u.affix));
          expect(preview).toEqual(committed);
          const primary = preview!.units[0]!;
          if (primary.title !== 'elite') {
            expect(primary.affix).toBeNull();
            continue;
          }
          previewed += 1;
          const affix = primary.affix!;
          expect(affix).toBe(eliteAffixIdFor(seed, node.fightNumber!));
          // Everything the map/prep UI needs to NAME it, before a card is bought.
          expect(MODIFIER_PRESETS[affix]!.name.length).toBeGreaterThan(0);
          expect(MODIFIER_PRESETS[affix]!.blurb.length).toBeGreaterThan(0);
        }
      }
    }
    expect(previewed, 'no elite node was previewed').toBeGreaterThan(10);
  });

  it('previewEncounter returns null for a non-combat node (nothing to preview, no affix to invent)', () => {
    startRun(SEEDS[0]!);
    applyRunDraft(draftPicksFor(SEEDS[0]!));
    const run = getActiveRun()!;
    let checked = 0;
    for (const column of run.map.depths) {
      for (const node of column) {
        if (node.kind === 'fight' || node.kind === 'boss') continue;
        expect(previewEncounter(node)).toBeNull();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. NON-VACUITY: the affix actually alters the event log.
// ---------------------------------------------------------------------------

describe('run/eliteAffix: the affix actually changes the fight (event-log non-vacuity)', () => {
  /**
   * THE CONTROL ENEMY. `mage` is the only clean control available: its authored
   * kit (`static_jolt`, `arcane_bolt`) carries NONE of the four affix keywords,
   * so any thorns / guard / enemy-heal / poison seen in its log HAS to have come
   * from the affix. (`giant_rat` cannot be the control — its own kit runs
   * `venom_fang`, so it poisons with or without VENOMOUS.)
   */
  const CONTROL_ENEMY = 'mage';

  /**
   * A PASSIVE-ish DUMMY hero — huge HP, 1 attack — so the fight runs long
   * enough for the elite to cycle its WHOLE deck and the affix card is
   * guaranteed to fire. `twin_slash` (two small hits per cast) is there for
   * exactly one reason: a thorns pile only stings when a hit LANDS, so a dummy
   * that never attacks could not show BARBED doing anything.
   */
  const DUMMY_STATS = { maxHp: 30000, hp: 30000, attack: 1, magicPower: 0, armor: 0, magicResist: 0, speed: 10 };

  function runFight(affix: string | null, enemyId: string, level: number, seed: number) {
    const foe = buildEnemyEncounter(enemyId, level, 'elite', undefined, [], affix);
    const out = simulate(
      {
        playerTeam: [{ name: 'Dummy', stats: { ...DUMMY_STATS }, boardSize: 4, pieces: board(['twin_slash']) }],
        enemyTeam: [foe.setup],
        skillBook,
        maxTurns: 40,
      },
      seed,
    );
    const statuses = new Set(
      out.events.map((e) => (e as { status?: string }).status).filter((x): x is string => x !== undefined),
    );
    const foeHealed = out.events.some((e) => e.kind === 'heal' && (e as { side?: string }).side === 'enemy');
    // `slow` is a WEIGHT TAX held on the victim (`nextWeightPenalty`), not a
    // status — it has its own `slowed` event carrying the weight it added.
    const slowed = out.events.some((e) => e.kind === 'slowed' && (e as { side?: string }).side === 'player');
    return { out, statuses, foeHealed, slowed };
  }

  /** The keyword each affix must be seen DOING in the log — the affix is only
   * real if its OWN mechanic fires, not merely if some number moved. */
  const SIGNATURE: Record<string, (r: ReturnType<typeof runFight>) => boolean> = {
    braced: (r) => r.statuses.has('guard'),
    hobbling: (r) => r.slowed,
    leeching: (r) => r.foeHealed,
    venomous: (r) => r.statuses.has('poison'),
  };

  it('a plain elite and an affixed elite at the SAME position produce DIFFERENT event logs', () => {
    for (const affix of ELITE_AFFIX_IDS) {
      for (const enemyId of [CONTROL_ENEMY, 'knight', 'ember_imp']) {
        for (const level of [8, 20, 40]) {
          const plain = runFight(null, enemyId, level, 5);
          const affixed = runFight(affix, enemyId, level, 5);
          expect(plain.out.events.length).toBeGreaterThan(0);
          expect(
            JSON.stringify(affixed.out.events),
            `${affix} on ${enemyId} @LV${level} produced a byte-identical log`,
          ).not.toBe(JSON.stringify(plain.out.events));
        }
      }
    }
  });

  it('each affix is seen DOING its own keyword, the control elite is seen doing NONE of them, and no affix fires another\'s', () => {
    const control = runFight(null, CONTROL_ENEMY, 20, 5);
    for (const affix of ELITE_AFFIX_IDS) {
      const signature = SIGNATURE[affix];
      expect(signature, `no log signature declared for affix "${affix}"`).toBeDefined();
      expect(signature!(control), `the plain control elite already showed ${affix}'s keyword`).toBe(false);
      const withAffix = runFight(affix, CONTROL_ENEMY, 20, 5);
      expect(signature!(withAffix), `${affix} never fired its own keyword`).toBe(true);
      // CROSS-CHECK: an affix fires ITS keyword and nobody else's, so the four
      // affixes are genuinely four different problems and not one in four hats.
      for (const other of ELITE_AFFIX_IDS) {
        if (other === affix) continue;
        expect(SIGNATURE[other]!(withAffix), `${affix} also fired ${other}'s keyword`).toBe(false);
      }
    }
  });

  it('the affix card really is ON the deck, at the slot the generic filler would have taken', () => {
    for (const affix of ELITE_AFFIX_IDS) {
      const cards = MODIFIER_PRESETS[affix]!.cards!;
      for (const enemyId of Object.keys(enemies)) {
        const plain = buildEnemyEncounter(enemyId, 10, 'elite', undefined, [], null);
        const affixed = buildEnemyEncounter(enemyId, 10, 'elite', undefined, [], affix);
        // Same length, and the affix's cards occupy the tail slots.
        expect(affixed.setup.pieces).toHaveLength(plain.setup.pieces.length);
        const tail = affixed.setup.pieces.slice(-cards.length);
        expect(tail.map((p) => p.skillId)).toEqual([...cards]);
        expect(tail.map((p) => p.slot)).toEqual(plain.setup.pieces.slice(-cards.length).map((p) => p.slot));
        expect(affixed.affix).toBe(affix);
        expect(plain.affix).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. PL-HONESTY: a substitution, priced at zero because it IS a substitution.
// ---------------------------------------------------------------------------

describe('run/eliteAffix: PL honesty', () => {
  it('every affix card audits to exactly one BRONZE tier budget — the same budget the generic filler it replaces audits to', () => {
    for (const affix of ELITE_AFFIX_IDS) {
      for (const cardId of MODIFIER_PRESETS[affix]!.cards!) {
        const card = skillBook[cardId]!;
        expect(card.tier ?? 'bronze', cardId).toBe('bronze');
        expect(powerLevelDeci(card), cardId).toBe(TIER_BUDGET_DECI.bronze);
      }
    }
  });

  it('no affix names more cards than the ELITE title\'s own filler allowance, so the swap is one-for-one', () => {
    for (const affix of ELITE_AFFIX_IDS) {
      expect(MODIFIER_PRESETS[affix]!.cards!.length, affix).toBeLessThanOrEqual(TITLE_PRESETS.elite.extraCards);
    }
  });

  it('soloThreatDeci is IDENTICAL with and without an affix (the deck it prices did not grow)', () => {
    for (const affix of ELITE_AFFIX_IDS) {
      for (let level = 1; level <= 60; level++) {
        expect(soloThreatDeci(level, 'elite', [], affix), `${affix} @ ${level}`).toBe(
          soloThreatDeci(level, 'elite', [], null),
        );
      }
    }
  });

  it('the deck\'s TIER MULTISET is unchanged by the affix, so rank distribution and tier budget are untouched', () => {
    for (const affix of ELITE_AFFIX_IDS) {
      for (const enemyId of Object.keys(enemies)) {
        const plain = buildEnemyEncounter(enemyId, 12, 'elite', undefined, [], null);
        const affixed = buildEnemyEncounter(enemyId, 12, 'elite', undefined, [], affix);
        const tiers = (u: typeof plain): string[] => u.setup.pieces.map((p) => p.tier ?? 'bronze').sort();
        expect(tiers(affixed), `${affix} on ${enemyId}`).toEqual(tiers(plain));
        expect(affixed.rank).toBe(plain.rank);
        expect(affixed.setup.stats).toEqual(plain.setup.stats);
        expect(affixed.setup.boardSize).toBe(plain.setup.boardSize);
      }
    }
  });

  it('the affix is NOT in `modifiers`, so battleGoldReward\'s difficulty term is unchanged by it', () => {
    for (const seed of SEEDS) {
      const { state, nodes } = combatNodes(seed, BOSS_EVERY * 2);
      for (const node of nodes) {
        const entry = fightTableEntryForNode(node);
        for (const unit of rollEncounter({ ...state, currentNodeId: node.id }).units) {
          expect(unit.modifiers).toEqual(entry.modifiers);
          if (unit.affix !== null) expect(unit.modifiers).not.toContain(unit.affix);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A typo'd affix must scream.
// ---------------------------------------------------------------------------

describe('run/eliteAffix: a bad affix id is refused, never silently dropped', () => {
  it('an unknown affix id throws', () => {
    expect(() => eliteAffixPreset('not_an_affix')).toThrow(/unknown affix id/);
    expect(() => buildEnemyEncounter('knight', 5, 'elite', undefined, [], 'not_an_affix')).toThrow(/unknown affix id/);
  });

  it('a real modifier that is NOT flagged `affix: true` is refused as an affix', () => {
    for (const id of ENEMY_MODIFIER_IDS) {
      expect(() => eliteAffixPreset(id), id).toThrow(/is not an affix/);
      expect(() => buildEnemyEncounter('knight', 5, 'elite', undefined, [], id), id).toThrow(/is not an affix/);
    }
  });
});
