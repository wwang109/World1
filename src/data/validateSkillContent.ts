import { MAX_WARD_CHARGES, type Action, type SkillDef } from '../engine/types';

/**
 * RUNTIME SCHEMA VALIDATION for the JSON content documents.
 *
 * WHY THIS EXISTS: moving content from TypeScript literals to JSON gives up the
 * compile-time checking that used to catch a bad `rarity` or a malformed action.
 * TypeScript widens every string in an imported JSON literal to `string`, so the
 * string-literal unions (Rarity, Element, Action kinds) stop being enforced at the
 * authoring surface — for a VALID value as much as an invalid one. This module is
 * what buys that back, and it matters more than usual because the intended author
 * is an AGENT, which needs a schema that fails LOUDLY rather than a human who can
 * infer intent from the surrounding code.
 *
 * THE KEY TRICK is assertNever at the end of validateAction's switch: tsc FAILS
 * TO COMPILE if src/engine/types.ts gains an Action kind this validator does not
 * handle. So the SCHEMA stays compile-time-guaranteed even though the DATA is
 * checked at runtime. (statStrike was added days ago and the echo-gem work is
 * extending it right now — this is the mechanism that keeps that safe.)
 *
 * NO ajv, NO zod: ~20 enums and ~20 action kinds is a few hundred dependency-free
 * lines, and it keeps the client bundle clean.
 *
 * ONE OUTCOME: a problem is a FAILURE. There is no warning tier.
 *
 * This is a CONTRACT, so it rejects everything it does not define — including an
 * unknown field. A soft warning is worthless to the intended author: an agent
 * typing `capp` for `cap`, or `weappon` for `weapon`, would otherwise ship a card
 * that validates clean and silently plays wrong, which is the worst failure mode
 * available (no error, no crash, just different numbers).
 *
 * Schema evolution is NOT lost by this — it becomes DELIBERATE. A new field lands
 * by extending this validator (and `schemaVersion` when the shape genuinely
 * changes) in the SAME change that first authors it. That is what makes the
 * document a contract rather than a suggestion.
 *
 * COMPLETENESS, not just shape. The document is the single source that must carry
 * everything needed to SHOW what a card does, so anything that would leave a card
 * unrenderable or mechanically ambiguous is rejected: missing text, a magical card
 * with no element, an aura with no mods. Deeper card-text drift (magnitudes and
 * stat tokens agreeing with the effects) is a SECOND gate — tests/engine/cardText.test.ts
 * — which runs against the loaded book and is deliberately not duplicated here.
 */
export interface ContentProblem {
  where: string;
  message: string;
}

function assertNever(value: never, problems: ContentProblem[], where: string): void {
  problems.push({ where, message: 'unhandled action kind ' + JSON.stringify(value) });
}

const ARCHETYPES = ['offense', 'defensive', 'healing', 'support', 'debuff'] as readonly string[];
const PROPERTIES = ['physical', 'magical', 'true'] as readonly string[];
const RARITIES = ['common', 'rare', 'epic', 'legendary'] as readonly string[];
const TIERS = ['bronze', 'silver', 'gold', 'diamond'] as readonly string[];
const ELEMENTS = ['fire', 'frost', 'lightning', 'nature', 'holy', 'dark'] as readonly string[];
const WEAPONS = ['sword', 'axe', 'lance', 'bow', 'beast'] as readonly string[];
const BUFFABLE = ['attack', 'magicPower', 'armor', 'magicResist', 'speed'] as readonly string[];

/**
 * `negate`'s apply-time per-property charge clamp, mirrored from the engine
 * (`applyAction`'s negate arm in src/engine/combat/interpreter.ts). Unlike ward
 * — whose clamp is the exported `MAX_WARD_CHARGES` and is imported above — the
 * negate clamp is still a bare literal at its call site, so this is a MIRROR and
 * has to move if that literal does. Promoting it to an exported constant in
 * engine/types.ts alongside MAX_WARD_CHARGES would remove the duplication.
 */
const NEGATE_CHARGE_CLAMP = 3;

