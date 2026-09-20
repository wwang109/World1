# Content documents — the authoring contract

This directory is the **single source of truth** for card and event content. The client,
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
| `events.v1.json` | Frozen legacy-event baseline used for parity checks. |
| `events.v2.json` | Frozen 44-ID schema-v2 compatibility artifact used by legacy facade/snapshot tests. |
| `events.v3.json` | Generated, live 66-ID mixed-schema aggregate. It carries current schema-v3 Arrowfell, eight biome anchors and three callbacks, plus seven global/conditional anchors and four callbacks alongside exact historical wrappers. |
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

> New draws use the numerically current version, then pin that exact
> `contentVersion` in the run's immutable event-instance record. Resolution,
> pending-picker reopen, and queued callback delivery use the exact
> `(eventId, contentVersion)` lookup; they never fall forward to a newer
> definition. Adding a new version therefore affects only future draws.

## Events (`event-packs/*.json` → highest `events.vN.json`)

Every `event-packs/*.json` file is an active event authoring source with a
validated schema-1, schema-2, or schema-3 envelope. The compiler sorts packs in
code-unit filename order, preserves event/version/choice order and every `def`
value, chooses the highest source envelope, then adds an explicit wrapper
`schemaVersion` only where lifting an older source would otherwise reinterpret
that version. Untagged grandfathered definitions in a schema-2 source (the
legacy shapes without `delivery`) become explicit schema 1; true schema-2
definitions become explicit schema 2. Authored explicit tags remain strict and
unchanged. Every schema-3 pack must repeat the exact closed story-state
registry.

`npm run content:events` writes only the aggregate matching that highest active
schema (`events.v3.json` now). `events.v2.json` remains the frozen schema-2
compatibility artifact; live selection and exact-version lookup use the
validated mixed V3 aggregate.
Runtime code never enumerates packs. The
raw-byte build gate validates every pack, rejects duplicate object keys before
`JSON.parse` can silently keep the last value, rejects duplicate event ids and
versions, validates exact callback target versions after the merge, and fails
when generated bytes are stale. Do not add top-level `notes` to schema 2 or 3.

Every event has a lowercase snake_case, non-numeric `id` and a non-empty
`versions` array of `{ version, def }`. Versions are positive and unique within
their event; current is the numerically highest version. `id` and `version`
belong only to the envelope. The loader rebuilds the runtime `EventDef` and
keeps authoring-only legacy `def.notes` out of it.

`00-core.json` begins with every `events.v1.json` legacy event envelope unchanged,
in its existing order. Those definitions omit `delivery` and retain the legacy
schema, including their existing `notes`, gates, and behavior. `10-arrowfell.json`
holds exact schema-v2 version-1 history plus current schema-v3 version 2 for
Feathered Cairn and Far Sight. New packs append by filename order; do not
rename/reorder the existing packs or edit the historical payloads.
`20-duskbarrow.json` through `90-thornwild.json` add the approved schema-v3
biome slice (eight anchors and three callbacks) in filename/biome order.
`events.v1.json` remains the frozen parity baseline, not a runtime source.

Schema-v2 definitions include `title`, `body`, `theme`, `rarity`, optional
`biomeIds`/`artId`, `story`, `eligibility`, `delivery`, `visibility`, `priority`,
`once`, `cooldownNodes`, and two or three choices. Themes are `training`,
`cache`, `recruit`, `forge`, `market`, or `omen`; rarities are `common`,
`uncommon`, `rare`, or `secret`. Omit `artId` to use the theme fallback art.
Map previews always remain theme-based.

`eligibility` is a closed AST: `all`, `any`, `not`, and the facts
`biome.current`, `board.affinity`, `owned.card.count`, or `callback.queued`.
Schema 2 deliberately narrows owned-card matching to a non-empty
`{ "weapons": [...] }` matcher. `delivery` is exactly `{ "kind": "ambient" }`
or `{ "kind": "queued_callback" }`; queued callback eligibility is exactly the
matching `callback.queued` fact. Visibility is `visible`,
`hidden_until_eligible`, or `teased_when_due`. `once` is `node` or `run`, and
priority is an integer from 0 through 999.

