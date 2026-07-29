# Run Mode — Event Dialogues design plan

Companion to [`release-game-plan.md`](release-game-plan.md) and
[`run-shops-design.md`](run-shops-design.md). Events are the third leg of the
run: fights spend HP-of-attention, shops spend gold, **events spend risk**.
They are text dialogues at a map node offering 2–3 choices with deterministic,
seeded outcomes: free cards, gems, gold, hero levels, or an extra draft.

Status: **planned — build after run v1 wiring (phase 3) is stable.** Adding
the node kind touches `runMap.ts`/`runState.ts`, which the in-flight scene
work reads; events land as their own phase so the map/battle loop ships first.

## 1. Shape — pure data, additive resolver (same pattern as everything else)

- `src/data/events.ts` — declarative catalog, NO logic (mirrors
  `shopTypes.ts`). Each event: `id`, `title`, `body` (the scene text),
  and 2–3 `choices`.
- `src/run/events.ts` — pure resolution: `rollEventForNode(encounterSeed)`
  picks the event (draw-without-replacement bag per run, like shop themes),
  `resolveChoice(state, event, choiceId)` applies the outcome and returns the
  new `RunState` + a result blurb to display. All randomness from the node
  seed via `Rng`, fixed call order.
- Map gen: node kind `'event'` joins `fight|elite|shop|boss` — roughly 1–2
  event nodes per run, never at depth 1 (draft just happened) or depth 9
  (pre-boss slot stays a fight/shop decision).

## 2. Choice & outcome vocabulary (v1 set)

Every choice is one of these outcome kinds — small on purpose so the resolver
stays tiny and every grant reuses an existing system:

| Outcome | Reuses | Notes |
|---|---|---|
| `grantCard` | wiki ADD-TO-BAG path (`nearest-fit insert`) | Fixed card id OR seeded draw from a filter (same `CardFilter` shape as shops). May carry a tier. Bag-full → falls back to gold. |
| `grantGem` | gem pouch | Fixed id or seeded draw. |
| `grantGold` | run wallet | Amounts sized vs. fight income (1 base +1–3 bonus): small 2, big 4. |
| `grantLevel` | `heroLevel + 1` (player spends PL by hand, as with wins) | The "extra levels" lever. Expensive to offer — one win's worth of progression. |
| `bonusDraft` | `rollStartDraft`-style single set: 5 seeded cards, pick 1 | The "more drafting" lever. A one-set mini-draft overlay, not the 4-set opener. |
| `loseGold` / `nothing` | — | The price of greedy choices. |

**No mid-run HP/injury mechanic** — fights are full-HP deterministic sims, so
events must never mutate combat state. Risk is paid in gold, tempo (a
worthless outcome), or opportunity, never in a stat the engine would have to
carry between fights.

A choice's outcome is either **fixed** (shown plainly: "Gain 2 gold") or a
**seeded gamble** (shown as odds flavor: "The chest may be trapped…" —
weighted table rolled from the node seed). Gambles must telegraph stakes in
the body text; no unreadable coin flips.

## 3. v1 event set (8 events — enough that 2 draws/run stay fresh)

1. **The Wandering Tutor** — pay 3 gold → `grantLevel` / decline.
2. **Abandoned Cache** — open (gamble: 60% `grantCard` bronze draw from a
   random shop filter, 40% `nothing`) / leave it.
3. **The Recruiter** — `bonusDraft` (weapon-filtered set) / `grantGold` 2.
4. **Gemseller's Mishap** — help gather (gamble: 70% `grantGem`, 30%
   `nothing`) / rifle the spill (`grantGem` guaranteed but `loseGold` 2).
5. **Crossroads Shrine** — tithe 2 gold → `grantCard` holy/dark draw /
   deface it → `grantGold` 3 (flavor consequence only in v1).
6. **Veteran's Last Lesson** — `grantCard` fixed high-value silver from a
   curated list / `grantLevel` if you decline the blade (pick your axis).
7. **The Gambler** — stake 3 gold (gamble: 50% double back, 50% gone) /
   walk away.
8. **Overloaded Caravan** — `bonusDraft` (unfiltered set) but `loseGold` 1 /
   `grantGold` 1 for helping push.

Authoring rule: every event has a **safe exit** choice (possibly `nothing`)
so events never soft-lock a broke player, and at most one gamble per event.