/** Fields allowed inside a document's `def` payload. `id`/`version` are the KEY
 * and live on the envelope, so finding either in here is a mistake worth naming. */
const DEF_FIELDS = new Set([
  'notes',
  'name', 'archetypes', 'property', 'size', 'speedWeight', 'cooldownTurns',
  'rarity', 'tier', 'element', 'weapon', 'effects', 'scope', 'aura', 'special',
  'tierUpgrades', 'text',
]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/**
 * Integer check, hardened. `Number.isSafeInteger` rejects values past 2^53 where
 * arithmetic silently stops being exact — a power of 1e300 would otherwise
 * validate and then poison the sim's integer-only state. `-0` is rejected
 * because it round-trips through JSON as `0` but compares unequal under
 * `Object.is`, which is the kind of difference that shows up as an unexplained
 * hash/parity mismatch rather than an error.
 */
export const isInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0);

/** An integer inside sane authoring bounds — catches a stray extra digit. */
export const inRange = (lo: number, hi: number) => (v: unknown): boolean => isInt(v) && (v as number) >= lo && (v as number) <= hi;

export function req(o: Record<string, unknown>, key: string, ok: (v: unknown) => boolean, what: string, where: string, problems: ContentProblem[]): void {
  if (!(key in o)) { problems.push({ where, message: 'missing required field ' + key }); return; }
  if (!ok(o[key])) problems.push({ where, message: key + ' must be ' + what + ', got ' + JSON.stringify(o[key]) });
}

export function opt(o: Record<string, unknown>, key: string, ok: (v: unknown) => boolean, what: string, where: string, problems: ContentProblem[]): void {
  if (o[key] === undefined) return;
  if (!ok(o[key])) problems.push({ where, message: key + ' must be ' + what + ', got ' + JSON.stringify(o[key]) });
}

/**
 * Validates ONE action. The default arm is assertNever, so this switch is
 * compile-time exhaustive over Action kinds — see the module docs.
 */
/**
 * Fields each action kind is allowed to carry, beyond `kind`. Used for the
 * UNKNOWN-KEY warning: without it a typo like `capp` for `cap` validates clean
 * and the card silently plays wrong, which is the worst failure mode there is —
 * no error, no crash, just different numbers. Mirrors what validateDef does.
 */
const ACTION_FIELDS: Record<string, readonly string[]> = {
  damage: ['power'],
  statStrike: ['shareOf', 'cap', 'echoHostPower'],
  heal: ['power'],
  shield: ['power'],
  poison: ['stacks'],
  thorns: ['stacks'],
  burn: ['stacks'],
  bleed: ['stacks'],
  stun: ['turns'],
  slow: ['weight'],
  disrupt: ['amount'],
  expose: ['pct', 'turns'],
  guard: ['property', 'pct', 'turns'],
  negate: ['property', 'charges'],
  // NO 'property' on ward, on purpose (see the `ward` docs in engine/types.ts):
  // afflictions carry no attacker property to match, so listing one here would
  // let content author a field the engine silently ignores.
  ward: ['charges'],
  cleanse: ['charges'],
  lifesteal: ['pct'],
  shieldBreak: ['amount'],
  comboBonus: ['amount'],
  taunt: ['amount'],
  buffStat: ['stat', 'pct', 'turns'],
  debuffStat: ['stat', 'pct', 'turns'],
};

