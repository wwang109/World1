# Audio design — buses, event keys, placeholder synthesis

> **Scope:** LIVING — the audio architecture and the event-key vocabulary
> every scene wires sound through. Recipes/values live in
> `src/game/audio/sfxRecipes.ts` (tested); this doc explains the system and
> lists the intended final assets.

## Architecture

One shared `AudioContext` with a `master → { music, sfx }` gain chain
(`src/game/audio/audioBus.ts`). Volumes are stored in **dB** and converted to
linear only at the GainNode edge; settings (`masterDb`, `musicDb`, `sfxDb`,
`muted`) persist to localStorage under `world1.audio`. Browsers refuse audio
before a user gesture — `installUnlock()` (armed once in `BootScene`) resumes
the context on the first pointer/key input; every play path is a safe no-op
until then, so call sites never guard.

## The event-key vocabulary (the wiring contract)

Scenes call `playSfx('<key>')` (`src/game/audio/sfxSynth.ts`) and never
describe sound themselves. `src/game/audio/sfxSpec.ts`'s `sfxKeyForFx` maps a
battle timeline `TurnFx` to its key so the battle scenes never hand-pick one.
Every shared button/panel wires its own press sound through
`attachButtonFeel`'s `sfx` option (`src/game/ui/motion.ts`) rather than a
separate `playSfx` call beside it — the option defaults to `'uiClick'`,
`null` opts a control out (for a caller with its own conditional sound), and
any other `SfxKey` overrides it (`'uiBack'` for a close/back control).
`ActionBar`'s `ActionButton.sfx` and `RunChoicePanel`'s `sfx` prop forward
into the same option. Keys (typed `SfxKey`, `Record<SfxKey, SfxRecipe>` in
`sfxRecipes.ts` keeps this table exhaustive):

| Key | Fires when |
|---|---|
| `uiClick` | `attachButtonFeel`'s default press sound — every shared button/panel/choice tile that doesn't override `sfx` |
| `uiBack` | `attachButtonFeel({ sfx: 'uiBack' })` on a close/back/cancel control: `DesktopNav`'s MENU, `RunProgressStrip`'s `back`-role HUD button, `RunDestinationHost.renderRunHostButton` for a `‹`-prefixed label, `RunRouteBoard`'s intel-rail/band-read close buttons, `foeDeckEditor`'s CANCEL |
| `cast:offense` `cast:defensive` `cast:healing` `cast:support` `cast:debuff` | a card cast — pair with the matching `battleFxSpec` cast flourish (one feedback bundle: sound + motion together) |
| `hitPhysical` / `hitMagical` / `hitTrue` | damage lands, by property (fallback when no weapon/element is attributed) |
| `hit:${Element}` (fire/frost/lightning/nature/holy/dark) | damage lands from a card with that element |
| `hit:${WeaponType}` (sword/axe/lance/bow/beast) | damage lands from a card with that weapon, takes priority over element |
| `heal` / `shieldGain` / `shieldBreak` / `dotTick` | the matching combat events |
| `status:${StatusName}` (poison/burn/bleed/stun/buff/debuff/guard/negate/expose/thorns/ward) | a `statusApplied` event for that status |
| `died` | a combatant's `died` event |
| `phase` | `suddenDeathStart` / `fatigueStart` / `attritionStart` |
| `negated` / `warded` | Negate or Ward blocks a hit/affliction before it lands |
| `dragPick` | a prep/shop board drag crosses the tap-vs-drag threshold (`DesktopShopScene`/`MobileShopScene`/`DesktopDeckBuildScene`/`MobileDeckBuildScene`'s `wireDrag`) — never on a plain tap |
| `dragDrop` | that drag commits onto a valid target (a board/bag placement, a shelf-card buy staged, a trash/hold drop) |
| `sell` | a shop SELL confirm actually sells (`DesktopShopScene`/`MobileShopScene`) |
| `goldGain` / `purchase` | income tick / shop or event spend |
| `levelUp` | level-up confirm |
| `victory` / `defeat` | fight end (stinger) |
| `runWin` / `runLose` | run-level outcome (stinger; `STINGER_KEYS` also holds `levelUp`). `runLose` fires on every RETIRE confirm (`retireActiveRun()` across the Run Map/Prep/Shop/Deck Build/Event scene pairs) — battle defeat (lives to 0) already plays `defeat` inside the battle scene, so `runLose` never stacks on top of it. `runWin` has no call site: the ladder is endless, so there is no run-level win to end on. |

Scene wiring: battle damage/heal/shield/cast plus the fight-structure keys are
wired through the battle scenes; `dragPick`/`dragDrop`/`sell`/`runLose` are
wired as of this pass (see the table above for call sites). `runWin` still has
no call site (no win path to end a run on).

## File first, recipe fallback

Every key has a fully procedural recipe (oscillator + envelope + optional
noise burst), so the game is audible with zero binary assets. Every key is
also listed in `SFX_FILES` (`src/game/audio/sfxAssets.ts`) and has a recorded
one-shot at `public/game-audio/<stem>.ogg` (`<stem>` = the key with `:` → `-`,
e.g. `hit:fire` → `hit-fire.ogg`, since `:` is not a legal Windows filename).
All 51 one-shots come from one pack family — Kenney (UI, impacts, statuses,
economy, jingles) plus lentikula's spell-impact packs (casts, element hits,
heal) — so the game sounds like one product.

