import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextFoeRank, rankStepperLabel } from '../../src/game/demoState';
import { buildEnemyEncounter, maxRankFor } from '../../src/run/encounter';

/**
 * `nextFoeRank` — the sandbox RANK stepper's ONE rule (shared by
 * DesktopPrepScene and MobilePrepScene). Critical fix: at any enemyLevel with
 * active growth (`growthStepsAt(level) > 0`, i.e. level >= 2), the stepper
 * DISPLAYS `EncounterUnit.rank` (resolved: base + growth) but must WRITE the
 * next `foe.rank` off `EncounterUnit.baseRank` (pre-growth). Feeding the
 * resolved rank back in as the next base double-counts growth every render,
 * so the DOWN arrow made the foe STRONGER at any grown level. `giant_rat`
 * (`normal`, boardSize 2, no authored `growth` list) isolates the pure
 * tier-growth case — growth adds zero cards here, only rank steps, matching
 * the exact probe (`L6: displayed 3 base 0`) the audit that found this bug
 * (`task-mechanism-review-3.md`) recorded.
 *
 * `nextFoeRank` now takes the WHOLE `encounter` (not a bare number) so the
 * bug's actual shape — passing `EncounterUnit.rank` where `.baseRank` was
 * meant — is a TYPE error, not just a convention: `fix-round-review.md`'s
 * Important #1 ("the choice is still written twice, and nothing stops a
 * caller passing `encounter.rank`") is closed by making that call not
 * compile, not merely by reviewing it away.
 */
describe('game/demoState: nextFoeRank (sandbox RANK stepper write-back)', () => {
  const ENEMY_ID = 'giant_rat';
  const LEVEL = 6; // growthStepsAt(6) = 3 — growth active.

  function resolveAt(baseRank: number) {
    const encounter = buildEnemyEncounter(ENEMY_ID, LEVEL, 'normal', baseRank);
    const rankCap = maxRankFor(encounter.setup.pieces.length);
    return { encounter, rankCap };
  }

  it('growth is active at level 6 and grows the DISPLAYED rank without moving the base', () => {
    const { encounter } = resolveAt(0);
    expect(encounter.baseRank).toBe(0);
    expect(encounter.rank).toBe(3); // resolved = base(0) + 3 growth-rank-steps
  });

  it('DOWN at base 0 stays at base 0 — displayed rank does NOT drop below its growth floor and does NOT rise', () => {
    const { encounter, rankCap } = resolveAt(0);
    const nextBase = nextFoeRank(encounter, rankCap, -1);
    expect(nextBase).toBe(0);
    const { encounter: after } = resolveAt(nextBase);
    expect(after.rank).toBe(3); // unchanged — NOT raised, which is the bug this closes
  });

  it('UP moves the base by exactly +1, and the displayed rank grows by the same +1 on top of growth', () => {
    const { encounter, rankCap } = resolveAt(0);
    const nextBase = nextFoeRank(encounter, rankCap, 1);
    expect(nextBase).toBe(1);
    const { encounter: after } = resolveAt(nextBase);
    expect(after.baseRank).toBe(1);
    expect(after.rank).toBe(4);
  });

  it('three UPs then three DOWNs return to base 0 (round trip)', () => {
    let base = 0;
    for (let i = 0; i < 3; i += 1) {
      const { encounter, rankCap } = resolveAt(base);
      base = nextFoeRank(encounter, rankCap, 1);
    }
    expect(base).toBe(3);
    for (let i = 0; i < 3; i += 1) {
      const { encounter, rankCap } = resolveAt(base);
      base = nextFoeRank(encounter, rankCap, -1);
    }
    expect(base).toBe(0);
    const { encounter: final } = resolveAt(base);
    expect(final.rank).toBe(3);
  });

  it('is the identity clamp at level 1 (no growth): base and resolved rank never diverge', () => {
    const encounter = buildEnemyEncounter(ENEMY_ID, 1, 'normal', 2);
    const rankCap = maxRankFor(encounter.setup.pieces.length);
    expect(encounter.baseRank).toBe(encounter.rank);
    const downBase = nextFoeRank(encounter, rankCap, -1);
    expect(downBase).toBe(1);
  });

  it('a caller cannot pass the resolved rank where the encounter belongs — TYPE proof, not convention', () => {
    // This is the actual verification for review Important #1: the OLD bug
    // was `nextFoeRank(encounter.rank, rankCap, d)` (a bare number). With the
    // new signature that argument is a type error, so the assertion here is
    // just that `nextFoeRank` requires an object carrying `.baseRank` — a
    // `number` (which is what `encounter.rank` is) cannot structurally match.
    const { encounter } = resolveAt(0);
    // @ts-expect-error — encounter.rank is a bare number, not `{ baseRank }`.
    expect(() => nextFoeRank(encounter.rank, 6, 1)).not.toThrow();
  });
});

