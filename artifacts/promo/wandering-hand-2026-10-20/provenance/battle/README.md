# Finished battle promo subset

Use the four named clips in capture-manifest.json; exclude unlabelled page@ WebM from a failed early harness attempt. Actual desktop1440x900/mobile412x892,25fps, no product changes, no dev labels or error states. All10 final PNGs inspected with view_image.

| Clip | Prep | Active combat | Victory |
|---|---|---|---|
| desktop-normal.webm |5.7–7.6s|8.0–18.7s|51.3–54.1s|
| mobile-normal.webm |4.9–6.7s|7.1–17.7s|50.4–53.1s|
| desktop-boss.webm |5.5–7.5s|7.9–18.6s|Do not imply a boss win|
| mobile-boss.webm |4.4–6.3s|6.7–17.3s|Do not imply a boss win|

Timing marks are relative to browser context recording start, accurate to roughly1second; confirm final edit trim from visible action. Playwright recorded video has no game sound; approved parent audio mix supplies it.

Normal shots use seed7 actual draft offers and first normal encounter at stop3/LV1 with four distinct cards; recorded-normal-state-seed7.json reproduces exact input. Actual service result is victory. Normal-provenance.json is an unused later scout candidate, not recording input; use manifest/source snapshot.

Boss shots use seed11, earned LV5 at stop15, eight distinct cards obtained through actual draft/shop offers and affordable purchases. fixture-provenance.json records draft picks and API-backed route results; boss-state.json exact input. Two lives on prep, one remains after real boss loss. Clip stops in active playback and no boss-loss or boss-victory panel is included.

Existing UI settles service response before playback, so top HUD shows next level/day/lives during battle playback. This is the real UI; consider framing away from the tiny top statistics when cutting prep into combat. Health/cards/effects are the actual service-backed playback. No fake results, local combat renderer, duplicated10-card board, overwritten player save, publishing or external messaging.

Capture harness imports the exact cache-busted runStore URL already loaded by Vite to share the live game state. Isolated contexts only; temporary development save snapshots, no user storage. Source script capture.ts plus replacement script document workflow. Old failed desktop boss shot was overwritten by final seed11 clip; manifest describes final files.
