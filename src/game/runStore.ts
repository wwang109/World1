import { enemies } from '../data/enemies';
import type { EventDef } from '../data/events';
import { isEventDefV3 } from '../data/eventContentV3';
import { eventDefAtVersion, type LoadedEventDef } from '../data/eventsContent';
import type { DraftCard, DraftSetKey, StartDraft } from '../run/draft';
import type { EncounterPack } from '../run/encounter';
import { applyBonusDraftPick, applyGemChoicePick, applyMergeCardsPick, applySellGemPick, applyUpgradeCardPick, chooseNodeWithEventOpportunities, currentEventResolution as eventResolutionOf, reopenEventChoice, resolveEventChoice, rollEventForNode, type EventOutcome, type MergeCardsReceipt } from '../run/events';
import {
  correlatedMaterializedChoiceV3,
  eventOutcomeForPendingOfferV3,
  finalizeBonusDraftV3,
  finalizeEventCardChoiceV3,
  finalizeGemChoiceV3,
  finalizeMergeCardsV3,
  finalizeSellGemV3,
  finalizeTargetedUpgradeV3,
  finalizeUpgradeCardV3,
  materializeReachedEventV3,
  reopenEventChoiceV3,
  resolveEventChoiceV3,
  type EventOutcomeV3,
} from '../run/eventsV3';
import type { EventDefinitionLookup } from '../run/eventCallbacks';
import { previewEventForNode } from '../run/eventPreview';
import { bankedPL, type Allocation } from '../run/leveling';
import { battleStatsFromEvents } from '../run/logAnalysis';
import { mapIntelRecords } from '../run/eventMapInfo';
import { biomeFor } from '../run/biome';
import { battleFactFromLog } from '../run/eventV3Facts';
import { battleGoldReward, type BattleFoeSummary } from '../run/shop';
import type { BattleLog } from '../run/resolveBattle';
import { noteRunEnded, noteRunStarted } from './metaStore';
import {
  clearRun as clearRunSave,
  loadRun as loadRunSave,
  saveRun as saveRunSave,
  type StorageDriver,
} from '../meta/runSave';
import type { BattleTimelineInput } from './battleTimeline';
import { buildRunEventViewModel, type RunEventViewModel } from './ui/runEventViewModel';
export { encounterHintDetail, FIGHT_TIER_LABEL } from './ui/runTravelChoiceViewModel';
import {
  applyStartDraft,
  currentStartDraft,
  pickStartDraftCard,
  rerollStartDraft,
  startDraftPicks,
  availableChoices,
  buyRunCard,
  buyRunCardTo,
  buyRunGem,
  createRun,
  ensureRunShopShelf,
  heroAllocationCost,
  leaveEvent,
  leaveShop,
  mergeRunCard,
  recordBattleResult,
  rerollCostForNode,
  rerollRunShop,
  retireRun,
  runMergeTargetFor,
  sellRunCard,
  sellRunGem,
  setHeroAllocation,
  WAVE_COUNT,
  rollEncounter,
  runBagHasRoomFor,
  type BuyDestination,
  type MergeTarget,
  type RunBagSlot,
  type RunBoardPiece,
  type RunCard,
  type RunNode,
  type RunNodeKind,
  type EventResolution,
  type RunShopShelf,
  type RunState,
} from '../run/runState';

/**
 * Run store — the Run Mode counterpart of `demoState`: a module-level
 * `RunState | null` plus thin actions that call the pure `src/run/runState`
 * (+ `src/run/draft`) functions and replace the stored state. Scenes read/
 * write ONLY through this module. No logic beyond delegation — every
 * decision (map shape, encounter rolls, gold math) lives in `src/run`.
 *
 * PERSISTENCE (`src/meta/runSave.ts`): every write to `activeRun` funnels
 * through `setActiveRun` below — the ONE place this module hands a new
 * `RunState` to `src/meta`'s save (or clears it) — so there is no separate
 * "remember to persist" step at each of the ~25 call sites that used to
 * assign `activeRun` directly. Reads (`getActiveRun`, `currentNode`, etc.)
 * are untouched; only the write path changed shape.
 */

/** `StorageDriver` backed by the real browser `localStorage` — same
 * catch-and-report idiom as `metaStore.ts`'s driver (never throws; `set`
 * reports `false` on quota-exceeded/private-mode/unavailable storage so a
 * failed save is surfaced, not silently pretended). Kept local rather than
 * shared with `metaStore.ts` — trivial (~10 lines), and keeps this module's
 * only `src/meta` dependency the pure `runSave` functions, not another
 * `src/game` module's private plumbing. */
const localStorageDriver: StorageDriver = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false; // quota exceeded / private mode / no localStorage
    }
  },
};

