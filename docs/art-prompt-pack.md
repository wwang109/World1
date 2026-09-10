# Art Prompt Pack — run-layer UI assets (LIVING)

Scope: one ready-to-feed image-generation prompt block per **run-layer UI
asset** (event area illustrations, biome band backgrounds, event choice-type
icons, currency, lives, boss, storefront). Card art / badge icons are owned by
[`icon-generation-prompts.md`](icon-generation-prompts.md) — the archetype,
element, and weapon badges already exist in `public/game-art/template/` and
are NOT duplicated here.

All **43 active run illustrations** below have final masters and served
derivatives: 39 newly illustrated pairs plus four intentional bright reuses
(the run map and three Bell-story illustrations).
The historical directory name remains `art-src/placeholders/`, deliberately
**outside `public/`** so `vite build` never ships a master.

**Swapping in real art is two steps, no code change:**

1. Save the generated PNG over the placeholder master in
   `art-src/placeholders/<file>.png`.
2. Run `npm run art:encode`, which writes the served derivative
   `public/game-art/placeholders/<file>.webp` — the file the game actually
   loads (`RUN_ART_ASSETS` in `src/game/ui/runArt.ts` names the `.webp`).

Commit **both**: the master and the generated `.webp`. The `.webp` is
generated but checked in — the build has no Chromium to encode with. Full
rationale: [`card-template-spec.md`](card-template-spec.md) §4.1.

**Shared style lines** (keep verbatim so new art matches the existing set):

- *Icon style* — `Lightweight cute glossy game icon style, like Ragnarok
  Online and MapleStory inventory icons: clean bold outlines, soft glossy
  shading with bright highlights, warm cheerful saturated colors, rounded
  charming shapes, gentle glow, polished and adorable, no gritty textures,
  no photorealism.`
- *Illustration style* — `Bright manga/anime adventure environment painting:
  crisp matte cel-painted shapes, restrained ink accents, broad azure/cyan
  atmosphere, fresh green planes and warm cream/coral/gold light, luminous
  readable cool shadows and clear silhouettes. No gritty photorealism,
  glossy 3D finish, black vignette, characters, text, border, frame or watermark.`

The illustration direction follows the user's 2026-09-06 sunlit mountain,
coastal street and lakeside castle references. Preserve each subject below;
night, storm and dark-family locations use luminous blue/violet atmosphere
and warm local light so their identity remains clear. Icon/badge styling is
unchanged. Bespoke point-of-interest events receive their cream/ink manga
panel outline in the shared UI renderer, inside the existing image bounds;
ordinary theme areas keep their neutral edge. Never bake either into art.

Practical notes: generate at 4–8× the target size and downscale to the exact
px. Icons need a **transparent** background — if the generator can't emit
alpha, generate on flat `#14181f` and cut out. Illustrations are **opaque**
edge-to-edge (the UI clips its own corners).

---

## Landing / front-door assets

`StartScene` owns this isolated four-asset family; it is loaded directly by
`startSceneAssetPaths()` rather than through the shared run-art catalog.

| Asset | Master contract | Served derivative | Runtime use |
|---|---|---|---|
| `start-background-desktop.png` | 1586x992 opaque RGB; bright painted world map, center safe for the 1440x900 title stack | `start-background-desktop.webp` | desktop cover crop |
| `start-background-mobile.png` | 852x1846 opaque RGB; portrait companion with the same world geography and a center-safe lower ocean | `start-background-mobile.webp` | mobile cover crop |
| `start-cta-frame.png` | 1973x586 RGBA; empty restrained coral plate, thin antique-gold outline, clipped/scalloped ends, clean alpha; no text or glow | `start-cta-frame.webp` | frame behind live Start/Resume copy |
| `start-icons.png` | 2172x724 RGBA sprite strip; four equal 543x724 frames in order: crossed swords, knight helmet, five-point star, reroll arrow; flat gold, clean alpha, no glow/fringe | `start-icons.webp` | live lifetime values and seed control |

Generation direction: match the approved centered landing mockups with bright
anime-map painting and restrained cream/coral/gold UI ornament. Keep both
backgrounds free of UI/text. Keep the frame center empty for dynamic Phaser
copy. Keep every icon centered at equal visual weight and legible around 21-36
display pixels. Masters and WebP derivatives are committed as pairs.

---

## 1. Event area illustrations (6) — 360×140, opaque

Subjects come from the D&D area identities in
`src/game/ui/eventThemeBlurb.ts`. Common block per area — replace
`{SUBJECT}`:

```
Wide landscape fantasy location illustration, 360x140 aspect (generate large,
downscale). {SUBJECT} Bright manga/anime adventure environment painting:
crisp matte cel-painted shapes, restrained ink accents, broad azure/cyan
atmosphere, fresh green planes and warm cream/coral/gold light, luminous
readable cool shadows and clear silhouettes. No gritty photorealism,
glossy 3D finish, black vignette, characters, text, border, frame or watermark.
Opaque background, key detail kept in the
central band so the edges can crop safely.
```

