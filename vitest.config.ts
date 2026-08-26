import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // WHY 30s RATHER THAN VITEST'S 5s DEFAULT.
    //
    // This suite is built out of SWEEPS — `simulate` over 120 random configs,
    // `rollShopStock` over 21 themes x 9 depths x 200 seeds, `generateRunMap`
    // over 60 seeds to wave 30. That is the project's chosen way to prove a
    // determinism or reachability invariant, and it is the right one: a single
    // hand-picked case cannot show that an invariant HOLDS.
    //
    // A sweep that finishes in 1.5s alone can take well past 5s when the pool
    // is running it alongside seven other files, and `boundaryChecker` spawns
    // real subprocesses on top of that. So the 5s default was not measuring
    // "is this test slow" — it was measuring "how loaded was the machine",
    // which is not a property of the code under test.
    //
    // The cost of getting this wrong is not a slow suite, it is a suite that
    // LIES. On 2026-08-26 three tests — `attrition`'s byte-identical guard,
    // `enemyDepthGating`'s orphan check, and `boundaryChecker` — failed under
    // load and passed in isolation, and the attrition one reads as a broken
    // determinism invariant, the single most alarming failure this engine can
    // produce. It cost several diagnosis cycles and a false report before
    // being identified as a timeout.
    //
    // 30s is deliberately far above the slowest real sweep (~8s under load) so
    // that a timeout means a HANG, not a queue. A test that genuinely needs
    // longer should say so at its own call site, where the reason is visible.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