/** Hydrate from whatever was persisted the LAST time this browser had a run
 * in progress — runs at module load (import time), which for the Phaser
 * bundle is before any scene's `create()` fires, so `StartScene`'s
 * "RESUME RUN ›" vs. "START RUN ›" choice (driven by `getActiveRun()`) and
 * every other scene's read of the active run are correct from the very first
 * frame, including after a hard page refresh. `loadRun` never throws and
 * returns `null` for "nothing to resume" (never-saved, cleared, corrupt, or
 * a newer-schema blob) — this line is always safe to run unconditionally. */
let activeRun: RunState | null = loadRunSave(localStorageDriver);

/** Development event fixtures are a browser-audit surface, never a
 * resumable player run. While one is installed, every subsequent store
 * update stays in memory too, so merely looking up or resolving the fixture
 * cannot overwrite either an empty save slot or a legitimate saved run. */
let activeRunIsEphemeralDevFixture = false;

/** The single write funnel for `activeRun`: every action in this module that
 * used to assign `activeRun = ...` directly now calls this instead, so the
 * persistence hook lives in exactly one place. `null` means "no active run"
 * (a fresh module load, or an explicit `clearRun()`) and persists via
 * `clearRunSave` (writes the explicit "cleared" marker) rather than
 * `saveRunSave`, which only ever accepts a real `RunState`. A failed save is
 * logged, not thrown — gameplay must never block on a storage write. */
function setActiveRun(next: RunState | null): void {
  activeRun = next;
  if (activeRunIsEphemeralDevFixture) return;
  if (next === null) {
    clearRunSave(localStorageDriver);
    return;
  }
  const outcome = saveRunSave(localStorageDriver, next);
  if (!outcome.ok) {
    // eslint-disable-next-line no-console -- best-effort dev/user visibility; non-fatal by design.
    console.warn(`run not saved (${outcome.reason}) — a page refresh will not be able to resume it`);
  }
}

/** The one active run, or null if none has been started yet this session. */
export function getActiveRun(): RunState | null {
  return activeRun;
}

/** The player's already-persisted map-intel snapshots, in display order.
 * This is deliberately a read of Task 6's records only: UI code never
 * reforecasts a band or derives an alternate run state while drawing it. */
export function currentMapIntel() {
  return activeRun ? mapIntelRecords(activeRun) : [];
}

/** Install a complete development-launch fixture before a run scene starts.
 * The Vite production build compiles this guard false; player-facing scenes
 * never construct fixture state or choose event content themselves. */
export function installDevRunFixture(state: RunState): void {
  if (!import.meta.env.DEV) return;
  activeRunIsEphemeralDevFixture = true;
  activeRun = state;
}

/**
 * Whether a run is currently IN PROGRESS — drafting or fighting, not a
 * finished (`defeat`/`retired`/`victory`) run still parked for its end
 * banner. This is the signal for SANDBOX surfaces that show run-adjacent
 * facts to a player who merely stepped out to the menus mid-run: the wiki's
 * GEMS tab reads the pouch through this (a66eca4 — its unconditional
 * `demoState.gemInventory` read showed "0 IN POUCH" while the run pouch held
 * three, feeding the "my gems vanished" misread). Deliberately narrower than
 * `getActiveRun() !== null` (which also covers ended-but-uncleared runs,
 * where the Sandbox is the player's context again) and unrelated to
 * `deckBuildContext` (which is a per-visit routing flag the wiki never sets).
 */
export function isRunInProgress(): boolean {
  return activeRun !== null && (activeRun.status === 'drafting' || activeRun.status === 'active');
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
  activeRunIsEphemeralDevFixture = false;
  setActiveRun(createRun(seed));
  noteRunStarted();
  // Consume-and-refresh: the NEXT run's pending seed differs even when the
  // player never touches the reroll button (StartScene commits directly).
  rerollPendingSeed();
}

/**
 * THE HAND THE RUN DRAFT IS OFFERING — `rollStartDraftAt(seed, rerolls)` for
 * the active run, or `null` with no run. The draft scenes call this in
 * `create()` INSTEAD of rolling it themselves off a stride literal, so a
 * reroll the player made is still on screen when they come back: `init()`
 * rebuilds a scene from nothing, and the only thing that can remember the
 * reroll is the run (see `RunState.draft`).
 */
export function currentStartDraftHand(): StartDraft | null {
  return activeRun ? currentStartDraft(activeRun) : null;
}

/** The run's recorded draft picks, already filtered against the hand above
 * (`startDraftPicks`) — never a pick the current roll does not offer. Empty
 * with no active run. */
export function currentStartDraftPicks(): Partial<Record<DraftSetKey, string>> {
  return activeRun ? startDraftPicks(activeRun) : {};
}

/** REROLL: next offer, picks cleared, ONE persisted write (`rerollStartDraft`
 * owns that rule). No-op unless a run is actually drafting. */
export function rerollCurrentStartDraft(): void {
  if (!activeRun || activeRun.status !== 'drafting') return;
  setActiveRun(rerollStartDraft(activeRun));
}

/** Record one set's pick on the active run. No-op unless a run is drafting;
 * the run layer throws on a skill the current roll does not offer, so a
 * stale/duplicate tap cannot install an unoffered card. */