| Theme | `{SUBJECT}` | Save to |
|---|---|---|
| training | A windswept sparring yard of packed dirt and splintered wooden dueling posts, dust hanging golden in the air, worn training dummies and a rack of practice weapons under a pale sky. | `art-src/placeholders/area-hollow-yard.png` |
| cache | Sunken earthen barrows and rusted supply crates half-swallowed by dark mud along a marshy roadside, a glint of something metallic in a freshly dug hollow, mist low over still water. | `art-src/placeholders/area-silt-hollows.png` |
| recruit | A roadside waystation of colorful campaign tents and banners along a rutted road, campfires with cookpots, a medic's tent with hanging herb bundles, weapon racks and bedrolls, warm and welcoming. | `art-src/placeholders/area-muster-road.png` |
| forge | A scatter of open-air smithies and half-collapsed stone forges, anvils glowing faintly orange, sparks and ember motes rising into a dusky sky, stacked ingots and quenching barrels. | `art-src/placeholders/area-cinderworks.png` |
| market | A crowded stone toll bridge and caravan road, canvas-topped merchant wagons, hanging lanterns, coin scales on a toll-keeper's table, purses and crates changing hands in warm lamplight. | `art-src/placeholders/area-tolling-road.png` |
| omen | A lonely stone shrine where two dirt roads cross at twilight, carved with a rising sun on one face and a crescent moon on the other, guttering votive candles, a violet star-strewn sky that feels watched. | `art-src/placeholders/area-crossroads-unquiet.png` |

---

## 1b. Biome band backgrounds (11) — 512×288, opaque RGB

These exact 16:9 masters identify the live biome forecast inside the shared
run-map band banner. The renderer cover-crops the image behind the existing
banner copy, then applies a light navy veil; local dark text outlines protect
legibility while retaining the illustrated color. Keep the main landmark
centered and crop-safe. Common block — replace `{SUBJECT}`:

```
Wide cinematic fantasy biome landscape, exact 512x288 aspect (generate large,
downscale). {SUBJECT} Bright manga/anime adventure environment painting:
crisp matte cel-painted shapes, restrained ink accents, azure/cyan atmosphere,
cream clouds, fresh green planes and warm cream/coral/gold light. Clear
silhouettes and luminous cool shadows; preserve night/storm identity with
readable blue/violet light. Main landmark within the central 56% width so a
central square crop keeps its identity. No gritty photorealism, glossy 3D
finish, black vignette, characters, text, border, frame, logo or watermark.
Opaque RGB background, main landmark centered and crop-safe.
```

| Biome ID | `{SUBJECT}` | Save to |
|---|---|---|
| arrowfell | Windswept golden highlands beneath a clearing storm, broken standing stones and a distant watchtower citadel overlooking the road. | `art-src/placeholders/biome-arrowfell.png` |
| duskbarrow | Misty burial mounds among gnarled leafless trees, sealed stone tomb doors and faint violet grave-lights under a dim sky. | `art-src/placeholders/biome-duskbarrow.png` |
| emberwaste | A black volcanic plain cut by incandescent lava channels, ash clouds glowing around a jagged volcanic citadel. | `art-src/placeholders/biome-emberwaste.png` |
| frostmarch | A vast blue ice field with crystalline spires, windblown snow and a distant ice fortress beneath cold aurora light. | `art-src/placeholders/biome-frostmarch.png` |
| hallowfield | Rolling consecrated fields leading to a luminous hilltop cathedral-citadel, roadside shrines caught in warm sun rays. | `art-src/placeholders/biome-hallowfield.png` |
| howlmoor | A moonlit, wind-bent moor with ancient standing stones and a distant mountain den glowing amber through the mist. | `art-src/placeholders/biome-howlmoor.png` |
| ironmoot | A vast fortified war camp of palisades, towers, red banners and forge fires spread across a hard-packed plain. | `art-src/placeholders/biome-ironmoot.png` |
| pikewold | A green hedgerow valley with cypress-lined terraces and winding roads climbing toward a fortified hilltop town. | `art-src/placeholders/biome-pikewold.png` |
| stormreach | A lightning-lashed mountain spire and observatory above a winding cliff road, storm clouds split by electric light. | `art-src/placeholders/biome-stormreach.png` |
| swornhold | A snowbound mountain fortress with warm gate lights, high stone walls and steep peaks at blue twilight. | `art-src/placeholders/biome-swornhold.png` |
| thornwild | A dense ancient forest of tangled vines surrounding a colossal luminous tree-ruin, with violet motes in the undergrowth. | `art-src/placeholders/biome-thornwild.png` |

Encode only this source group with `npm run art:encode -- --group placeholders`;
the resulting served files are
`public/game-art/placeholders/biome-<biomeId>.webp` at the same 512×288 size.

## 1c. Journey world map — 1672×941, opaque RGB

This is the bright world canvas behind `StartScene`, `DesktopRunMapScene`, and
`MobileRunMapScene`. Save the master to
`art-src/placeholders/run-map.png`; `npm run art:encode -- --group placeholders`
writes `public/game-art/placeholders/run-map.webp`. Desktop cover-crops it into
1440×900. Mobile intentionally uses the center portrait crop at 412×892, so
the central snow-to-gold river/road corridor must remain a complete readable
journey while the forest and volcanic biomes enrich the wider desktop view.

