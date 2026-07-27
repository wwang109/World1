import { createServer } from 'node:http';
import { resolveBattle, type BattleRequest } from '../src/run/resolveBattle';
import { damagePerTurn, type DamageProfileOpts } from '../src/run/analysis';
import { skillBook } from '../src/data/skills';
import type { CombatantSetup } from '../src/engine/types';

/**
 * Battle API — the only thing that may run combat.
 *
 * - `POST /battle`      prep info  → event log
 * - `POST /damage-band` a setup    → sustained damage-per-turn band
 *
 * Both are thin wrappers; the logic lives in `src/run`. The client cannot
 * simulate at all (enforced by `scripts/check-boundaries.mjs`), so the prep
 * screen's DMG/turn preview has to come from here too.
 */

interface DamageBandRequest { setup: CombatantSetup; opts?: DamageProfileOpts }
const PORT = Number(process.env.PORT ?? 8787);

createServer((req, res) => {
  const json = (code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }
  const route = req.url?.split('?')[0];
  if (req.method !== 'POST' || (route !== '/battle' && route !== '/damage-band')) {
    json(404, { error: 'POST /battle or POST /damage-band' });
    return;
  }
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      if (route === '/damage-band') {
        const { setup, opts } = JSON.parse(body) as DamageBandRequest;
        json(200, damagePerTurn(setup, skillBook, opts ?? {}));
        return;
      }
      json(200, resolveBattle(JSON.parse(body) as BattleRequest));
    } catch (err) {
      json(400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}).listen(PORT, () => {
  console.log(`battle api: http://localhost:${PORT}/battle`);
});
