// ASCII combat log for eyeballing engine behavior:
//   npm run fight                        (hero vs bandit_duelist)
//   npm run fight -- ember_imp 42        (hero vs one Ember Imp, seed 42)
//   npm run fight -- giant_rat*3 42      (hero vs a pack of three Giant Rats)
//   npm run fight -- giant_rat*2,knight 42
//
// TEAM-AWARE (2026-08-19): every line names the exact combatant it is about
// ("Giant Rat #2"), not just its side, and a cast line names the foe its
// targeting policy CHOSE plus the metric that decided it. All of that is
// already on the event log (`play`/`skillCast` carry `targetUnit` /
// `targetPolicy` / `targetValue` / `aoe` / `targets`; every `damage` carries
// the victim's `side` + `unit`) — this script previously discarded the unit
// index, so in a pack fight the reader could not tell which foe was hit.
import { readFileSync } from 'node:fs';
import { simulate } from '../src/engine/combat/simulate';
import { fmtDamage } from './logFormat';
import type { BoardPiece, CombatantSetup, Gem, Side } from '../src/engine/types';
import { hashSeed } from '../src/engine/rng';
import { skillBook as shippedSkillBook } from '../src/data/skills';
import { skillDefOfDocument, validateSkillDocument } from '../src/data/validateSkillContent';
import { BASE_HERO_STATS, HERO_BOARD_SLOTS } from '../src/data/heroes';
import { enemies } from '../src/data/enemies';
import { gemBook } from '../src/data/gems';

/**
 * Local copy of the foe cap (the shared constant lives in `src/game`, which the
 * pure layers and scripts must not import — see the layer boundary rule).
 */
const MAX_FOES = 5;

const enemySpec = process.argv[2] ?? 'bandit_duelist';
/**
 * PROBE CARDS — `FIGHT_EXTRA_CARDS=<path to a skills-document JSON>`.
 *
 * Merges extra card documents into the book for THIS RUN only, so a card shape
 * that is not (or not yet) shipped content can be shown in a REAL combat log
 * instead of being described in prose. Added for the tier-lock work
 * (`TierLocked`, src/engine/types.ts), whose whole point is a shape no shipped
 * card carries yet — and the project rule is that behaviour is proven with
 * `npm run fight` and never with a second, hand-written renderer
 * (CLAUDE.md, user-locked 2026-08-25).
 *
 * NOT A BACK DOOR AROUND CONTENT VALIDATION: the file is the exact same document
 * shape as `src/data/content/skills.v1.json` and goes through the SAME
 * `validateSkillDocument` the real loader uses, so a probe card that could not be
 * authored for real cannot be fought either. It never touches the shipped book on
 * disk, and a run without the env var is byte-identical to before.
 */
function loadBook(): typeof shippedSkillBook {
  const path = process.env['FIGHT_EXTRA_CARDS'];
  if (path === undefined || path.trim() === '') return shippedSkillBook;
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path.trim(), 'utf8')) as unknown;
  } catch (err) {
    console.error(`FIGHT_EXTRA_CARDS: cannot read '${path}' — ${String(err)}`);
    process.exit(1);
  }
  const problems = validateSkillDocument(doc);
  if (problems.length > 0) {
    console.error(`FIGHT_EXTRA_CARDS: ${problems.length} problem(s) in '${path}':`);
    for (const p of problems) console.error(`  ${p.where}: ${p.message}`);
    process.exit(1);
  }
  const cards = (doc as { cards: Array<{ id: string; versions: Array<{ version: number; def: Record<string, unknown> }> }> }).cards;
  const out = { ...shippedSkillBook };
  // Highest version wins, exactly as `skillsContent.ts` resolves the real book.
  for (const card of cards) {
    let current = card.versions[0]!;
    for (const entry of card.versions) if (entry.version > current.version) current = entry;
    out[card.id] = skillDefOfDocument(card.id, current.def);
  }
  return out;
}

const skillBook = loadBook();


/**
 * A seed you cannot trust is worse than no seed: `Number('abc')` is NaN, and
 * `Rng`'s `seed >>> 0` turns NaN into 0 — so a typo silently reproduces a
 * DIFFERENT fight than the one asked for. Refuse instead.
 */