```
Wide approximately 16:9 oblique fantasy continent/world-map illustration.
Distinct broad biome masses: turquoise ocean and islands, fresh green forest,
sunny gold plains and roads, white-blue ice mountains, and warm coral-orange
volcanic land, with only a few clear fantasy settlements. Bright high-key
manga/anime adventure environment painting: clean matte cel-painted shapes,
crisp silhouettes, luminous azure/cyan atmosphere, cream clouds and snow,
fresh lime-green land, coral accents, and warm gold sunlight. Simplify into
large calm color fields; keep the central vertical snow-to-plains route clear
for a portrait crop. Restrained colored-pencil edge texture only on major
contours. No words, labels, icons, shields, compass, border, HUD, characters,
logo, watermark, dark navy grading, muddy shadows, heavy ink, glossy 3D,
photorealism, or dense micro-detail.
```

---

## 2. Event choice-type icons (5) — 48×48, transparent

One icon per presentation family used by the outcome kinds authored in
`src/data/content/events.v1.json` and typed by `src/data/eventTypes.ts`:
`grantGold`/`loseGold` → gold; `grantCard`/`cardChoice`/`bonusDraft`/
`upgradeCard`/`mergeCards` and their picker results → card;
`grantGem`/`gemChoice`/`sellGem` and their picker results → gem;
`grantLevel` → level; `nothing` → nothing. Common block — replace `{EMBLEM}`:

```
A single small fantasy game icon: {EMBLEM}. Lightweight cute glossy game icon
style, like Ragnarok Online and MapleStory inventory icons: clean bold
outlines, soft glossy shading with bright highlights, warm cheerful saturated
colors, rounded charming shapes, gentle glow, polished and adorable, no
gritty textures, no photorealism. Centered, filling about 80% of the frame,
TRANSPARENT background, no badge plate, no text, no watermark. Final size
48x48 px.
```

| Outcome | `{EMBLEM}` | Save to |
|---|---|---|
| gold | a small tied coin pouch spilling three gold coins | `art-src/placeholders/icon-choice-gold.png` |
| card | a single upright playing card with a glowing arcane blue back | `art-src/placeholders/icon-choice-card.png` |
| gem | a faceted teardrop-cut emerald gem with a bright sparkle | `art-src/placeholders/icon-choice-gem.png` |
| level | two stacked upward golden chevron arrows with a rising sparkle | `art-src/placeholders/icon-choice-level.png` |
| nothing | a slate-gray rounded circle emblem with a simple horizontal dash | `art-src/placeholders/icon-choice-nothing.png` |

---

## 3. Currency coin (1) — 32×32, transparent

```
A single small fantasy game icon: one round gold coin seen slightly from
above, embossed with a simple star, one bright glossy highlight. Lightweight
cute glossy game icon style, like Ragnarok Online and MapleStory inventory
icons: clean bold outlines, soft glossy shading with bright highlights, warm
cheerful saturated colors, rounded charming shapes, gentle glow, polished and
adorable, no gritty textures, no photorealism. Centered, filling about 85% of
the frame, TRANSPARENT background, no text, no watermark. Final size 32x32 px.
```

Save to: `art-src/placeholders/icon-coin.png`

## 4. Lives heart (1) — 48×48, transparent

```
A single small fantasy game icon: a plump glossy ruby-red heart with a bright
window highlight and a faint warm glow. Lightweight cute glossy game icon
style, like Ragnarok Online and MapleStory inventory icons: clean bold
outlines, soft glossy shading with bright highlights, warm cheerful saturated
colors, rounded charming shapes, gentle glow, polished and adorable, no
gritty textures, no photorealism. Centered, filling about 80% of the frame,
TRANSPARENT background, no text, no watermark. Final size 48x48 px.
```

Save to: `art-src/placeholders/icon-life-heart.png`

## 5. Boss skull (1) — 48×48, transparent

```
A single small fantasy game icon: a menacing but charming stylized horned
skull in bone-white with deep crimson eye glow, slightly oversized lower jaw.
Lightweight cute glossy game icon style, like Ragnarok Online and MapleStory
inventory icons: clean bold outlines, soft glossy shading with bright
highlights, warm cheerful saturated colors, rounded charming shapes, gentle
glow, polished and adorable, no gritty textures, no photorealism. Centered,
filling about 80% of the frame, TRANSPARENT background, no text, no
watermark. Final size 48x48 px.
```

Save to: `art-src/placeholders/icon-boss-skull.png`

## 6. Shop storefront fallback icon (1) — 48×48, transparent

`icon-storefront` is now the unknown-shop safety fallback only. All 21 live
shop IDs resolve to their own §7.2 512×288 banner and served WebP derivative.
The five weapon-focused additions are `swordwright`, `cleaving_yard`,
`lancers_rest`, `fletchers_loft`, and `beastmoot`; their dedicated
`shop-front-<shopId>.webp` derivatives ship with the original 16-shop set.

