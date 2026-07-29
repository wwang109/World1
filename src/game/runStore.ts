import { enemies } from '../data/enemies';
import type { EventDef } from '../data/events';
import type { DraftCard, DraftSetKey } from '../run/draft';
import type { EncounterUnit } from '../run/encounter';
import { applyBonusDraftPick, resolveEventChoice, rollEventForNode, type EventOutcome } from '../run/events';
import { bankedPL, type Allocation, type LevelStat } from '../run/leveling';
import { battleGoldReward, type BattleFoeSummary } from '../run/shop';
import type { BattleLog } from '../run/resolveBattle';
import type { BattleTimelineInput } from './battleTimeline';
import {
  applyDraftResult,
  availableChoices,
  buyHeroStatAllocation,
  buyRunCard,
  buyRunGem,
  chooseNode,
  createRun,
  ensureRunShopShelf,
  isTutorialSkipped,
  leaveEvent,
  leaveShop,
  markTutorialSkipped,
  recordBattleResult,
  rerollRunShop,
  WAVE_COUNT,
  rollEncounter,
  runBagHasRoomFor,
  type RunNode,
  type RunNodeKind,
  type RunShopShelf,
  type RunState,
} from '../run/runState';
import { notifyTutorial } from './tutorial/controller';
import { TUTORIAL_STEPS } from './tutorial/steps';
import type { TutorialMoment, TutorialStepDef } from './tutorial/types';

/**
 * Run store — the Run Mode counterpart of `demoState`: a module-level
 * `RunState | null` plus thin actions that call the pure `src/run/runState`
 * (+ `src/run/draft`) functions and replace the stored state. Scenes read/
 * write ONLY through this module. No logic beyond delegation — every
 * decision (map shape, encounter rolls, gold math) lives in `src/run`.
 */

let activeRun: RunState | null = null;

/** The one active run, or null if none has been started yet this session. */
export function getActiveRun(): RunState | null {
  return activeRun;
}

/**
 * Cosmetic pre-run seed shown on the START RUN panel's seed box — same
 * "mash the sine wave" reroll idiom as `demoState.seed`'s REROLL button
 * (see DesktopPrepScene/MobilePrepScene). Not part of `RunState`; it only
 * exists to let the player preview/reroll a seed before committing to it.
 */
let pendingSeed = 1;

export function getPendingSeed(): number {
  return pendingSeed;
}

export function rerollPendingSeed(): void {
  pendingSeed = 1 + Math.floor(Math.abs(Math.sin(pendingSeed * 97.13)) * 999999);
}

/**
 * `?tutorial=off|reset` dev/QA launch flag (see `devLaunch.ts`'s
 * `readDevLaunchConfig`) — applied the next time (and every time) a run
 * starts this session. `'off'` pre-skips the tutorial for QA runs that don't
 * want it; `'reset'` is a no-op today (a fresh run already starts unskipped/
 * unseen — there is no `src/meta` persistence yet to actually reset), kept as
 * an explicit flag so it's a stable no-op rather than an unknown value.
 */
let pendingTutorialFlag: 'off' | 'reset' | undefined;

export function setPendingTutorialFlag(flag: 'off' | 'reset' | undefined): void {
  pendingTutorialFlag = flag;
}

/**
 * Start a brand-new run at `seed` — status lands in `'drafting'`; the RUN MAP
 * scene routes straight to the Draft scenes (in run context) instead of
 * surfacing any node choices until `applyRunDraft` installs the real picks.
 */
export function startRun(seed: number): void {
  let run = createRun(seed);
  if (pendingTutorialFlag === 'off') run = markTutorialSkipped(run);
  activeRun = run;
}

/** Installs the player's actual draft picks (one per `DRAFT_SET_KEYS` set)
 * into the active run and moves it to `'active'`. The Draft scenes' START
 * button calls this INSTEAD of `applyDraftPicks`(demoState) when launched in
 * run context (an active run sitting in `'drafting'` status). */
