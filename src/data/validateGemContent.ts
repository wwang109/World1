import type { Action, Gem, Rarity } from '../engine/types';
import type { ContentProblem } from './validateSkillContent';
import { isInt, opt, req, validateAction } from './validateSkillContent';

/**
 * RUNTIME SCHEMA + RULESET VALIDATION for the gem content documents.
 *
 * Same contract stance as `validateSkillContent.ts` — ONE outcome, a problem is a
 * failure, unknown fields included — plus the gem-specific rules from the GEM
 * RULESET v1 (game-director, 2026-08-09). Those rules exist because the pre-2026-08-09
 * catalog had drifted badly: 11 gems were mechanical duplicates of another gem,
 * "Echo" named 33 unrelated chips, and a Common gem out-healed a Legendary 4x.
 * The point of encoding them HERE is that the confusion becomes UNAUTHORABLE
 * rather than merely reviewable.
 *
 * WHAT IS DELIBERATELY NOT HERE: anything needing the PRICE tables. Exact band
 * placement (`isGemOnBudget`) and the minimal-magnitude rule are BALANCE rules and
 * live with the other balance audits in `tests/engine/gemAudit.test.ts` /
 * `tests/data/gemsRuleset.test.ts`. Keeping `src/engine/balance.ts` out of the
 * loader's import graph keeps content loading cheap and dependency-light in all
 * three runtimes; a price change must never be able to stop the game booting.
 */

/** The four gem categories. Derived from the PAYLOAD — never from the name. */
export type GemCategory = 'Sliver' | 'Echo' | 'Core' | 'Charm';

/** Actions that count as an appended HIT (mirrors `HIT_KINDS` in balance.ts). */
const HIT_KINDS: readonly string[] = ['damage', 'statStrike'];

/**
 * Openers each category's `text` MUST begin with. A Sliver has no fixed opener
 * (the ruleset says "effect keyword/verb", which is not a checkable string), so it
 * is validated NEGATIVELY: a Sliver must not borrow another category's opener.
 * That still makes the drift that matters — a rider masquerading as a Core or a
 * Charm — unauthorable.
 */
const CATEGORY_OPENER: Record<GemCategory, string | null> = {
  Sliver: null,
  Echo: 'Echo:',
  Core: 'This card:',
  Charm: 'Hero:',
};

const RARITIES: readonly string[] = ['common', 'rare', 'epic', 'legendary'];
const SCOPES: readonly string[] = ['card', 'hero'];
const CARD_MODS: readonly string[] = ['damageFlat', 'healFlat', 'weightDelta'];
const HERO_MODS: readonly string[] = ['attack', 'magicPower', 'armor', 'magicResist', 'speed'];

const DEF_FIELDS = new Set([
  'notes', 'name', 'text', 'kind', 'rarity', 'scope',
  'actions', 'mods', 'weightIncreasePct', 'cooldownReduction',
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Category from the payload shape alone. `null` when the shape is not valid enough to classify. */
export function categoryOfGem(def: Record<string, unknown>): GemCategory | null {
  if (def.kind === 'stat') {
    if (def.scope === 'card') return 'Core';
    if (def.scope === 'hero') return 'Charm';
    return null;
  }
  if (def.kind !== 'effect' || !Array.isArray(def.actions)) return null;
  const actions = def.actions as Array<Record<string, unknown>>;
  const isEcho = actions.some((a) => a.kind === 'statStrike' && a.echoHostPower === true);
  return isEcho ? 'Echo' : 'Sliver';
}

/**
 * A canonical string for the gem's MECHANICAL payload — everything that decides
 * what it does, and nothing that decides what it is called. Two gems sharing this
 * are mechanical twins, which is exactly the duplicate class that produced
 * 11 redundant gems before the 2026-08-09 migration (damage4 x5, damage8 x3,
 * slow16 x3, ...). Rarity is INCLUDED, so the same shape at a different band is a
 * legal ladder rung (R8.3) while the same shape at the same band is not.
 */
export function payloadFingerprint(def: Record<string, unknown>): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (!isObj(v)) return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canonical(v[k]);
    return out;
  };
  return JSON.stringify(canonical({
    kind: def.kind, rarity: def.rarity, scope: def.scope,
    actions: def.actions, mods: def.mods,
    weightIncreasePct: def.weightIncreasePct, cooldownReduction: def.cooldownReduction,
  }));
}

