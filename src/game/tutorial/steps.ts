import type { TutorialStepDef } from './types';

/**
 * The three-lesson tutorial (docs/run-tutorial-design.md), as flat atomic
 * "beats" — each is its own step id so `RunState.tutorialSeen` tracks (and
 * `npm test` can assert) "fires at most once" per beat, not per lesson.
 * Order here is presentation order within a moment (see `controller.ts`'s
 * `notifyAll`, which returns matches in this array's order).
 *
 * Every `body` reads its payload (live values the calling scene already
 * computed from the served battle log / RunState) — it never recomputes
 * combat math or PL costs itself.
 */
export const TUTORIAL_STEPS: readonly TutorialStepDef[] = [
  // ---- Lesson 1: stats -> damage --------------------------------------
  {
    id: 'stats_damage_1',
    moment: 'battle:hit',
    anchor: 'hitRow',
    title: 'STATS -> DAMAGE',
    body: (p) => {
      const amount = typeof p.amount === 'number' ? p.amount : undefined;
      const lead = amount !== undefined ? `That ${amount} damage` : 'This hit';
      return `${lead} scaled off ATK or MAG, minus the target's DEF or RES — true damage skips both. `
        + 'Tap any HIT row any time to see the D: math behind it.';
    },
  },
  {
    id: 'stats_damage_2',
    moment: 'battle:hitMatchup',
    anchor: 'hitRow',
    title: 'MATCHUPS',
    when: (p) => p.hasMatchup === true,
    body: () => 'This hit had an element/weapon matchup — favorable matchups deal +50% damage, '
      + 'unfavorable ones only −25%. The AFFINITY line in its D: math is that swing.',
  },
  // ---- Lesson 2: Speed -> who acts -------------------------------------
  {
    id: 'speed_turnline',
    moment: 'battle:turnline',
    anchor: 'turnline',
    title: 'SPEED -> WHO ACTS',
    body: (p) => {
      const spanNote = p.hasSpan === true
        ? ' A multi-slot card busies its caster for the rest of its span (see the n/N marker) — heavy cards cost you turns.'
        : ' A size-N card busies its caster N−1 further turns — heavy cards cost you turns.';
      return 'Every turn: score = banked Speed + Speed − the queued card\'s weight. Higher score acts; '
        + `the loser banks its Speed for next turn.${spanNote} High Speed acts more often.`;
    },
  },
  // ---- Lesson 3: PL growth ---------------------------------------------
  {
    id: 'pl_levelup',
    moment: 'battle:levelUp',
    anchor: 'levelUpLine',
    title: 'PL GROWTH',
    body: () => '+1 level = 3 PL to spend on your stats. You bank PL every fight, win or lose.',
  },
  {
    id: 'pl_badge',
    moment: 'runmap:plBadge',
    anchor: 'plBadge',
    title: 'BANKED PL',
    body: (p) => {
      const banked = typeof p.banked === 'number' ? p.banked : undefined;
      const lead = banked !== undefined ? `You have ${banked} PL banked` : 'PL banked here';
      return `${lead} — tap this badge any time between fights to open the allocation panel and spend it.`;
    },
  },
  {
    id: 'pl_grid',
    moment: 'runmap:statPanelOpen',
    anchor: 'statGrid',
    title: 'PRICED STATS',
    body: () => 'Each stat costs PL to buy — SPD costs more than the rest, because Speed buys you turns.',
  },
  {
    id: 'pl_cardcost',
    moment: 'runmap:statPanelOpen',
    anchor: 'plSpentLine',
    title: 'ONE CURRENCY',
    body: () => 'Cards cost PL too, under the same priced economy — PL is the one currency for power. '
      + 'Gold only buys you access to a shelf.',
  },
];

/** Lookup by id — used by the determinism/registry tests and the controller. */
export const TUTORIAL_STEP_BY_ID: Readonly<Record<string, TutorialStepDef>> =
  Object.fromEntries(TUTORIAL_STEPS.map((s) => [s.id, s]));
