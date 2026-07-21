# Screenshot How-To

This is the quickest path for Claude to reopen and capture the current UI views
on this Windows machine.

## Dev server

Run:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 4173
```

The app will be served at:

```text
http://127.0.0.1:4173
```

## Working Chromium path

Use this executable path with Playwright:

```text
C:/Users/wenwa/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe
```

Recommended launch arg for headless canvas capture:

```text
--enable-unsafe-swiftshader
```

## Direct URLs for the four current views

Preferred approach: open these URLs directly. This avoids relying on canvas
clicks for the prep tabs.

- Loadout: `http://127.0.0.1:4173/?view=loadout`
- Bag: `http://127.0.0.1:4173/?view=bag`
- Wiki / Cards: `http://127.0.0.1:4173/?view=wiki/card`
- Wiki / Opponents: `http://127.0.0.1:4173/?view=wiki/opponents`
- Battle: `http://127.0.0.1:4173/?scene=battle&enemy=bandit_duelist&seed=1`
- Multi-enemy battle: `http://127.0.0.1:4173/?scene=multi`

Optional extra:

- Empty board loadout: `http://127.0.0.1:4173/?view=loadout&board=empty`

## Driving the scene from Playwright

The Phaser game instance is exposed as `window.__game` (see `src/main.ts`).
Synthetic canvas clicks are unreliable in headless runs — prefer driving the
scene directly, e.g.:

```js
await page.evaluate(() => {
  const scene = window.__game.scene.getScene("Prep");
  scene.openWikiFilters();          // open the wiki filter sheet
  // or: scene.wikiFilters = { ...scene.wikiFilters, element: "frost" };
  //     scene.scene.restart();
});
```

## Current canvas click coordinates

Only needed if Claude wants to click through the canvas instead of using the
launcher URLs.

- Deck tab: `(135, 143)`
- Bag tab: `(360, 143)`
- Wiki tab: `(585, 143)`
- Wiki Cards subtab: `(513, 203)`
- Wiki Opponents subtab: `(618, 203)`
- Fight button: `(546, 1234)`

These coordinates are for the current 720×1280 portrait layout.

## Ready-to-run Playwright snippet

```js
const { chromium } = await import("playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Users/wenwa/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe",
  args: ["--enable-unsafe-swiftshader"],
});

const page = await browser.newPage({ viewport: { width: 720, height: 1280 } });

await page.goto("http://127.0.0.1:4173/?view=loadout", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "loadout-portrait.png", fullPage: true });

await page.goto("http://127.0.0.1:4173/?view=bag", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "bag-portrait.png", fullPage: true });

await page.goto("http://127.0.0.1:4173/?view=wiki", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "wiki-portrait.png", fullPage: true });

await page.goto("http://127.0.0.1:4173/?scene=battle&enemy=bandit_duelist&seed=1", { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
await page.screenshot({ path: "battle-portrait.png", fullPage: true });

await browser.close();
```