export function pickCurrentStartDraftCard(key: DraftSetKey, skillId: string): void {
  if (!activeRun || activeRun.status !== 'drafting') return;
  setActiveRun(pickStartDraftCard(activeRun, key, skillId));
}

/** Installs the run's OWN recorded draft picks (one per `DRAFT_SET_KEYS` set)
 * and moves it to `'active'`. The Draft scenes' START button calls this
 * INSTEAD of `applyDraftPicks`(demoState) when launched in run context (an
 * active run sitting in `'drafting'` status). Takes no picks argument on
 * purpose: the picks are run state, so a scene passing its own would be the
 * scene-field bug all over again. */
export function applyRunDraft(): void {
  if (!activeRun) return;
  setActiveRun(applyStartDraft(activeRun));
}

/** Whether the active run is still waiting on its start-of-run draft — the
 * Draft scenes use this to decide which context (Sandbox vs. Run) they're
 * rendering in. */
export function isRunDrafting(): boolean {
  return activeRun?.status === 'drafting';
}

/** Abandon the active run entirely (returns to the START RUN panel). */
export function clearRun(): void {
  setActiveRun(null);
}

/** Voluntarily end the active run right now — the HUD's RETIRE action (see
 * `renderRetireConfirm`). No-op if there's no active run, or it isn't
 * `'active'` (mirrors `retireRun`'s own no-op idiom). Every run screen routes
 * to the Run Map after calling this so the map's end-summary banner (status
 * `'retired'`) takes over. */
export function retireActiveRun(): void {
  if (!activeRun) return;
  const before = activeRun;
  setActiveRun(retireRun(activeRun));
  if (activeRun !== before && activeRun) noteRunEnded(activeRun);
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
  setActiveRun(chooseNodeWithEventOpportunities(activeRun, nodeId));
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

/** Preview an event without replacing or persisting the active run. */
export function previewRunEvent(node: RunNode): LoadedEventDef | null {
  if (!activeRun || node.kind !== 'event') return null;
  return previewEventForNode(activeRun, node);
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
  const state = activeRun;
  const node = currentNode();
  if (!node) throw new Error('resolveRunBattleResult: no combat node is currently active');
  const foes: BattleFoeSummary[] = (input.enemyTeam && input.enemyTeam.length > 0
    ? input.enemyTeam
    : [{
      enemyId: input.enemyId, level: input.enemyLevel, title: input.enemyTitle,
      rank: input.enemyRank, modifiers: input.enemyModifiers ?? [],
    }]
  ).map((f) => ({ level: f.level, title: f.title, rank: f.rank, modifiers: f.modifiers }));
  const reward = battleGoldReward(foes, state.heroLevel);
  const won = log.result === 'win';
  const payout = won ? reward.base + reward.winBonus : 0;
  const battleStats = battleStatsFromEvents(log.events);
  const enemyIds = input.enemyTeam && input.enemyTeam.length > 0
    ? input.enemyTeam.map((enemy) => enemy.enemyId)
    : [input.enemyId];
  const battleFact = battleFactFromLog({
    battleId: `battle:${node.id}`,
    nodeId: node.id,
    depth: node.depth,
    biomeId: biomeFor(state.map.seed, node.wave, node.biomeId).id,
    enemyIds,
    boss: node.kind === 'boss',
    ...(log.playerAffinityId === undefined ? {} : { affinityId: log.playerAffinityId }),
  }, log);
  setActiveRun(recordBattleResult(state, { won, goldEarned: payout, ...battleStats, battleFact }));
  if (activeRun && activeRun.status === 'defeat') noteRunEnded(activeRun);
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
  setActiveRun(ensureRunShopShelf(activeRun, node.id));
}

/** The current shop node's persisted shelf, or undefined before it's rolled. */
export function currentShopShelf(): RunShopShelf | undefined {
  const node = currentNode();
  return activeRun && node ? activeRun.shopShelves[node.id] : undefined;
}

/** REROLL on the current shop node — costs `currentShopRerollCost()` gold
 * (escalating 1, 2, 3, 4… per reroll at THIS node — see `rerollCostForNode`),
 * no-ops if unaffordable. */
export function rerollCurrentShop(): void {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return;
  setActiveRun(rerollRunShop(activeRun, node.id));
}

/** The current shop node's NEXT reroll cost (1, 2, 3, 4…, escalating per
 * reroll already spent at this node — `rerollRunShop` already charges and
 * gates on this exact number, see `rerollCostForNode` in `src/run/runState.ts`).
 * Falls back to 1 off a shop node / with no active run — the shop scenes'
 * SANDBOX reroll (no active run, unlimited wallet) has no escalating cost of
 * its own to report, so this just gives its pre-existing flat label. */
export function currentShopRerollCost(): number {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return 1;
  return rerollCostForNode(activeRun, node.id);
}

export type ShopBuyResult = { ok: true } | { ok: false; reason: 'gold' | 'bag' | 'gone' };

/** Buys the card offer at `index` on the current shop node's shelf. */
export function buyCurrentShopCard(index: number): ShopBuyResult {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return { ok: false, reason: 'gone' };
  const result = buyRunCard(activeRun, node.id, index);
  if (result.ok) { setActiveRun(result.state); return { ok: true }; }
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
  if (result.ok) { setActiveRun(result.state); return { ok: true }; }
  return { ok: false, reason: result.reason };
}

/** Buys the gem offer at `index` on the current shop node's shelf. */
export function buyCurrentShopGem(index: number): ShopBuyResult {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return { ok: false, reason: 'gone' };
  const result = buyRunGem(activeRun, node.id, index);
  if (result.ok) { setActiveRun(result.state); return { ok: true }; }
  return { ok: false, reason: result.reason };
}

export type ShopBuyToSlotResult = { ok: true } | { ok: false; reason: 'gold' | 'slot' | 'gone' };

/** BUY-TO-SLOT: buys the card offer at `index` on the current shop node's
 * shelf straight into an explicit board/bag destination slot (the upcoming
 * drag-to-deck UI's entry point) instead of `buyCurrentShopCard`'s
 * nearest-fit auto-placement. `buyCurrentShopCard` remains the plain-tap
 * path — this is purely additive alongside it. */
export function buyCurrentShopCardTo(index: number, dest: BuyDestination): ShopBuyToSlotResult {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'shop') return { ok: false, reason: 'gone' };
  const result = buyRunCardTo(activeRun, node.id, index, dest);
  if (result.ok) { setActiveRun(result.state); return { ok: true }; }
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
  setActiveRun(leaveShop(activeRun));
}

