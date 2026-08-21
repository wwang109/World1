# Content documents — the authoring contract

This directory is the **single source of truth** for card content. The client,
the dev battle service (`npm run api`) and the production Cloudflare Pages
Function all read these files; nothing else defines what a card is.

The bar this file sets: a document must carry **everything needed to SHOW what a
card does and how it works**. If the wiki, the card face or the shop shelf cannot
render a card fully from its document, the document is incomplete and the
validator rejects it.

| File | What it holds |
|---|---|
| `skills.v1.json` | All card definitions. |
| `gems.v1.json` | All gem definitions. Identical envelope and `def` payload key. |
| *(presentation)* | Not yet migrated. |

## Shape

One document per card. The `id` is unique across the file and appears exactly
once; its versions are nested inside it.

```json
{
  "schemaVersion": 1,
  "notes": ["file-level commentary"],
  "cards": [
    {
      "id": "crushing_blow",
      "versions": [
        {
          "version": 1,
          "def": {
            "name": "Crushing Blow",
            "text": "Deal 96 (+ATK) Axe damage.",
            "notes": ["balance derivation lines"],
            "archetypes": ["offense"],
            "property": "physical",
            "weapon": "axe",
            "size": 3,
            "rarity": "rare",
            "tier": "bronze",
            "effects": [{ "kind": "damage", "power": 96 }]
          }
        }
      ]
    }
  ]
}
```

- **`id` is never repeated inside `def`.** It identifies the document; copying it
  into the payload is exactly the drift a data store would suffer from. The
  loader re-attaches it when rebuilding the in-memory `SkillDef`.
- **`def` is the whole card.** The same key is used for skills and gems, so one
  loader shape serves both, and it matches the codebase's existing
  `SkillDef` / `GemDef` vocabulary.
- **`notes` is free-form prose** carrying the balance derivation — the reasoning
  behind each number. Nothing reads it at runtime. It exists because JSON has no
  comments and this reasoning is the audit trail the balance work depends on.
  **Do not drop it when editing a card.**

## Versions

`versions` is an **array** of `{ version, def }`. `version` is a hand-set integer.

- **CURRENT is the entry with the HIGHEST `version`**, not the last element of the
  array. Resolution is by value, so array order carries no meaning.
- **Appending a new entry = a new version.** Use this for a real change.
- **Editing the last entry in place = not a new version.** Use this for a typo, a
  copy tweak, or fixing something never shipped.
- Duplicate version numbers inside one document are an **error**.

Why an array and not a map keyed by version number: a map *looks* like it would
make duplicates impossible, but it would not. Duplicate keys are not a JSON parse
error — every parser silently keeps the last one, so the mistake would become
**invisible** rather than impossible. An array keeps both entries, which is what
lets the validator see a repeat and name it. (The build gate also scans the raw
bytes for duplicate keys anywhere in the file, for the same reason.)

> Nothing consumes `version` beyond picking the current one. Per-run version
> pinning is deliberately **not** built.

## The rules a card must pass

Run `npm run content:validate`. It also runs first inside `npm run build`, so a
document that would not load cannot produce a deployable artifact.

**There is one outcome: a problem is a failure.** There is no warning tier. This
is a *contract*, so it rejects everything it does not define — unknown fields
included. A soft warning is worthless when the author is an agent: a typo like
`capp` for `cap`, or `weappon` for `weapon`, would otherwise validate clean and
ship a card that silently plays wrong — no error, no crash, just different
numbers, which is the worst failure mode available.

Schema evolution is not lost by this; it becomes **deliberate**. A new field lands
by extending `src/data/validateSkillContent.ts` — and bumping `schemaVersion` when
the shape genuinely changes — in the *same* change that first authors it.

### Required on every card

| Field | Rule |
|---|---|
| `name` | non-empty string |
| `text` | non-empty string — a card that cannot say what it does is incomplete |
| `archetypes` | non-empty array of `offense` `defensive` `healing` `support` `debuff` |
| `property` | `physical` \| `magical` \| `true` |
| `size` | `1` \| `2` \| `3` |
| `rarity` | `common` \| `rare` \| `epic` \| `legendary` |
| `tier` | `bronze` \| `silver` \| `gold` \| `diamond` |
| `effects` | array (may be empty **only** if the card has an `aura`) |
| exactly one of `element` / `weapon` | the card face draws a single type badge from it |

`element`: `fire` `frost` `lightning` `nature` `holy` `dark`.
`weapon`: `sword` `axe` `lance` `bow` `beast`.

