import type { Gem } from '../engine/types';
import { gemBookFromJson } from './gemsContent';

// Gem catalog, priced with the Power Level system's SOCKET/GEM rules
// (src/engine/balance.ts, docs/power-level-reference.md "Socket / Gem PL
// accounting"). Each gem's OWN PL must land EXACTLY on its rarity's band
// (BUDGET_TOLERANCE_DECI = 0, same zero tolerance as the card audit — user-
// locked 2026-07-19): Common 2 · Rare 4 · Epic 6 · Legendary 8 — checked by
// `isGemOnBudget` (see tests/engine/gemAudit.test.ts). Gem PL is uncapped
// bonus power stacked on top of a card's authored (tier-budgeted) kit; it is
// NEVER folded into the base-card audit.
//
// `GemDef` is display data layered on the engine's structural `Gem` type —
// `name`/`text` aren't consumed by the engine, only by content/UI.
export type GemDef = Gem & { name: string; text: string };

/**
 * THE gem book — loaded from `content/gems.v1.json` via `gemsContent.ts`.
 *
 * This file is now a ONE-LINE RE-EXPORT SHIM (plus the `GemDef` type alias
 * above, which the engine/UI layers still import from here), kept so every
 * module already importing `gemBook` from `src/data/gems` needs no import
 * churn. The hand-written `gemDefs` literals that used to live here (and the
 * migration-proof-only `gemBookFromDefs` export) are gone: `gemsContent.ts` /
 * `content/gems.v1.json` is now the single source of truth, and
 * `tests/data/gemsRuleset.test.ts` / `validateGemContent.ts` are what pin its
 * contract (runtime schema + ruleset validation, standing in for the
 * compile-time checking the literals used to give).
 */
export const gemBook: Record<string, GemDef> = gemBookFromJson;