// ---------------------------------------------------------------------------
// Event-node wiring — thin wrappers over the pure `src/run/events` resolver,
// keyed by whatever node is CURRENT (an event node's drawn-event id lives on
// `activeRun.eventInstances`, populated idempotently by `rollEventForNode`).
// ---------------------------------------------------------------------------

export type RunEventOutcome = EventOutcome | EventOutcomeV3;
export type RunEventDefinitionLookup = EventDefinitionLookup<LoadedEventDef>;

export type RunEventOfferSelection =
  | { kind: 'card'; skillId: string }
  | { kind: 'upgrade'; instanceId: string }
  | { kind: 'gem'; gemId: string }
  | { kind: 'sellGem'; pouchIndex: number }
  | { kind: 'mergeCards'; skillId: string };

interface CurrentCommittedEvent {
  node: RunNode;
  instanceId: string;
  event: LoadedEventDef;
}

function currentCommittedEvent(
  lookup: RunEventDefinitionLookup = eventDefAtVersion,
): CurrentCommittedEvent | undefined {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'event') return undefined;
  const instance = activeRun.eventInstances[node.id];
  if (instance === undefined) return undefined;
  const event = lookup(instance.eventId, instance.contentVersion);
  if (event === undefined || event.id !== instance.eventId) return undefined;
  return { node, instanceId: instance.instanceId, event };
}

function currentTransactionIsV3(): boolean {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'event') return false;
  const instance = activeRun.eventInstances[node.id];
  if (instance === undefined) return false;
  if (activeRun.eventMaterializations[instance.instanceId] !== undefined) return true;
  const exact = eventDefAtVersion(instance.eventId, instance.contentVersion);
  return exact !== undefined && isEventDefV3(exact);
}

function legacyLookupFrom(lookup: RunEventDefinitionLookup): EventDefinitionLookup<EventDef> {
  return (eventId, contentVersion) => {
    const event = lookup(eventId, contentVersion);
    return event === undefined || isEventDefV3(event) ? undefined : event;
  };
}

function currentResolutionMatches(committed: CurrentCommittedEvent): boolean {
  if (!activeRun) return false;
  const resolution = eventResolutionOf(activeRun);
  const instance = activeRun.eventInstances[committed.node.id];
  return resolution !== undefined
    && instance !== undefined
    && resolution.eventId === instance.eventId
    && resolution.contentVersion === instance.contentVersion
    && resolution.instanceId === committed.instanceId;
}

function rollCurrentEvent(
  lookup: RunEventDefinitionLookup = eventDefAtVersion,
): { event: LoadedEventDef; node: RunNode } | undefined {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'event') return undefined;
  const existing = activeRun.eventInstances[node.id];
  if (existing !== undefined) {
    const event = lookup(existing.eventId, existing.contentVersion);
    if (event === undefined || event.id !== existing.eventId) return undefined;
    if (isEventDefV3(event)) {
      const replay = materializeReachedEventV3(
        activeRun,
        node,
        event,
        existing.contentVersion,
      );
      if (!replay.ok) return undefined;
    }
  }
  const rolled = rollEventForNode(activeRun, node, lookup);
  if (rolled.state !== activeRun) setActiveRun(rolled.state);
  return { event: rolled.event, node };
}

/** The renderer's sole event input. Browsing an unreached event node performs
 * the normal lazy draw, then projects only the persisted committed state. */
