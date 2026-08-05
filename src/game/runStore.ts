import { enemies } from '../data/enemies';
import type { EventDef } from '../data/events';
import type { DraftCard, DraftSetKey } from '../run/draft';
import type { EncounterPack } from '../run/encounter';
import { applyBonusDraftPick, resolveEventChoice, rollEventForNode, type EventOutcome } from '../run/events';
import { bankedPL, type Allocation } from '../run/leveling';
import { battleStatsFromEvents } from '../run/logAnalysis';
import { battleGoldReward, type BattleFoeSummary } from '../run/shop';
import type { BattleLog } from '../run/resolveBattle';
import { noteRunEnded, noteRunStarted } from './metaStore';
import type { BattleTimelineInput } from './battleTimeline';
import {
  applyDraftResult,
  availableChoices,
  buyRunCard,
  buyRunGem,
  chooseNode,
  createRun,
  ensureRunShopShelf,
  heroAllocationCost,
  leaveEvent,
  leaveShop,
  mergeRunCard,
  recordBattleResult,
  rerollRunShop,
  retireRun,
  runMergeTargetFor,
  setHeroAllocation,
  WAVE_COUNT,
  rollEncounter,
  runBagHasRoomFor,
  type MergeTarget,
  type RunBagSlot,
  type RunBoardPiece,
  type RunNode,
  type RunNodeKind,
  type RunShopShelf,
  type RunState,
} from '../run/runState';

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
// Session-random initial roll (Math.random is fine HERE — src/game glue; the
// engine stays pure because the seed only ever enters the sim as plain data).
// Without this, every fresh page load drafted the identical seed-1 run.
let pendingSeed = 1 + Math.floor(Math.random() * 999999);

export function getPendingSeed(): number {
  return pendingSeed;
}

export function rerollPendingSeed(): void {
  pendingSeed = 1 + Math.floor(Math.abs(Math.sin(pendingSeed * 97.13)) * 999999);
}

/**
 * Start a brand-new run at `seed` — status lands in `'drafting'`; the RUN MAP
 * scene routes straight to the Draft scenes (in run context) instead of
 * surfacing any node choices until `applyRunDraft` installs the real picks.
 */
