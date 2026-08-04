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
describe sound themselves. Keys (typed `SfxKey`, enforced complete by
`tests/game/sfxRecipes.test.ts`):

| Key | Fires when |
|---|---|
| `uiClick` / `uiBack` | any affirmative press / any back-out |
| `cast:offense` `cast:defensive` `cast:healing` `cast:support` `cast:debuff` | a card cast — pair with the matching `battleFxSpec` cast flourish (one feedback bundle: sound + motion together) |
| `hitPhysical` / `hitMagical` / `hitTrue` | damage lands, by property |
| `heal` / `shieldGain` / `shieldBreak` / `dotTick` | the matching combat events |
| `goldGain` / `purchase` | income tick / shop or event spend |
| `levelUp` | level-up confirm |
| `victory` / `defeat` | fight end (the two long stingers) |

Scene wiring is tracked as its own pass (task list) — the core ships silent
until keys are wired.

## Placeholder synthesis → real assets

Every key has a fully procedural recipe (oscillator + envelope + optional
noise burst), so the game is audible with zero binary assets and repeats are
detuned ±% so they don't grate. Swapping in real audio: load a file keyed by
the SAME `SfxKey` and prefer it in `playSfx`, falling back to the recipe —
call sites never change.

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