export function currentRunEventViewModel(
  lookup: RunEventDefinitionLookup = eventDefAtVersion,
): RunEventViewModel | undefined {
  const rolled = rollCurrentEvent(lookup);
  if (!rolled || !activeRun) return undefined;
  return buildRunEventViewModel(activeRun, rolled.node, rolled.event, lookup);
}

/** Resolve a choice against the current committed `(eventId, version)`.
 * Callers supply only a choice id; they cannot redirect the transaction to a
 * different event/version. */
export function resolveCurrentRunEventChoice(
  choiceId: string,
  lookup: RunEventDefinitionLookup = eventDefAtVersion,
): RunEventOutcome | undefined {
  if (!activeRun || eventResolutionOf(activeRun)) return undefined;
  const rolled = rollCurrentEvent(lookup);
  if (!rolled || !activeRun) return undefined;
  const committed = currentCommittedEvent(lookup);
  if (!committed) return undefined;
  if (isEventDefV3(committed.event)) {
    const resolved = resolveEventChoiceV3(activeRun, committed.instanceId, choiceId, lookup);
    if (!resolved.ok) return undefined;
    setActiveRun(resolved.state);
    return resolved.outcome;
  }
  const resolved = resolveEventChoice(activeRun, committed.event.id, choiceId, legacyLookupFrom(lookup));
  setActiveRun(resolved.state);
  return resolved.outcome;
}

/** Reopen the exact pending question. V3 reads its persisted offer directly;
 * legacy behavior keeps its historical deterministic re-derivation. */
export function reopenCurrentRunEventOffer(
  lookup: RunEventDefinitionLookup = eventDefAtVersion,
): RunEventOutcome | undefined {
  if (!activeRun) return undefined;
  const committed = currentCommittedEvent(lookup);
  if (!committed) return undefined;
  if (isEventDefV3(committed.event)) {
    if (!currentResolutionMatches(committed)) return undefined;
    const reopened = reopenEventChoiceV3(activeRun, committed.instanceId, lookup);
    if (!reopened || reopened.offer.status !== 'pending') return undefined;
    const materialization = activeRun.eventMaterializations[committed.instanceId];
    if (materialization === undefined
      || correlatedMaterializedChoiceV3(
        committed.event,
        materialization,
        committed.instanceId,
        reopened.choiceId,
      ) === undefined) return undefined;
    if (reopened.offer.kind === 'grantCard' || reopened.offer.kind === 'grantGem') return undefined;
    return eventOutcomeForPendingOfferV3(reopened.offer);
  }
  const reopened = reopenEventChoice(activeRun, legacyLookupFrom(lookup));
  if (!reopened) return undefined;
  if (reopened.state !== activeRun) setActiveRun(reopened.state);
  return reopened.outcome;
}

function finishCurrentV3Offer(
  selection: RunEventOfferSelection,
  committed: CurrentCommittedEvent,
  lookup: RunEventDefinitionLookup,
): RunEventOutcome | undefined {
  if (!activeRun) return undefined;
  if (!currentResolutionMatches(committed)) return undefined;
  const resolution = eventResolutionOf(activeRun)!;
  if (!isEventDefV3(committed.event)) return undefined;
  const materialization = activeRun.eventMaterializations[committed.instanceId];
  if (materialization === undefined) return undefined;
  const correlated = correlatedMaterializedChoiceV3(
    committed.event,
    materialization,
    committed.instanceId,
    resolution.choiceId,
  );
  if (correlated === undefined) return undefined;
  const offer = correlated.offer;
  if (offer === undefined || offer.status === 'unavailable') return undefined;

  const result = selection.kind === 'card' && offer.kind === 'cardChoice'
    ? finalizeEventCardChoiceV3(activeRun, committed.instanceId, resolution.choiceId, selection.skillId, lookup)
    : selection.kind === 'card' && offer.kind === 'bonusDraft'
      ? finalizeBonusDraftV3(activeRun, committed.instanceId, resolution.choiceId, selection.skillId, lookup)
      : selection.kind === 'upgrade' && offer.kind === 'upgradeCardTargeted'
        ? finalizeTargetedUpgradeV3(activeRun, committed.instanceId, resolution.choiceId, selection.instanceId, lookup)
        : selection.kind === 'upgrade' && offer.kind === 'upgradeCard'
          ? finalizeUpgradeCardV3(activeRun, committed.instanceId, resolution.choiceId, selection.instanceId, lookup)
          : selection.kind === 'gem' && offer.kind === 'gemChoice'
            ? finalizeGemChoiceV3(activeRun, committed.instanceId, resolution.choiceId, selection.gemId, lookup)
            : selection.kind === 'sellGem' && offer.kind === 'sellGem'
              ? finalizeSellGemV3(activeRun, committed.instanceId, resolution.choiceId, selection.pouchIndex, lookup)
              : selection.kind === 'mergeCards' && offer.kind === 'mergeCards'
                ? finalizeMergeCardsV3(activeRun, committed.instanceId, resolution.choiceId, selection.skillId, lookup)
                : undefined;
  if (result === undefined || !result.ok) return undefined;
  if (result.state !== activeRun) setActiveRun(result.state);
  return result.outcome;
}