export function startRun(seed: number): void {
  activeRun = createRun(seed);
  noteRunStarted();
  // Consume-and-refresh: the NEXT run's pending seed differs even when the
  // player never touches the reroll button (StartScene commits directly).
  rerollPendingSeed();
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

/** Voluntarily end the active run right now — the HUD's RETIRE action (see
 * `renderRetireConfirm`). No-op if there's no active run, or it isn't
 * `'active'` (mirrors `retireRun`'s own no-op idiom). Every run screen routes
 * to the Run Map after calling this so the map's end-summary banner (status
 * `'retired'`) takes over. */
export function retireActiveRun(): void {
  if (!activeRun) return;
  const before = activeRun;
  activeRun = retireRun(activeRun);
  if (activeRun !== before) noteRunEnded(activeRun);
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
 * state. Used by the map's fight-node preview line (pack shape/enemy name/
 * LV/title). Returns null for shop/event nodes (no encounter to preview).
 *
 * PACK FIGHTS: the returned `EncounterPack.units` is 1-3 entries (see
 * `rollEncounter` in `src/run/runState.ts`) — this is deliberately the SAME
 * call `battleContext.ts#runBattleInput` makes for the committed node, so a
 * pack's map preview always matches the pack the FIGHT button actually
 * starts (byte-identical, same `encounterSeed`).
 */
export function previewEncounter(node: RunNode): EncounterPack | null {
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
 * fight/boss. Same `EncounterPack` shape as `previewEncounter` (1-3 units). */
export function currentEncounter(): EncounterPack | undefined {
  const node = currentNode();
  if (!activeRun || !node || (node.kind !== 'fight' && node.kind !== 'boss')) return undefined;
  return rollEncounter(activeRun);
}

/**
 * The map choice panel's one-line fight/boss hint — shared by both platforms'
 * run map scenes so a pack's shape reads identically on desktop and mobile.
 * Solo keeps the pre-pack grammar (`"Rogue · LV 6 · NORMAL"`); a pack leads
 * with its count instead of a title (every pack member is mob/normal — see
 * `capPackTitle` in `src/run/encounter.ts` — so a title chip would read as
 * redundant/misleading): `"PACK OF 2 · Wolf · LV 3"`, naming the FIRST
 * member as the representative foe (members can repeat/differ, but always
 * share the same discounted level).
 */
export function encounterHintDetail(pack: EncounterPack): string {
  const primary = pack.units[0]!;
  const name = enemyNameFor(primary.enemyId);
  if (pack.variant === 'solo') {
    return `${name} · LV ${primary.effectiveLevel} · ${primary.title.toUpperCase()}`;
  }
  return `PACK OF ${pack.units.length} · ${name} · LV ${primary.effectiveLevel}`;
}

/**
 * RunPrep's DESKTOP foe panel has room to list every pack member — one line
 * per DISTINCT (enemy, level) pairing, annotated `×N` when more than one
 * member shares it (members roll independently and can repeat). A solo
 * encounter returns a single-entry array (same one line the panel always
 * showed, pre-packs) so callers don't need a separate solo/pack branch just
 * to decide whether to render this list.
 */
export function packMemberLines(pack: EncounterPack): string[] {
  const counts = new Map<string, { name: string; level: number; count: number }>();
  for (const unit of pack.units) {
    const key = `${unit.enemyId}@${unit.effectiveLevel}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { name: enemyNameFor(unit.enemyId), level: unit.effectiveLevel, count: 1 });
  }
  return [...counts.values()].map((e) => (e.count > 1 ? `${e.name} · LV ${e.level} ×${e.count}` : `${e.name} · LV ${e.level}`));
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
  const battleStats = battleStatsFromEvents(log.events);
  activeRun = recordBattleResult(activeRun, { won, goldEarned: payout, ...battleStats });
  if (activeRun.status === 'defeat') noteRunEnded(activeRun);
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

export type ShopMergeResult = { ok: true } | { ok: false; reason: 'gold' | 'no-target' | 'gone' };

/** Merge target preview for a shop card offer's `skillId` — null if the
 * player owns no mergeable (non-diamond) instance of it. The BUY confirm
 * dialog calls this to decide whether to surface the MERGE choice. */
export function currentShopMergeTarget(skillId: string): MergeTarget | null {
  return activeRun ? runMergeTargetFor(activeRun, skillId) : null;
}

/** MERGE: buys the card offer at `index` on the current shop node's shelf,
 * upgrading an owned instance one tier instead of adding a copy. */
export function mergeCurrentShopCard(index: number): ShopMergeResult {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return { ok: false, reason: 'gone' };
  const result = mergeRunCard(activeRun, node.id, index);
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
// Deck/bag access between fights — lets the Deck Build scenes serve RUN
// CONTEXT (source discriminator, same idiom as Shop/Draft's `runContext`
// flag) by reading/writing `RunState.pieces`/`bagSlots`/`gemInventory`
// straight through this module instead of a forked scene. Every setter is a
// PLAIN replace (no validation) — the Deck Build scenes already own the
// placement rules via `src/run/loadout.ts`'s pure `moveWithinStrip`/
// `shiftInsert`/`socketGem`/etc., which only ever produce legal shapes; this
// module is just the run's storage slot for whatever they compute, exactly
// like `demoState`'s fields are for the Sandbox.
// ---------------------------------------------------------------------------

/** The run's current board pieces (empty array with no active run). */
export function currentRunPieces(): RunBoardPiece[] {
  return activeRun?.pieces ?? [];
}

/** Replaces the run's board pieces wholesale. No-op with no active run. */
export function setCurrentRunPieces(pieces: RunBoardPiece[]): void {
  if (!activeRun) return;
  activeRun = { ...activeRun, pieces };
}

/** The run's current bag slots (empty array with no active run). */
export function currentRunBagSlots(): RunBagSlot[] {
  return activeRun?.bagSlots ?? [];
}

/** Replaces the run's bag slots wholesale. No-op with no active run. */
export function setCurrentRunBagSlots(bagSlots: RunBagSlot[]): void {
  if (!activeRun) return;
  activeRun = { ...activeRun, bagSlots };
}

/** The run's current gem pouch (ids, may repeat). Empty with no active run. */
export function currentRunGemInventory(): string[] {
  return activeRun?.gemInventory ?? [];
}

/** Replaces the run's gem pouch wholesale. No-op with no active run. */
export function setCurrentRunGemInventory(gemInventory: string[]): void {
  if (!activeRun) return;
  activeRun = { ...activeRun, gemInventory };
}

// ---------------------------------------------------------------------------
// Hero PL-budget stat allocation — reachable from the Run Map AND Run Prep
// (see docs/release-game-plan.md "Hero leveling & stat allocation"). The
// player edits a SCRATCH allocation locally (`RunStatPanel.ts`) and commits it
// wholesale via `commitHeroAllocation` — no partial writes to `RunState`
// happen before CONFIRM.
// ---------------------------------------------------------------------------

/** The run's current hero level, or 1 if there's no active run. */
export function currentHeroLevel(): number {
  return activeRun?.heroLevel ?? 1;
}

/** The run's current COMMITTED hero PL allocation (buy counts per stat) — the
 * stat panel seeds its scratch edit from this. */
export function currentHeroAllocation(): Allocation {
  return activeRun?.heroAllocation ?? {};
}

/** PL banked (earned but unspent) at the run's current hero level. Drives the
 * "n PL TO SPEND" badge on the Run Map/Run Prep headers. */
export function currentBankedPL(): number {
  return activeRun ? bankedPL(activeRun.heroLevel, activeRun.heroAllocation) : 0;
}

/** PL a (possibly scratch, uncommitted) allocation would spend — pure
 * pricing read, thin wrapper over `runState.ts#heroAllocationCost`, so the
 * stat panel never imports `src/run` directly. */
export function heroAllocationScratchCost(alloc: Allocation): number {
  return heroAllocationCost(alloc);
}

/** Commits a whole scratch `Allocation` (replaces the run's allocation
 * wholesale) — the stat panel's CONFIRM button. No-op (silently rejects,
 * mirroring `setHeroAllocation`) if it overspends the run's banked PL or if
 * there's no active run. */
export function commitHeroAllocation(next: Allocation): void {
  if (!activeRun) return;
  activeRun = setHeroAllocation(activeRun, next);
}

export { WAVE_COUNT };
export type { RunBagSlot, RunBoardPiece, RunNode, RunNodeKind, RunState };