```
A single small fantasy game icon: a cozy wooden market stall with a striped
canvas awning, a small hanging shop sign (blank, no letters), and a counter
with a few wares. Lightweight cute glossy game icon style, like Ragnarok
Online and MapleStory inventory icons: clean bold outlines, soft glossy
shading with bright highlights, warm cheerful saturated colors, rounded
charming shapes, gentle glow, polished and adorable, no gritty textures, no
photorealism. Centered, filling about 80% of the frame, TRANSPARENT
background, no text, no watermark. Final size 48x48 px.
```

Save to: `art-src/placeholders/icon-storefront.png`

### Per-theme accent notes (seed table for §7.2)

Themes from `src/data/shopTypes.ts`. The per-theme pass is now specced in
full — **§7.2 below** carries one ready-to-feed banner prompt per theme,
built from this table (awning color + counter prop):

| Shop id | Name | Awning accent | Signature prop on the counter |
|---|---|---|---|
| `armory` | Armory | steel gray | a kite shield and crossed sword |
| `wildworks` | Wildworks | forest green | a recurve bow and a paw print |
| `arcanum` | Arcanum | arcane blue | a crackling elemental orb |
| `sanctum` | Sanctum | white and gold | a glowing sun-and-moon censer |
| `alchemist` | Alchemist | poison green | bubbling round-bottom flasks |
| `gemcutter` | Gemcutter | violet | a jeweler's loupe over cut gems |
| `caravan` | Caravan | patched multicolor | an overstuffed travel trunk |
| `bulwark` | Bulwark | slate blue | a tower shield leaned on the counter |
| `assassins_den` | Assassins' Den | near-black | a hooded lantern and thrown dagger |
| `relic_vault` | Relic Vault | aged bronze | an ornate reliquary chest |
| `emberworks` | Emberworks | ember orange | a brazier with a live flame |
| `frosthold` | Frosthold | ice blue | a frosted crystal cluster |
| `stormspire` | Stormspire | electric yellow | a jar with a captive spark |
| `grovekeep` | Grovekeep | leaf green | a potted sapling with glowing leaves |
| `reliquary` | Reliquary | radiant gold | light kept in a stoppered jar |
| `umbral_stall` | Umbral Stall | deep violet | a veiled crescent-moon idol |

---

## 7. PLACEMENT MAP — shops & events (handoff spec)

WHERE every image goes on the shop/event/map screens and WHAT to generate,
so finals are drop-in file replacements. **Read this first:** the event,
shop, and run-map scenes are under active rework, so every placement below
is anchored to a **stable structural region** (panel/grid/row that survives
a layout pass) and every px number is **PROVISIONAL** — treat structure as
the contract, px as today's snapshot. Canvases: desktop **1440×900**
(safe-x 32, gap 12), mobile **412×892** (safe-x 10, gap 8) — from
`src/game/layoutProfile.ts`. Header/content bands come from
`src/game/ui/runScreenTemplate.ts` (desktop content starts at y≈130, mobile
at y≈100, both full-chrome).

File-path contract (unchanged from the pack header): the placeholder path IS
the final MASTER path — `art-src/placeholders/<file>.png`. It is served as
its derivative at `/game-art/placeholders/<file>.webp`, written by
`npm run art:encode`. Swapping in real art is a file replace plus that one
command; no code changes.

### 7.1 Slot inventory (screen → slot → asset)

| # | Screen (both platforms) | Slot — structural anchor | Asset family | File(s) | Display size (provisional) |
|---|---|---|---|---|---|
| B1 | Run map — biome band banner | cover-cropped behind the existing band title, subtitle, affordance, and lean-color hairline/pill | biome background, 11 identities, **§1b** | `biome-<biomeId>.png` 512×288 | full existing band rect on desktop and mobile; geometry unchanged, navy readability scrim above image |
| S1 | Shop — storefront picker | top band of each shop tile in the picker grid | shop-front banner, 21 themes, **§7.2** | `shop-front-<shopId>.png` 512×288 | at 1440×900 desktop pages 8/8/5 in a 4×2 grid, each full-page tile ≈335×308 with a ≈335×142 banner; at 412×892 mobile independently pages 6/6/6/3 in a 2×3 grid, each tile ≈193×244 with a ≈193×109 banner |
| S2 | Shop — shelf view | header band, behind/right of the shop name + tagline block | same 21 banners (reuse S1 file) | `shop-front-<shopId>.png` | desktop: full-content-width strip ≈1376×96 center-crop; mobile: ≈392×56 strip |
| S3 | Shop — buy-confirm dialog | left of the "Buy X for N gold?" headline | coin icon (reuse §3) | `icon-coin.png` 32×32 | 24–32 px |
| E1 | Event — story panel | inside `renderStory()`, after the area intro and before the title | optional per-event final, otherwise 6-area fallback | `event-<story>.png` 1774×887 or `area-<areaName>.png` | desktop caps at 520×260 and can shrink proportionally to the 180×90 floor; mobile uses its ≈388×194 inner-width crop |
| E2 | Event — choice rows | left of the title inside each `RunChoicePanel` row, right of the accent rail | choice-type icon (reuse §2) | `icon-choice-<kind>.png` 48×48 | 36–44 px (row h: 84 desktop / 80 mobile) |
| E3 | Event — outcome panel | centered above the outcome headline | choice-type icon keyed by `outcome.kind` (reuse §2) | `icon-choice-<kind>.png` | 44–48 px |
| M1 | Run map — event-node choice panel | left thumb inside the `RunChoicePanel` row | square **code-side center-crop** of the node's area art (no new file) | `area-<areaName>.png` | ≈72×72 desktop / 56×56 mobile (row h ≈92/–) |
| M2 | Run map — shop-node choice panel | left thumb inside the `RunChoicePanel` row | square code-side center-crop of the shop banner (no new file) | `shop-front-<shopId>.png` | same as M1 |
| M3 | Run map — fight/boss/other kinds | left thumb slot | existing kind icons (§4/§5) | `icon-boss-skull.png` etc. | 40–48 px |