export function validateAction(raw: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(raw)) { problems.push({ where, message: 'action must be an object' }); return; }
  if (typeof raw.kind !== 'string') { problems.push({ where, message: 'action is missing a string kind' }); return; }
  const kind = raw.kind as Action['kind'];
  const at = where + '/' + kind;
  const num = (k: string) => req(raw, k, isInt, 'an integer', at, problems);
  const optNum = (k: string) => opt(raw, k, isInt, 'an integer', at, problems);
  const pct = (k: string) => req(raw, k, inRange(-1000, 1000), 'an integer percentage between -1000 and 1000', at, problems);
  const turns = (k: string) => req(raw, k, inRange(0, 99), 'an integer 0..99 turns', at, problems);
  const stacks = (k: string) => req(raw, k, inRange(0, 999), 'an integer 0..999', at, problems);
  /**
   * CHARGES ARE RANGE-CHECKED AGAINST THE ENGINE'S APPLY-TIME CLAMP, for two
   * separate silent-failure reasons:
   *
   * OVER the clamp = PAYING PL FOR NOTHING. `applyAction` grants at most the
   * clamp, but `powerLevelDeci` charges the authored number, so a size-3 bronze
   * `ward charges: 4` priced clean on budget (480 deci of actions, empower cap
   * 200) while the engine could only ever grant 3 — 50 deci bought a charge that
   * can never exist. (`negate` never had this hole by luck: at 100 deci/charge,
   * 3 charges already blow the size-3 empower cap, so the cap enforced the clamp
   * for free. Ward's 50 deci/charge rate is what opened it.)
   *
   * UNDER zero = BUYING BUDGET. A negative count prices NEGATIVELY —
   * `ward charges: -3` refunds 150 deci, i.e. 15 PL of headroom for real damage
   * — and the apply-time `Math.max(0, ...)` then makes it a harmless no-op. So
   * the floor is 0 for every charge keyword, clamp or no clamp.
   */
  const charges = (hi: number) => req(raw, 'charges', inRange(0, hi), 'an integer 0..' + String(hi) + ' (the engine clamps charges at apply time; authoring past the clamp pays PL for a charge that can never be granted, and a negative count would REFUND budget)', at, problems);

  // UNKNOWN KEYS on the action itself (fix: `capp` typo used to pass clean).
  const known = ACTION_FIELDS[kind];
  if (known) {
    for (const k of Object.keys(raw)) {
      if (k !== 'kind' && !known.includes(k)) {
        problems.push({ where: at, message: 'unknown field ' + k + ' on a ' + kind + ' action (known: ' + known.join(', ') + ')' });
      }
    }
  }

  const stat = () => req(raw, 'stat', (v) => BUFFABLE.includes(v as string), BUFFABLE.join('|'), at, problems);
  const property = () => req(raw, 'property', (v) => PROPERTIES.includes(v as string), PROPERTIES.join('|'), at, problems);

  switch (kind) {
    case 'damage': num('power'); break;
    case 'statStrike': num('shareOf'); optNum('cap'); opt(raw, 'echoHostPower', (v) => v === true, 'literally true (the flag is present-or-absent, never false)', at, problems); break;
    case 'heal': num('power'); break;
    case 'shield': num('power'); break;
    case 'poison': stacks('stacks'); break;
    case 'thorns': stacks('stacks'); break;
    case 'burn': stacks('stacks'); break;
    case 'bleed': stacks('stacks'); break;
    case 'stun': turns('turns'); break;
    case 'slow': num('weight'); break;
    case 'disrupt': num('amount'); break;
    case 'expose': pct('pct'); turns('turns'); break;
    case 'guard': property(); pct('pct'); turns('turns'); break;
    case 'negate': property(); charges(NEGATE_CHARGE_CLAMP); break;
    case 'ward': charges(MAX_WARD_CHARGES); break;
    // cleanse has NO upper clamp in the engine — every charge is spent against
    // whatever afflictions are actually present, so a high count is merely
    // wasteful rather than unbuyable. It gets the same sane authoring ceiling as
    // `stacks` (catching a stray extra digit) and the same 0 floor as the rest.
    case 'cleanse': charges(999); break;
    case 'lifesteal': pct('pct'); break;
    case 'shieldBreak': num('amount'); break;
    case 'comboBonus': num('amount'); break;
    case 'taunt': num('amount'); break;
    case 'buffStat': stat(); pct('pct'); turns('turns'); break;
    case 'debuffStat': stat(); pct('pct'); turns('turns'); break;
    default: assertNever(kind, problems, where);
  }
}


const AURA_FIELDS = new Set(['affects', 'reach', 'archetypeFilter', 'propertyFilter', 'mods']);
const AURA_AFFECTS = ['adjacent', 'left', 'right', 'allBoard'] as readonly string[];
const AURA_MODS = ['damageFlat', 'healFlat', 'weightDelta'] as readonly string[];