function finishCurrentLegacyOffer(
  selection: RunEventOfferSelection,
  lookup: RunEventDefinitionLookup,
): RunEventOutcome | undefined {
  if (!activeRun) return undefined;
  const reopened = reopenEventChoice(activeRun, legacyLookupFrom(lookup));
  if (!reopened) return undefined;
  if (reopened.outcome.kind === 'bonusDraft' && selection.kind === 'card') {
    const pick = reopened.outcome.cards.find((card) => card.skillId === selection.skillId);
    if (!pick) return undefined;
    const result = applyBonusDraftPick(reopened.state, pick);
    setActiveRun(result.state);
    return result.outcome;
  }
  if (reopened.outcome.kind === 'upgradeCardPick' && selection.kind === 'upgrade'
    && reopened.outcome.options.some((option) => option.instanceId === selection.instanceId)) {
    const result = applyUpgradeCardPick(reopened.state, selection.instanceId);
    setActiveRun(result.state);
    return result.outcome;
  }
  if (reopened.outcome.kind === 'gemChoicePick' && selection.kind === 'gem'
    && reopened.outcome.options.includes(selection.gemId)) {
    const result = applyGemChoicePick(reopened.state, selection.gemId);
    setActiveRun(result.state);
    return result.outcome;
  }
  if (reopened.outcome.kind === 'sellGemPick' && selection.kind === 'sellGem'
    && reopened.outcome.options.some((option) => option.pouchIndex === selection.pouchIndex)) {
    const result = applySellGemPick(reopened.state, selection.pouchIndex);
    setActiveRun(result.state);
    return result.outcome;
  }
  if (reopened.outcome.kind === 'mergeCardsPick' && selection.kind === 'mergeCards'
    && reopened.outcome.candidates.some((candidate) => candidate.skillId === selection.skillId)) {
    const result = applyMergeCardsPick(reopened.state, selection.skillId);
    setActiveRun(result.state);
    return result.outcome;
  }
  if (reopened.state !== activeRun && reopened.outcome.kind !== 'bonusDraft'
    && reopened.outcome.kind !== 'upgradeCardPick' && reopened.outcome.kind !== 'gemChoicePick'
    && reopened.outcome.kind !== 'sellGemPick' && reopened.outcome.kind !== 'mergeCardsPick') {
    setActiveRun(reopened.state);
    return reopened.outcome;
  }
  return undefined;
}

/** Finalize only the current pending persisted transaction. Exact same V3
 * settled selection replays `alreadySettled`; wrong/missing selections are
 * invalid no-ops. */
export function finalizeCurrentRunEventOffer(
  selection: RunEventOfferSelection,
  lookup: RunEventDefinitionLookup = eventDefAtVersion,
): RunEventOutcome | undefined {
  if (!activeRun) return undefined;
  const committed = currentCommittedEvent(lookup);
  if (!committed) return undefined;
  return isEventDefV3(committed.event)
    ? finishCurrentV3Offer(selection, committed, lookup)
    : finishCurrentLegacyOffer(selection, lookup);
}

/** Legacy compatibility view for a schema-v1/v2 event at the current node.
 * Drawing remains lazy and idempotent; current schema-v3 definitions are
 * exposed through the materialized transaction view instead. */
export function currentEventDef(): EventDef | undefined {
  const node = currentNode();
  if (!activeRun || !node || node.kind !== 'event') return undefined;
  if (currentTransactionIsV3()) return undefined;
  const { state, event } = rollEventForNode(activeRun, node);
  setActiveRun(state);
  return isEventDefV3(event) ? undefined : event;
}

/** What the CURRENT event node already resolved to — `undefined` off an event
 * node, or on one whose rungs are still open. The event scenes ask this in
 * `create()` (which runs again on every `scene.start`, so it is the only thing
 * that can tell a fresh arrival from a return trip) and show the node as DONE
 * rather than re-offering its rungs. */
export function currentEventResolution(): EventResolution | undefined {
  return activeRun && !currentTransactionIsV3() ? eventResolutionOf(activeRun) : undefined;
}

/** Resolves a choice on the current event node: deducts cost, applies the
 * outcome. Undefined if there's no active event node — OR if this node's rungs
 * were already taken (the run layer throws on that; this refuses first, so a
 * stale/duplicate tap is a no-op instead of an exception, which is what the
 * scenes' existing `if (!outcome) return;` already handles). */
export function resolveCurrentEventChoice(eventId: string, choiceId: string): EventOutcome | undefined {
  if (!activeRun) return undefined;
  if (currentTransactionIsV3()) return undefined;
  if (eventResolutionOf(activeRun)) return undefined;
  const { state, outcome } = resolveEventChoice(activeRun, eventId, choiceId);
  setActiveRun(state);
  return outcome;
}