Choices have lowercase snake_case `id`, non-empty presentation `label`, a
0..999 `cost`, and one typed `outcome`. A schema-v2 choice may also carry a
closed `mutations` list of `{ "op": "completeStory", "storyId": "..." }` and
one callback object. Callback fields are structured: `callbackId`, `eventId`,
`contentVersion`, `minDepthDelay`, destination themes/optional biomes,
priority, empty `bind`, and positive expiry with `fallback: "discard"`. Runtime
behavior dispatches only on these typed fields; title, body, and labels never
control outcomes, mutations, eligibility, or delivery.

Every event must keep a cost-zero, ungated safe choice. It may reward or do
nothing; availability is the promise that a player can leave.

Outcomes are a discriminated object with one of these exact shapes:

| `kind` | Additional allowed fields |
|---|---|
| `grantCard` | optional `cardId`, `filter`, `tier` |
| `grantGem` | optional `gemId`, `filter` |
| `cardChoice` | optional `filter`, `filterFrom`, `tier` (only `bronze`) |
| `gemChoice` | optional `filter` |
| `grantGold` / `loseGold` | positive integer `amount` |
| `grantLevel` / `upgradeCard` / `sellGem` / `mergeCards` / `nothing` | none |
| `grantMapInfo` | `bandsAhead`: exactly `2` or `3` |
| `bonusDraft` | optional `filter`, `filterFrom` |

Card filters are non-empty arrays of non-empty clauses using `properties`,
`weapons`, `elements`, and/or `archetypes`; gem filters are non-empty arrays of
clauses selecting exactly one of `ids`, `actionKinds`, `heroStats`, or `all: true`.
`filterFrom` is `biomeLean`, `biomeCounter`, or `boardIdentity`, and is mutually
exclusive with a static card filter. A curated gem filter with `ids` is an exact
content set, not an implied mechanical weapon filter: Far Sight's three gems
are fletcher-themed curation, not Bow-only gems. Unknown fields at every
envelope, definition, choice, gate, filter, and outcome level are errors.

### Schema-v3 live content

The loader and compiler also validate mixed version wrappers whose optional
`schemaVersion` tag explicitly selects schema 1, 2, or 3; an untagged wrapper
inherits its document envelope. Runtime projection adds
`contentSchemaVersion: 3` only to loaded v3 definitions and never writes that
marker into authored `def` JSON. `events.v3.json` now materializes current
Feathered Cairn and Far Sight definitions plus eleven schema-v3 biome
definitions and eleven global/conditional definitions while preserving
Arrowfell's explicit schema-v2 version-1 history.
The live runtime imports `events.v3.json`; the separate frozen V2 projection is
available only to compatibility callers that still read legacy `.choices`.

The live V3 run seam chooses a seed once in `createRun` and selects content
only when an event node is reached. Due callbacks are considered first with
one exact-version lookup, then fully eligible v3 conditional/special content
by priority and an isolated deterministic tie hash, then the unchanged legacy
theme no-repeat bags. Conditional and Secret definitions never enter ordinary
bags. A selected v3 instance persists its exact two-or-three choice IDs,
weighted branch IDs, typed bindings/reservations, closed reward offers, and a
closed `unavailableChoiceReasonsByChoiceId` map before it can be rendered.
That map locks an individually unavailable choice without hiding its other
committed choices. Older V3 saves that predate the field normalize a
missing map to `{}`; a present map with an unknown reason or a key outside the
committed choices is invalid. Reload reads those bytes; it never re-pools,
reweights, rebinds, or reoffers.

Dynamic V3 bindings remain closed. `revenge.finisherCardId` is required unless
that exact ambient variant authors `optional:true`; other binding kinds cannot
be optional. Callback copies never accept `optional:true`. A queued
definition's `acceptsBindings` is its exact required slot contract, not an
allow-list; producer callback bindings, persisted queue subjects, and delivered
callback subjects must match it exactly. Destination-bound callbacks also
persist and deliver exactly the copied destination biome. A `signature.cardId`
binding requires exactly one positive
`combat.signatureReady` gate outside `any`/`not`, and that gate's JSON values
qualify the selected card. Mono-type gem choices own an exhaustive ordered
eleven-case weapon/element selector in JSON. Materialization resolves the
persisted `{typeKind,type}` to one concrete offer, so later callback delivery
does not inspect the current board or a code-owned affinity mapping.

