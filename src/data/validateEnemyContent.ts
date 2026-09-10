import type { EnemyDef, EnemyGrowthMilestone } from '../engine/types';
import type { ContentProblem } from './validateSkillContent';
import { inRange, isInt, opt, req } from './validateSkillContent';

/**
 * RUNTIME SCHEMA VALIDATION for the enemy content document — the twin of
 * validateSkillContent.ts / validateGemContent.ts, deliberately identical in
 * philosophy so there is ONE way content is validated in this codebase:
 *
 *   - ONE OUTCOME: a problem is a FAILURE. There is no warning tier.
 *   - A CONTRACT, not a suggestion: unknown fields are rejected (an agent
 *     typing `elementAffinty` for `elementAffinity` must not validate clean
 *     and silently spawn an untyped monster).
 *   - COMPLETENESS, not just shape: an `EnemyDef` this loader accepts must be
 *     everything `src/run/encounter.ts` and the board UI need to place and
 *     render the monster — nothing here may be optional-in-practice while
 *     typed as required, or vice versa.
 *
 * SMALLER than its skill/gem siblings on purpose: `EnemyDef` has no actions,
 * auras or tier upgrades of its own — it names cards by `skillId` and leaves
 * validating what THOSE ids do to validateSkillContent.ts. Cross-checking
 * that a `skillId` actually exists in the skill book is deliberately NOT done
 * here: that would make this loader depend on the skill book's load order,
 * and a dangling id is exactly the kind of thing
 * tests/data/enemiesJsonParity.test.ts's whole-book comparison against the
 * live TS book already catches (the TS book would fail to build such a board
 * against `simulate()` first).
 */
export type { ContentProblem };

const ELEMENTS = ['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'] as readonly string[];
const WEAPONS = ['sword', 'axe', 'lance', 'bow', 'beast'] as readonly string[];
const TIERS = ['bronze', 'silver', 'gold', 'diamond'] as readonly string[];

/** The 7 fields of `CombatantStats` — every enemy's floor statline, no more, no fewer. */
const STAT_FIELDS = ['maxHp', 'hp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'] as const;

/** Fields allowed inside a document's `def` payload. `id`/`version` are the KEY and live on the envelope. */
const DEF_FIELDS = new Set([
  'notes', 'name', 'baseDepth', 'isElite', 'isBoss',
  'elementAffinity', 'weaponAffinity', 'stats', 'boardSize', 'pieces',
  'growth', 'goldReward', 'xpReward',
]);

/**
 * MIRRORS `GENERIC_GROWTH_CARDS` in `src/run/encounter.ts` — kept as its own
 * literal rather than imported, because `src/data` must not depend on
 * `src/run` (the reverse of the project's layering direction: engine < data <
 * run). `tests/data/enemyGrowthGuard.test.ts` asserts the two stay equal, so a
 * future repricing of the run-layer constant cannot silently drift from the
 * schema's own cap without a red test naming it.
 */
const MAX_GROWTH_CARDS = 3;

/** Exported for the sync guard against `GENERIC_GROWTH_CARDS`
 * (`src/run/encounter.ts`) — see `MAX_GROWTH_CARDS`'s own comment. */
export { MAX_GROWTH_CARDS };

