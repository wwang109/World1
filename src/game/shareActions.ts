// Share-code apply paths — the demoState <-> ShareLoadout mappers
// (docs/sandbox-features-proposal.md §3.2/§3.3). The CODEC is pure and lives
// in `src/run/shareCode.ts`; THIS module is the game-layer glue (naming idiom:
// `draftActions.ts`, `shopActions.ts`) because `OwnedBoardPiece`/instanceIds/
// `createOwnedCard` live in `demoState` and a pure module may not import them.
//
// THE ASYMMETRY TABLE (§3.3) — what maps, what drops:
//
//   loadout field   PLAY IT (hero)            FIGHT IT (foe)
//   board           1:1                       1:1 (`foe.deck`)
//   socketed gems   1:1 (Gems from gemBook)   1:1 (gemIds; the engine folds
//                                             gems for foes too — state.ts)
//   hero level      1:1                       -> foe.level, title NORMAL
//                                             (same PL budget: totalLevelPL(L)
//                                             = (L-1)*3 = monsterLevelPL(L))
//   stat spend      1:1 (re-fit if overspent) DROPPED — the foe auto-spends
//                                             the same PL via its chassis
//                                             profile (`profileFor`)
//   bag             1:1 (re-packed)           DROPPED — a foe has no bag
//   loose gems      1:1                       DROPPED — no inventory, sockets only
//
// No silent drops: both apply paths return the human report lines the import
// dialog shows. Enemy-side dials a code can NEVER carry (title/modifiers/
// chassis) belong to the challenger's own prep panel, not the shared build.

import { gemBook } from '../data/gems';
import { skillBook } from '../data/skills';
import type { FoeDeckCard } from '../run/encounter';
import {
  allocationToCounts,
  countsToAllocation,
  refitAllocation,
  type ShareLoadout,
} from '../run/shareCode';
import {
  createOwnedCard,
  demoState,
  syncPrimaryFoe,
  type InventorySlot,
  type OwnedBoardPiece,
} from './demoState';

/**
 * Read the current sandbox build off `demoState` as a `ShareLoadout` —
 * pieces sorted by slot (canonical form, so equal builds mint equal codes),
 * socketed gems as ids, bag filtered to its cards in slot order (gaps are
 * cosmetic and not carried), the loose gem inventory verbatim, and the hero
 * level + stat buys.
 */
export function captureLoadout(): ShareLoadout {
  const board = [...demoState.pieces]
    .sort((a, b) => a.slot - b.slot)
    .map((p) => ({ skillId: p.skillId, tier: p.tier, slot: p.slot, gemId: p.gem?.id ?? null }));
  const bag: ShareLoadout['bag'] = [];
  for (const slot of demoState.bagSlots) {
    if (slot) bag.push({ skillId: slot.skillId, tier: slot.tier });
  }
  return {
    heroLevel: demoState.heroLevel,
    allocation: allocationToCounts(demoState.heroAllocation),
    board,
    bag,
    gems: [...demoState.gemInventory],
  };
}

/**
 * PLAY IT — the lossless path: the loadout becomes MY hero setup, replacing
 * board, bag, loose gems, level and stat spend. Board/bag instances are
 * minted through `createOwnedCard` (the sandbox's single stamping point, with
 * its tier floor); gems are socketed from `gemBook`. Returns the report lines
 * the import dialog shows (empty = clean apply).
 */