/** Re-opens the DEFERRED picker a resolved-but-unfinished event node is still
 * waiting on (the player took a `bonusDraft`/`upgradeCard`/`gemChoice`/
 * `sellGem`/`mergeCards` rung and left for DECK/BAG before picking). Charges
 * nothing and counts nothing — the run layer's `reopenEventChoice` owns that
 * rule; this is the usual one-line store wrapper. Undefined when there is
 * nothing pending. */
export function reopenCurrentEventPick(): EventOutcome | undefined {
  if (!activeRun) return undefined;
  if (currentTransactionIsV3()) return undefined;
  const reopened = reopenEventChoice(activeRun);
  if (!reopened) return undefined;
  setActiveRun(reopened.state);
  return reopened.outcome;
}

/** Finalizes a `bonusDraft` outcome's deferred pick (the picker overlay). */
export function applyCurrentBonusDraftPick(pick: DraftCard): EventOutcome | undefined {
  if (!activeRun) return undefined;
  if (currentTransactionIsV3()) return undefined;
  const { state, outcome } = applyBonusDraftPick(activeRun, pick);
  setActiveRun(state);
  return outcome;
}

/** Finalizes an `upgradeCard` outcome's deferred pick (the picker overlay) —
 * bumps the tapped `instanceId` +1 tier. */
export function applyCurrentUpgradeCardPick(instanceId: string): EventOutcome | undefined {
  if (!activeRun) return undefined;
  if (currentTransactionIsV3()) return undefined;
  const { state, outcome } = applyUpgradeCardPick(activeRun, instanceId);
  setActiveRun(state);
  return outcome;
}

/** Finalizes a `gemChoice` outcome's deferred pick (the picker overlay) —
 * pushes the tapped gem id into the run's gem pouch. */
export function applyCurrentGemChoicePick(gemId: string): EventOutcome | undefined {
  if (!activeRun) return undefined;
  if (currentTransactionIsV3()) return undefined;
  const { state, outcome } = applyGemChoicePick(activeRun, gemId);
  setActiveRun(state);
  return outcome;
}

/** What `applyCurrentMergeCardsPick` hands back: the resolved outcome, plus
 * the RECEIPT for the trade that produced it.
 *
 * The receipt is the reason this one finalizer does not share its four
 * siblings' bare `EventOutcome | undefined` shape. A merge resolves to an
 * ordinary `grantCard`, so the outcome alone cannot say that three owned cards
 * were destroyed to make it — and the run layer's `MergeCardsReceipt` is the
 * only record of which three. Dropping it here (which is exactly what this
 * function did until the receipt was wired through) leaves the outcome screen
 * announcing "Gained a SILVER card" for the one outcome in the vocabulary that
 * takes something away. `merged` is absent only on the fallback path, where the
 * outcome is a `grantGold` coin and no trade happened.
 *
 * ATOMIC, unchanged: `applyMergeCardsPick` re-derives the plan from state and
 * returns the ORIGINAL state (plus a fallback coin) if anything is wrong, so
 * there is no ordering in which this store call leaves the run short three
 * cards and up nothing. The run layer still owns every rule; this only swaps
 * the active run for whatever it computed and CARRIES BOTH halves of what it
 * computed to the caller. */
export interface MergeCardsPickResult {
  outcome: EventOutcome;
  merged?: MergeCardsReceipt;
}

/** Finalizes a `mergeCards` outcome's deferred pick (the picker overlay) —
 * consumes the three same-tier inputs the offer named and inserts the tapped
 * card at tier+1. See `MergeCardsPickResult` for why this returns a pair. */
export function applyCurrentMergeCardsPick(skillId: string): MergeCardsPickResult | undefined {
  if (!activeRun) return undefined;
  if (currentTransactionIsV3()) return undefined;
  const { state, outcome, merged } = applyMergeCardsPick(activeRun, skillId);
  setActiveRun(state);
  return { outcome, merged };
}

/** Finalizes a `sellGem` outcome's deferred pick (the picker overlay) — sells
 * the tapped pouch gem and produces the FINAL `sellGem` outcome.
 *
 * Straight through to the run layer's `applySellGemPick`, like all five of its
 * sibling finalizers above. The event scenes used to call `sellCurrentRunGem`
 * (the Deck/Bag screen's SELL wrapper) and then HAND-BUILD
 * `{kind:'sellGem', gemId, price}` themselves from the gold it returned — a
 * second copy of a rule the run layer already owned, kept honest only by
 * coincidence (both routes bottom out in `sellRunGem`/`sellPriceOfGem`), and
 * with four tests in tests/run/events.test.ts exercising a finalizer the game
 * never actually called. `sellCurrentRunGem` remains for what it is really
 * for: the Deck/Bag SELL button, which is not an event outcome and builds no
 * outcome at all. */
export function applyCurrentSellGemPick(pouchIndex: number): EventOutcome | undefined {
  if (!activeRun) return undefined;
  if (currentTransactionIsV3()) return undefined;
  const { state, outcome } = applySellGemPick(activeRun, pouchIndex);
  setActiveRun(state);
  return outcome;
}

