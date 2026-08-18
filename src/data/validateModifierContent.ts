import type { EnemyModifierPreset } from './modifiers';
import type { ContentProblem } from './validateSkillContent';
import { inRange, isInt, opt, req } from './validateSkillContent';

/**
 * RUNTIME SCHEMA VALIDATION for the enemy-modifier content document — the
 * twin of validateEnemyContent.ts / validateSkillContent.ts /
 * validateGemContent.ts, deliberately identical in philosophy so there is
 * ONE way content is validated in this codebase:
 *
 *   - ONE OUTCOME: a problem is a FAILURE. There is no warning tier.
 *   - A CONTRACT, not a suggestion: unknown fields are rejected (an agent
 *     typing `forcetier` for `forceTier` must not validate clean and
 *     silently ship an affix that never applies).
 *   - COMPLETENESS, not just shape: a preset this loader accepts must be
 *     everything `src/run/encounter.ts`'s `buildEnemyEncounter` needs to
 *     actually apply the affix — nothing here may be optional-in-practice
 *     while typed as required, or vice versa.
 *
 * SMALLER than its enemy/skill/gem siblings on purpose: a modifier preset has
 * exactly two effect shapes (a PL auto-spend, or a tier override), so this
 * validator's real teeth are the CROSS-FIELD checks below, not a long field
 * list — a schema that only checks "is this key present" is theatre.
 */
export type { ContentProblem };

const TIERS = ['bronze', 'silver', 'gold', 'diamond'] as readonly string[];

/** The 6 fields `ModifierStatBonus` (a `bonusProfile`) may carry — `maxHp` plus every `BuffableStat`. */
const PROFILE_FIELDS = ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'] as const;