Validation recursively traces bound slots consumed by direct or weighted
outcomes and callback copies. Ambient consumers must be declared in the
definition's `bindings`; queued consumers must be declared by the target's
exact `acceptsBindings` contract. If an unvisited future-biome binding has no
candidate, materialization remains valid and locks only the choice that copies
that absent destination, using the coded `no_unvisited_biome` reason; its other
committed choices remain available.

V3 resolution reads only that persisted materialization. Every random or
deferred legacy outcome is first converted to a separate v3 commitment DTO
(never `DraftCard`), including exact card/gem subjects, card/gem picks,
upgrade/sell targets, and merge inputs/candidates. Cost, gates, outcome,
mutations, exact reservation consumption, callback scheduling, and the single
resolution/stat update form one returned-state transaction. All 66 validated
event IDs are live while the frozen V2 artifact retains exact historical
compatibility. The Bronze start draft remains a separate type and system.

## The rules a card must pass

Run `npm run content:events` after changing source packs, then
`npm run content:validate`. Validation also runs first inside `npm run build`,
so a document that would not load cannot produce a deployable artifact.

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

### There is no `text` field

A card's face is **generated** from its `effects` — `renderSkillText`
(`src/engine/keywords/compose.ts`) walks the keyword registry in
`src/engine/keywords/text.ts` and prints one clause per effect, in one fixed
order, with this card's own numbers as `{{Keyword}}` tokens. Authoring a `text`
is a validation ERROR, not a silently ignored field.

The keyword's MECHANISM is never on the face. It lives once, as that keyword's
parameter-free `ruleSentence`, and a player reaches it by tapping the coloured
token (`cardGlossary.ts`). So:

- **to change what a card does** — edit `effects`. The face follows.
- **to change how a keyword READS on every card** — edit its row in
  `src/engine/keywords/text.ts`. One edit, 183 cards, four tiers.
- **to change what a keyword MEANS to a player** — edit that row's
  `ruleSentence`. It must contain no digit, no `%` and no markup: it is a
  definition, and it reads identically on every card that carries the keyword.

### Optional fields

`speedWeight` (0..200), `cooldownTurns` (0..99), `scope` (`one` \| `all`),
`special`, `aura`, `tierUpgrades`, `flavor`.

