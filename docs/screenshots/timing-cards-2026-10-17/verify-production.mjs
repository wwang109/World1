import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'https://proof-of-concept-ab-deckbuilder.pages.dev';
const commit = 'd949da615bf2fb4253ea7016cf52a6519352cdb9';
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const landing = await fetch(`${base}/?commit=${commit}`);
const html = await landing.text();
if (landing.status !== 200) throw new Error(`landing ${landing.status}`);
const bundle = html.match(/src="([^"]+\.js)"/)?.[1];
const localHtml = readFileSync('dist/index.html', 'utf8');
if (!bundle || !localHtml.includes(bundle)) throw new Error(`Production is not the latest bundle: ${bundle}`);
const checks = [{ url: base, status: landing.status, bundle }];
for (const path of [bundle, '/game-art/cards/waking-blade-anime.webp', '/game-art/cards/honed-edge-anime.webp']) {
  const url = new URL(path, `${base}/`);
  url.searchParams.set('commit', commit);
  const response = await fetch(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  const local = readFileSync(`dist${url.pathname}`);
  const matches = sha(bytes) === sha(local);
  if (response.status !== 200 || !matches) throw new Error(`Production mismatch: ${path} ${response.status}`);
  url.search = '';
  checks.push({ url: url.href, status: response.status, bytes: bytes.length, sha256: sha(bytes), matchesBuiltFile: matches });
}
const evidence = { commit, deployment: 'https://89c6f421.proof-of-concept-ab-deckbuilder.pages.dev', checks };
writeFileSync('docs/screenshots/timing-cards-2026-10-17/production.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
