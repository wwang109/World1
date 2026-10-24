# Audio credits

One row per committed master in `audio-src/` (encoded to `public/game-audio/<stem>.ogg` by `npm run audio:encode`). Every key has a master; every master is CC0, so the game ships with no required attribution.

Packs (all CC0, downloaded into the gitignored `audio-src/_packs/`):

- Kenney (www.kenney.nl) — Interface Sounds, Impact Sounds, Digital Audio, Casino Audio, Music Jingles — https://creativecommons.org/publicdomain/zero/1.0/
- lentikula (lentikula.itch.io) — Basic Spell Impacts, Druid Spell Impacts, Healing Spell Impacts — released CC0 on each pack page

Kenney masters are the pack's `.ogg` copied verbatim. lentikula masters are mono 48 kHz FLAC windows cut from the pack's 24-bit WAV: `impact` = 700 ms from 40 ms before the loudest transient; `build-up` = the 420 ms swell ending 20 ms before it (the encoder then trims and caps as usual).

| Key | Master | Pack clip | Pack | Author | Licence | URL |
|---|---|---|---|---|---|---|
| `uiClick` | `uiClick.ogg` | `click_001.ogg` | Interface Sounds | Kenney | CC0 | https://kenney.nl/assets/interface-sounds |
| `uiBack` | `uiBack.ogg` | `back_002.ogg` | Interface Sounds | Kenney | CC0 | https://kenney.nl/assets/interface-sounds |
| `cast:offense` | `cast-offense.flac` | `Fire Spell Impact 3.wav` (build-up 66–486 ms) | Basic Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx |
| `cast:defensive` | `cast-defensive.flac` | `Earth Spell Impact 1.wav` (build-up 34–454 ms) | Druid Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/druid-spell-impacts |
| `cast:healing` | `cast-healing.flac` | `Healing Spell Impact 6.wav` (build-up 442–862 ms) | Healing Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/healing-spell-impacts |
| `cast:support` | `cast-support.flac` | `Wind Spell Impact 4.wav` (build-up 789–1209 ms) | Druid Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/druid-spell-impacts |
| `cast:debuff` | `cast-debuff.flac` | `Lightning Spell Impact 4.wav` (build-up 418–838 ms) | Basic Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx |
| `hitPhysical` | `hitPhysical.ogg` | `impactPunch_medium_000.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `hitMagical` | `hitMagical.flac` | `Water Spell Impact 2.wav` (impact 554–1254 ms) | Basic Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx |
| `hitTrue` | `hitTrue.ogg` | `impactMetal_light_002.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `hit:fire` | `hit-fire.flac` | `Fire Spell Impact 4.wav` (impact 170–870 ms) | Basic Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx |
| `hit:frost` | `hit-frost.flac` | `Ice Spell Impact 4.wav` (impact 403–1103 ms) | Basic Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx |
| `hit:lightning` | `hit-lightning.flac` | `Lightning Spell Impact 5.wav` (impact 898–1598 ms) | Basic Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/freecc0-basic-spell-impacts-sfx |
| `hit:nature` | `hit-nature.flac` | `Plant Spell Impact 1.wav` (impact 206–906 ms) | Druid Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/druid-spell-impacts |
| `hit:holy` | `hit-holy.flac` | `Healing Spell Impact 11.wav` (impact 411–1111 ms) | Healing Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/healing-spell-impacts |
| `hit:dark` | `hit-dark.flac` | `Earth Spell Impact 4.wav` (impact 118–818 ms) | Druid Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/druid-spell-impacts |
| `hit:sword` | `hit-sword.ogg` | `impactMetal_light_001.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `hit:axe` | `hit-axe.ogg` | `impactPlank_medium_002.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `hit:lance` | `hit-lance.ogg` | `impactMetal_heavy_002.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `hit:bow` | `hit-bow.ogg` | `impactSoft_medium_002.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `hit:beast` | `hit-beast.ogg` | `impactPunch_heavy_002.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `heal` | `heal.flac` | `Healing Spell Impact 14.wav` (impact 525–1225 ms) | Healing Spell Impacts | lentikula | CC0 | https://lentikula.itch.io/healing-spell-impacts |
| `shieldGain` | `shieldGain.ogg` | `impactPlate_light_002.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `shieldBreak` | `shieldBreak.ogg` | `impactGlass_heavy_000.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `dotTick` | `dotTick.ogg` | `tone1.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:poison` | `status-poison.ogg` | `lowRandom.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:burn` | `status-burn.ogg` | `phaseJump4.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:bleed` | `status-bleed.ogg` | `phaseJump3.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:stun` | `status-stun.ogg` | `highDown.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:buff` | `status-buff.ogg` | `powerUp7.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:debuff` | `status-debuff.ogg` | `phaserDown1.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:guard` | `status-guard.ogg` | `pepSound4.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:negate` | `status-negate.ogg` | `lowDown.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:expose` | `status-expose.ogg` | `phaserDown3.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:thorns` | `status-thorns.ogg` | `phaseJump5.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:regen` | `status-regen.ogg` | `powerUp8.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `status:ward` | `status-ward.ogg` | `highUp.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `died` | `died.ogg` | `impactSoft_heavy_003.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `phase` | `phase.ogg` | `threeTone2.ogg` | Digital Audio | Kenney | CC0 | https://kenney.nl/assets/digital-audio |
| `negated` | `negated.ogg` | `impactTin_medium_003.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `warded` | `warded.ogg` | `impactBell_heavy_004.ogg` | Impact Sounds | Kenney | CC0 | https://kenney.nl/assets/impact-sounds |
| `dragPick` | `dragPick.ogg` | `card-slide-1.ogg` | Casino Audio | Kenney | CC0 | https://kenney.nl/assets/casino-audio |
| `dragDrop` | `dragDrop.ogg` | `card-place-1.ogg` | Casino Audio | Kenney | CC0 | https://kenney.nl/assets/casino-audio |
| `sell` | `sell.ogg` | `chips-handle-1.ogg` | Casino Audio | Kenney | CC0 | https://kenney.nl/assets/casino-audio |
| `goldGain` | `goldGain.ogg` | `chips-stack-1.ogg` | Casino Audio | Kenney | CC0 | https://kenney.nl/assets/casino-audio |
| `purchase` | `purchase.ogg` | `chip-lay-1.ogg` | Casino Audio | Kenney | CC0 | https://kenney.nl/assets/casino-audio |
| `levelUp` | `levelUp.ogg` | `Pizzicato jingles/jingles_PIZZI10.ogg` | Music Jingles | Kenney | CC0 | https://kenney.nl/assets/music-jingles |
| `victory` | `victory.ogg` | `Pizzicato jingles/jingles_PIZZI02.ogg` | Music Jingles | Kenney | CC0 | https://kenney.nl/assets/music-jingles |
| `defeat` | `defeat.ogg` | `Pizzicato jingles/jingles_PIZZI01.ogg` | Music Jingles | Kenney | CC0 | https://kenney.nl/assets/music-jingles |
| `runWin` | `runWin.ogg` | `Pizzicato jingles/jingles_PIZZI15.ogg` | Music Jingles | Kenney | CC0 | https://kenney.nl/assets/music-jingles |
| `runLose` | `runLose.ogg` | `Pizzicato jingles/jingles_PIZZI14.ogg` | Music Jingles | Kenney | CC0 | https://kenney.nl/assets/music-jingles |