Only S1/S2's 21 banners require one image per shop; every other slot reuses
art already prompted in §1–§5. Thumbs (M1/M2) are runtime crops
(`setCrop`/texture frame) of the 512×288 banners — do NOT generate separate
thumb files; one banner must therefore keep its subject readable in the
**center square** (the prompt block below bakes that in).

### 7.2 Shop storefront banners (21) — 512×288, opaque — THE new prompts

One wide banner per shop theme in `src/data/shopTypes.ts`. The runtime
cover-crops this 16:9 master into both the wide shelf header and compact picker
thumb so shops and events retain one banner idiom.
Filename embeds the catalog id **verbatim** (underscores kept) so the master
is `shop-front-${shopId}.png` and its served derivative
`shop-front-${shopId}.webp`, with no mapping table. The final PNG masters and
encoded WebP derivatives are both kept on disk.

Common block — replace `{SUBJECT}`:

```
Wide landscape fantasy market-stall illustration, 512x288 (16:9) aspect
(generate large, center-crop/downscale). {SUBJECT} Bright manga/anime adventure
environment painting: crisp matte cel-painted shapes, restrained ink accents,
warm inviting architecture, azure/cyan atmosphere and cream/coral/gold light,
luminous cool shadows, clear merchandise silhouettes and restrained detail.
Preserve the shop's awning accent and signature prop. No gritty photorealism,
glossy 3D finish, black vignette, characters, text, border, frame or watermark.
Any shop sign is blank. Opaque
background, the stall itself centered so a square center-crop still reads as
this shop.
```