function parseSeed(arg: string | undefined, fallback: number): number {
  if (arg === undefined) return fallback;
  // Deliberately NOT Number(): '' and '  ' both coerce to 0, which is the same
  // silent-zero trap by another route. Plain unsigned decimal digits only.
  const value = /^[0-9]+$/.test(arg) ? Number(arg) : Number.NaN;
  if (!Number.isInteger(value) || value > 0xffffffff) {
    console.error(`Invalid seed '${arg}' — expected an integer in [0, 4294967295].`);
    process.exit(1);
  }
  return value;
}

/**
 * Enemy lineup spec: comma-separated enemy ids, each optionally `*N` repeated.
 * A bare single id is the historical 1v1 form and behaves exactly as before.
 */
function parseLineup(spec: string): string[] {
  const ids: string[] = [];
  for (const raw of spec.split(',')) {
    const part = raw.trim();
    if (part === '') continue;
    const star = part.indexOf('*');
    const id = star === -1 ? part : part.slice(0, star);
    const countArg = star === -1 ? '1' : part.slice(star + 1);
    if (!/^[0-9]+$/.test(countArg) || Number(countArg) < 1) {
      console.error(`Invalid repeat count in '${part}' — expected '<enemyId>*<positive integer>'.`);
      process.exit(1);
    }
    for (let i = 0; i < Number(countArg); i += 1) ids.push(id);
  }
  if (ids.length === 0) {
    console.error(`Empty enemy lineup '${spec}'.`);
    process.exit(1);
  }
  if (ids.length > MAX_FOES) {
    console.error(`Lineup of ${ids.length} exceeds MAX_FOES (${MAX_FOES}).`);
    process.exit(1);
  }
  return ids;
}

const seed = parseSeed(process.argv[3], hashSeed('fight', enemySpec));
const enemyIds = parseLineup(enemySpec);

const enemyDefs = enemyIds.map((id) => {
  const def = enemies[id];
  if (!def) {
    console.error(`Unknown enemy '${id}'. Options: ${Object.keys(enemies).join(', ')}`);
    process.exit(1);
  }
  return def;
});

// A plausible drafted starter board.
const heroName = 'Hero';

/**
 * DEFAULT BOARD — the drafted-starter shape every plain `npm run fight` uses.
 */
const DEFAULT_HERO_PIECES = [
  { skillId: 'war_banner', slot: 0 },
  { skillId: 'sword_slash', slot: 1 },
  { skillId: 'crushing_blow', slot: 2 },
  { skillId: 'iron_bulwark', slot: 5 },
  { skillId: 'second_wind', slot: 7 },
];

/**
 * One board-spec entry: `skill_id`, `skill_id@tier` to rank the card up before
 * the fight (`bronze`|`silver`|`gold`|`diamond`), and/or `skill_id#gem_id` to
 * socket a gem into it. Both suffixes may be combined, tier first:
 * `judgment_light@diamond#judgment_light_echo`.
 *
 * THE SUFFIXES EXIST so a tier-scaled or GEMMED card can be shown the same way
 * every other claim in this project is shown — by a real `npm run fight` log
 * rather than a second, hand-written renderer. `BoardPiece.tier` / `BoardPiece.gem`
 * are the engine's own per-piece overrides (`resolveEffectiveSkill` runs
 * `applyTier` and the gem splice on them), so this parses the spec and hands the
 * engine fields it already has; no formatting or resolution logic is duplicated
 * here. No suffix = bronze, un-gemmed = byte-identical to the pre-suffix behavior.
 *
 * The GEM suffix was added on 2026-08-31 for the cast-order ruling: a gem's
 * actions splice in at the resolver (`GEM_ACTION_PHASE` / `orderCastRiders`,
 * src/engine/cards.ts), so "a gem-applied debuff also trails the hit" is a claim
 * about a SOCKETED piece and could not be shown from a log at all before this.
 */
function parsePiece(raw: string, envName: string, slot: number): BoardPiece | null {
  const entry = raw.trim();
  if (entry === '') return null;
  const hash = entry.indexOf('#');
  const gemId = hash < 0 ? '' : entry.slice(hash + 1).trim();
  const head = hash < 0 ? entry : entry.slice(0, hash);
  const at = head.indexOf('@');
  const skillId = at < 0 ? head.trim() : head.slice(0, at).trim();
  const tierText = at < 0 ? '' : head.slice(at + 1).trim();
  if (!skillBook[skillId]) {
    console.error(`${envName}: unknown skill '${skillId}'.`);
    process.exit(1);
  }
  let gem: Gem | undefined;
  if (gemId !== '') {
    const def = gemBook[gemId];
    if (!def) {
      console.error(`${envName}: unknown gem '${gemId}' on '${skillId}'.`);
      process.exit(1);
    }
    gem = def;
  }
  if (tierText === '') return { skillId, slot, ...(gem ? { gem } : {}) };
  if (tierText !== 'bronze' && tierText !== 'silver' && tierText !== 'gold' && tierText !== 'diamond') {
    console.error(`${envName}: unknown tier '${tierText}' on '${skillId}' — use bronze|silver|gold|diamond.`);
    process.exit(1);
  }
  return { skillId, slot, tier: tierText, ...(gem ? { gem } : {}) };
}