## 3b. Expanded catalog — event THEMES (target 20 events)

A run visits ~10–14 stop columns with 2–3 choices each, so an 8-event catalog
repeats within a single run. Target **20 events**, tagged with a `theme` field
so the map can label the node ("EVENT · FORGE") and the no-repeat bag can
spread themes out — the player reads the theme and chooses what their deck
needs, which is what makes stops a build decision rather than a coin flip.

`ShopTypeDef`-style declarative tags; `theme` drives label + icon color only.

| Theme | What its events do | Colour |
|---|---|---|
| **TRAINING** | `grantLevel`, or level-for-gold trades | violet |
| **CACHE** | `grantCard` / `grantGem` finds, often gambles | amber |
| **RECRUIT** | `bonusDraft` — filtered or open mini-drafts | teal |
| **FORGE** | Tier-up flavor: a card grant at a *higher tier* for gold | orange |
| **MARKET** | Gold in/out: sell-flavored trades, discounts, gambles | green |
| **OMEN** | High-variance gambles with the biggest swings | crimson |

Catalog plan — the 8 from §3 keep their ids, plus 12 new ones:

| Theme | New events |
|---|---|
| TRAINING | **Sparring Circle** (spend 2g → `grantLevel`, or free `grantCard` bronze) · **Hermit's Riddle** (gamble 50/50 `grantLevel` / `nothing`, free) |
| CACHE | **Collapsed Barrow** (gamble: gem vs nothing) · **Quartermaster's Error** (pick one of `grantCard` defensive-filter / `grantGem`) · **Beast Nest** (gamble: bow/beast card vs `loseGold` 1) |
| RECRUIT | **Sellsword Camp** (`bonusDraft`, weapon-filtered) · **Circle of Adepts** (`bonusDraft`, magical-filtered) · **Field Medic** (`bonusDraft`, heal/support-filtered) |
| FORGE | **Wandering Smith** (pay 4g → `grantCard` at **silver**) · **Ruined Anvil** (free `grantCard` bronze, or 3g → same card silver) |
| MARKET | **Toll Bridge** (pay 2g → `grantCard`, or refuse → `nothing`) · **Fence's Offer** (`grantGold` 4 but `loseGold` on a later… no — v1: `grantGold` 3 vs `grantGem`) |
| OMEN | (existing Gambler, Crossroads Shrine) |

Balance guidance for authoring: a **free** outcome is worth ≤ one fight's
income (grantGold 2, a bronze card, a common gem). `grantLevel` and
silver-tier cards must cost gold or carry a gamble. No event may grant more
than one outcome kind unless one of them is negative (grant + `loseGold`).

Lint test extends to: every event has a `theme`; each theme has ≥ 2 events;
filtered `bonusDraft`/`grantCard` filters must resolve to a **non-empty** pool
(the user-locked thin-pool rule applies here too — see run-shops-design §2b:
a narrow filter offering 1–2 cards is fine, an empty one is a bug). A
`bonusDraft` set shows `min(5, pool)` cards; the picker UI must handle 1–5
cards without dead space.

## 4. UI (both platforms, same phase)

`DesktopRunEventScene` / `MobileRunEventScene`: parchment-style text panel
(title, body, result blurb after choosing), 2–3 choice buttons with their
cost/known-reward inline, CONTINUE → back to map. Reuses panel chrome +
`rebuildScene` idiom; `bonusDraft` reuses the draft scene's set-row component
in single-set mode. No new geometry sources.

## 5. Tests

- Determinism: same run seed → same events at same nodes, same gamble
  results, ~20 seeds.
- Event bag never repeats within a run (until catalog exhausted).
- Outcome application: bag-full `grantCard` falls back to gold; `loseGold`
  floors at 0; `grantLevel` matches the win-leveling path exactly.
- Map-gen placement: 1–2 events/run, never depth 1 or 9, never displacing
  the boss.
- Catalog lint test: every event has 2–3 choices, a safe exit, ≤1 gamble,
  and only vocabulary outcomes (mirrors the shop-filter audit style).

## Build order

1. `events.ts` data + `run/events.ts` resolver + tests (after phase-3 wiring).
2. Map-gen `'event'` node kind + placement tests.
3. Event scenes D+M + bonus-draft overlay.
4. Feature-inventory EVENT section.