| Shop id | Name — tagline | `{SUBJECT}` | Save to |
|---|---|---|---|
| `armory` | Armory — "Steel and shield" | A sturdy armorer's market stall under a steel-gray striped awning, racks of swords, axes and lances, a kite shield with a crossed sword propped on the counter, neat steel gleam and whetstone sparks. | `art-src/placeholders/shop-front-armory.png` |
| `wildworks` | Wildworks — "Bow and beast" | A hunter's trading stall under a forest-green awning at the treeline, a recurve bow and quivers hung on pegs, pelts and a paw-print token on the counter, feathers and leather cords swaying. | `art-src/placeholders/shop-front-wildworks.png` |
| `arcanum` | Arcanum — "the elemental wheel" | A wizard's supply stall under an arcane-blue awning, a crackling elemental orb on the counter swirling with fire, frost, lightning and leaf-green light, shelves of rune-etched focus crystals. | `art-src/placeholders/shop-front-arcanum.png` |
| `sanctum` | Sanctum — "healing and support" | A serene shrine-stall under a white-and-gold awning, a glowing sun-and-moon censer trailing soft incense on the counter, vials of radiant and dusky healing water, a gentle holy glow. | `art-src/placeholders/shop-front-sanctum.png` |
| `alchemist` | Alchemist — "debuff and control" | A cluttered alchemist's stall under a poison-green awning, bubbling round-bottom flasks and dripping retorts on the counter, hanging herb bundles and stoppered hex bottles, a wisp of green vapor. | `art-src/placeholders/shop-front-alchemist.png` |
| `gemcutter` | Gemcutter — "Facets for every socket" | A jeweler's stall under a violet awning, a jeweler's loupe over a tray of brilliantly cut gems on dark velvet, tiny chisels and a polishing wheel, rainbow sparkles off every facet. | `art-src/placeholders/shop-front-gemcutter.png` |
| `caravan` | Caravan — "Everything, once, at a price" | An overstuffed traveling wagon-stall under a patched multicolor awning, an open travel trunk spilling wares of every kind — blades, scrolls, trinkets — rope-tied bundles and hanging lanterns. | `art-src/placeholders/shop-front-caravan.png` |
| `bulwark` | Bulwark — "Nothing gets through" | A fortified shield-wright's stall under a slate-blue awning, a massive tower shield leaned against the counter, stacked bucklers and riveted iron plates, heavy brackets, solid and immovable. | `art-src/placeholders/shop-front-bulwark.png` |
| `assassins_den` | Assassins' Den — "Fast, quiet, lethal" | A shadowy back-alley stall under a near-black awning, a hooded lantern casting one thin beam over a thrown dagger stuck in the counter, coiled cord and vials of night-dark oil. | `art-src/placeholders/shop-front-assassins_den.png` |
| `relic_vault` | Relic Vault — "Old power, honest price" | An antiquarian's vault-front stall under an aged-bronze awning, an ornate reliquary chest half-open with old treasures glinting inside, wax-sealed scroll cases and verdigris-touched artifacts. | `art-src/placeholders/shop-front-relic_vault.png` |
| `emberworks` | Emberworks — "Fire answers to nobody" | A fire-seller's stall under an ember-orange awning, a brazier with a lively dancing flame on the counter, banked coals and rising ember motes, heat-shimmer over blackened iron tools. | `art-src/placeholders/shop-front-emberworks.png` |
| `frosthold` | Frosthold — "Cold patience" | An ice-trader's stall under an ice-blue awning rimmed with frost, a frosted crystal cluster glowing pale blue on the counter, icicles under the eaves and a small drift of snow at its base. | `art-src/placeholders/shop-front-frosthold.png` |
| `stormspire` | Stormspire — "Thunder, sold by the bolt" | A storm-chandler's stall under an electric-yellow awning, a glass jar holding a captive crackling spark on the counter, coiled copper rods and lightning-glass trinkets with tiny arcs jumping between them. | `art-src/placeholders/shop-front-stormspire.png` |
| `grovekeep` | Grovekeep — "Roots outlast steel" | A druid's garden stall under a leaf-green awning woven with living vines, a potted sapling with softly glowing leaves on the counter, seed pouches, acorns and moss-covered baskets. | `art-src/placeholders/shop-front-grovekeep.png` |
| `reliquary` | Reliquary — "Light kept in a jar" | A holy relic stall under a radiant-gold awning, warm light kept in a stoppered glass jar glowing on the counter, votive candles, prayer beads and small gilded icons under a soft halo. | `art-src/placeholders/shop-front-reliquary.png` |
| `umbral_stall` | Umbral Stall — "Ask no questions" | A veiled occult stall under a deep-violet awning, a crescent-moon idol draped in gauzy veils on the counter, guttering purple candles and inkwells of liquid shadow in a dim moth-lit gloom. | `art-src/placeholders/shop-front-umbral_stall.png` |
| `swordwright` | Swordwright's Bench — "Every edge, sworn" | An oath-bound swordsmith's stall under deep red drapery, symmetrical racks of polished swords around a central anvil and glowing hearth, crowned by a ceremonial sword crest. | `art-src/placeholders/shop-front-swordwright.png` |
| `cleaving_yard` | The Cleaving Yard — "Bigger swing, fewer questions" | A rugged timber axe yard hung with crossed-axe emblems, heavy chopping axes and split logs around a central stump, with a working forge burning inside. | `art-src/placeholders/shop-front-cleaving_yard.png` |
| `lancers_rest` | Lancer's Rest — "Hold the line; the line is for sale" | A blue-awning lancewright's stall lined with upright cavalry lances, blue-and-gold shields and fitted saddlery, orderly and ready for the road. | `art-src/placeholders/shop-front-lancers_rest.png` |
| `fletchers_loft` | Fletcher's Loft — "Nock, draw, pay" | An elevated timber fletcher's loft beneath green drapery, with bows, arrow bundles, feathered quivers and a practice target arranged around an open workbench. | `art-src/placeholders/shop-front-fletchers_loft.png` |
| `beastmoot` | The Beastmoot — "Fang, claw, and the keeping of them" | A dark teal hide-and-bone market stall crowned by a horned beast skull, with pelts, fang charms, cages and rugged beast-handling gear around the counter. | `art-src/placeholders/shop-front-beastmoot.png` |

### 7.3 Event story-panel illustration — area fallback plus overrides

The story panel (slot E1) uses the event definition's optional `artId` override,
falling back to **per-AREA** art when absent. The first override set is the
three-stage Bell chain (`event-bell-beneath-ice.png`, `event-second-toll.png`,
`event-bell-unbound.png`); all other events share their theme's §1 illustration. The
theme→file mapping, with the current event ids from
`src/data/content/events.v1.json`:

#### Bright anime journey direction

Use this direction for new or regenerated story illustrations, especially rare,
secret, and chained events. It is grounded in the approved mountain, shrine, and
coastal-street references without copying any one composition or landmark.

- Prefer high-key daylight, sunrise, or luminous magical light. Use saturated
  azure, cyan, and turquoise as the broad base, with each biome's own accent and
  coral, orange, or gold as a warm counterpoint.
- Build the scene from five to seven large cel-painted environmental masses, one
  unmistakable focal subject, clean silhouettes, and generous negative space.
  The event must still read when shown only 388 px wide on mobile.
- Keep the colored-pencil influence restrained: selective edge texture and a
  faint paper grain are welcome; dense hatching, sketch noise, and tiny surface
  decoration are not.