export function applyRunDraft(picks: Partial<Record<DraftSetKey, string>>): void {
  if (!activeRun) return;
  activeRun = applyDraftResult(activeRun, picks);
}

/** Whether the active run is still waiting on its start-of-run draft — the
 * Draft scenes use this to decide which context (Sandbox vs. Run) they're
 * rendering in. */
export function isRunDrafting(): boolean {
  return activeRun?.status === 'drafting';
}

/** Abandon the active run entirely (returns to the START RUN panel). */
export function clearRun(): void {
  activeRun = null;
}

/** The 2-3 nodes the player may pick next (empty if no run, run over, or a
 * node is already being resolved). Thin wrapper over `availableChoices`. */
export function choices(): readonly RunNode[] {
  return activeRun ? availableChoices(activeRun) : [];
}

/** The node the map's `currentNodeId` currently points at, if any — used by
 * the stub confirm panel to know what kind (fight/elite/shop/boss) and which
 * enemy/shop it is. Read-only lookup over `activeRun.map`, no decisions. */
export function currentNode(): RunNode | undefined {
  if (!activeRun || activeRun.currentNodeId === null) return undefined;
  for (const column of activeRun.map.depths) {
    for (const node of column) {
      if (node.id === activeRun.currentNodeId) return node;
    }
  }
  return undefined;
}

/**
 * Commit to one of `choices()`. Thin wrapper over `chooseNode` — the caller
 * (the Run Map scene) routes to the RunEvent/Shop/RunPrep scene by the
 * chosen node's `kind` right after calling this.
 */
export function pickNode(nodeId: string): void {
  if (!activeRun) return;
  activeRun = chooseNode(activeRun, nodeId);
}

/**
 * Preview the encounter a NOT-YET-CHOSEN fight/boss node would roll, without
 * committing to it — `rollEncounter` requires the node to already be
 * `currentNodeId`, so this composes it against a throwaway copy of the run
 * state. Used by the map's fight-node preview line (enemy name/LV/title).
 * Returns null for shop/event nodes (no encounter to preview).
 */
export function previewEncounter(node: RunNode): EncounterUnit | null {
  if (!activeRun || (node.kind !== 'fight' && node.kind !== 'boss')) return null;
  return rollEncounter({ ...activeRun, currentNodeId: node.id });
}

/** Display name for an enemy id (falls back to the raw id if unknown). */
export function enemyNameFor(enemyId: string): string {
  return enemies[enemyId]?.name ?? enemyId;
}

/** The already-rolled encounter for the CURRENT combat node (must already be
 * committed via `pickNode`) — RunPrepScene's read-only foe preview. Undefined
 * if there's no active run, no current node, or the current node isn't a
 * fight/boss. */
export function currentEncounter(): EncounterUnit | undefined {
  const node = currentNode();
  if (!activeRun || !node || (node.kind !== 'fight' && node.kind !== 'boss')) return undefined;
  return rollEncounter(activeRun);
}

// ---------------------------------------------------------------------------
// Battle resolution — the Run Mode counterpart of `battleGold.ts`'s
// `creditBattleGold`, but settling through `recordBattleResult` (gold + wins/
// losses/hero level + the boss-ends-the-run transition) instead of a bare
// gold mutation. Loss rule: base pays nothing in Run Mode (`recordBattleResult`
// already zeroes it) — this deliberately differs from the Sandbox, where
// `creditBattleGold` pays `base` on a loss too.
// ---------------------------------------------------------------------------

/** Settles the active run's current combat node from a fetched `BattleLog`:
 * computes `battleGoldReward` from the EXACT foe config the request was built
 * from + the run's hero level, then calls `recordBattleResult` (win -> base +
 * winBonus, loss -> 0). Returns the gold payout for the banner to display.
 * Callers own the "exactly once per fetched response" guard (same idiom as
 * `creditBattleGold`). No-op (returns 0) if there's no active run. */