/**
 * An aura is projected onto neighbouring board cards, and the engine reads
 * `aura.mods.*` and switches on `aura.affects` UNCONDITIONALLY. So a document
 * carrying `aura: { affects: 'diagonal' }` — no mods, unknown direction — used to
 * validate clean and then blow up inside simulate() the first time the card was
 * placed. Everything the engine dereferences is required here.
 */
function validateAura(raw: unknown, where: string, problems: ContentProblem[]): void {
  const at = where + '.aura';
  if (!isObj(raw)) { problems.push({ where: at, message: 'aura must be an object' }); return; }
  req(raw, 'affects', (v) => AURA_AFFECTS.includes(v as string), AURA_AFFECTS.join('|'), at, problems);
  // `reach` is edge-to-edge gap; 0 reaches nothing, which is legal but pointless.
  opt(raw, 'reach', inRange(0, 20), 'an integer 0..20', at, problems);
  opt(raw, 'archetypeFilter', (v) => ARCHETYPES.includes(v as string), ARCHETYPES.join('|'), at, problems);
  opt(raw, 'propertyFilter', (v) => PROPERTIES.includes(v as string), PROPERTIES.join('|'), at, problems);

  if (!isObj(raw.mods)) {
    problems.push({ where: at, message: 'mods is required and must be an object (the engine reads aura.mods.* unconditionally)' });
  } else {
    const present = Object.keys(raw.mods).filter((k) => AURA_MODS.includes(k));
    if (present.length === 0) {
      problems.push({ where: at + '.mods', message: 'an aura must carry at least one of ' + AURA_MODS.join(', ') + ' — an aura that modifies nothing cannot be shown or felt' });
    }
    for (const [k, v] of Object.entries(raw.mods)) {
      if (!AURA_MODS.includes(k)) { problems.push({ where: at + '.mods', message: 'unknown aura mod ' + k + ' (known: ' + AURA_MODS.join(', ') + ')' }); continue; }
      if (!isInt(v)) problems.push({ where: at + '.mods', message: k + ' must be an integer, got ' + JSON.stringify(v) });
    }
  }
  for (const k of Object.keys(raw)) {
    if (!AURA_FIELDS.has(k)) problems.push({ where: at, message: 'unknown aura field ' + k });
  }
}

const TIER_UPGRADE_FIELDS = new Set(['effects', 'aura', 'speedWeight', 'cooldownTurns', 'text']);

function validateTierUpgrade(raw: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(raw)) { problems.push({ where, message: 'tier upgrade must be an object' }); return; }
  const changesEffects = Array.isArray(raw.effects);
  if (changesEffects) (raw.effects as unknown[]).forEach((a, i) => validateAction(a, where + '.effects[' + String(i) + ']', problems));
  if (raw.aura !== undefined) validateAura(raw.aura, where, problems);
  opt(raw, 'speedWeight', inRange(0, 200), 'an integer 0..200', where, problems);
  opt(raw, 'cooldownTurns', inRange(0, 99), 'an integer 0..99', where, problems);
  // A tier that changes what the card DOES must say so, or the card face lies at
  // that tier. (Magnitude/stat-token drift is a separate, deeper gate — see
  // tests/engine/cardText.test.ts.)
  if (changesEffects && (typeof raw.text !== 'string' || raw.text.trim() === '')) {
    problems.push({ where, message: 'a tier upgrade that changes effects must carry non-empty text — otherwise the card face shows the wrong numbers at that tier' });
  }
  if (Object.keys(raw).length === 0) {
    problems.push({ where, message: 'empty tier upgrade — remove it or give it something to override' });
  }
  for (const k of Object.keys(raw)) {
    if (!TIER_UPGRADE_FIELDS.has(k)) problems.push({ where, message: 'unknown tier-upgrade field ' + k });
  }
}