- Concentrate detail on the event object and simplify the background. Avoid
  muddy shadows and crushed near-black values. Ominous hidden events may be
  darker, but must keep luminous color contrast and readable silhouettes.
- Keep every master opaque RGB at exactly 1774×887 (2:1), central-crop safe,
  with no characters, text, UI, border, frame, logo, or watermark.

This direction does not replace a shipped asset by itself. Keep the current
master and derivative until a replacement preview is selected and verified at
both desktop and mobile crops.

Despite the historical `art-src/placeholders/` directory name, these three Bell
PNGs are the current shipped masters, not temporary placeholders. Their served
WebPs are encoded from those masters and committed beside the code. Each master
is exactly **1774×887**, opaque RGB, and exactly **2:1**. Keep the Bell and its
stage-defining setting inside the central crop: desktop and mobile may trim the
outer edges but must never lose the subject. No text, frame, logo, or watermark.

Shared Bell style suffix (keep verbatim):

```text
Bright anime journey illustration with clean cel-painted shapes and a restrained
colored-pencil finish: luminous high-key lighting, saturated azure/cyan/turquoise
with a warm coral, orange, or gold counterpoint, crisp readable silhouettes, and
soft atmospheric depth. Use only five to seven large environmental masses, one
clear focal subject, generous negative space, and very little micro-detail. Wide
opaque RGB landscape, exact 1774x887 pixels (2:1). Keep the ornate silver bell
and the stage-defining landmark fully readable in the central crop. No
characters, text, UI, border, frame, logo, or watermark.
```

Bell-specific prompt blocks:

**The Bell Beneath the Ice — `art-src/placeholders/event-bell-beneath-ice.png`**

```text
A moonlit Frostmarch mountain road beneath a deep blue starry sky. In the central
foreground, an ornate silver handbell lies trapped diagonally inside a great
cracked slab of luminous cyan ice; its open mouth glows warm gold through the
frost. Snowy rocks and dark fir trees frame a winding road toward distant peaks.
Bright anime journey illustration with clean cel-painted shapes and a restrained
colored-pencil finish: luminous high-key lighting, saturated azure/cyan/turquoise
with a warm coral, orange, or gold counterpoint, crisp readable silhouettes, and
soft atmospheric depth. Use only five to seven large environmental masses, one
clear focal subject, generous negative space, and very little micro-detail. Wide
opaque RGB landscape, exact 1774x887 pixels (2:1). Keep the ornate silver bell
and the stage-defining landmark fully readable in the central crop. No
characters, text, UI, border, frame, logo, or watermark.
```

**The Second Toll — `art-src/placeholders/event-second-toll.png`**

```text
A vast Frostmarch snowfield at violet-gold twilight, encircled by distant jagged
mountains. An ornate silver handbell rests in the central foreground beside a
tall ancient stone cairn. Across the plain, smaller cairns answer with concentric
rings of warm magical light and rising sparks, suggesting a call traveling from
marker to marker beneath a crescent moon.
Bright anime journey illustration with clean cel-painted shapes and a restrained
colored-pencil finish: luminous high-key lighting, saturated azure/cyan/turquoise
with a warm coral, orange, or gold counterpoint, crisp readable silhouettes, and
soft atmospheric depth. Use only five to seven large environmental masses, one
clear focal subject, generous negative space, and very little micro-detail. Wide
opaque RGB landscape, exact 1774x887 pixels (2:1). Keep the ornate silver bell
and the stage-defining landmark fully readable in the central crop. No
characters, text, UI, border, frame, logo, or watermark.
```

**The Bell Unbound — `art-src/placeholders/event-bell-unbound.png`**

```text
Inside an open ruined forge in the Emberwaste, an enormous ornate silver handbell
lies centered on a black stone anvil. Frost-blue flame and ice crystals curl from
one rim while molten orange light burns within its mouth and across the other
side. A volcano, lava channels, furnace fire, hanging chains, smithing tools, and
large tongs frame the transformation without obscuring the bell.
Bright anime journey illustration with clean cel-painted shapes and a restrained
colored-pencil finish: luminous high-key lighting, saturated azure/cyan/turquoise
with a warm coral, orange, or gold counterpoint, crisp readable silhouettes, and
soft atmospheric depth. Use only five to seven large environmental masses, one
clear focal subject, generous negative space, and very little micro-detail. Wide
opaque RGB landscape, exact 1774x887 pixels (2:1). Keep the ornate silver bell
and the stage-defining landmark fully readable in the central crop. No
characters, text, UI, border, frame, logo, or watermark.
```