/**
 * ...OVERRIDABLE, for eyeballing ONE card instead of the starter deck:
 *
 *   FIGHT_HERO_BOARD=aegis_of_the_unbroken,vow_broken npm run fight -- knight 7
 *   FIGHT_HERO_BOARD=wildfire_rite@silver,cinder_dart npm run fight -- knight 7
 *   FIGHT_HERO_BOARD=hemorrhage#resonant_echo npm run fight -- knight 7
 *   FIGHT_HERO_HP=40 FIGHT_HERO_BOARD=cornered_beast npm run fight
 *
 * A comma-separated list of skill ids, laid out left to right from slot 0 with
 * each card's own `size` advancing the cursor (the same packing `tests/helpers.ts`
 * does). `FIGHT_HERO_HP` overrides starting HP only — maxHp is untouched, so it is
 * the knob for "what does this look like at half health".
 *
 * ENV, not argv, deliberately: argv positions 2 and 3 are the documented
 * enemy-spec/seed contract and adding a third positional would break every
 * existing invocation in the docs. Absent env = byte-identical to before, which is
 * what keeps this a debugging affordance rather than a behavior change.
 */
function heroPieces(): BoardPiece[] {
  const spec = process.env['FIGHT_HERO_BOARD'];
  if (spec === undefined || spec.trim() === '') return DEFAULT_HERO_PIECES;
  const pieces: BoardPiece[] = [];
  let slot = 0;
  for (const raw of spec.split(',')) {
    const piece = parsePiece(raw, 'FIGHT_HERO_BOARD', slot);
    if (!piece) continue;
    pieces.push(piece);
    slot += skillBook[piece.skillId]!.size;
  }
  if (pieces.length === 0) {
    console.error('FIGHT_HERO_BOARD is empty.');
    process.exit(1);
  }
  if (slot > HERO_BOARD_SLOTS) {
    console.error(`FIGHT_HERO_BOARD needs ${slot} slots, board is ${HERO_BOARD_SLOTS}.`);
    process.exit(1);
  }
  return pieces;
}

/**
 * The FOE's BOARD SLOTS — `FIGHT_FOE_SLOTS=4 npm run fight`.
 *
 * A catalog enemy's `boardSize` is sized to its OWN authored deck (every
 * roster entry today fills its board exactly, zero slack), but the run layer
 * GROWS it for a titled encounter: `buildEnemyEncounter` ships
 * `Math.max(enemy.boardSize, nextFreeSlot(pieces))`, so an ELITE (+1 card) or
 * BOSS (+2) legitimately fields a bigger board than the catalog value. Without
 * this override no real elite/boss board could be shown in a combat log at
 * all — the `FIGHT_FOE_BOARD` slot check below would reject every one of them
 * — which is exactly the gap that pushes people into hand-writing a log
 * instead (the one thing this script exists to prevent).
 *
 * Refuses a non-positive or non-integer value rather than silently falling
 * back, same contract as `FIGHT_FOE_STATS`'s unknown-stat refusal.
 */
function foeBoardSize(catalogSize: number): number {
  const spec = process.env['FIGHT_FOE_SLOTS'];
  if (spec === undefined || spec.trim() === '') return catalogSize;
  if (!/^[0-9]+$/.test(spec.trim()) || Number(spec.trim()) < 1) {
    console.error(`FIGHT_FOE_SLOTS: expected a positive integer, got '${spec}'.`);
    process.exit(1);
  }
  return Number(spec.trim());
}

/**
 * The FOE's board, same contract as `FIGHT_HERO_BOARD`:
 *
 *   FIGHT_FOE_BOARD=lance_thrust npm run fight
 *
 * Replaces the named enemy's pieces so a card can be tried against a chosen
 * attacker rather than whatever the catalog enemy happens to run. Its stats are
 * still the catalog enemy's unless `FIGHT_FOE_STATS` overrides them, and its
 * board is the catalog enemy's unless `FIGHT_FOE_SLOTS` overrides it.
 */