/**
 * `rankStepperLabel` — the sandbox RANK stepper's ONE label rule (shared by
 * both Prep scenes). Priority: custom deck > forced tier > growth pinning
 * the display at its cap > plain "MAX". `giant_rat` (cap 6, no authored
 * growth list — pure tier growth) walks the WHOLE base range at a level
 * where growth alone already exceeds the cap (LV12, growthStepsAt=6=cap):
 * the fix-round review measured this as "0/6 visible, no label at all" on
 * mobile; this pins the label existing and shrinking to 0 exactly once the
 * base itself reaches the cap (at which point every point is genuinely the
 * player's own, so the plain MAX label is honest again).
 */
describe('game/demoState: rankStepperLabel (sandbox RANK stepper label)', () => {
  it('custom deck wins over everything else', () => {
    expect(rankStepperLabel(6, true, 'DIAMOND', 3)).toBe('RANK · CUSTOM DECK');
  });

  it('a forcing modifier wins over growth pinning', () => {
    expect(rankStepperLabel(6, false, 'DIAMOND', 3)).toBe('RANK · MAXED BY DIAMOND');
  });

  it('growth pinning the display at the cap is labeled with how much growth owns', () => {
    expect(rankStepperLabel(6, false, undefined, 3)).toBe('RANK · GROWN +3 · MAX 6');
  });

  it('no pinning: the plain MAX label', () => {
    expect(rankStepperLabel(6, false, undefined, 0)).toBe('RANK · MAX 6');
  });

  it('LV12 giant_rat: growth alone (6) equals the cap (6) at every base — fully pinned, honest at each step', () => {
    const rankCap = maxRankFor(buildEnemyEncounter('giant_rat', 12, 'normal', 0).setup.pieces.length);
    expect(rankCap).toBe(6);
    const labels: string[] = [];
    for (let base = 0; base <= rankCap; base += 1) {
      const encounter = buildEnemyEncounter('giant_rat', 12, 'normal', base);
      const growthPinnedSteps = encounter.rank >= rankCap ? Math.max(0, encounter.rank - encounter.baseRank) : 0;
      labels.push(rankStepperLabel(rankCap, false, undefined, growthPinnedSteps));
    }
    expect(labels).toEqual([
      'RANK · GROWN +6 · MAX 6',
      'RANK · GROWN +5 · MAX 6',
      'RANK · GROWN +4 · MAX 6',
      'RANK · GROWN +3 · MAX 6',
      'RANK · GROWN +2 · MAX 6',
      'RANK · GROWN +1 · MAX 6',
      'RANK · MAX 6', // base(6) === cap: fully the player's own, plain label
    ]);
  });
});

/**
 * Source-text regression pin (the `foeDeckEditor.test.ts:199-207` idiom):
 * both scenes' RANK stepper call site must read `nextFoeRank(encounter, ...)`
 * — passing the whole encounter, never a bare `.rank`/`.baseRank` number —
 * so a future edit that reverts to the old shape fails here even before
 * `tsc` catches it. Revert either scene's line locally to reproduce RED.
 */
describe('prep scenes: the RANK stepper write-back (source-text pin)', () => {
  const SCENES = join(process.cwd(), 'src', 'game', 'scenes');

  it('DesktopPrepScene writes foe.rank off the whole resolved encounter, not a resolved number', () => {
    const src = readFileSync(join(SCENES, 'DesktopPrepScene.ts'), 'utf8');
    expect(src).toMatch(/foe\.rank = nextFoeRank\(encounter, rankCap, d\)/);
  });

  it('MobilePrepScene writes foe.rank off the whole resolved encounter, not a resolved number', () => {
    const src = readFileSync(join(SCENES, 'MobilePrepScene.ts'), 'utf8');
    expect(src).toMatch(/foe\.rank = nextFoeRank\(encounter, rankCap, d\)/);
  });
});
