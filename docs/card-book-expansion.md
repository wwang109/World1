# Card Book Expansion — filling the theme axes

The run's shops and events are theme-shaped (see
[`run-shops-design.md`](run-shops-design.md) §2b and
[`run-events-design.md`](run-events-design.md) §3b), but the card book is
**36 bronze cards** and the theme axes are lopsided — which is why some shops
would sell a 1-card shelf today. Thin shelves are *allowed*
(user-locked), but the real fix is more cards. This is the authoring plan.

## Where the book stands (2026-07-29)

| Axis | Counts |
|---|---|
| total | **36** cards, all authored at bronze (tiers are derived via `applyTier`) |
| size | 27 × size-1 · 6 × size-2 · 3 × size-3 |
| property | physical 19 · magical 12 · true 5 |
| weapon | sword 5 · axe 5 · beast 5 · lance 2 · bow 2 |
| element | holy 6 · dark 4 · frost 3 · nature 2 · **fire 1** · **lightning 1** |
| archetype | offense 20 · defensive 5 · debuff 5 · support 3 · healing 3 |

The gaps that hurt the run loop:
1. **Fire and lightning are one card each** — two of the four wheel elements
   barely exist, so the elemental wheel (Fire→Nature→Lightning→Frost→Fire)
   can't be played around.
2. **Lance and bow are two cards each** — the weapon triangle
   (Sword→Axe→Lance) and Bow-beats-Beast are similarly unplayable as builds.
3. **Non-offense archetypes are 3–5 cards each** — a defensive or support
   deck has almost nothing to draft, so every run trends toward the same
   offense pile.

## Target — 72 cards (double the book)

**+36 new bronze cards**, allocated to fix exactly the gaps above. Every card
must pass the PL balance audit (`PRICE` in `src/engine/balance.ts` is the
authority) — this is content authoring, NOT a pricing change. Budget stays
Bronze 10 PL.

| Slice | New cards | Why |
|---|---|---|
| **fire** | +5 (→6) | make the wheel real; burn/DoT identity |
| **lightning** | +5 (→6) | wheel; speed/stagger identity |
| **nature** | +4 (→6) | wheel; poison/regen identity |
| **frost** | +3 (→6) | wheel; slow/control identity |
| **lance** | +4 (→6) | weapon triangle; reach/guard identity |
| **bow** | +4 (→6) | triangle outsider; multi-hit/precision identity |
| **defensive** | +4 (→9) | armor-stack builds; feeds Bulwark shop |
| **support** | +3 (→6) | buff/aura builds; feeds Sanctum/Field Medic |
| **healing** | +2 (→5) | sustain builds |
| **true** | +2 (→7) | ignores-defense niche; feeds Assassins' Den |

(Slices overlap — a fire *support* card counts in both rows; the +36 total is
the ceiling, not the sum of the column.)

Size mix for the new cards: keep the existing shape — roughly **24 × size-1,
9 × size-2, 3 × size-3**. Size-2/3 cards are where multi-turn spans and the
big effects live; they must justify the tempo cost.

## Authoring rules (non-negotiable)

1. **Pure data** in `src/data/skills.ts` — no logic. Conform to existing
   `SkillDef` shape and idioms; author at **bronze** only and let `applyTier`
   derive silver/gold/diamond (authored `tierUpgrades` only where the
   auto-scale path can't express the intent).
2. **Balance audit green** — every new card must price out at its tier budget
   via the existing audit test. If a card can't fit 10 PL, cut magnitude, not
   the price.
3. **Effect caps hold** — the locked per-size caps (7/16/32 scalable,
   10/15/20 control/buff) and the escalating disrupt brackets apply.
4. **Element/weapon matchups are PL-neutral** — assigning an element is free
   in PL terms; it's identity, not power.
5. **Text honesty** — display `text` must match the numbers, including after
   tier scaling (locked by `tests/engine/tierText.test.ts`).
6. **Card art is a known gap** — new cards ship without PNGs; the CardToken /
   template path already handles art-less cards (`twin_slash` does today).
   Art is a separate later pass; do not block authoring on it.

## Payoff for the run loop

At 72 cards every element stall (Emberworks, Stormspire, Grovekeep,
Frosthold, Reliquary, Umbral Stall) has a 6-card pool — a real shelf with
reroll value — and Bulwark/Assassins' Den/Field Medic have enough to draft a
coherent identity. The thin-pool tolerance stays in place as the safety net,
but no shop would actually be down to one card.

## Build order

1. Author in **slices, not one dump**: wheel elements first (fire/lightning/
   nature/frost = +17), balance-audit green after each slice.
2. Then weapons (lance/bow = +8).
3. Then archetypes (defensive/support/healing/true = +11).
4. Re-run the shop/event pool-lint tests after each slice — pools should climb
   and the REROLL-suppression flags should start flipping off.
5. Wiki spot-check (both platforms) — the catalog count label must read 72.