function validateDef(raw: Record<string, unknown>, where: string, problems: ContentProblem[]): void {
  // RENDER-REQUIRED. A card with no name or no text cannot be shown by the card
  // face, the wiki detail pane or the shop shelf — that is an incompleteness, not
  // a style nit, so it is rejected rather than tolerated.
  req(raw, 'name', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string', where, problems);
  req(raw, 'text', (v) => typeof v === 'string' && v.trim() !== '', 'a non-empty string (the card must be able to SHOW what it does)', where, problems);
  req(raw, 'property', (v) => PROPERTIES.includes(v as string), PROPERTIES.join('|'), where, problems);
  req(raw, 'rarity', (v) => RARITIES.includes(v as string), RARITIES.join('|'), where, problems);
  req(raw, 'tier', (v) => TIERS.includes(v as string), TIERS.join('|'), where, problems);
  req(raw, 'size', (v) => v === 1 || v === 2 || v === 3, '1, 2 or 3', where, problems);
  req(raw, 'archetypes', (v) => Array.isArray(v) && v.length > 0 && v.every((a) => ARCHETYPES.includes(a as string)), 'a NON-EMPTY array of ' + ARCHETYPES.join('|'), where, problems);
  req(raw, 'effects', (v) => Array.isArray(v), 'an array', where, problems);
  opt(raw, 'element', (v) => ELEMENTS.includes(v as string), ELEMENTS.join('|'), where, problems);
  opt(raw, 'weapon', (v) => WEAPONS.includes(v as string), WEAPONS.join('|'), where, problems);
  opt(raw, 'speedWeight', inRange(0, 200), 'an integer 0..200', where, problems);
  opt(raw, 'cooldownTurns', inRange(0, 99), 'an integer 0..99', where, problems);
  opt(raw, 'scope', (v) => v === 'one' || v === 'all', 'one or all', where, problems);
  opt(raw, 'special', (v) => typeof v === 'string', 'a string', where, problems);
  opt(raw, 'notes', (v) => Array.isArray(v) && v.every((n) => typeof n === 'string'), 'an array of strings', where, problems);

  // ---- COMPLETENESS: the card must be able to SHOW its identity ----------
  // EVERY card is typed by exactly ONE weapon or element — the card face draws a
  // single type badge from it (docs/card-template-spec.md), and the matchup
  // teaching surfaces (element wheel / weapon triangle) read it. Neither = an
  // untyped card the face cannot render; both = an ambiguous badge.
  const hasElement = raw.element !== undefined;
  const hasWeapon = raw.weapon !== undefined;
  if (hasElement && hasWeapon) {
    problems.push({ where, message: 'a card is typed by exactly ONE of element or weapon, not both (the card face draws one type badge)' });
  } else if (!hasElement && !hasWeapon) {
    problems.push({ where, message: 'a card must carry an element OR a weapon — the type badge and the matchup tooltip have nothing to show otherwise' });
  }
  // PROPERTY-CONDITIONAL: magical resolves on the element wheel, physical on the
  // weapon triangle. TRUE bypasses both, so its type is cosmetic and either is
  // fine (7 TRUE cards carry an element, 1 carries a weapon).
  if (raw.property === 'magical' && !hasElement) {
    problems.push({ where, message: 'a MAGICAL card requires an element (it resolves on the element advantage wheel)' });
  }
  if (raw.property === 'physical' && !hasWeapon) {
    problems.push({ where, message: 'a PHYSICAL card requires a weapon (it resolves on the weapon triangle)' });
  }
  // A card must DO something: cast effects, or project an aura.
  if (Array.isArray(raw.effects) && raw.effects.length === 0 && raw.aura === undefined) {
    problems.push({ where, message: 'a card with no effects must carry an aura — otherwise it does nothing and there is nothing to show' });
  }
  if (raw.aura !== undefined) validateAura(raw.aura, where, problems);

  if (Array.isArray(raw.effects)) raw.effects.forEach((a, i) => validateAction(a, where + '.effects[' + String(i) + ']', problems));
  if (raw.tierUpgrades !== undefined) {
    if (!isObj(raw.tierUpgrades)) {
      problems.push({ where, message: 'tierUpgrades must be an object keyed by tier' });
    } else {
      for (const [tier, up] of Object.entries(raw.tierUpgrades)) {
        if (tier === 'bronze') { problems.push({ where, message: 'tierUpgrades cannot override bronze — bronze IS the authored base' }); continue; }
        if (!TIERS.includes(tier)) { problems.push({ where, message: 'tierUpgrades key ' + tier + ' is not a tier' }); continue; }
        validateTierUpgrade(up, where + '.tierUpgrades.' + tier, problems);
      }
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

/** Validates a whole skills document. Returns every problem found; never throws. */
export function validateSkillDocument(doc: unknown): ContentProblem[] {
  const problems: ContentProblem[] = [];
  if (!isObj(doc)) return [{ where: 'document', message: 'document must be an object' }];
  if (doc.schemaVersion !== 1) {
    problems.push({ where: 'document', message: 'unsupported schemaVersion ' + JSON.stringify(doc.schemaVersion) + ' (this loader knows 1)' });
  }
  if (!Array.isArray(doc.cards)) {
    problems.push({ where: 'document', message: 'cards must be an array' });
    return problems;
  }
  const seen = new Set<string>();
  doc.cards.forEach((card, ci) => {
    const where0 = 'cards[' + String(ci) + ']';
    if (!isObj(card)) { problems.push({ where: where0, message: 'card must be an object' }); return; }
    if (typeof card.id !== 'string') { problems.push({ where: where0, message: 'card is missing a string id' }); return; }
    const id = card.id;
    // ALL-NUMERIC IDS ARE REJECTED. `skillBook` is a plain object keyed by id, and
    // JS enumerates integer-like keys FIRST, in ascending numeric order, before
    // any string key. An id like "42" would jump to the front of Object.keys /
    // Object.values regardless of the id sort the loader applies — silently
    // changing what every seeded run is offered (src/run pools draw by index).
    if (/^[0-9]+$/.test(id)) {
      problems.push({ where: id, message: 'an all-numeric id is not allowed: JS enumerates integer-like object keys first, which would break the id-sorted pool order the run layer depends on' });
    }
    if (id.trim() === '') problems.push({ where: where0, message: 'id must be a non-empty string' });
    // ONE DOCUMENT PER CARD. `cards` is an ARRAY (so it exports cleanly as one
    // row per card), which means a second document for the same id is still
    // EXPRESSIBLE and must be caught here — it is not structurally impossible.
    if (seen.has(id)) problems.push({ where: id, message: 'duplicate document for id ' + id + ' — one document per card, versions go inside it' });
    seen.add(id);

    if (!Array.isArray(card.versions) || card.versions.length === 0) {
      problems.push({ where: id, message: 'versions must be a non-empty array of { version, def }' });
      return;
    }
    const versionsSeen = new Set<number>();
    card.versions.forEach((entry, vi) => {
      const at = id + '[' + String(vi) + ']';
      if (!isObj(entry)) { problems.push({ where: at, message: 'version entry must be an object' }); return; }
      req(entry, 'version', (v) => isInt(v) && (v as number) >= 1, 'an integer >= 1', at, problems);
      if (isInt(entry.version)) {
        const v = entry.version;
        // Duplicates are VISIBLE here precisely because versions is an array. In
        // a map keyed by version number a repeated key would be silently
        // last-wins at JSON.parse time, hiding the mistake instead of naming it.
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

    for (const k of Object.keys(card)) {
      if (k !== 'id' && k !== 'versions') {
        problems.push({ where: id, message: 'unknown envelope field ' + k + ' — the envelope is exactly { id, versions }' });
      }
    }
  });
  return problems;
}

/**
 * The SkillDef a document resolves to: its `def` payload, with `id` put back and
 * the authoring-only `notes` dropped.
 *
 * `id` lives on the ENVELOPE (it is half the key) and is deliberately absent from
 * the payload, so re-attaching it here is what keeps the in-memory SkillDef
 * byte-identical to the hand-written literals — which is what lets ~60 consumers
 * stay untouched and keeps the parity test meaningful.
 */
export function skillDefOfDocument(id: string, def: Record<string, unknown>): SkillDef {
  const { notes: _n, ...rest } = def;
  return { id, ...rest } as unknown as SkillDef;
}