/**
 * Kinds banned OUTRIGHT from a gem's `actions`, at ANY magnitude, in ANY
 * combination with other actions — a HARD structural rejection, not merely
 * "this magnitude misses a band". A kind belongs here ONLY when NO companion
 * action could ever rescue it: every action's price is ADDED, never
 * subtracted (an effect gem carries no negative-cost term — that only exists
 * on a Core's `weightDelta`, a disjoint `kind: 'stat'` payload), so a kind
 * whose OWN MINIMUM already exceeds Legendary (80) can only be pushed further
 * over budget by a companion, never brought back under it.
 *   stun:   100 deci/turn, 1-turn floor = 100 > 80. No companion helps.
 *   negate: 100 deci/charge, 1-charge floor = 100 > 80. No companion helps.
 *           (The Echo counterplay is card-only, by design.)
 * `cleanse` USED to sit here too (25 deci/charge — no charge count alone
 * lands on 20/40/60/80) but that reasoning only ever covered the SINGLE-
 * ACTION case: `cleanse 1 (25) + a 15-deci companion = 40` bands exactly on
 * Rare (see `renewal_sliver`, gem ruleset investigation 2026-08-18), so a
 * blanket ban was over-broad and is lifted. A lone, uncompanioned `cleanse`
 * still misses every band — that is now a BALANCE fact (`isGemOnBudget`,
 * `tests/data/gemsRuleset.test.ts`), not a structural one, matching this
 * file's own stated boundary ("anything needing the PRICE tables… live with
 * the other balance audits").
 */
const UNPRICEABLE_KINDS: Record<string, string> = {
  stun: 'stun costs 100 deci/turn, so 1 turn = 100 — past Legendary (80). No turn count lands on a band (20/40/60/80), and no companion action can ever bring an already-over-budget minimum back down (every action price only adds).',
  negate: 'negate costs 100 deci/charge, so 1 charge = 100 — past Legendary (80). The Echo counterplay is card-only, by design, and no companion action can ever bring an already-over-budget minimum back down (every action price only adds).',
};

