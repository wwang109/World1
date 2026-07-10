import type { EnemyDef } from '../engine/types';
import defs from './enemies.json';

// Enemy data lives in enemies.json; this wrapper types it and indexes by id.
// Demo presets use depth-1 stats (the run layer will scale by depth later);
// HP pools are sized for the PL-balanced Bronze card set. Elites are tactic
// checks whose KITS demand an answer (turtle/buff-stacker/healer/anti-magic/
// mixed-damage) — no new rules. tests/data.test.ts validates the records.
export const enemies: Record<string, EnemyDef> = Object.fromEntries(
  (defs as EnemyDef[]).map((e) => [e.id, e]),
);