**Conditional by property** — a card must be able to show its matchup identity:

- a **magical** card requires an `element` (it resolves on the element wheel);
- a **physical** card requires a `weapon` (it resolves on the weapon triangle);
- a **true** card bypasses both, so its type is cosmetic and either is fine.

### Optional fields

`speedWeight` (0..200), `cooldownTurns` (0..99), `scope` (`one` \| `all`),
`special`, `aura`, `tierUpgrades`.

- **`aura`** requires `affects` (`adjacent` \| `left` \| `right` \| `allBoard`) and
  a `mods` object carrying at least one of `damageFlat`, `healFlat`,
  `weightDelta`. Optional: `reach` (0..20), `archetypeFilter`, `propertyFilter`.
  These are required because the engine dereferences `aura.mods.*` and switches on
  `aura.affects` unconditionally — an incomplete aura used to crash `simulate()`
  at first use rather than failing validation.
- **`tierUpgrades`** is keyed by `silver` / `gold` / `diamond` (never `bronze` —
  bronze *is* the authored base). An upgrade that changes `effects` **must** carry
  its own `text`, or the card face shows the wrong numbers at that tier.

### Action kinds

Every action carries a `kind` discriminant plus exactly its own fields. An unknown
field on an action is an error.

| kind | fields |
|---|---|
| `damage` `heal` `shield` | `power` |
| `statStrike` | `shareOf`, optional `cap` |
| `poison` `burn` `bleed` | `stacks` |
| `stun` | `turns` |
| `slow` | `weight` |
| `disrupt` `shieldBreak` `comboBonus` `taunt` | `amount` |
| `expose` | `pct`, `turns` |
| `guard` | `property`, `pct`, `turns` |
| `negate` | `property`, `charges` |
| `cleanse` | `charges` |
| `lifesteal` | `pct` |
| `buffStat` `debuffStat` | `stat`, `pct`, `turns` |
| `exploit` | `status`, `amount` |
| `stackBonus` | `status`, `of`, `per`, `cap` (all four required) |

`stat`: `attack` `magicPower` `armor` `magicResist` `speed`.