/** Leave the current event node with its choice already resolved — the
 * event scene's CONTINUE › button. */
export function leaveCurrentEvent(): void {
  if (!activeRun) return;
  setActiveRun(leaveEvent(activeRun));
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
  setActiveRun({ ...activeRun, pieces });
}

/** The run's current bag slots (empty array with no active run). */
export function currentRunBagSlots(): RunBagSlot[] {
  return activeRun?.bagSlots ?? [];
}

/** Replaces the run's bag slots wholesale. No-op with no active run. */
export function setCurrentRunBagSlots(bagSlots: RunBagSlot[]): void {
  if (!activeRun) return;
  setActiveRun({ ...activeRun, bagSlots });
}

/** The card parked on the Deck Build TEMP HOLDING strip, or null (also null
 * with no active run). Persisted like everything else on `RunState` — see
 * `RunState.held`. */
export function currentRunHeld(): RunCard | null {
  return activeRun?.held ?? null;
}

/** Replaces the held card (null empties the strip). No-op with no active run. */
export function setCurrentRunHeld(held: RunCard | null): void {
  if (!activeRun) return;
  setActiveRun({ ...activeRun, held });
}

/** One card move's worth of run state — any subset of the four places a Deck
 * Build drag can move a card between. */
export interface RunDeckEdit {
  pieces?: RunBoardPiece[];
  bagSlots?: RunBagSlot[];
  gemInventory?: string[];
  held?: RunCard | null;
}

/**
 * Apply a whole Deck Build move in ONE persisted write.
 *
 * The deck scenes' TEMP HOLDING bug was not only "the held card wasn't in
 * `RunState`" — it is also structurally wrong to persist a card's REMOVAL
 * and its new home as two separate saves, because the snapshot in between
 * owns neither. Every hold-involving move therefore commits through here:
 * the board/bag removal and the held card land in the same `setActiveRun`,
 * so no state that ever reaches storage is missing the card.
 *
 * Omitted keys are left as they are; `held: null` explicitly empties the
 * strip (it is a real value, not "unchanged").
 */
export function commitRunDeckEdit(edit: RunDeckEdit): void {
  if (!activeRun) return;
  const next: RunState = { ...activeRun };
  if (edit.pieces) next.pieces = edit.pieces;
  if (edit.bagSlots) next.bagSlots = edit.bagSlots;
  if (edit.gemInventory) next.gemInventory = edit.gemInventory;
  if ('held' in edit) next.held = edit.held ?? null;
  setActiveRun(next);
}

let cooldownWarningDismissedFor: string | null = null;

export function currentCooldownWarningDismissedFor(): string | null {
  return cooldownWarningDismissedFor;
}

export function setCooldownWarningDismissedFor(signature: string | null): void {
  cooldownWarningDismissedFor = signature;
}

/** The run's current gem pouch (ids, may repeat). Empty with no active run. */
export function currentRunGemInventory(): string[] {
  return activeRun?.gemInventory ?? [];
}

/** Replaces the run's gem pouch wholesale. No-op with no active run. */
export function setCurrentRunGemInventory(gemInventory: string[]): void {
  if (!activeRun) return;
  setActiveRun({ ...activeRun, gemInventory });
}

// ---------------------------------------------------------------------------
// Selling (2026-08-04) — the run's SELL action: doesn't need a shop node open
// (unlike buy/merge/reroll), it just removes an owned board piece/bag card/
// pouch gem and credits half-price gold. Thin wrappers over `sellRunCard`/
// `sellRunGem`, same idiom as the Deck/bag getters/setters above.
// ---------------------------------------------------------------------------

export type RunSellResult = { ok: true; goldReceived: number } | { ok: false; reason: 'empty' };

/** SELL the board piece / bag card at `index` from the active run — the
 * Deck/Bag build screens' SELL action. No-op (`'empty'`) if there's no
 * active run or the slot is already empty. */
export function sellCurrentRunCard(location: 'board' | 'bag', index: number): RunSellResult {
  if (!activeRun) return { ok: false, reason: 'empty' };
  const result = sellRunCard(activeRun, location, index);
  if (!result.ok) return { ok: false, reason: result.reason };
  setActiveRun(result.state);
  return { ok: true, goldReceived: result.goldReceived };
}

/** SELL the pouch gem at `pouchIndex` from the active run. */
export function sellCurrentRunGem(pouchIndex: number): RunSellResult {
  if (!activeRun) return { ok: false, reason: 'empty' };
  const result = sellRunGem(activeRun, pouchIndex);
  if (!result.ok) return { ok: false, reason: result.reason };
  setActiveRun(result.state);
  return { ok: true, goldReceived: result.goldReceived };
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
  setActiveRun(setHeroAllocation(activeRun, next));
}

export { WAVE_COUNT };
export type { BuyDestination, RunBagSlot, RunBoardPiece, RunNode, RunNodeKind, RunState };