export function resolveRunBattleResult(input: BattleTimelineInput, log: BattleLog): number {
  if (!activeRun) return 0;
  const foes: BattleFoeSummary[] = (input.enemyTeam && input.enemyTeam.length > 0
    ? input.enemyTeam
    : [{
      enemyId: input.enemyId, level: input.enemyLevel, title: input.enemyTitle,
      rank: input.enemyRank, modifiers: input.enemyModifiers ?? [],
    }]
  ).map((f) => ({ level: f.level, title: f.title, rank: f.rank, modifiers: f.modifiers }));
  const reward = battleGoldReward(foes, activeRun.heroLevel);
  const won = log.result === 'win';
  const payout = won ? reward.base + reward.winBonus : 0;
  activeRun = recordBattleResult(activeRun, { won, goldEarned: payout });
  return payout;
}

// ---------------------------------------------------------------------------
// Shop-node wiring — thin wrappers over the pure `src/run/runState` shop
// functions, keyed by the CURRENT node's id (a shop node's shelf/reroll
// history lives on that specific node, not its theme).
// ---------------------------------------------------------------------------

/** Rolls the current shop node's shelf into the run the first time it's
 * browsed (idempotent). No-op if there's no active shop node. */
export function ensureCurrentShopShelf(): void {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return;
  activeRun = ensureRunShopShelf(activeRun, node.id);
}

/** The current shop node's persisted shelf, or undefined before it's rolled. */
export function currentShopShelf(): RunShopShelf | undefined {
  const node = currentNode();
  return activeRun && node ? activeRun.shopShelves[node.id] : undefined;
}

/** REROLL on the current shop node — costs 1 gold, no-ops if unaffordable. */
export function rerollCurrentShop(): void {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return;
  activeRun = rerollRunShop(activeRun, node.id);
}

export type ShopBuyResult = { ok: true } | { ok: false; reason: 'gold' | 'bag' | 'gone' };

/** Buys the card offer at `index` on the current shop node's shelf. */
export function buyCurrentShopCard(index: number): ShopBuyResult {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return { ok: false, reason: 'gone' };
  const result = buyRunCard(activeRun, node.id, index);
  if (result.ok) { activeRun = result.state; return { ok: true }; }
  return { ok: false, reason: result.reason };
}

/** Buys the gem offer at `index` on the current shop node's shelf. */
export function buyCurrentShopGem(index: number): ShopBuyResult {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return { ok: false, reason: 'gone' };
  const result = buyRunGem(activeRun, node.id, index);
  if (result.ok) { activeRun = result.state; return { ok: true }; }
  return { ok: false, reason: result.reason };
}

/** Whether the run's bag currently has room for a card of this skill. */
export function currentRunBagHasRoomFor(skillId: string): boolean {
  return activeRun ? runBagHasRoomFor(activeRun, skillId) : false;
}

/** Leave the current shop node with no win/loss to resolve — the shop
 * scene's LEAVE SHOP button. */
export function leaveCurrentShop(): void {
  if (!activeRun) return;
  activeRun = leaveShop(activeRun);
}

// ---------------------------------------------------------------------------
// Event-node wiring — thin wrappers over the pure `src/run/events` resolver,
// keyed by whatever node is CURRENT (an event node's drawn-event id lives on
// `activeRun.eventInstances`, populated idempotently by `rollEventForNode`).
// ---------------------------------------------------------------------------

/** The event def for the current event node — draws it (idempotently) into
 * the run the first time it's browsed. Undefined off an event node. */
export function currentEventDef(): EventDef | undefined {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'event') return undefined;
  const { state, event } = rollEventForNode(activeRun, node);
  activeRun = state;
  return event;
}

/** Resolves a choice on the current event node: deducts cost, rolls any
 * gamble, applies the outcome. Undefined if there's no active event node. */