function foePieces(boardSize: number, fallback: readonly BoardPiece[]): BoardPiece[] {
  const spec = process.env['FIGHT_FOE_BOARD'];
  if (spec === undefined || spec.trim() === '') return [...fallback];
  const pieces: BoardPiece[] = [];
  let slot = 0;
  for (const raw of spec.split(',')) {
    const piece = parsePiece(raw, 'FIGHT_FOE_BOARD', slot);
    if (!piece) continue;
    pieces.push(piece);
    slot += skillBook[piece.skillId]!.size;
  }
  if (pieces.length === 0) {
    console.error('FIGHT_FOE_BOARD is empty.');
    process.exit(1);
  }
  if (slot > boardSize) {
    console.error(`FIGHT_FOE_BOARD needs ${slot} slots, board is ${boardSize} (raise it with FIGHT_FOE_SLOTS).`);
    process.exit(1);
  }
  return pieces;
}

/**
 * Stat overrides for either side:
 *
 *   FIGHT_FOE_STATS=maxHp:30000,hp:30000,attack:1,armor:0 npm run fight
 *
 * The knob for building a PASSIVE DUMMY — huge HP, no armor, no offence — so a
 * log shows one card's behaviour and nothing else. Every field is an integer stat
 * name from `CombatantStats`; anything unrecognised is refused rather than
 * silently ignored, since a typo'd stat is a fight you did not ask for.
 */
function withStatOverrides<T extends Record<string, number>>(stats: T, envVar: string): T {
  const spec = process.env[envVar];
  if (spec === undefined || spec.trim() === '') return stats;
  const out: Record<string, number> = { ...stats };
  for (const raw of spec.split(',')) {
    const pair = raw.trim();
    if (pair === '') continue;
    const [key, value] = pair.split(':');
    if (key === undefined || value === undefined || !/^-?[0-9]+$/.test(value)) {
      console.error(`${envVar}: expected name:integer pairs, got '${pair}'.`);
      process.exit(1);
    }
    if (!(key in out)) {
      console.error(`${envVar}: unknown stat '${key}' (known: ${Object.keys(out).join(', ')}).`);
      process.exit(1);
    }
    out[key] = Number(value);
  }
  return out as T;
}

function heroStats(): typeof BASE_HERO_STATS {
  const stats = { ...BASE_HERO_STATS };
  const hp = process.env['FIGHT_HERO_HP'];
  if (hp !== undefined && /^[0-9]+$/.test(hp)) stats.hp = Math.min(Number(hp), stats.maxHp);
  return withStatOverrides(stats, 'FIGHT_HERO_STATS');
}

const playerTeam: CombatantSetup[] = [
  {
    name: heroName,
    stats: heroStats(),
    boardSize: HERO_BOARD_SLOTS,
    pieces: heroPieces(),
  },
];
const enemyTeam: CombatantSetup[] = enemyDefs.map((enemy) => ({
  name: enemy.name,
  stats: withStatOverrides({ ...enemy.stats }, 'FIGHT_FOE_STATS'),
  boardSize: foeBoardSize(enemy.boardSize),
  pieces: foePieces(foeBoardSize(enemy.boardSize), enemy.pieces),
  elementAffinity: enemy.elementAffinity,
  weaponAffinity: enemy.weaponAffinity,
}));

const { result, turns, events, finalState } = simulate({ playerTeam, enemyTeam, skillBook }, seed);

// ---------------------------------------------------------------------------
// Naming. `#n` is the 1-BASED lineup position, i.e. engine unit index n−1 — the
// same 1-based convention this script already uses for board slots. A side with
// exactly one unit needs no disambiguator and prints its bare name (so a 1v1
// log reads exactly as it always has).
// ---------------------------------------------------------------------------
const nameTable: Record<Side, string[]> = {
  player: playerTeam.map((u, i) => (playerTeam.length > 1 ? `${u.name} #${i + 1}` : u.name)),
  enemy: enemyTeam.map((u, i) => (enemyTeam.length > 1 ? `${u.name} #${i + 1}` : u.name)),
};
const label = (side: Side, unit: number): string => nameTable[side][unit] ?? `${side} #${unit + 1}`;
const nameWidth = Math.max(16, ...nameTable.player.map((n) => n.length), ...nameTable.enemy.map((n) => n.length));
const tag = (side: Side, unit: number): string => label(side, unit).padEnd(nameWidth);
const other = (side: Side): Side => (side === 'player' ? 'enemy' : 'player');