const PIECE_FIELDS = new Set(['skillId', 'slot', 'tier', 'gem']);
const MILESTONE_FIELDS = new Set(['family', 'purpose', 'candidates']);
const FAMILY_FIELDS = new Set(['kind', 'type']);
const CANDIDATE_FIELDS = new Set(['skillId', 'allowDuplicate']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validateGrowthMilestone(raw: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(raw)) { problems.push({ where, message: 'growth milestone must be an object' }); return; }
  if (!isObj(raw.family)) {
    problems.push({ where, message: 'family must be an object' });
  } else {
    const family = raw.family;
    if (family.kind !== 'element' && family.kind !== 'weapon') {
      problems.push({ where, message: 'family.kind must be element|weapon' });
    } else if (!(family.kind === 'element' ? ELEMENTS : WEAPONS).includes(family.type as string)) {
      problems.push({ where, message: 'family.type must belong to the declared ' + family.kind + ' axis' });
    }
    for (const key of Object.keys(family)) {
      if (!FAMILY_FIELDS.has(key)) problems.push({ where, message: 'unknown family field ' + key });
    }
  }
  req(raw, 'purpose', (v) => v === 'complete-affinity' || v === 'reinforce-family', 'complete-affinity|reinforce-family', where, problems);
  if (!Array.isArray(raw.candidates) || raw.candidates.length === 0) {
    problems.push({ where, message: 'candidates must be a non-empty array' });
  } else {
    raw.candidates.forEach((candidate, i) => {
      const at = where + '.candidates[' + String(i) + ']';
      if (!isObj(candidate)) { problems.push({ where: at, message: 'candidate must be an object' }); return; }
      req(candidate, 'skillId', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', at, problems);
      opt(candidate, 'allowDuplicate', (v) => v === true, 'literally true (omit to reject duplicates)', at, problems);
      for (const key of Object.keys(candidate)) {
        if (!CANDIDATE_FIELDS.has(key)) problems.push({ where: at, message: 'unknown candidate field ' + key });
      }
    });
  }
  for (const key of Object.keys(raw)) {
    if (!MILESTONE_FIELDS.has(key)) problems.push({ where, message: 'unknown milestone field ' + key });
  }
}

/** Validates the `stats` object: exactly the 7 `CombatantStats` fields, each a safe integer. */
function validateStats(raw: unknown, where: string, problems: ContentProblem[]): void {
  const at = where + '.stats';
  if (!isObj(raw)) { problems.push({ where: at, message: 'stats must be an object' }); return; }
  for (const field of STAT_FIELDS) req(raw, field, isInt, 'an integer', at, problems);
  for (const key of Object.keys(raw)) {
    if (!(STAT_FIELDS as readonly string[]).includes(key)) {
      problems.push({ where: at, message: 'unknown stat field ' + key + ' (known: ' + STAT_FIELDS.join(', ') + ')' });
    }
  }
}

/**
 * Validates one board piece. `gem` is intentionally NOT deep-validated
 * against gem content rules — no enemy carries one today (see enemies.ts's
 * own doc comment: "no gems, no tier overrides"), and doing so here would
 * duplicate validateGemContent.ts's contract for a shape this document does
 * not yet use. It is checked structurally (object or null) so a malformed
 * value still fails loudly rather than reaching `simulate()` unchecked.
 */
function validatePiece(raw: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(raw)) { problems.push({ where, message: 'a piece must be an object' }); return; }
  req(raw, 'skillId', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  req(raw, 'slot', inRange(0, 99), 'an integer 0..99', where, problems);
  opt(raw, 'tier', (v) => TIERS.includes(v as string), TIERS.join('|'), where, problems);
  if (raw.gem !== undefined && raw.gem !== null && !isObj(raw.gem)) {
    problems.push({ where, message: 'gem must be an object or null' });
  }
  for (const key of Object.keys(raw)) {
    if (!PIECE_FIELDS.has(key)) problems.push({ where, message: 'unknown piece field ' + key + ' (known: ' + [...PIECE_FIELDS].join(', ') + ')' });
  }
}

function validateDef(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  // RENDER-REQUIRED. An enemy with no name cannot be shown by the encounter
  // card, the board UI or the bestiary.
  req(raw, 'name', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  req(raw, 'baseDepth', inRange(1, 999), 'an integer 1..999 (the difficulty anchor the run layer scales boards/HP from)', where, problems);
  opt(raw, 'isElite', (v) => v === true, 'literally true (the flag is present-or-absent, never false)', where, problems);
  opt(raw, 'isBoss', (v) => v === true, 'literally true (the flag is present-or-absent, never false)', where, problems);
  opt(raw, 'elementAffinity', (v) => ELEMENTS.includes(v as string), ELEMENTS.join('|'), where, problems);
  opt(raw, 'weaponAffinity', (v) => WEAPONS.includes(v as string), WEAPONS.join('|'), where, problems);
  opt(raw, 'notes', (v) => Array.isArray(v) && v.every((n) => typeof n === 'string'), 'an array of strings', where, problems);

  // `elementAffinity`/`weaponAffinity` are BOTH optional on an enemy, AND MAY
  // COEXIST — unlike `SkillDef`, which must carry exactly one type badge for
  // its single card face, an `EnemyDef` is not a card: `stone_beetle` is a
  // real, intentional example (nature affinity + a beast weapon affinity),
  // and several signature monsters carry neither and rely on their cards' own
  // typing. There is no "ambiguous badge" concern to police here.

  // Structural milestone contract. Catalog-dependent checks stay in the
  // explicit guard below and the run-layer production-resolution validators.
  if (raw.growth !== undefined) {
    if (!Array.isArray(raw.growth)) {
      problems.push({ where, message: 'growth must be an array of milestones' });
    } else {
      if (raw.growth.length > MAX_GROWTH_CARDS) {
        problems.push({ where, message: 'growth has ' + String(raw.growth.length) + ' cards, more than MAX_GROWTH_CARDS (' + String(MAX_GROWTH_CARDS) + ') — the PL ledger prices an unauthored/oversized list at this worst case; a longer list would under-price the encounter' });
      }
      raw.growth.forEach((milestone, i) => validateGrowthMilestone(milestone, where + '.growth[' + String(i) + ']', problems));
    }
  }

  req(raw, 'boardSize', inRange(1, 20), 'an integer 1..20', where, problems);
  req(raw, 'goldReward', inRange(0, 999999), 'a non-negative integer', where, problems);
  req(raw, 'xpReward', inRange(0, 999999), 'a non-negative integer', where, problems);

  if (raw.stats !== undefined) validateStats(raw.stats, where, problems); else problems.push({ where, message: 'missing required field stats' });

  if (!Array.isArray(raw.pieces) || raw.pieces.length === 0) {
    problems.push({ where, message: 'pieces must be a non-empty array (an enemy with no cards has nothing to cast)' });
  } else {
    raw.pieces.forEach((p, i) => validatePiece(p, where + '.pieces[' + String(i) + ']', problems));
    // NO TWO PIECES MAY SHARE A SLOT — `CombatantSetup.pieces`' own doc says
    // "must not overlap"; a document that violates this would build a board
    // `simulate()` was never meant to receive.
    const slots = new Map<number, number>();
    raw.pieces.forEach((p, i) => {
      if (!isObj(p) || !isInt(p.slot)) return;
      const first = slots.get(p.slot);
      if (first !== undefined) {
        problems.push({ where: where + '.pieces[' + String(i) + ']', message: 'slot ' + String(p.slot) + ' is already used by pieces[' + String(first) + ']' });
      } else {
        slots.set(p.slot, i);
      }
    });
    // A piece's slot must fit on the enemy's own board.
    if (isInt(raw.boardSize)) {
      raw.pieces.forEach((p, i) => {
        if (isObj(p) && isInt(p.slot) && p.slot >= (raw.boardSize as number)) {
          problems.push({ where: where + '.pieces[' + String(i) + ']', message: 'slot ' + String(p.slot) + ' is outside boardSize ' + String(raw.boardSize) });
        }
      });
    }
  }

  for (const key of Object.keys(raw)) {
    if (key === 'id' || key === 'version') {
      problems.push({ where, message: key + ' belongs on the document envelope, not inside def' });
    } else if (!DEF_FIELDS.has(key)) {
      problems.push({ where, message: 'unknown field ' + key + ' — the schema is a CONTRACT and rejects what it does not define. If this field is real, add it to the validator in the same change that first uses it.' });
    }
  }
}

/** Validates a whole enemies document. Returns every problem found; never throws. */
export function validateEnemyDocument(doc: unknown): ContentProblem[] {
  const problems: ContentProblem[] = [];
  if (!isObj(doc)) return [{ where: 'document', message: 'document must be an object' }];
  if (doc.schemaVersion !== 1) {
    problems.push({ where: 'document', message: 'unsupported schemaVersion ' + JSON.stringify(doc.schemaVersion) + ' (this loader knows 1)' });
  }
  if (!Array.isArray(doc.enemies)) {
    problems.push({ where: 'document', message: 'enemies must be an array' });
    return problems;
  }

  const seen = new Set<string>();
  doc.enemies.forEach((enemy, ei) => {
    const where0 = 'enemies[' + String(ei) + ']';
    if (!isObj(enemy)) { problems.push({ where: where0, message: 'enemy must be an object' }); return; }
    if (typeof enemy.id !== 'string') { problems.push({ where: where0, message: 'enemy is missing a string id' }); return; }
    const id = enemy.id;
    // ALL-NUMERIC IDS ARE REJECTED — same reasoning as skills/gems: JS
    // enumerates integer-like object keys first, in ascending numeric order,
    // which would silently break the id-sorted iteration order
    // `Object.values(enemies)` feeds the run layer's fight/boss pools
    // (src/run/runState.ts's FIGHT_POOL/BOSS_POOL).
    if (/^[0-9]+$/.test(id)) {
      problems.push({ where: id, message: 'an all-numeric id is not allowed: JS enumerates integer-like object keys first, which would break the id-sorted pool order the run layer depends on' });
    }
    if (id.trim() === '') problems.push({ where: where0, message: 'id must be a non-empty string' });
    if (seen.has(id)) problems.push({ where: id, message: 'duplicate document for id ' + id + ' — one document per enemy, versions go inside it' });
    seen.add(id);

    if (!Array.isArray(enemy.versions) || enemy.versions.length === 0) {
      problems.push({ where: id, message: 'versions must be a non-empty array of { version, def }' });
      return;
    }
    const versionsSeen = new Set<number>();
    enemy.versions.forEach((entry, vi) => {
      const at = id + '[' + String(vi) + ']';
      if (!isObj(entry)) { problems.push({ where: at, message: 'version entry must be an object' }); return; }
      req(entry, 'version', (v) => isInt(v) && (v as number) >= 1, 'an integer >= 1', at, problems);
      if (isInt(entry.version)) {
        const v = entry.version;
        if (versionsSeen.has(v)) problems.push({ where: id, message: 'duplicate version ' + String(v) });
        versionsSeen.add(v);
      }
      if (!isObj(entry.def)) {
        problems.push({ where: id + '@v' + String(entry.version), message: 'def must be an object (the definition this version resolves to)' });
        return;
      }
      validateDef(entry.def, id + '@v' + String(entry.version), problems);
      for (const k of Object.keys(entry)) {
        if (k !== 'version' && k !== 'def') {
          problems.push({ where: id + '@v' + String(entry.version), message: 'unknown field ' + k + ' — a version entry is exactly { version, def }' });
        }
      }
    });

    for (const k of Object.keys(enemy)) {
      if (k !== 'id' && k !== 'versions') {
        problems.push({ where: id, message: 'unknown envelope field ' + k + ' — the envelope is exactly { id, versions }' });
      }
    }
  });
  return problems;
}

/**
 * The EnemyDef a document resolves to: its `def` payload, with `id` put back
 * and the authoring-only `notes` dropped — mirrors `skillDefOfDocument` /
 * `gemDefOfDocument`.
 */
export function enemyDefOfDocument(id: string, def: Record<string, unknown>): EnemyDef {
  const { notes: _n, ...rest } = def;
  return { id, ...rest } as unknown as EnemyDef;
}

/** The shape both sides of the affinity guard below share: an enemy's
 * `elementAffinity`/`weaponAffinity`, however they were produced. */
export interface EnemyAffinityLike {
  elementAffinity?: string;
  weaponAffinity?: string;
}

/**
 * PERMANENT GUARD for the 2026-09-06 ruling ("affinity are just passive buffs
 * based on the board … there should be no hardcoded enemy that break the
 * rule"): if `elementAffinity`/`weaponAffinity` are EVER authored on an enemy
 * again, the value must equal exactly what that enemy's own board derives —
 * never a value the board does not produce. No enemy in the live document
 * authors either field as of 2026-09-06 (both were removed from every entry
 * in `src/data/enemies.ts`); this only fires if one is added back that the
 * board does not earn.
 *
 * Deliberately NOT folded into `validateEnemyDocument`/`validateDef` above,
 * and deliberately NOT importing the skill book itself: this module's own
 * doc comment already declines a `skillId` existence check for exactly this
 * reason ("that would make this loader depend on the skill book's load
 * order"), and computing a board's derived affinity needs the same skill
 * lookups. `derived` is passed in instead, computed by the one real
 * implementation — `enemyDerivedAffinity` (`src/data/enemies.ts`), itself a
 * thin wrapper over the engine's own `boardAffinities`
 * (`src/engine/combat/typeIdentity.ts`) — so there is still only ONE rule for
 * what an enemy's affinity is; this function only compares two answers, it
 * never computes one. Wired into `tests/data/enemyAffinityGuard.test.ts`
 * against the live TS book + skill book, which is where a caller naturally
 * has both sides to hand; `scripts/validateContent.ts`'s raw-JSON build gate
 * stays skill-book-free, matching the same tradeoff `src/data/content/
 * README.md` documents for the balance/gem-band rules that need `PRICE` or
 * the skill book and therefore live in tests too.
 */
export function validateEnemyAffinityMatchesBoard(
  id: string,
  authored: EnemyAffinityLike,
  derived: EnemyAffinityLike,
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  if (authored.elementAffinity !== undefined && authored.elementAffinity !== derived.elementAffinity) {
    problems.push({
      where: id,
      message: 'elementAffinity ' + authored.elementAffinity + ' is authored but the board only derives '
        + (derived.elementAffinity ?? '(none)') + ' — affinity is board-derived only, no authored override may disagree with it',
    });
  }
  if (authored.weaponAffinity !== undefined && authored.weaponAffinity !== derived.weaponAffinity) {
    problems.push({
      where: id,
      message: 'weaponAffinity ' + authored.weaponAffinity + ' is authored but the board only derives '
        + (derived.weaponAffinity ?? '(none)') + ' — affinity is board-derived only, no authored override may disagree with it',
    });
  }
  return problems;
}

/**
 * PERMANENT GUARD for `EnemyDef.growth`: every candidate ID nested in every
 * ordered milestone must exist in the skill book, including unused fallbacks.
 * Deliberately a SEPARATE function from `validateDef` above
 * for the identical reason `validateEnemyAffinityMatchesBoard` is — a
 * `skillId` existence check needs the skill book, and this module's own doc
 * comment already declines that dependency for `pieces[].skillId` ("that
 * would make this loader depend on the skill book's load order"). At runtime,
 * the resolver rejects unknown IDs and tries the next authored candidate;
 * if none qualifies, it throws EnemyGrowthResolutionError. This preflight
 * guard catches invalid IDs even when a valid fallback would resolve: wired into
 * `tests/data/enemyGrowthGuard.test.ts` where a caller naturally has both the
 * live enemy book and the skill book to hand.
 */
export function validateEnemyGrowthCardsExist(
  id: string,
  growth: readonly EnemyGrowthMilestone[] | undefined,
  knownSkillIds: ReadonlySet<string>,
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  for (let i = 0; i < (growth?.length ?? 0); i += 1) {
    const candidates = growth![i]!.candidates;
    for (let j = 0; j < candidates.length; j += 1) {
      const skillId = candidates[j]!.skillId;
      if (!knownSkillIds.has(skillId)) {
        problems.push({ where: id + '.growth[' + String(i) + '].candidates[' + String(j) + ']', message: 'growth names unknown skill id "' + skillId + '" — every growth card must exist in the skill book' });
      }
    }
  }
  return problems;
}