function validateGemDef(raw: unknown, id: string, problems: ContentProblem[]): void {
  const where = id;
  if (!isObj(raw)) { problems.push({ where, message: 'def must be an object' }); return; }

  req(raw, 'name', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  req(raw, 'text', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string (the gem must be able to SHOW what it does)', where, problems);
  req(raw, 'rarity', (v) => RARITIES.includes(v as string), RARITIES.join('|'), where, problems);
  req(raw, 'kind', (v) => v === 'effect' || v === 'stat', 'effect or stat', where, problems);
  opt(raw, 'notes', (v) => Array.isArray(v) && v.every((n) => typeof n === 'string'), 'an array of strings', where, problems);

  const name = typeof raw.name === 'string' ? raw.name : '';
  const text = typeof raw.text === 'string' ? raw.text : '';
  const rarity = raw.rarity as Rarity;

  // ---- R7.1 ONE KIND, and only that kind's payload ------------------------
  if (raw.kind === 'effect') {
    if (raw.scope !== undefined) problems.push({ where, message: 'scope belongs to a stat gem; an effect gem has none' });
    if (raw.mods !== undefined) problems.push({ where, message: 'mods belongs to a stat gem; an effect gem carries actions' });
    if (!Array.isArray(raw.actions) || raw.actions.length === 0) {
      problems.push({ where, message: 'an effect gem needs a non-empty actions array' });
    } else {
      raw.actions.forEach((a, i) => validateAction(a, where + '.actions[' + String(i) + ']', problems));
    }
  } else if (raw.kind === 'stat') {
    if (raw.actions !== undefined) problems.push({ where, message: 'actions belongs to an effect gem; a stat gem carries mods' });
    if (raw.weightIncreasePct !== undefined) problems.push({ where, message: 'weightIncreasePct is an Echo dial; a stat gem cannot carry it' });
    req(raw, 'scope', (v) => SCOPES.includes(v as string), SCOPES.join('|'), where, problems);
    if (!isObj(raw.mods)) {
      problems.push({ where, message: 'a stat gem needs a mods object' });
    } else {
      // R7.2 EXACTLY ONE SCOPE BUNDLE. An off-scope key used to be silently inert
      // AND unpriced — a gem promising something it never delivered.
      const wanted = raw.scope === 'card' ? 'card' : 'hero';
      const other = wanted === 'card' ? 'hero' : 'card';
      if (raw.mods[other] !== undefined) {
        problems.push({ where, message: 'scope is ' + wanted + ' but mods carries a ' + other + ' bundle — an off-scope bundle is silently inert AND unpriced' });
      }
      const bundle = raw.mods[wanted];
      if (!isObj(bundle)) {
        problems.push({ where, message: 'mods.' + wanted + ' is required for a ' + wanted + '-scope gem' });
      } else {
        const allowed = wanted === 'card' ? CARD_MODS : HERO_MODS;
        const keys = Object.keys(bundle);
        if (keys.length === 0) problems.push({ where, message: 'mods.' + wanted + ' modifies nothing' });
        for (const k of keys) {
          if (!allowed.includes(k)) { problems.push({ where, message: 'unknown ' + wanted + ' mod ' + k + ' (known: ' + allowed.join(', ') + ')' }); continue; }
          if (!isInt(bundle[k])) problems.push({ where, message: 'mods.' + wanted + '.' + k + ' must be an integer' });
        }
        const wd = bundle.weightDelta;
        if (isInt(wd) && wd < -2) problems.push({ where, message: 'Core weightDelta must be >= -2 (WEIGHT_MIN is 5; deeper discounts belong in a combination, ruleset R4.3)' });
      }
      for (const k of Object.keys(raw.mods)) {
        if (k !== 'card' && k !== 'hero') problems.push({ where, message: 'mods may only contain a card or hero bundle, got ' + k });
      }
    }
  }

  // ---- unpriceable dials --------------------------------------------------
  if (raw.cooldownReduction !== undefined) {
    problems.push({ where, message: 'cooldownReduction costs 100 deci/turn — 1 turn = 100, past Legendary (80). No value lands on a band.' });
  }

  // ---- banned action kinds, with the band arithmetic in the message -------
  const actions = Array.isArray(raw.actions) ? raw.actions as Array<Record<string, unknown>> : [];
  for (const a of actions) {
    const why = typeof a.kind === 'string' ? UNPRICEABLE_KINDS[a.kind] : undefined;
    if (why) problems.push({ where, message: 'a gem cannot carry a ' + String(a.kind) + ' action: ' + why });
    if (a.kind === 'lifesteal' && isInt(a.pct) && a.pct > 60) {
      problems.push({ where, message: 'lifesteal is capped at 60% on a gem (ruleset R4.3); higher bands must combine payloads instead' });
    }
  }

  // ---- R6 the HIT rules: an appended hit is an Echo, or it is nothing -----
  const hits = actions.filter((a) => typeof a.kind === 'string' && HIT_KINDS.includes(a.kind));
  if (hits.length > 0) {
    if (rarity !== 'legendary') {
      problems.push({ where, message: 'only a Legendary gem may carry an appended hit: extraHitPremium alone is 30 deci, already past Common (20), and with the echo repeat the only band that lands is 80' });
    }
    if (hits.length > 1) problems.push({ where, message: 'a gem may carry at most ONE appended hit' });
    for (const h of hits) {
      if (h.kind !== 'statStrike' || h.echoHostPower !== true) {
        problems.push({ where, message: 'the ONLY legal gem hit is an Echo (statStrike with echoHostPower). A flat damage chip on a gem takes no stat, no aura and no combo, then eats full mitigation — it delivers ~1 damage at any real depth, which is why the 9 flat-damage gems were retired (R1.2 / R6.5)' });
      }
      if (h.cap !== undefined) {
        problems.push({ where, message: 'a capped statStrike is banned on a gem: a cap small enough to fit a band binds on almost every host, flattening the Echo back into the flat chip it replaced (R6.4)' });
      }
    }
    if (!name.trim().endsWith('Echo')) {
      problems.push({ where, message: 'a gem carrying a hit IS an Echo and its name must end "Echo" (R6.5 reclaimed the word: it names the repeat, not any chip)' });
    }
  }

  if (raw.weightIncreasePct !== undefined) {
    if (!isInt(raw.weightIncreasePct) || raw.weightIncreasePct <= 0) {
      problems.push({ where, message: 'weightIncreasePct must be a positive integer' });
    }
    if (categoryOfGem(raw) !== 'Echo') {
      problems.push({ where, message: 'weightIncreasePct is the Echo tempo cost and only an Echo may carry it (R6.2)' });
    }
  }

  // ---- R1.1 CATEGORY derived from PAYLOAD; name + opener must agree ------
  const category = categoryOfGem(raw);
  if (category === null) {
    problems.push({ where, message: 'gem payload does not classify into a category (Sliver / Echo / Core / Charm) — check kind, scope and actions' });
  } else {
    const suffix = name.trim().split(/\s+/).pop() ?? '';
    if (suffix !== category) {
      problems.push({ where, message: 'payload is a ' + category + ' but the name ends "' + suffix + '". Sliver = rider, Echo = repeats the host attack, Core = this card, Charm = hero — the name must say which (R1.1)' });
    }
    const opener = CATEGORY_OPENER[category];
    if (opener !== null && !text.startsWith(opener)) {
      problems.push({ where, message: 'a ' + category + ' must open its text with "' + opener + '", got "' + text.slice(0, 24) + '"' });
    }
    if (category === 'Sliver') {
      for (const [other, otherOpener] of Object.entries(CATEGORY_OPENER)) {
        if (otherOpener !== null && text.startsWith(otherOpener)) {
          problems.push({ where, message: 'this is a Sliver (a rider) but its text opens like a ' + other + ' ("' + otherOpener + '")' });
        }
      }
    }
  }

  for (const k of Object.keys(raw)) {
    if (!DEF_FIELDS.has(k)) problems.push({ where, message: 'unknown field ' + k + ' — the schema is a CONTRACT and rejects what it does not define' });
  }
}

/** Validates a whole gems document. Returns every problem found; never throws. */
export function validateGemDocument(doc: unknown): ContentProblem[] {
  const problems: ContentProblem[] = [];
  if (!isObj(doc)) return [{ where: 'document', message: 'document must be an object' }];
  if (doc.schemaVersion !== 1) {
    problems.push({ where: 'document', message: 'unsupported schemaVersion ' + JSON.stringify(doc.schemaVersion) + ' (this loader knows 1)' });
  }
  if (!Array.isArray(doc.gems)) {
    problems.push({ where: 'document', message: 'gems must be an array' });
    return problems;
  }

  const seen = new Set<string>();
  // R8.1 PAYLOAD UNIQUENESS across the whole file. Before the 2026-08-09 migration
  // 17 gems sat in 6 mechanical-twin groups (damage4 x5, damage8 x3, slow16 x3,
  // slow8 x2, poison2 x2, shield4 x2) — the same gem wearing different names. The
  // fingerprint includes rarity, so the same shape at a DIFFERENT band stays a
  // legal ladder rung (R8.3); only same-shape-same-band collides.
  const fingerprints = new Map<string, string>();

  doc.gems.forEach((gem, gi) => {
    const where0 = 'gems[' + String(gi) + ']';
    if (!isObj(gem)) { problems.push({ where: where0, message: 'gem must be an object' }); return; }
    if (typeof gem.id !== 'string') { problems.push({ where: where0, message: 'gem is missing a string id' }); return; }
    const id = gem.id;
    if (!/^[a-z][a-z0-9_]*$/.test(id)) {
      problems.push({ where: id, message: 'id must be lowercase snake_case starting with a letter (an all-numeric id would also break iteration order: JS enumerates integer-like object keys first)' });
    }
    if (seen.has(id)) problems.push({ where: id, message: 'duplicate document for id ' + id + ' — one document per gem, versions go inside it' });
    seen.add(id);

    if (!Array.isArray(gem.versions) || gem.versions.length === 0) {
      problems.push({ where: id, message: 'versions must be a non-empty array of { version, def }' });
      return;
    }
    const versionsSeen = new Set<number>();
    gem.versions.forEach((entry, vi) => {
      const at = id + '[' + String(vi) + ']';
      if (!isObj(entry)) { problems.push({ where: at, message: 'version entry must be an object' }); return; }
      req(entry, 'version', (v) => isInt(v) && (v as number) >= 1, 'an integer >= 1', at, problems);
      if (isInt(entry.version)) {
        if (versionsSeen.has(entry.version)) problems.push({ where: id, message: 'duplicate version ' + String(entry.version) });
        versionsSeen.add(entry.version);
      }
      if (!isObj(entry.def)) {
        problems.push({ where: id + '@v' + String(entry.version), message: 'def must be an object (the definition this version resolves to)' });
        return;
      }
      validateGemDef(entry.def, id + '@v' + String(entry.version), problems);
      for (const k of Object.keys(entry)) {
        if (k !== 'version' && k !== 'def') problems.push({ where: id + '@v' + String(entry.version), message: 'unknown field ' + k + ' — a version entry is exactly { version, def }' });
      }
    });

    // Fingerprint the CURRENT (highest) version only: superseded versions are
    // history and are expected to resemble their successors.
    let current: Record<string, unknown> | undefined;
    let best = -1;
    for (const entry of gem.versions as Array<Record<string, unknown>>) {
      if (isObj(entry) && isInt(entry.version) && entry.version > best && isObj(entry.def)) { best = entry.version; current = entry.def; }
    }
    if (current) {
      const print = payloadFingerprint(current);
      const twin = fingerprints.get(print);
      if (twin !== undefined) {
        problems.push({ where: id, message: 'mechanical twin of ' + twin + ' — identical payload at the same rarity. Two gems that do exactly the same thing are one gem with two names (R8.1); change the shape, the magnitude or the band' });
      } else {
        fingerprints.set(print, id);
      }
    }

    for (const k of Object.keys(gem)) {
      if (k !== 'id' && k !== 'versions') problems.push({ where: id, message: 'unknown envelope field ' + k + ' — the envelope is exactly { id, versions }' });
    }
  });
  return problems;
}

/** The GemDef a document resolves to: its `def` payload, with `id` put back and authoring-only `notes` dropped. */
export function gemDefOfDocument(id: string, def: Record<string, unknown>): Gem & { name: string; text: string } {
  const { notes: _n, ...rest } = def;
  return { id, ...rest } as unknown as Gem & { name: string; text: string };
}