const fmt = (side: { bank: number; speed: number; weight: number | null; score: number | null; state: string; queuedSkillId: string | null }) =>
  side.state === 'ready'
    ? `${side.bank}+${side.speed}-${side.weight}=${side.score} (${side.queuedSkillId})`
    : side.state;

/**
 * WHO this cast chose, and WHY — read straight off the event's recorded
 * targeting decision. Targets are always on the side opposite the caster.
 * Prints nothing for support/self casts, which record no target fields.
 */
const targetSuffix = (e: {
  side: Side;
  targetUnit?: number;
  targetPolicy?: string;
  targetValue?: number;
  aoe?: boolean;
  targets?: number[];
}): string => {
  const foeSide = other(e.side);
  if (e.aoe) return ` · targets ALL [${(e.targets ?? []).map((u) => label(foeSide, u)).join(', ')}]`;
  if (e.targetUnit === undefined) return '';
  const why =
    e.targetPolicy === undefined ? '' : ` (${e.targetPolicy}${e.targetValue === undefined ? '' : ` ${e.targetValue}`})`;
  return ` · target ${label(foeSide, e.targetUnit)}${why}`;
};

/**
 * THE WALL LEFT STANDING, tracked by the RENDERER.
 *
 * `shieldGain` reports `totalAfter`, but a `damage` event carries only `blocked`
 * and `shieldDrain` — nothing says how much plating survived the hit. So the log
 * could tell you a hit was blocked and never tell you whether the wall that
 * blocked it still exists, which is the number that actually decides the next
 * few turns.
 *
 * DERIVED RATHER THAN ADDED TO THE EVENT: a `shieldAfter` field would touch every
 * damage event in every log and move the frozen outcome baseline for a number the
 * renderer can compute exactly. `shieldDrain` is the POINTS REMOVED (which is not
 * `blocked` — an attuned pool blocks 2 per point and a typed hit spilling into
 * TRUE spends 2 per point blocked), so subtracting the drain is exact.
 */
const wall = new Map<string, number>();
const wallKey = (side: Side, unit: number): string => `${side}:${unit}`;

/**
 * MOBILE MODE — `FIGHT_NARROW=1 npm run fight`.
 *
 * The wide log packs cast, hit, derivation and remaining HP onto one ~70-column
 * row, which wraps into mush on a phone (user-locked 2026-08-25: one fact per
 * line, nothing past ~28 characters).
 *
 * IMPLEMENTED AS A REFLOW OF THIS RENDERER'S OWN OUTPUT, deliberately, rather
 * than as a second set of format strings. A parallel narrow renderer is a
 * duplicate that drifts — which is exactly how a hand-written demo log ended up
 * inventing the phrase "plating spent" and omitting "shield left" entirely. One
 * wrapper over `console.log` means every line the switch below emits, today and
 * in future, is narrow-formatted for free and can never disagree with the wide
 * form because it IS the wide form, re-broken.
 */
const NARROW = process.env['FIGHT_NARROW'] === '1';
if (NARROW) {
  const wide = console.log.bind(console);
  console.log = (...args: unknown[]): void => {
    const line = args.map(String).join(' ');
    if (line.trim() === '') { wide(''); return; }
    // Two prefix shapes exist: `  5 │  Hero   <body>` for the indented detail
    // rows and `  5  gain    Hero   <body>` for the turn-level ones. Both start
    // with the turn number, so strip that (and the optional gutter) and split the
    // remainder on the renderer's own column padding.
    const m = /^\s*(\d+)\s*│?\s*(.*)$/.exec(line);
    if (!m) { wide(line); return; }
    const cols = (m[2] ?? '').trim().split(/\s{2,}/).map((c) => c.trim()).filter((c) => c !== '');
    if (cols.length === 0) { wide(line); return; }
    // Last column is the body; everything before it names the row (`gain Hero`,
    // `calc`, `Hero`).
    const body = cols.length > 1 ? cols[cols.length - 1]! : '';
    wide(`t${m[1]} ${cols.slice(0, Math.max(1, cols.length - 1)).join(' ')}`);
    const facts = body
      // SPACED arrow only: `-> 73 hp` is a separate fact, but `attack 8->8` is one
      // number and must not be torn in half.
      .replace(/\s+->\s+/g, '\n-> ')
      .replace(/\s*·\s*/g, '\n')
      .replace(/\s*\[/g, '\n')
      .replace(/[\])]/g, '\n')
      .replace(/\s*\(/g, '\n')
      .replace(/[;,]\s*/g, '\n')
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => t !== '');
    for (const fact of facts) wide(`   ${fact}`);
  };
}

