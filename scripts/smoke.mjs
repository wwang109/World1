import { chromium } from 'playwright';

const OUT = process.env.OUT_DIR ?? '.';
const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || undefined,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/prep.png` });

const canvas = page.locator('canvas');
const box = await canvas.boundingBox();
const sx = box.width / 1280;
const sy = box.height / 720;
await page.mouse.click(box.x + 1130 * sx, box.y + 640 * sy);
await page.waitForTimeout(3500);
await page.screenshot({ path: `${OUT}/battle-early.png` });

await page.mouse.click(box.x + 1215 * sx, box.y + 695 * sy);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/battle-end.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