export function applyAsHero(loadout: ShareLoadout): string[] {
  const report: string[] = [];

  const pieces: OwnedBoardPiece[] = loadout.board.map((card) => {
    const owned = createOwnedCard(card.skillId, card.tier);
    const gem = card.gemId != null ? gemBook[card.gemId] : undefined;
    if (card.gemId != null && gem === undefined) {
      // Decode already drops unknown gems; this guards hand-built loadouts.
      report.push(`unknown gem "${card.gemId}" skipped`);
    }
    return { ...owned, slot: card.slot, ...(gem ? { gem } : {}) };
  });
  demoState.pieces = pieces;

  // Bag: re-pack by card size into the 10-slot rail (the DEFAULT_BAG_SLOTS
  // rule: a size-N card sits at its first slot and covers the next N-1, which
  // stay null). Cards past the rail are DROPPED with a report line — reachable
  // only from a tampered-but-checksum-lucky or future-version code, but never
  // silently.
  const slots: InventorySlot[] = new Array<InventorySlot>(demoState.bagSlots.length).fill(null);
  let cursor = 0;
  let dropped = 0;
  for (const card of loadout.bag) {
    const size = skillBook[card.skillId]?.size ?? 1;
    if (cursor + size > slots.length) {
      dropped += 1;
      continue;
    }
    slots[cursor] = createOwnedCard(card.skillId, card.tier);
    cursor += size;
  }
  if (dropped > 0) report.push(`${dropped} bag card${dropped === 1 ? '' : 's'} dropped — the bag holds ${slots.length} slots`);
  demoState.bagSlots = slots;

  const gems = loadout.gems.filter((id) => gemBook[id] !== undefined);
  if (gems.length < loadout.gems.length) {
    report.push(`${loadout.gems.length - gems.length} unknown loose gem${loadout.gems.length - gems.length === 1 ? '' : 's'} skipped`);
  }
  demoState.gemInventory = gems;

  demoState.heroLevel = Math.max(1, Math.floor(loadout.heroLevel));
  // The exact un-buy loop the LV stepper uses, so the guarded
  // `applyPlayerLevelAllocation` path can never throw on an imported spend.
  const refit = refitAllocation(demoState.heroLevel, countsToAllocation(loadout.allocation));
  demoState.heroAllocation = refit.alloc;
  if (refit.changed) report.push('stat spend re-fit to the LV budget');

  return report;
}

/**
 * FIGHT IT — the loadout becomes the ACTIVE foe's custom deck (Feature A's
 * `FoeDeckCard[]` shape): card-for-card, tier-for-tier, slot-for-slot,
 * gem-for-gem identical to the source board. `foe.level` <- the code's hero
 * level (same PL budget by construction: `totalLevelPL(L) === monsterLevelPL(L)`
 * for L >= 1); `foe.title` <- 'normal' (levelDelta 0 — "fight this build at
 * its own level"); `foe.affix` <- null (a custom deck owns the board); the
 * foe's `modifiers` and chassis `enemyId` are LEFT AS-IS — they are the
 * challenger's own dials, not the code's. Returns the documented drop lines.
 * Throws on an empty board (a card-less foe just stalls into attrition) —
 * the import dialog disables FIGHT IT for that case.
 */
export function applyAsFoe(loadout: ShareLoadout): string[] {
  if (loadout.board.length === 0) {
    throw new Error('applyAsFoe: an empty-board loadout cannot become a foe deck');
  }
  const foe = demoState.enemyTeam[demoState.activeFoe];
  if (!foe) throw new Error('applyAsFoe: no active foe to receive the deck');

  const deck: FoeDeckCard[] = loadout.board.map((card) => ({
    skillId: card.skillId,
    slot: card.slot,
    tier: card.tier,
    gemId: card.gemId,
  }));
  foe.deck = deck;
  foe.level = Math.max(1, Math.floor(loadout.heroLevel));
  foe.title = 'normal';
  foe.affix = null;
  syncPrimaryFoe();

  const drops: string[] = [];
  if (loadout.bag.length > 0) {
    drops.push(`bag (${loadout.bag.length} card${loadout.bag.length === 1 ? '' : 's'}) dropped — a foe has no bag`);
  }
  if (loadout.gems.length > 0) {
    drops.push(`${loadout.gems.length} loose gem${loadout.gems.length === 1 ? '' : 's'} dropped — a foe has no inventory`);
  }
  if (loadout.allocation.some((buys) => buys > 0)) {
    drops.push('stat spend dropped — the foe auto-spends its LV');
  }
  return drops;
}