// Lineup legend, so `#n` is never a guess.
console.log(`seed ${seed} · ${enemySpec}`);
for (const side of ['player', 'enemy'] as const) {
  const team = side === 'player' ? playerTeam : enemyTeam;
  for (let i = 0; i < team.length; i += 1) {
    const u = team[i]!;
    console.log(`  ${side === 'player' ? 'you' : 'foe'} unit ${i}  ${tag(side, i)} ${u.stats.maxHp} hp`);
  }
}
console.log('');

for (const e of events) {
  const t = String(e.turn).padStart(3);
  switch (e.kind) {
    case 'gain':
      console.log(
        `${t}  gain    ${tag(e.side, e.unit)} readiness ${e.readinessBefore} -> ${e.readinessAfter} (+${e.speed}${e.speedModifier === 0 ? '' : `; effect ${e.speedModifier > 0 ? '+' : ''}${e.speedModifier}`})`,
      );
      break;
    case 'play':
      // The readable cast record: caster, card, cost, and the foe the cast's
      // targeting policy picked (plus the metric that decided it).
      console.log(
        `${t}  play    ${tag(e.side, e.unit)} ${e.skillId} (slot ${e.slot + 1}${e.slotCount > 1 ? `, 1 of ${e.slotCount}` : ''}) · weight ${e.weight}${targetSuffix(e)}${e.damage === undefined ? '' : ` -> -${e.damage} [${e.hpAfter} hp]`}`,
      );
      break;
    case 'cost':
      console.log(`${t}  cost    ${tag(e.side, e.unit)} readiness ${e.readinessBefore} -> ${e.readinessAfter} (paid ${e.paid})`);
      break;
    case 'cursor':
      console.log(
        `${t}  cursor  ${tag(e.side, e.unit)} -> ${e.skillId ?? 'empty'} (slot ${e.slot + 1}${e.slotCount && e.slotCount > 1 ? `, ${e.slotIndex} of ${e.slotCount}` : ''}${e.wrapped ? ', wrap' : ''})`,
      );
      break;
    case 'busy':
      console.log(`${t}  busy    ${tag(e.side, e.unit)} ${e.skillId} resolving (slot ${e.slotIndex} of ${e.slotCount})`);
      break;
    case 'wait':
      if (e.reason === 'cantAfford') {
        console.log(`${t}  wait    ${tag(e.side, e.unit)} readiness ${e.readiness} < ${e.skillId} weight ${e.weight}`);
      } else if (e.reason === 'cooling') {
        console.log(`${t}  wait    ${tag(e.side, e.unit)} ${e.skillId} cooling · ${e.turnsLeft} turn${e.turnsLeft === 1 ? '' : 's'} left`);
      } else {
        console.log(`${t}  wait    ${tag(e.side, e.unit)} ${e.reason === 'stunned' ? 'stunned' : 'no cards'}`);
      }
      break;
    case 'end':
      console.log(`${t}  end     turn over`);
      break;
    case 'comparison':
      // `entries` is the team-aware source of truth (the legacy `player`/
      // `enemy` fields only describe each side's index-0 unit, which in a pack
      // silently hides four of five foes).
      console.log(
        `${t} ┌ ${e.entries.map((x) => `${label(x.side, x.unit)} ${fmt(x)}`).join(' | ')} → ` +
          `${e.performer === null ? 'nobody' : label(e.performer, e.performerUnit ?? 0)}`,
      );
      break;
    case 'skillCast':
      // Compatibility event; the tagged `play` line above is the readable cast
      // record and carries the identical targeting decision.
      break;
    case 'performSkipped':
      console.log(`${t} │  ${tag(e.side, e.unit)} performance consumed (${e.reason})`);
      break;
    case 'damage': {
      let shieldNote = '';
      if (e.blocked) {
        const drain = e.shieldDrain;
        const spent = drain === undefined ? 0 : drain.physical + drain.magical + drain.true;
        const key = wallKey(e.side, e.unit);
        const left = Math.max(0, (wall.get(key) ?? 0) - spent);
        wall.set(key, left);
        // `blocked` is DAMAGE absorbed; `spent` is PLATING consumed. They differ
        // whenever a pool trades at something other than 1:1 — an attuned pool
        // blocks 2 per point, a typed hit spilling into TRUE burns 2 per point —
        // so both are printed, and the wall left standing after them.
        shieldNote = ` (${e.blocked} blocked${spent !== e.blocked ? `, ${spent} shield spent` : ''}; ${left} shield left)`;
      }
      console.log(
        `${t} │  ${tag(e.side, e.unit)} takes ${e.amount} ${e.property}${shieldNote} -> ${e.hpAfter} hp${e.source !== 'skill' ? ` [${e.source}]` : ''}`,
      );
      if (e.calculation) console.log(`${t} │  calc             ${fmtDamage(e.calculation)}`);
      break;
    }
    case 'heal': {
      console.log(
        `${t} │  ${tag(e.side, e.unit)} heals ${e.amount}${e.flat ? ' (flat)' : ''}${
          e.antiHeal ? ` [anti-heal -${e.antiHeal.pct}%: -${e.antiHeal.reduced} from ${e.antiHeal.categories.join('+')}]` : ''
        } -> ${e.hpAfter} hp`,
      );
      // Same `calc` line the damage case prints. A LIFESTEAL heal carries no
      // calculation (percentage of damage dealt — no base to split), so this
      // line simply doesn't appear for one.
      const hc = e.calculation;
      if (hc) {
        const terms = [`${hc.power}`];
        const add = (label: string, value: number): void => {
          if (value !== 0) terms.push(`${value > 0 ? '+' : '-'}${label}${Math.abs(value)}`);
        };
        add(hc.property === 'physical' ? 'ARMOR' : 'MRES', hc.statBonus);
        add('AURA', hc.healFlat);
        // A rider's flat contribution to the request (`cleanseConvert`). Part of
        // the pre-tax request, so it sits ahead of the ANTIHEAL line. On a TRUE
        // heal `hc.power` is the base alone and this term is what makes the sum
        // add up.
        add('RIDER', hc.bonus ?? 0);
        add('ANTIHEAL', -(e.antiHeal?.reduced ?? 0));
        add('OVERHEAL', -e.overheal);
        console.log(`${t} │  calc             ${terms.join(' ')} = ${e.amount} HP`);
      }
      break;
    }
    case 'shieldGain':
      // `overheal: true` = plating CONVERTED from a heal's wasted remainder
      // (`overhealShield`), not granted by a `shield` line — worth naming, because
      // the two are otherwise the same row.
      console.log(`${t} │  ${tag(e.side, e.unit)} +${e.amount} ${e.property} shield${e.overheal ? ' from overheal' : ''}${e.wasted ? ` (${e.wasted} wasted)` : ''} -> ${e.totalAfter} total`);
      wall.set(wallKey(e.side, e.unit), e.totalAfter);
      break;
    case 'statusApplied': {
      let detail = '';
      if (e.stat) {
        detail = ` ${e.stat} ${e.status === 'debuff' ? '-' : '+'}${e.pct ?? e.amount ?? 0}${e.pct !== undefined ? '%' : ''}`;
      } else if (e.status === 'expose') {
        detail = ` +${e.pct ?? 0}%`;
      } else if (e.status === 'poison' || e.status === 'burn' || e.status === 'bleed') {
        // Decaying DoTs: the pile size IS the state — duration is implied
        // (poison/bleed: stacks ticks; burn: halves each tick).
        console.log(`${t} │  ${tag(e.side, e.unit)} gains ${e.status} ${e.stacks ?? 0} stacks${e.property ? ` (${e.property})` : ''}`);
        break;
      } else if (e.property) {
        detail = `(${e.property})`;
      }
      console.log(`${t} │  ${tag(e.side, e.unit)} gains ${e.status}${detail} for ${e.turns}t`);
      break;
    }
    case 'statusExpired':
      console.log(`${t} │  ${tag(e.side, e.unit)} ${e.status} expired`);
      break;
    case 'cleansed':
      console.log(`${t} │  ${tag(e.side, e.unit)} cleansed ${e.removed} effect${e.removed === 1 ? '' : 's'}`);
      break;
    case 'aggroChanged':
      // Worth printing: `aggro` is the metric the default target policy reads,
      // so this line explains WHY later casts pick the foe they pick.
      console.log(`${t} │  ${tag(e.side, e.unit)} aggro -> ${e.aggro}`);
      break;
    case 'negated':
      console.log(`${t} │  ${tag(e.side, e.unit)} negated a ${e.property} hit`);
      break;
    case 'slowed':
      console.log(`${t} │  ${tag(e.side, e.unit)} next action +${e.weight} weight (slowed)`);
      break;
    // BURDEN — the card-scope weight tax. One slot = the bare burden on the
    // anchor; several = a `splash` spread it across the band, which the line says
    // outright so the spreader is legible in the log.
    case 'burdened':
      console.log(
        `${t} │  ${tag(e.side, e.unit)} burden +${e.weight} weight on slot${e.slots.length === 1 ? '' : 's'} `
        + `${e.slots.map((slot) => (slot === e.anchorSlot ? `[${slot + 1}]` : String(slot + 1))).join(' ')} `
        + `(anchor in brackets)${e.slots.length > 1 ? ' [splash]' : ''}`,
      );
      break;
    // CURSE — burden's twin on the damage axis, same line shape plus the window.
    case 'cursed':
      console.log(
        `${t} │  ${tag(e.side, e.unit)} curse -${e.amount} damage for ${e.turns} turn${e.turns === 1 ? '' : 's'} on slot${e.slots.length === 1 ? '' : 's'} `
        + `${e.slots.map((slot) => (slot === e.anchorSlot ? `[${slot + 1}]` : String(slot + 1))).join(' ')} `
        + `(anchor in brackets)${e.slots.length > 1 ? ' [splash]' : ''}`,
      );
      break;
    case 'curseExpired':
      console.log(
        `${t} │  ${tag(e.side, e.unit)} curse wears off on slot${e.slots.length === 1 ? '' : 's'} `
        + `${e.slots.map((slot) => String(slot + 1)).join(' ')}`,
      );
      break;
    case 'disrupted':
      console.log(`${t} │  ${tag(e.side, e.unit)} disrupted −${e.amount} bank -> ${e.bankAfter}`);
      break;
    case 'shieldBroken':
      // `burst: true` means the unit SPENT ITS OWN plating as damage
      // (`shieldBurst`) rather than having it shattered by a foe's `shieldBreak`
      // — same two numbers, opposite owner, so the line says which.
      console.log(
        e.burst
          ? `${t} │  ${tag(e.side, e.unit)} spends its own shield −${e.amount} -> ${e.totalAfter} (burst into the hit)`
          : `${t} │  ${tag(e.side, e.unit)} shield shattered −${e.amount} -> ${e.totalAfter}`,
      );
      break;
    case 'warded':
      console.log(`${t} │  ${tag(e.side, e.unit)} ward prevented ${e.status} -> ${e.chargesLeft} charge${e.chargesLeft === 1 ? '' : 's'} left`);
      break;
    case 'wardReleased':
      // The volunteered mirror of `warded`: charges cashed in as damage
      // (`wardRelease`) instead of spent stopping an affliction.
      console.log(`${t} │  ${tag(e.side, e.unit)} releases ${e.charges} ward charge${e.charges === 1 ? '' : 's'} into the hit -> ${e.chargesLeft} left`);
      break;
    case 'suddenDeathStart':
      console.log(`${t} ⚡ SUDDEN DEATH — damage ramps each turn (+10% you, +30% foe)`);
      break;
    case 'attritionStart':
      console.log(`${t} ⚡ ATTRITION — every combatant now takes ${e.amount} true damage per turn (growing)`);
      break;
    case 'fatigueStart':
      console.log(`${t} ⚡ FATIGUE backstop sets in`);
      break;
    case 'died':
      console.log(`${t} ☠  ${tag(e.side, e.unit)} dies`);
      break;
    case 'combatEnd':
      console.log(`${t} ═══ ${e.result.toUpperCase()} after ${e.turns} turns ═══`);
      break;
    default:
      break;
  }
}

const finalLine = (side: Side): string =>
  (side === 'player' ? finalState.playerTeam : finalState.enemyTeam)
    .map((u, i) => `${label(side, i)} ${u.stats.hp}/${u.stats.maxHp} hp${u.alive ? '' : ' ☠'}`)
    .join(', ');

console.log(`\nfinal: ${finalLine('player')} | ${finalLine('enemy')} | result=${result} turns=${turns} seed=${seed}`);