`status`: `poison` `burn` `bleed` `stun` `debuff` `expose` for `exploit`;
`poison` `burn` `bleed` `thorns` for `stackBonus` (it needs a pile with stacks).
`of`: `caster` (read your own pile) or `target` (read the victim's).

**Ordering rule for `exploit`/`stackBonus`** (user-locked 2026-08-21). Both riders
read a status that is ALREADY there and hand a flat bonus to the cast's damage, so
the authored effect list must run **rider → damage → any status this card
applies**. The validator rejects anything else: a rider behind the damage arms a
bonus nothing can spend, and this card's own poison/thorns line ahead of the
damage would let the card trigger itself on its first cast — the payoff is meant
to land on the NEXT one. (`stackBonus` with `of: 'caster'` is only ordered against
CASTER-side applications, i.e. `thorns`.)

This mirrors the `Action` union in `src/engine/types.ts`. The validator's switch
ends in `assertNever`, so **adding an action kind to the engine fails `tsc` until
the validator handles it** — that is the compile-time safety JSON gives up, bought
back.

### Ids

Lowercase snake_case. An **all-numeric id is rejected**: JavaScript enumerates
integer-like object keys first, in ascending numeric order, so an id like `"42"`
would jump to the front of `Object.keys(skillBook)` regardless of the id sort the
loader applies — silently changing what every seeded run is offered, since the
shop / draft / event pools draw by index.

## The other gates a new card must clear

Passing `content:validate` proves a document is well-formed and complete. It does
**not** prove the card is balanced, or that its text is truthful. Three further
gates run inside `npm test`:

1. **Balance audit** (`tests/engine/balance.test.ts`) — the card's kit must sum to
   its tier's Power Level budget at **zero tolerance**. Prices live in
   `src/engine/balance.ts`; the reasoning in `docs/power-level-reference.md`.
2. **Card-text drift guard** (`tests/engine/cardText.test.ts`) — the magnitudes and
   stat tokens in `text` must agree with `effects`. The validator only checks that
   `text` *exists*; this is the gate that checks it is *true*.
3. **Text style** — `docs/card-text-style-guide.md` for wording, and
   `docs/card-template-spec.md` for the `{{keyword}}` markup.

## Workflow

```
npm run content:validate     # the gate; also runs first inside `npm run build`
npm test                     # everything, including the three gates above
npm run content:export       # regenerate from the legacy TS literals — see hazard
```

> **`content:export` OVERWRITES `skills.v1.json` wholesale**, regenerating it from
> the legacy literals in `src/data/skills.ts`. It was the one-shot migration tool.
> Any card authored directly in the JSON — and any version appended — is
> **destroyed** by running it. It exists only until those literals are deleted;
> after that it should go too. Do not run it to "refresh" the file.

## Known limitation

**Old versions and `notes` ship in the client bundle.** Every version's full
payload is bundled, not just the current one. Accepted at current scale — the
whole catalogue is roughly 40 KB against a multi-megabyte Phaser bundle — but
worth revisiting if history grows deep.

---

# Gems (`gems.v1.json`)

Identical envelope and identical `def` payload key — one loader philosophy for
both books. The array is named `gems` instead of `cards`; everything else about
the shape, the versioning and the one-outcome contract is the same.

## The four categories

A gem's category is **derived from its payload**, never from its name. The name
suffix and the text opener must then agree with it — that is the rule that makes
the old confusion unauthorable.

| Category | Payload shape | What it does | Name ends | Text opens |
|---|---|---|---|---|
| **Sliver** | `effect`, no hit | adds a NEW effect to the cast | `… Sliver` | (an effect verb) |
| **Echo** | `effect` with `statStrike` + `echoHostPower` | REPEATS the host's attack proportionally | `… Echo` | `Echo:` |
| **Core** | `stat`, `scope: "card"` | improves numbers the host already has | `… Core` | `This card:` |
| **Charm** | `stat`, `scope: "hero"` | improves the hero, on every card | `… Charm` | `Hero:` |

A Sliver has no fixed opener, so it is checked negatively: it must not borrow
another category's opener.

```json
{
  "id": "resonant_echo",
  "versions": [
    { "version": 1,
      "def": {
        "name": "Resonant Echo",
        "text": "Echo: this card's attack repeats at half strength as a separate hit, and the card is 25% heavier.",
        "notes": ["…the price derivation…"],
        "kind": "effect",
        "rarity": "legendary",
        "actions": [{ "kind": "statStrike", "shareOf": 2, "echoHostPower": true }],
        "weightIncreasePct": 25
      } }
  ]
}
```

## Gem rules the validator enforces

Bands are **exact** at 20 / 40 / 60 / 80 deci with zero tolerance
(`isGemOnBudget`). On top of that:

- **One kind.** An `effect` gem carries `actions`; a `stat` gem carries `scope` +
  `mods`. Mixing them is an error.
- **Scope-matching mods only.** A `hero`-scope gem carrying a `card` bundle is an
  error — an off-scope bundle is silently inert *and* unpriced.
- **Payload uniqueness.** Two gems with an identical payload at the same rarity
  are mechanical twins and rejected. The same shape at a *different* band is a
  legal ladder rung. (Before the 2026-08-09 migration, 17 gems sat in 6
  twin groups; 11 were retired.)
- **Hits are Echo-only and Legendary-only.** A flat `damage` action on a gem takes
  no stat, no aura and no combo, then eats full mitigation — it delivers ~1 damage
  at any real depth. A capped `statStrike` is banned too: a cap small enough to fit
  a band binds on almost every host, flattening the Echo back into the flat chip it
  replaced.
- **`weightIncreasePct`** is the Echo's tempo cost and only an Echo may carry it.
- **Structurally unpriceable payloads are rejected with the arithmetic**: `stun`
  (100/turn), `negate` (100/charge), `cleanse` (25/charge → 25/50/75/100) and
  `cooldownReduction` (100/turn) have no value that lands on a band.
- **Design caps**: `lifesteal` ≤ 60%, Core `weightDelta` ≥ −2. Higher bands on
  those axes must come from combining payloads.
- **Ids** are lowercase snake_case (and never all-numeric).

## Balance rules that live in tests, not the validator

Two rules need the `PRICE` tables and therefore live with the balance audits, so
that `src/engine/balance.ts` stays out of the loader's import graph — a price
change must never be able to stop the game booting.

1. **Exact band placement** — `tests/engine/gemAudit.test.ts`.
2. **Minimal magnitude** (`tests/data/gemsRuleset.test.ts`) — if a *smaller*
   magnitude lands the same band, the authored one ships free power. This is real,
   not theoretical: a 31% lifesteal prices identically to 30%, so a gem authored at
   31% would be handing out 1% for nothing.