- **`flavor`** is the ONE authored string a card may still carry: a trailing
  line of colour the generator has no access to (`thorn_reckoning`'s "The fresh
  barbs feed your next swing."). Validated MECHANICALLY INERT — no digit, no
  `%`, no `{{...}}` token — so it can never assert a claim `effects` does not
  back, and can never go stale when a number moves at a higher tier. Four cards
  use it. Use it for colour, never for a rule.

- **`aura`** requires `affects` (`adjacent` \| `left` \| `right` \| `allBoard`) and
  a `mods` object carrying at least one of `damageFlat`, `healFlat`,
  `weightDelta`. Optional: `reach` (0..20), `archetypeFilter`, `propertyFilter`.
  These are required because the engine dereferences `aura.mods.*` and switches on
  `aura.affects` unconditionally — an incomplete aura used to crash `simulate()`
  at first use rather than failing validation.
- **`tierUpgrades`** is keyed by `silver` / `gold` / `diamond` (never `bronze` —
  bronze *is* the authored base). It carries no `text`: a tier that changes
  `effects` re-renders its own face from them. Before authoring one at all,
  check whether `autoScaleTier` already produces it — 23 blocks were deleted in
  the 2026-09-06 migration for being exact reproductions of the auto-scaler,
  and 62 more for carrying nothing but a `text`.

### Action kinds

Every action carries a `kind` discriminant plus exactly its own fields. An unknown
field on an action is an error.

| kind | fields |
|---|---|
| `damage` `heal` `shield` | `power` |
| `statStrike` | `shareOf`, optional `cap` |
| `poison` `burn` `bleed` | `stacks` |
| `stun` | `turns` |
| `slow` `burden` | `weight` |
| `curse` | `amount`, `turns` (both required, both >= 1) |
| `splash` | *(none — the spreader carries no payload)* |
| `disrupt` `shieldBreak` `comboBonus` `taunt` | `amount` |
| `chainBonus` | `after` + `amount` |
| `expose` | `pct`, `turns` |
| `guard` | `property`, `pct`, `turns` |
| `negate` | `property`, `charges` |
| `cleanse` | `charges` |
| `lifesteal` | `pct` |
| `buffStat` `debuffStat` | `stat`, `pct`, `turns` |
| `exploit` | `status`, `amount` |
| `stackBonus` | `status`, `of`, `per`, `cap` (all four required) |
| `shieldBurst` | `cap` (required) |
| `wardRelease` | `per`, `cap` (both required) |
| `desperation` | `amount` |
| `overhealShield` | `cap` (required) |
| `cleanseConvert` | `per`, `cap` (both required) |

`stat`: `attack` `magicPower` `armor` `magicResist` `speed`.

`status`: `poison` `burn` `bleed` `stun` `debuff` `expose` for `exploit`;
`poison` `burn` `bleed` `thorns` `burden` for `stackBonus`.
`of`: `caster` (read your own side) or `target` (read the victim's).

The first four are PILES and the rider counts their stacks; `burden` is a weight
penalty on a CARD, so the rider counts how many of that side's BOARD PIECES carry
one — cards, not points. A pending unit-scope `slow` is not counted: it marks no
piece. (This replaced the hardcoded `taxBonus` keyword on 2026-09-14; the price is
unchanged, since both forms charge the same `cap × rate ÷ discount`.)

`cap` is REQUIRED on `stackBonus`/`shieldBurst`/`wardRelease`/
`overhealShield`/`cleanseConvert` and is the only thing priced: the payload is
`min(per × count, cap)` (or `min(your shield, cap)`, or `min(this heal's overflow,
cap)`), which is unbounded in a resource the card does not own, so only the ceiling
can carry an honest price. A big `per` is free — it just makes the rider reach its
cap sooner. `exploit` and `desperation` have no count to multiply, so their flat
`amount` IS the priced magnitude.

**Ordering rule for the seven conditional riders** — `exploit`, `stackBonus`,
`shieldBurst`, `wardRelease`, `desperation`, `overhealShield`,
`cleanseConvert` (user-locked 2026-08-21). Every one of them reads a resource that
is ALREADY there and hands a flat bonus to the cast, so the authored effect list
must run **rider → the action it feeds → anything this card supplies**. The
validator rejects anything else: a rider behind what it feeds arms a bonus nothing
can spend, and this card's own line ahead of it would let the card trigger itself
on its first cast — the payoff is meant to land on the NEXT one.

**WHAT EACH RIDER FEEDS.** Five of them arm bonus DAMAGE, so a `damage` action must
follow. The two heal-side ones — `overhealShield` and `cleanseConvert` — arm the
cast's own HEAL, so a **`heal`** action must follow instead; the validator names the
right kind in the error, and a heal rider on a card with only a damage line is
rejected as the priced no-op it is.

**`cleanseConvert` is ordered BOTH WAYS**, and it is the only one: it converts the
stacks its own cleanse actually removed, so a `cleanse` must sit **before** it and
the `heal` **after** it — `cleanse → cleanseConvert → heal`. This is not an
exception to the ruling: the rider still reads something that is already there when
it runs. Its own cleanse is the conversion MECHANISM, not the gate (the gate is
"somebody on your side is afflicted", which only the enemy supplies), which is why
it keeps the discount despite carrying its own cleanse.

What counts as "supplies", per rider: `poison`/`burn`/`bleed`/`stun`/`debuffStat`/
`expose`/`thorns` for the status readers, `shield` (and `overhealShield`, which
banks plating out of a heal) for `shieldBurst` (caster-side), `ward` for
`wardRelease` (caster-side), and `burden` for a `stackBonus` whose `status` is
`burden` (`splash` supplies nothing — it only widens a burden's reach; `slow`
supplies nothing — it marks no piece; `curse` supplies nothing — a weight tax is
not what it puts there). Side matters: `stackBonus` with `of: 'caster'` is only
ordered against CASTER-side applications (i.e. `thorns`), and a `shield` line is
irrelevant to a burden reader.

**Three gates cannot be self-supplied at all**, so `desperation`, `overhealShield`
and `cleanseConvert` always price at the discount and can never owe the
self-synergy premium: no keyword can lower the caster's own HP fraction, raise an
ally past full, or afflict your own side.

**`burden` gets no exception** for being the longest-lived self-supply: the ruling
is about self-triggering, not about how long the resource lasts. A `burden` +
burden-reader card still pays off on every LATER cast, until the burdened piece is
played — just never on the cast that burdened it.

**`scope: 'all'` is refused with `splash`, `shieldBurst` and `wardRelease`.** Splash
is single-target at the unit level; a burst spends ONE wall ONCE and a release ONE
pile of charges ONCE, and either bonus would otherwise be handed to every foe at a
single-target price (both are caster-side keywords, so they pay no AoE reach
multiplier). An AoE `stackBonus` or `desperation` is fine — both are armed per victim
and do pay reach. So is an AoE `burden`/`curse`: one card per foe is the same linear
reach an AoE `slow` has, priced by the reach multiplier — it is band × foes that the
splash rule refuses. The two heal-side riders need no rule at all: a `heal` resolves
once on the support target whatever the scope.

### The card-targeting keywords and their spreader

`burden` and `curse` land on ONE of the victim's board cards — the ANCHOR, the
card their cast cursor is on (or the last card they played, when the cursor is
parked past the end of the board; nothing about this wraps). `burden` makes that
card cost +weight the next time it is played (paid once, then spent, however many
turns it takes); `curse` makes it deal −amount damage for N global turns (never
below 1 damage total, and the window is the same one a status of N turns gets).

`splash` has **no payload of its own**. Its only meaning is that the cast's
`burden`/`curse` apply to the whole BAND — the anchor plus the pieces
immediately either side of it, 1 to 3 cards depending on the victim's board —
instead of to the anchor alone. So:

| authored | what lands |
|---|---|
| `burden 6` | +6 weight on ONE card |
| `burden 6` + `splash` | +6 weight on up to THREE cards |
| `curse 4/2t` | −4 damage on ONE card for 2 turns |
| `curse 4/2t` + `splash` | −4 damage on up to THREE cards for 2 turns |
| `splash` alone | **rejected** — a spreader with nothing to spread |

Both re-applications take the **stronger** value, never a sum (`Math.max`), so a
second cast can never lock a card out. Splash is priced FLAT and STANDALONE
(`PRICE.splashFlatDeci`, 20 deci per cast — user-locked 2026-08-21, never a
multiplier on its siblings), which is why a spread line costs its anchor-only
form plus one fixed spreader price, whatever the payload's magnitude.

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
2. **Card-text generation** (`tests/engine/cardText.test.ts`) — every card, at
   every reachable tier, must render a non-empty well-formed face, and a GOLDEN
   SET of twelve faces covering each feature of the grammar once must not move
   silently. Drift between the face and the kit is no longer a failure mode:
   there is one source for both.
3. **Keyword reachability** (`tests/engine/keywordRegistryReachability.test.ts`) —
   every rule-bearing keyword marks its own name up on the face, that token
   resolves to a colour, and its definition is reachable identically on desktop
   hover and mobile tap. This is what makes taking the rule prose OFF the face
   safe rather than merely shorter.
4. **Text style** — `src/engine/keywords/text.ts` IS the wording now
   (`docs/card-text-style-guide.md` is HISTORY); `docs/card-template-spec.md`
   still owns the `{{keyword}}` markup.

## Workflow

```
npm run content:events       # compile event packs into the highest versioned aggregate
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