| Theme | Area (file) | Events sharing this art |
|---|---|---|
| training | The Hollow Yard — `area-hollow-yard.png` | hermits_riddle, sparring_circle, sweep_drill, tutors_return, veterans_last_lesson, wandering_tutor |
| cache | The Silt Hollows — `area-silt-hollows.png` | abandoned_cache, beast_nest, collapsed_barrow, gemsellers_mishap, quartermasters_error, the_lands_measure, thorn_garden_shrine |
| recruit | The Muster Road — `area-muster-road.png` | banner_scribe, circle_of_adepts, field_medic, recruiter, sellsword_camp, venomers_den |
| forge | The Cinderworks — `area-cinderworks.png` | cinderworks_regrind, ember_pit, retiring_smith, ruined_anvil, the_lapidary, wandering_smith |
| market | The Tolling Road — `area-tolling-road.png` | broken_axle, factors_ledger, fences_offer, flaw_finder, overloaded_caravan, toll_bridge, toll_collectors_ledger |
| omen | The Crossroads Unquiet — `area-crossroads-unquiet.png` | crossroads_shrine, fortune_teller, gambler, pyre_watch, the_reckoning, two_ravens, weighing_stone |

New events added later inherit their theme's art automatically. Story scenes
resolve `eventArtKey(event.theme, event.artId)`; map nodes do not yet know the
resolved event and continue to use the same six theme files as center-square
crops.

### 7.4 Wiring record and remaining placement notes

The event story override is shipped; the remaining shop/row-icon entries below
retain their placement contract. Mount points by file + function (no line
numbers; layouts are moving):

- **Loading (built)** — `src/game/scenes/BootScene.ts` → `preload()` eagerly
  loads all 53 entries in `RUN_ART_ASSETS`: 21 shop-front banners, 11 biome
  band backgrounds, six event-theme areas, three story-specific event
  banners, two general run/shop backdrops, and ten icons. This set remains
  intentionally eager; no lazy loading path exists. Runtime keys use the
  shipped `run-art-shop-*`, `run-art-biome-*`, `run-art-event-*`,
  `run-art-event-story-*`, and `run-art-icon-*` families; files load from
  `/game-art/placeholders/...`.
- **B1 biome band (built)** — `bandBannerViewModel()` exposes the exact live
  `biomeId` and strict `run-art-biome-*` key; `renderRunBandBanner()` cover-
  crops it with `addRunArt()` behind a light `UI.panelMuted` navy scrim at
  0.26 alpha. A 3px deep-blue local text stroke protects the display copy
  while leaving the brighter illustration visible. The existing desktop/
  mobile banner rect, lean-color hairline/pill, text hierarchy, and READ
  control remain unchanged.
- **S1 picker tiles (built)** — `DesktopShopScene.renderStorefront()`
  (`src/game/scenes/DesktopShopScene.ts`; deterministic 8/8/5 pages, each a
  4-col × 2-row grid at 1440×900) and
  `MobileShopScene.renderStorefront()` (`src/game/scenes/MobileShopScene.ts`;
  deterministic 6/6/6/3 pages, each a 2-col × 3-row grid at 412×892).
  Banner image sits at the tile's top edge on both platforms; mobile keeps the
  existing name, tagline, and stock-count text below its materially larger
  banner and exposes 40px PREVIOUS/NEXT controls plus `PAGE n / 4`.
- **S2 shelf header** — `DesktopShopScene.renderShelf()` /
  `MobileShopScene.renderShelf()`: a low-alpha full-width strip behind the
  shop name + tagline block at the shelf top (keep text contrast — dim to
  ~0.35 alpha or darken-overlay).
- **S3 confirm accent** — `DesktopShopScene.renderConfirm()` /
  `MobileShopScene.renderConfirm()`, `icon:coin` left of the headline.
- **E1 story banner (built)** — the shared
  `buildRunEventScenePresentation()` presenter supplies the validated
  per-event art override or theme fallback plus the area context.
  `DesktopRunEventScene.renderStory()` places it after the area intro and
  before the title, capped at 520×260 and shrinking proportionally as far as
  the 180×90 floor when the measured story/choice budget needs room.
  `MobileRunEventScene.renderStory()` owns its separate inner-width 2:1
  geometry (about 388×194 at 412×892). Both scenes call the shared POI-border
  renderer only for a validated per-event illustration; theme fallback keeps
  the neutral edge.
- **E2/M1/M2/M3 row icons+thumbs** — extend `RunChoiceViewModel` in
  `src/game/ui/RunChoicePanel.ts` with an optional
  `image?: { textureKey: string; crop?: 'centerSquare' }` and render it in
  `renderRunChoicePanel()` left of the title (indenting `contentX`). Feed it
  from the three call sites: `DesktopRunMapScene.choiceViewModel()` /
  `MobileRunMapScene` counterpart (map nodes: shop banner crop, area crop,
  kind icons) and the two event scenes' choice loops (choice-kind icons per
  `choice.outcome.kind`).
- **E3 outcome accent** — `DesktopRunEventScene.renderOutcomePanel()` /
  `MobileRunEventScene.renderOutcome()`: the presentation-family icon from
  `choiceArtKey(outcome.kind)` centered above the headline (`nothing` uses the
  dash emblem; deferred card/gem/merge pickers reuse their family icon).

---

Adding an asset? Add its placeholder to `scripts/gen-placeholder-art.ts`
(same path scheme), re-run the script, and add its prompt block here — path
listed here must always equal the placeholder path on disk.