/** Fields allowed inside a document's `def` payload. `id`/`version` are the KEY and live on the envelope. */
const DEF_FIELDS = new Set(['notes', 'name', 'blurb', 'bonusPL', 'bonusProfile', 'forceTier']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A `bonusPL` modifier's PL ceiling — generous headroom over the highest
 * `bonusPL` authored today (SWIFT's 8), enough for a much stronger affix
 * without being a blank check: `MAX_TIER_STEPS`-scale swings, not an
 * unbounded number that could silently dwarf a whole encounter's stat PL.
 */
const MAX_BONUS_PL = 999;

/** Validates the `bonusProfile` weights object: known fields only, each a non-negative integer, at least one entry. */
function validateBonusProfile(raw: unknown, where: string, problems: ContentProblem[]): void {
  const at = where + '.bonusProfile';
  if (!isObj(raw)) { problems.push({ where: at, message: 'bonusProfile must be an object' }); return; }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    problems.push({ where: at, message: 'bonusProfile must carry at least one stat weight (an empty profile spends its bonusPL on nothing)' });
  }
  for (const key of keys) {
    if (!(PROFILE_FIELDS as readonly string[]).includes(key)) {
      problems.push({ where: at, message: 'unknown profile field ' + key + ' (known: ' + PROFILE_FIELDS.join(', ') + ')' });
      continue;
    }
    if (!inRange(0, 1000)((raw as Record<string, unknown>)[key])) {
      problems.push({ where: at, message: key + ' must be an integer 0..1000 (a weight, not a delta), got ' + JSON.stringify((raw as Record<string, unknown>)[key]) });
    }
  }
}

function validateDef(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  req(raw, 'name', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  req(raw, 'blurb', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  opt(raw, 'notes', (v) => Array.isArray(v) && v.every((n) => typeof n === 'string'), 'an array of strings', where, problems);

  opt(raw, 'bonusPL', inRange(1, MAX_BONUS_PL), 'an integer 1..' + String(MAX_BONUS_PL), where, problems);
  if (raw.bonusProfile !== undefined) validateBonusProfile(raw.bonusProfile, where, problems);
  opt(raw, 'forceTier', (v) => TIERS.includes(v as string), TIERS.join('|'), where, problems);

  // CROSS-FIELD: bonusPL and bonusProfile are a PAIR — buildEnemyEncounter's
  // own apply site (`if (!mod.bonusPL || !mod.bonusProfile) continue;`) skips
  // the bonus silently if only one is present, which is exactly the "no
  // error, just different numbers" failure mode this schema exists to close.
  const hasBonusPL = raw.bonusPL !== undefined;
  const hasBonusProfile = raw.bonusProfile !== undefined;
  if (hasBonusPL !== hasBonusProfile) {
    problems.push({
      where,
      message: 'bonusPL and bonusProfile must both be present or both be absent (one without the other is a bonus that silently never applies)',
    });
  }

  // STRUCTURALLY IMPOSSIBLE: a modifier with no effect at all — neither a PL
  // auto-spend nor a tier override — is an affix that changes nothing, which
  // can only be an authoring mistake (a dropped `forceTier`/`bonusPL` pair).
  if (!hasBonusPL && !hasBonusProfile && raw.forceTier === undefined) {
    problems.push({ where, message: 'a modifier must define at least one effect: bonusPL+bonusProfile, or forceTier' });
  }

  for (const key of Object.keys(raw)) {
    if (key === 'id' || key === 'version') {
      problems.push({ where, message: key + ' belongs on the document envelope, not inside def' });
    } else if (!DEF_FIELDS.has(key)) {
      problems.push({ where, message: 'unknown field ' + key + ' — the schema is a CONTRACT and rejects what it does not define. If this field is real, add it to the validator in the same change that first uses it.' });
    }
  }
}

/** Validates a whole modifiers document. Returns every problem found; never throws. */
export function validateModifierDocument(doc: unknown): ContentProblem[] {
  const problems: ContentProblem[] = [];
  if (!isObj(doc)) return [{ where: 'document', message: 'document must be an object' }];
  if (doc.schemaVersion !== 1) {
    problems.push({ where: 'document', message: 'unsupported schemaVersion ' + JSON.stringify(doc.schemaVersion) + ' (this loader knows 1)' });
  }
  if (!Array.isArray(doc.modifiers)) {
    problems.push({ where: 'document', message: 'modifiers must be an array' });
    return problems;
  }

  const seen = new Set<string>();
  doc.modifiers.forEach((modifier, mi) => {
    const where0 = 'modifiers[' + String(mi) + ']';
    if (!isObj(modifier)) { problems.push({ where: where0, message: 'modifier must be an object' }); return; }
    if (typeof modifier.id !== 'string') { problems.push({ where: where0, message: 'modifier is missing a string id' }); return; }
    const id = modifier.id;
    // ALL-NUMERIC IDS ARE REJECTED — same reasoning as skills/gems/enemies:
    // JS enumerates integer-like object keys first, in ascending numeric
    // order, which would silently break the id-sorted iteration order
    // `ENEMY_MODIFIER_IDS` (Object.keys(MODIFIER_PRESETS)) feeds — the run
    // layer slices this list (src/run/runState.ts) to decide which affixes
    // an overflow fight offers.
    if (/^[0-9]+$/.test(id)) {
      problems.push({ where: id, message: 'an all-numeric id is not allowed: JS enumerates integer-like object keys first, which would break the id-sorted order the run layer depends on' });
    }
    if (id.trim() === '') problems.push({ where: where0, message: 'id must be a non-empty string' });
    if (seen.has(id)) problems.push({ where: id, message: 'duplicate document for id ' + id + ' — one document per modifier, versions go inside it' });
    seen.add(id);

    if (!Array.isArray(modifier.versions) || modifier.versions.length === 0) {
      problems.push({ where: id, message: 'versions must be a non-empty array of { version, def }' });
      return;
    }
    const versionsSeen = new Set<number>();
    modifier.versions.forEach((entry, vi) => {
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

    for (const k of Object.keys(modifier)) {
      if (k !== 'id' && k !== 'versions') {
        problems.push({ where: id, message: 'unknown envelope field ' + k + ' — the envelope is exactly { id, versions }' });
      }
    }
  });
  return problems;
}

/**
 * The EnemyModifierPreset a document resolves to: its `def` payload, with
 * `id` put back and the authoring-only `notes` dropped — mirrors
 * `enemyDefOfDocument` / `skillDefOfDocument` / `gemDefOfDocument`.
 */
export function modifierPresetOfDocument(id: string, def: Record<string, unknown>): EnemyModifierPreset {
  const { notes: _n, ...rest } = def;
  return { id, ...rest } as unknown as EnemyModifierPreset;
}