- **Runtime** (`sfxSynth.ts`): on the first user gesture (`onAudioUnlock`)
  every `SFX_FILES` entry is fetched and decoded into an `AudioBuffer` cache
  once. `playSfx(key)` plays the decoded buffer through the same sfx bus when
  it is ready, with the recipe's `pitchJitterPct` applied as a ± playback-rate
  jitter (≤ 2% on combat keys, 0 on UI, economy and stingers, so a sound is
  recognisable each time); otherwise (not decoded yet, 404, decode error) it
  renders the recipe. Nothing throws; mute, volume and unlock behave exactly
  as before. Call sites never change.
- **Pipeline** (mirrors the art one): masters live in `audio-src/<stem>.flac`
  (or the pack's original `.ogg`; NOT served), lossless and pre-trimmed to the
  window the encoder uses plus ~0.25 s; `npm run audio:encode` (`scripts/encode-audio.ts`, ffmpeg on
  PATH or the `ffmpeg-static` devDependency) writes mono 44.1 kHz Vorbis q4,
  trims leading/trailing silence, level-matches each file to
  `REFERENCE_MEAN_DB + recipe.gainDb` (peak ceiling −1 dBFS, so the recipe's
  relative mix carries over), and caps length at `SFX_MAX_MS`
  (`STINGER_MAX_MS` for `STINGER_KEYS`, or the recipe's optional `maxMs`
  override — `died` 550, `phase` 600) with a fade-out. Masters AND the `.ogg`
  outputs are both committed; `npm run build` does not encode. Downloaded
  packs sit in the gitignored `audio-src/_packs/`; only the chosen per-key
  masters are committed (Kenney `.ogg` copied verbatim, lentikula WAVs cut to
  a mono FLAC window — the window is recorded per row in `CREDITS.md`).
- **Credits/licences**: `audio-src/CREDITS.md` — one row per master. Every
  master is CC0, so no attribution ships in-game; `SFX_CC_BY_CREDITS` stays
  empty and the Credits screen hides its attribution block while it is.
- **In-game Credits screen**: `src/game/audio/sfxCredits.ts` (Phaser-free data)
  rendered by `src/game/scenes/CreditsScene.ts`, reached from the CREDITS
  button on `StartScene` (`?scene=credits` to deep-link).

| Key | File | Source |
|---|---|---|
| `uiClick` / `uiBack` | `uiClick.ogg` / `uiBack.ogg` | Kenney Interface Sounds (click_001 / back_002) |
| `cast:offense` / `cast:defensive` / `cast:healing` / `cast:support` / `cast:debuff` | `cast-*.ogg` | lentikula spell-impact build-ups (Fire 3 / Earth 1 / Healing 6 / Wind 4 / Lightning 4) — the swell before the impact |
| `hitPhysical` / `hitTrue` | `hitPhysical.ogg` / `hitTrue.ogg` | Kenney Impact Sounds (punch medium / metal light 002) |
| `hitMagical` | `hitMagical.ogg` | lentikula Basic Spell Impacts (Water 2 impact) |
| `hit:fire` / `hit:frost` / `hit:lightning` | `hit-fire.ogg` / `hit-frost.ogg` / `hit-lightning.ogg` | lentikula Basic Spell Impacts (Fire 4 / Ice 4 / Lightning 5 impacts) |
| `hit:nature` / `hit:dark` | `hit-nature.ogg` / `hit-dark.ogg` | lentikula Druid Spell Impacts (Plant 1 / Earth 4 impacts) |
| `hit:holy` / `heal` | `hit-holy.ogg` / `heal.ogg` | lentikula Healing Spell Impacts (11 / 14 impacts) |
| `hit:sword` / `hit:axe` / `hit:lance` / `hit:bow` / `hit:beast` | `hit-*.ogg` | Kenney Impact Sounds (metal light 001 / plank medium 002 / metal heavy 002 / soft medium 002 / punch heavy 002) |
| `shieldGain` / `shieldBreak` | `shieldGain.ogg` / `shieldBreak.ogg` | Kenney Impact Sounds (plate light 002 / glass heavy 000) |
| `negated` / `warded` / `died` | `negated.ogg` / `warded.ogg` / `died.ogg` | Kenney Impact Sounds (tin medium 003 / bell heavy 004 / soft heavy 003) |
| `status:*` (12) / `dotTick` / `phase` | `status-*.ogg` / `dotTick.ogg` / `phase.ogg` | Kenney Digital Audio (poison lowRandom · burn phaseJump4 · bleed phaseJump3 · stun highDown · buff powerUp7 · debuff phaserDown1 · guard pepSound4 · negate lowDown · expose phaserDown3 · thorns phaseJump5 · regen powerUp8 · ward highUp · dotTick tone1 · phase threeTone2) |
| `dragPick` / `dragDrop` / `sell` / `purchase` / `goldGain` | `dragPick.ogg` / `dragDrop.ogg` / `sell.ogg` / `purchase.ogg` / `goldGain.ogg` | Kenney Casino Audio (card-slide-1 / card-place-1 / chips-handle-1 / chip-lay-1 / chips-stack-1) |
| `levelUp` / `victory` / `defeat` / `runWin` / `runLose` | `levelUp.ogg` / `victory.ogg` / `defeat.ogg` / `runWin.ogg` / `runLose.ogg` | Kenney Music Jingles, pizzicato set (PIZZI10 / 02 / 01 / 15 / 14) |

## Asset wishlist (for a sound pass / generation model)

Short, dry, layered-friendly one-shots; -6 dBFS headroom; 44.1kHz.

- `uiClick`/`uiBack` — soft parchment-and-brass tick; back is the darker inverse. ≤100ms.
- `cast:offense` — steel whoosh into a bright accent. ~150ms.
- `cast:defensive` — low shield thunk with a metallic ring-out. ~250ms.
- `cast:healing` — warm chime swell, airy tail. ~300ms.
- `cast:support` — glassy shimmer arpeggio. ~250ms.
- `cast:debuff` — sour descending smear, faint whisper texture. ~250ms.
- `hitPhysical` — meaty impact, low thud + snap. ~120ms.
- `hitMagical` — arcane crack with a pitch drop. ~150ms.
- `hitTrue` — clean piercing tone, no texture (reads "ignores defenses"). ~120ms.
- `heal` — two-note rising motif. `shieldGain` — short metallic clamp. `shieldBreak` — glass/metal shatter. `dotTick` — small acidic blip (very quiet; it repeats).
- `goldGain`/`purchase` — coin clink / coin pour. `levelUp` — short fanfare lift.
- `victory` — 1s triumphant resolve. `defeat` — 1s low sagging resolve.

## Future (not built)

Music layers + ducking (sidechain the music bus under `victory`/`defeat` and
heavy combat moments), per-theme event-area ambience beds.
