// Shared board-spec parser for every script that needs to build a
// `BoardPiece[]` from a plain string — `scripts/fight.ts` (`FIGHT_HERO_BOARD`
// / `FIGHT_FOE_BOARD`) and `scripts/enemyOutput.ts` (`--board` / `--vs`).
//
// EXTRACTED FROM `scripts/fight.ts` (2026-09-14), not reimplemented: this was
// `fight.ts`'s own private `parsePiece` plus the slot-cursor walk its
// `heroPieces`/`foePieces` each duplicated inline. `enemyOutput.ts` needed the
// identical `skill_id`, `skill_id@tier`, `skill_id#gem_id` syntax to test an
// arbitrary multi-card board, and CLAUDE.md's "never hand-write a second log
// renderer" reasoning applies just as hard to a second PARSER — two tools
// quietly disagreeing about what a board spec means is the same drift class,
// just one layer earlier. So this module holds the ONE parser; `fight.ts` and
// `enemyOutput.ts` both import it, and neither defines its own.
import type { BoardPiece, Gem, SkillBook } from '../src/engine/types';
import type { GemDef } from '../src/data/gems';

/**
 * One board-spec entry: `skill_id`, `skill_id@tier` to rank the card up before
 * the fight (`bronze`|`silver`|`gold`|`diamond`), and/or `skill_id#gem_id` to
 * socket a gem into it. Both suffixes may be combined, tier first:
 * `judgment_light@diamond#judgment_light_echo`.
 *
 * THE SUFFIXES EXIST so a tier-scaled or GEMMED card can be shown/measured the
 * same way every other claim in this project is shown — by a real
 * `npm run fight` log (or `npm run output`'s stat summary) rather than a
 * second, hand-written renderer. `BoardPiece.tier` / `BoardPiece.gem` are the
 * engine's own per-piece overrides (`resolveEffectiveSkill` runs `applyTier`
 * and the gem splice on them), so this parses the spec and hands the engine
 * fields it already has; no formatting or resolution logic is duplicated
 * here. No suffix = bronze, un-gemmed = byte-identical to the pre-suffix
 * behavior.
 *
 * Returns `null` for a blank entry (an empty comma-separated slot), which
 * every caller skips rather than turning into a piece.
 */
export function parsePiece(
  raw: string,
  envName: string,
  slot: number,
  skillBook: SkillBook,
  gemBook: Record<string, GemDef>,
): BoardPiece | null {
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

/** `parsePieceList`'s result: the parsed pieces plus the slot cursor after the last one. */
export interface ParsedPieceList {
  pieces: BoardPiece[];
  /** Total board slots the parsed pieces occupy (the cursor's value after the last piece). */
  slotsUsed: number;
}

/**
 * Parse a comma-separated list of board-spec entries (see `parsePiece`) into
 * pieces laid out left to right from slot 0, each card's own `size` (from
 * `skillBook`) advancing the cursor — the same packing `fight.ts`'s
 * `heroPieces`/`foePieces` and `tests/helpers.ts` use. Blank entries (from a
 * stray comma) are skipped, not turned into pieces.
 *
 * Callers own their own "is this empty" / "does it fit the board" checks —
 * `fight.ts`'s hero board, foe board, and `enemyOutput.ts`'s board specs each
 * have a different size limit and error wording, so this only returns
 * `slotsUsed` for the caller to check against its own limit.
 */
export function parsePieceList(
  spec: string,
  envName: string,
  skillBook: SkillBook,
  gemBook: Record<string, GemDef>,
): ParsedPieceList {
  const pieces: BoardPiece[] = [];
  let slot = 0;
  for (const raw of spec.split(',')) {
    const piece = parsePiece(raw, envName, slot, skillBook, gemBook);
    if (!piece) continue;
    pieces.push(piece);
    slot += skillBook[piece.skillId]!.size;
  }
  return { pieces, slotsUsed: slot };
}

// ---------------------------------------------------------------------------
// Stat overrides — EXTRACTED FROM `scripts/fight.ts` (2026-09-14 audit fix),
// not reimplemented. `fight.ts`'s `FIGHT_HERO_STATS`/`FIGHT_FOE_STATS` read
// this through an env var; `scripts/enemyOutput.ts`'s `--stats` flag reads
// the identical `name:integer,...` syntax from a CLI arg instead. Both call
// the SAME parsing engine (`parseStatOverrideSpec`) so the two tools cannot
// quietly disagree about what `attack:5,armor:0` means — the same "one
// parser" reasoning as `parsePiece`/`parsePieceList` above.
// ---------------------------------------------------------------------------

/**
 * Parse `key:value,key:value` into a stat-override object, using `base`'s own
 * keys as the allowed set (so `attack:5` refuses unless `attack` is already a
 * field on `base`). Refuses (via `process.exit(1)`) on a non-integer value or
 * an unrecognised key — a typo'd stat is an override you did not ask for,
 * same reasoning as `parsePiece`'s unknown-skill/unknown-gem refusals.
 * `label` names the flag/env-var in every error message.
 */
export function parseStatOverrideSpec<T extends Record<string, number>>(spec: string, label: string, base: T): T {
  const out: Record<string, number> = { ...base };
  for (const raw of spec.split(',')) {
    const pair = raw.trim();
    if (pair === '') continue;
    const [key, value] = pair.split(':');
    if (key === undefined || value === undefined || !/^-?[0-9]+$/.test(value)) {
      console.error(`${label}: expected name:integer pairs, got '${pair}'.`);
      process.exit(1);
    }
    if (!(key in out)) {
      console.error(`${label}: unknown stat '${key}' (known: ${Object.keys(out).join(', ')}).`);
      process.exit(1);
    }
    out[key] = Number(value);
  }
  return out as T;
}

/**
 * `fight.ts`'s original env-var form, UNCHANGED behavior: absent/blank env =
 * `stats` returned as-is (byte-identical passthrough); a present env value is
 * parsed by `parseStatOverrideSpec` with the env var's own name as the error
 * label — exactly the message `fight.ts` printed before this extraction.
 */
export function withStatOverrides<T extends Record<string, number>>(stats: T, envVar: string): T {
  const spec = process.env[envVar];
  if (spec === undefined || spec.trim() === '') return stats;
  return parseStatOverrideSpec(spec, envVar, stats);
}