export function resolveCurrentEventChoice(eventId: string, choiceId: string): EventOutcome | undefined {
  if (!activeRun) return undefined;
  const { state, outcome } = resolveEventChoice(activeRun, eventId, choiceId);
  activeRun = state;
  return outcome;
}

/** Finalizes a `bonusDraft` outcome's deferred pick (the picker overlay). */
export function applyCurrentBonusDraftPick(pick: DraftCard): EventOutcome | undefined {
  if (!activeRun) return undefined;
  const { state, outcome } = applyBonusDraftPick(activeRun, pick);
  activeRun = state;
  return outcome;
}

/** Leave the current event node with its choice already resolved — the
 * event scene's CONTINUE › button. */
export function leaveCurrentEvent(): void {
  if (!activeRun) return;
  activeRun = leaveEvent(activeRun);
}

// ---------------------------------------------------------------------------
// Hero PL-budget stat allocation — reachable from the Run Map AND Run Prep
// (see docs/release-game-plan.md "Hero leveling & stat allocation"). Additive
// -only within a run; no sell/respec wrapper exists here on purpose.
// ---------------------------------------------------------------------------

/** The run's current hero level, or 1 if there's no active run. */
export function currentHeroLevel(): number {
  return activeRun?.heroLevel ?? 1;
}

/** The run's current hero PL allocation (buy counts per stat). */
export function currentHeroAllocation(): Allocation {
  return activeRun?.heroAllocation ?? {};
}

/** PL banked (earned but unspent) at the run's current hero level. Drives the
 * "n PL TO SPEND" badge on the Run Map/Run Prep headers. */
export function currentBankedPL(): number {
  return activeRun ? bankedPL(activeRun.heroLevel, activeRun.heroAllocation) : 0;
}

/** Spend one buy of `stat` from the run's banked PL. No-op if unaffordable
 * or there's no active run — see `buyHeroStatAllocation`. */
export function buyCurrentHeroStat(stat: LevelStat): void {
  if (!activeRun) return;
  activeRun = buyHeroStatAllocation(activeRun, stat);
}

// ---------------------------------------------------------------------------
// Run tutorial — thin wrapper over `src/run/runState`'s pure tutorial
// helpers + `tutorial/controller.ts`'s pure `notifyTutorial`, keyed to the
// active run exactly like every other action in this module. Scenes never
// touch `RunState.tutorialSeen`/`tutorialSkipped` directly. Callers (battle
// scenes) are responsible for only invoking `notifyTutorialMoment` while
// `getBattleContext() === 'run'` (checked at the call site, not here, to
// avoid an import cycle with `battleContext.ts`, which already imports this
// module) — the tutorial must never arm in the Sandbox.
// ---------------------------------------------------------------------------

/** Fires a tutorial moment for the active run: returns the (possibly empty)
 * steps that just armed, each ALREADY marked seen (see `notifyTutorial`).
 * No-op (returns `[]`) with no active run. */
export function notifyTutorialMoment(moment: TutorialMoment, payload: Record<string, unknown> = {}): TutorialStepDef[] {
  if (!activeRun) return [];
  const { state, steps } = notifyTutorial(activeRun, moment, payload);
  activeRun = state;
  return steps;
}

/** SKIP TUTORIAL — remembered for the rest of the run. No-op with no active run. */
export function skipTutorial(): void {
  if (!activeRun) return;
  activeRun = markTutorialSkipped(activeRun);
}

/** Whether the Run Map's "TUTORIAL: ON · skip" entry chip should show: an
 * active run that hasn't skipped and still has at least one step left to
 * show. Never gates anything else — just a visibility check for the chip. */
export function tutorialChipVisible(): boolean {
  if (!activeRun || isTutorialSkipped(activeRun)) return false;
  return (activeRun.tutorialSeen ?? []).length < TUTORIAL_STEPS.length;
}

export { WAVE_COUNT };
export type { RunNode, RunNodeKind, RunState };
