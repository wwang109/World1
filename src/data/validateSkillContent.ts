import { CARD_TARGETING_KINDS, MAX_EXPOSE_PCT, MAX_GUARD_PCT, resourceSuppliedBy, riderFeedsKind, riderReadsResource } from '../engine/balance';
import { MAX_NEGATE_CHARGES, MAX_WARD_CHARGES, type Action, type SkillDef } from '../engine/types';

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
 * Runtime twins of `ExploitableStatus` / `StackedStatus` (engine/types.ts) — the
 * status a conditional rider may key off. Kept as literal lists for the same
 * reason every other enum here is: TypeScript widens JSON strings to `string`,
 * so the compile-time union enforces nothing at the authoring surface. Pinned
 * against the engine unions by `tests/engine/conditionalRiders.test.ts`.
 */
const EXPLOITABLE = ['poison', 'burn', 'bleed', 'stun', 'debuff', 'expose'] as readonly string[];
const STACKED = ['poison', 'burn', 'bleed', 'thorns'] as readonly string[];

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
  burden: ['weight'],
  curse: ['amount', 'turns'],
  // THE SPREADER CARRIES NOTHING (see the `splash` docs in engine/types.ts): an
  // EMPTY field list, so `{ kind: 'splash', weight: 6 }` — the pre-2026-08-21
  // shape — is now a loud "unknown field weight on a splash action" rather than
  // a silently ignored payload.
  splash: [],
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
  // CHAIN BONUS — the type-axis sibling of comboBonus. `after` names ONE card
  // type (a weapon OR an element: `cardType` reads `element ?? weapon`), so one
  // keyword covers both the sword->axe and the fire->frost pairing.
  chainBonus: ['after', 'amount'],
  exploit: ['status', 'amount'],
  // `cap` is REQUIRED on stackBonus (engine/types.ts) — the payload is
  // `min(per × stacks, cap)` and only the ceiling is priceable. Same for the
  // other two capped riders below.
  stackBonus: ['status', 'of', 'per', 'cap'],
  taxBonus: ['per', 'cap'],
  shieldBurst: ['cap'],
  wardRelease: ['per', 'cap'],
  // `desperation` is `exploit`'s shape without a status: the gate is the caster's
  // own HP bar, so there is nothing to name and a flat `amount` is the whole thing.
  desperation: ['amount'],
  // The two HEAL-SIDE riders, same required-`cap` rule: the payload is
  // `min(this cast's heal overflow, cap)` / `min(per × stacks cleansed, cap)`.
  overhealShield: ['cap'],
  cleanseConvert: ['per', 'cap'],
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

  /**
   * `pct` FOR `expose`/`guard`, RANGE-CHECKED AGAINST THE ENGINE'S OWN
   * APPLY-TIME CLAMP — the exact same two silent-failure shapes `charges`
   * closes above, applied to a `product` (pct*turns) rider instead of a
   * `perUnit` charge count:
   *
   * OVER the clamp = PAYING PL FOR AMPLIFICATION THAT NEVER LANDS.
   * `interpreter.ts`'s `expose`/`guard` arms clamp the authored `pct` to
   * `MAX_EXPOSE_PCT`/`MAX_GUARD_PCT` before applying it, but `powerLevelDeci`
   * charges the authored number — so `expose pct: 100` prices for 100% while
   * the engine only ever delivers 50%.
   *
   * UNDER zero = BUYING BUDGET. `pct * turns` prices negatively with no
   * floor, and the engine reads the clamped `pct` straight into `addStatus` —
   * nothing floors a negative pile at apply time the way `charges`'
   * `Math.max(0, ...)` does, so a negative `pct` is a REAL (inverted) effect
   * on the two riders that have no clamp of their own (see `lifestealPct`/
   * `slowWeight` below for the two shapes that ARE genuine apply-time
   * no-ops) — but `expose`/`guard` are still floored at 0 here because
   * neither keyword has any documented use for an authored negative
   * amplification, and leaving it open only adds a second way to buy budget
   * for the same rider this helper already bounds on the high side.
   */
  const clampedPct = (hi: number) => req(raw, 'pct', inRange(0, hi), 'an integer 0..' + String(hi) + ' (the engine clamps pct at apply time; authoring past ' + String(hi) + ' pays PL for amplification it will never deliver, and a negative pct would REFUND budget)', at, problems);

  /**
   * `expose`'s `pct` AND `turns` MUST BE POSITIVE — a stricter floor than
   * `clampedPct`'s shared 0, mirroring the engine's own drop rule (2026-08-18).
   * `interpreter.ts`'s `expose` arm now refuses to apply an application that
   * can amplify nothing (`pct <= 0 || turns <= 0` breaks before any status
   * exists), because such an application used to be a FREE affliction: priced
   * at 0 deci, it still armed anti-heal, baited a cleanse charge, drained a
   * ward and — under the old refresh rule — held someone else's 50% pile open
   * forever. Authoring one is now dead content rather than an exploit, and the
   * same silent-no-op shape `slowWeight`/`lifestealPct` below close.
   * `guard` keeps the shared `clampedPct` floor: its arm has no such drop.
   */
  const exposePct = () => req(raw, 'pct', inRange(1, MAX_EXPOSE_PCT), 'an integer 1..' + String(MAX_EXPOSE_PCT) + ' (a 0 or negative pct is dropped outright by the engine — it applies no status at all)', at, problems);
  const exposeTurns = () => req(raw, 'turns', inRange(1, 99), 'an integer 1..99 turns (a 0-turn expose is dropped outright by the engine — it applies no status at all)', at, problems);

  /**
   * `lifesteal`'s `pct` FLOORED AT 0. No engine ceiling to mirror here (unlike
   * `clampedPct`'s pair) — lifesteal scales off whatever damage THIS cast
   * actually deals (`PRICE.lifestealPerPctNum/Den`), so there is no fixed
   * apply-time cap to bound against. The floor closes the same silent-zero
   * shape as `charges`: `interpreter.ts`'s `lifesteal` arm computes
   * `stolen = floor(damageDealt * pct / 100)` and then `if (stolen <= 0)
   * break` — a negative `pct` prices as a refund for a rider the engine turns
   * into a no-op before any heal is even attempted.
   */
  const lifestealPct = () => req(raw, 'pct', inRange(0, 1000), 'an integer 0..1000 (a negative pct prices as a refund for a rider the engine turns into a no-op — stolen <= 0 breaks before any heal is applied)', at, problems);

  /**
   * `slow`'s `weight` FLOORED AT 0. `interpreter.ts`'s `slow` arm applies
   * `enemy.nextWeightPenalty = Math.max(enemy.nextWeightPenalty, action.weight)`
   * — a MAX, never a sum — so a negative `weight` can only ever match or lose
   * to whatever penalty is already pending; it can never lower it. The same
   * silent-zero shape as `charges`' under-zero case, on a `perUnit` rider
   * instead of a charge count.
   */
  const slowWeight = () => req(raw, 'weight', inRange(0, 999), 'an integer 0..999 (a negative weight prices as a refund for a rider the engine turns into a no-op — Math.max(pending, weight) never lowers the pending penalty)', at, problems);

  /**
   * `burden`'s `weight` FLOORED AT 0 — the identical shape to `slowWeight`
   * above, because burden applies the identical rule one scope down:
   * `piece.nextWeightPenalty = Math.max(piece.nextWeightPenalty ?? 0, weight)`
   * on each targeted piece (`interpreter.ts`'s `burden` arm). A negative weight
   * can only ever lose that `Math.max`, so it prices as a refund for a rider
   * the engine turns into a no-op.
   */
  const burdenWeight = () => req(raw, 'weight', inRange(0, 999), 'an integer 0..999 (a negative weight prices as a refund for a rider the engine turns into a no-op — Math.max(pending, weight) never lowers a piece\'s pending penalty)', at, problems);

  /**
   * `curse`'s `amount` AND `turns` MUST BOTH BE POSITIVE — the `expose` floors,
   * mirroring the engine's own drop rule: `interpreter.ts`'s `curse` arm refuses
   * an application that can never reduce a hit (`amount <= 0 || turns <= 0`
   * breaks before anything is written). Authoring one would buy a priced,
   * event-emitting no-op that also occupied the anchor's non-stacking slot; a
   * NEGATIVE amount would additionally refund budget for an effect the engine
   * drops and, were it ever applied, would BUFF the victim's card through
   * `mods.damageFlat`.
   */
  const curseAmount = () => req(raw, 'amount', inRange(1, 999), 'an integer 1..999 (a 0 or negative amount is dropped outright by the engine — it curses nothing at all, and a negative one would REFUND budget)', at, problems);
  const curseTurns = () => req(raw, 'turns', inRange(1, 99), 'an integer 1..99 turns (a 0-turn curse is dropped outright by the engine — it applies nothing at all)', at, problems);

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
    case 'slow': slowWeight(); break;
    case 'burden': burdenWeight(); break;
    case 'curse': curseAmount(); curseTurns(); break;
    // THE SPREADER HAS NO FIELDS TO CHECK. Its one authoring rule is a
    // whole-card one (it needs something to spread), enforced by
    // `rejectSpreaderWithNothingToSpread` in `validateDef` rather than here,
    // where a single action cannot see its siblings.
    case 'splash': break;
    case 'disrupt': num('amount'); break;
    case 'expose': exposePct(); exposeTurns(); break;
    case 'guard': property(); clampedPct(MAX_GUARD_PCT); turns('turns'); break;
    case 'negate': property(); charges(MAX_NEGATE_CHARGES); break;
    case 'ward': charges(MAX_WARD_CHARGES); break;
    // cleanse has NO upper clamp in the engine — every charge is spent against
    // whatever afflictions are actually present, so a high count is merely
    // wasteful rather than unbuyable. It gets the same sane authoring ceiling as
    // `stacks` (catching a stray extra digit) and the same 0 floor as the rest.
    case 'cleanse': charges(999); break;
    case 'lifesteal': lifestealPct(); break;
    case 'shieldBreak': num('amount'); break;
    case 'comboBonus': num('amount'); break;
    case 'chainBonus':
      // ONE NAME, EITHER NAMESPACE: the weapon and element vocabularies are
      // disjoint, so a bare name is unambiguous — but it must be a REAL type, or
      // the gate could never open and the card would be a priced no-op.
      req(raw, 'after', (v) => WEAPONS.includes(v as string) || ELEMENTS.includes(v as string),
        'one card type — a weapon (' + WEAPONS.join('|') + ') or an element (' + ELEMENTS.join('|') + ')', at, problems);
      num('amount');
      break;
    /**
     * EXPLOIT / STACK BONUS — the two conditional bonus-damage riders.
     *
     * Magnitudes are floored at 0 for the reason `charges`/`slowWeight` state at
     * length: a negative one REFUNDS budget (both price per point) while the
     * engine's `armTargetBonus` drops any non-positive bonus outright, i.e. it
     * would buy PL headroom for a rider that does nothing. `per` is floored at 1
     * — a `per: 0` rider is priced for its `cap` and can never deliver a point.
     */
    case 'exploit':
      req(raw, 'status', (v) => EXPLOITABLE.includes(v as string), EXPLOITABLE.join('|'), at, problems);
      req(raw, 'amount', inRange(0, 999), 'an integer 0..999 (a negative bonus REFUNDS budget for a rider the engine drops outright)', at, problems);
      break;
    case 'stackBonus':
      req(raw, 'status', (v) => STACKED.includes(v as string), STACKED.join('|'), at, problems);
      req(raw, 'of', (v) => v === 'caster' || v === 'target', 'caster or target', at, problems);
      req(raw, 'per', inRange(1, 999), 'an integer 1..999 (a per of 0 is priced for its cap and can never deliver a point)', at, problems);
      req(raw, 'cap', inRange(0, 999), 'an integer 0..999 — REQUIRED: the cap is what is priced, because per x stacks is unbounded', at, problems);
      break;
    /**
     * TAX BONUS / SHIELD BURST — the other two conditional riders, same floors and
     * the same REQUIRED cap for the same reason: the payload is
     * `min(per x taxed cards, cap)` / `min(your shield, cap)`, unbounded in a
     * resource the card does not own, so only the ceiling is priceable.
     */
    case 'taxBonus':
      req(raw, 'per', inRange(1, 999), 'an integer 1..999 (a per of 0 is priced for its cap and can never deliver a point)', at, problems);
      req(raw, 'cap', inRange(0, 999), 'an integer 0..999 — REQUIRED: the cap is what is priced, because per x taxed cards is unbounded', at, problems);
      break;
    case 'shieldBurst':
      req(raw, 'cap', inRange(0, 999), 'an integer 0..999 — REQUIRED: the cap is what is priced, and it is also how much of your own shield is spent', at, problems);
      break;
    /**
     * THE THIRD RIDER PASS (2026-08-21) — same floors, same required cap, one line
     * of reason each:
     *  • `wardRelease`: `min(per x charges released, cap)`, and the cap also decides
     *    HOW MANY charges are spent (`ceil(cap / per)`), so `per >= 1` is what keeps
     *    that division safe as well as meaningful;
     *  • `desperation`: a flat `amount`, `exploit`'s field verbatim — no cap,
     *    because there is no count to multiply and nothing to bound;
     *  • `overhealShield`: `min(this cast's heal overflow, cap)`, unbounded in how
     *    healthy the recipient happens to be, so only the ceiling is priceable;
     *  • `cleanseConvert`: `min(per x stacks cleansed, cap)`, unbounded in how
     *    afflicted your side happens to be — same rule again.
     */
    case 'wardRelease':
      req(raw, 'per', inRange(1, 999), 'an integer 1..999 (a per of 0 is priced for its cap and can never deliver a point)', at, problems);
      req(raw, 'cap', inRange(0, 999), 'an integer 0..999 — REQUIRED: the cap is what is priced, and it is also how many of your own ward charges are spent', at, problems);
      break;
    case 'desperation':
      num('amount');
      break;
    case 'overhealShield':
      req(raw, 'cap', inRange(0, 999), 'an integer 0..999 — REQUIRED: the cap is what is priced, because the overflow of a heal is unbounded in the recipient\'s missing HP', at, problems);
      break;
    case 'cleanseConvert':
      req(raw, 'per', inRange(1, 999), 'an integer 1..999 (a per of 0 is priced for its cap and can never deliver a point)', at, problems);
      req(raw, 'cap', inRange(0, 999), 'an integer 0..999 — REQUIRED: the cap is what is priced, because per x stacks cleansed is unbounded', at, problems);
      break;
    case 'taunt': num('amount'); break;
    case 'buffStat': stat(); pct('pct'); turns('turns'); break;
    case 'debuffStat': stat(); pct('pct'); turns('turns'); break;
    default: assertNever(kind, problems, where);
  }
}

/**
 * THE RIDER ORDERING RULE (user-locked 2026-08-21, verbatim: "it should always
 * activate this effect first before activating any poison debuff").
 *
 * ALL EIGHT conditional riders — `exploit`, `stackBonus`, `taxBonus`,
 * `shieldBurst`, `wardRelease`, `desperation`, `overhealShield`,
 * `cleanseConvert` — arm a bonus by READING A RESOURCE THAT IS ALREADY THERE
 * (`cast.bonusByTarget` / `cast.bonusFlat` / `cast.healBonusFlat` /
 * `cast.overhealShieldCap`, combat/interpreter.ts), and only a non-gem action of
 * the FED KIND ever spends it — `damage` for the six bonus-damage members, `heal`
 * for the two heal-side ones (`riderFeedsKind`, engine/balance.ts). Two things
 * must therefore hold on the authored effect list, and neither is expressible in
 * the type (plus one extra arrow that only `cleanseConvert` needs, rule 0 below):
 *
 *  1. THE RIDER MUST PRECEDE AN ACTION OF THE KIND IT FEEDS. Behind one — or on a
 *     card with no such line at all — it arms a bonus nothing can read: a priced
 *     no-op, the exact silent failure `GEM_ACTION_PHASE` (engine/cards.ts) was
 *     built to close for the same keyword family on the gem path. A heal-side
 *     rider on a card whose only line is `damage` fails this rule as surely as an
 *     `exploit` on a card whose only line is `heal`.
 *
 *  2. ANYTHING THAT SUPPLIES THE RIDER'S OWN RESOURCE MUST COME AFTER THAT FED
 *     ACTION. This is the user's ruling: a card may not satisfy its own condition
 *     inside one cast. Placed before the damage, a poison+exploit card would
 *     collect its own bonus on its FIRST cast and the cross-cast loop — the
 *     mechanic the card is sold on — would never exist. Placed after, the pile
 *     is left behind and the NEXT cast collects. It is also what makes the
 *     self-synergy price honest (`selfSynergyPremiumDeci`, engine/balance.ts):
 *     that premium is derived from "guaranteed from the second cast onward".
 *
 *     THE SAME ANSWER FOR EVERY SELF-SUPPLIABLE RESOURCE, deliberately — the alternative was
 *     considered and rejected (2026-08-21, second rider pass). A `slow`+`taxBonus`
 *     card is the tempting exception: a slow expires at end of turn, so letting it
 *     feed the reaper in the SAME cast would be the only way that pairing ever
 *     reliably pays. But the ruling is about SELF-TRIGGERING, not about how long
 *     the resource lives — a rider reads what is already there, full stop — and
 *     carving out one keyword would make the rule un-teachable ("your poison
 *     doesn't count but your slow does") and the self-synergy premium
 *     unjustifiable. So slow/burden are ordered exactly like poison/thorns/shield:
 *     after the hit. A slow+reaper card still self-feeds a SECOND cast in the same
 *     turn, and a burden+reaper card feeds every later cast until the taxed piece
 *     is played.
 *
 * SIDE-AWARE (rule 2): only an application that lands where the rider READS
 * counts. A `stackBonus` with `of: 'caster'` is self-fed by a CASTER-side
 * `thorns` line, never by the poison the same card puts on the enemy — so a
 * poison-before-damage line on a thorns-spender is not a violation. Likewise a
 * `shieldBurst` reads CASTER-side plating (fed by `shield`, and by an
 * `overhealShield` that banks plating out of a heal), a `wardRelease` reads
 * CASTER-side ward charges (fed by `ward`), a `taxBonus` reads TARGET-side weight
 * taxes (fed by `slow`/`burden` — never by `splash`, which spreads a burden's
 * reach but supplies no tax of its own).
 *
 * RULE 2 IS INERT FOR THREE OF THE EIGHT. Nothing supplies `'lowHp'`,
 * `'overheal'` or `'cleansed'` (`resourceSuppliedBy`, engine/balance.ts), so
 * `desperation`, `overhealShield` and `cleanseConvert` can never trip it — the
 * same fact that makes their conditional discount unforfeitable
 * (`selfSynergyPremiumDeci`).
 *
 * Checked against the EFFECTIVE effect list at every tier, exactly like the
 * AoE+splash and spreader rules beside it: a tier block that re-authors `effects`
 * can reorder them, and one that authors none inherits the base list.
 */
/**
 * A `chainBonus` MAY NOT NAME ITS OWN CARD'S TYPE (user design, 2026-08-21).
 *
 * The keyword's gate is "the caster's PREVIOUS resolved cast was of type X", and
 * it prices at the CONDITIONAL-TRIGGER DISCOUNT — which buys exactly one thing: a
 * gate the card cannot guarantee. A sword card gated on `after: 'sword'`
 * guarantees its own gate from its SECOND cast onward (it is itself the previous
 * cast), so the discount stops describing it — the same reasoning
 * `selfSynergyPremiumDeci` applies to a kit that supplies its own rider's
 * resource, and the same reasoning behind the never-self-trigger ordering ruling.
 *
 * REFUSED RATHER THAN PRICED, deliberately: the self-gated form is not a
 * different-magnitude card, it is a card whose printed condition is a formality.
 * The same refuse-rather-than-price call `splash`-with-nothing-to-spread and
 * `scope: all` + `shieldBurst` already get. (A MONO-TYPE BOARD still raises the
 * gate's real uptime, exactly as a narrow-archetype board does for `comboBonus`
 * — that is a deck choice, not an authoring defect, and is not refusable here.)
 *
 * `ownType` is the card's `element ?? weapon`, mirroring `cardType`
 * (combat/typeIdentity.ts) — the one definition of a card's type.
 */
function rejectSelfChain(ownType: unknown, effects: unknown, at: string, problems: ContentProblem[]): void {
  if (typeof ownType !== 'string' || !Array.isArray(effects)) return;
  for (const action of effects) {
    if (!isObj(action) || action.kind !== 'chainBonus' || action.after !== ownType) continue;
    problems.push({
      where: at,
      message: 'a chainBonus cannot name its own card type (' + ownType + ') — the card would satisfy its own gate '
        + 'from its second cast onward, which is not what the conditional-trigger discount prices. Name a DIFFERENT '
        + 'type (the sword -> axe / fire -> frost pairing the keyword exists for), or drop the rider.',
    });
  }
}

function rejectRiderMisordering(effects: unknown, at: string, problems: ContentProblem[]): void {
  if (!Array.isArray(effects)) return;
  const actions = effects.filter(isObj);
  for (let r = 0; r < actions.length; r += 1) {
    const rider = actions[r]!;
    // WHAT THIS RIDER READS, from the engine's own lookup — so the authoring rule
    // and the price can never disagree about which keyword reads (or supplies)
    // what. A raw JSON object is handed straight to it: the switch is driven by
    // `kind`, and a malformed rider simply yields a resource nothing matches
    // (its missing/invalid fields are already reported by `validateAction`).
    const reads = riderReadsResource(rider as unknown as Action);
    if (!reads) continue;
    /**
     * WHAT SPENDS THIS RIDER — `damage` for the six bonus-damage members, `heal`
     * for the two heal-side ones (`riderFeedsKind`, engine/balance.ts). Read from
     * the engine's own lookup for the same reason `reads` is: the authoring rule and
     * the price must never disagree about which action a rider belongs in front of.
     * The `?? 'damage'` is unreachable (`riderReadsResource` returned non-null, so
     * `riderFeedsKind` does too) and is here only so the narrowing is local.
     */
    const feeds = riderFeedsKind(rider as unknown as Action) ?? 'damage';
    /**
     * RULE 0 (`cleanseConvert` only) — THE PREREQUISITE THAT MUST COME FIRST.
     * Every other rider reads a resource that was already standing, so it goes at
     * the front of the card; this one reads a RESULT ITS OWN CAST PRODUCES, so the
     * `cleanse` that produces it has to be AHEAD of the rider. Behind it (or absent)
     * the rider reads 0 stacks and converts nothing — the same priced no-op rule 1
     * exists to prevent, one step earlier in the chain. The full authored shape is
     * `cleanse -> cleanseConvert -> heal`, and rules 0 and 1 pin one arrow each.
     */
    if (rider.kind === 'cleanseConvert') {
      let cleansed = false;
      for (let i = 0; i < r; i += 1) if (actions[i]!.kind === 'cleanse') { cleansed = true; break; }
      if (!cleansed) {
        problems.push({
          where: at,
          message: 'a cleanseConvert rider must be placed AFTER a cleanse action — it converts the stacks that cleanse '
            + 'actually removed, so with no cleanse ahead of it (effects[' + String(r) + ']) it reads 0 and can never pay out. '
            + 'The authored order is cleanse -> cleanseConvert -> heal.',
        });
        continue;
      }
    }
    // Rule 1: the first own action of the fed KIND after the rider is the one it feeds.
    let fed = -1;
    for (let i = r + 1; i < actions.length; i += 1) {
      if (actions[i]!.kind === feeds) { fed = i; break; }
    }
    if (fed === -1) {
      problems.push({
        where: at,
        message: 'a ' + String(rider.kind) + ' rider must be placed BEFORE a ' + feeds + ' action — it arms this cast\'s bonus '
          + feeds + ', and only a ' + feeds + ' action can spend it. Move it ahead of the card\'s ' + feeds + ' line (or drop it).',
      });
      continue;
    }
    // Rule 2: nothing may supply the resource this rider reads until after the
    // action it feeds. (Inert for `desperation`/`overhealShield`/`cleanseConvert`:
    // no keyword supplies `lowHp`/`overheal`/`cleansed` — see `resourceSuppliedBy`.)
    for (let i = 0; i < actions.length; i += 1) {
      if (i === r || i > fed) continue;
      const applied = resourceSuppliedBy(actions[i]! as unknown as Action);
      if (!applied || applied.resource !== reads.resource || applied.on !== reads.on) continue;
      problems.push({
        where: at,
        message: 'effects[' + String(i) + '] supplies ' + applied.resource + ', the same thing the ' + String(rider.kind)
          + ' rider reads, at or before the ' + feeds + ' it feeds (effects[' + String(fed) + ']) — a card may never trigger its own '
          + 'condition within one cast (user-locked 2026-08-21). Move the ' + String(actions[i]!.kind) + ' line AFTER the ' + feeds + '; '
          + 'the payoff is meant to land on the NEXT cast.',
      });
    }
  }
}

/**
 * A `splash` WITH NOTHING TO SPREAD IS REFUSED (user-locked 2026-08-21, with the
 * spreader model: "splash is an effect that spread other effect").
 *
 * `splash` carries no payload of its own — it only widens the reach of the cast's
 * CARD-TARGETING effects (`CARD_TARGETING_KINDS`: `burden`, `curse`) from the
 * anchor to the whole band. On a card that carries none of them it is dead
 * weight: it would print a keyword on the face, sit in the effect list, cost
 * nothing (the coverage multiplier has nothing to multiply) and do nothing.
 *
 * REFUSED RATHER THAN PRICED OR IGNORED, the same call the AoE rule above makes:
 * an authored no-op should be a build failure, not a shipped card that lies on
 * its own face. The GEM path is closed separately, by THE SPLASH GATE's
 * `nothingToSpread` arm (`spliceGemActions`, engine/cards.ts) — which this
 * validator structurally cannot cover, since gem actions are spliced after
 * authoring.
 *
 * Checked against the EFFECTIVE effect list at every tier, exactly like the two
 * rules beside it: a tier block that re-authors `effects` could otherwise drop
 * the burden and keep the splash.
 */
function rejectSpreaderWithNothingToSpread(effects: unknown, at: string, problems: ContentProblem[]): void {
  if (!Array.isArray(effects)) return;
  const actions = effects.filter(isObj);
  if (!actions.some((a) => a.kind === 'splash')) return;
  if (actions.some((a) => CARD_TARGETING_KINDS.has(a.kind as Action['kind']))) return;
  problems.push({
    where: at,
    message: 'a splash action needs something to spread — it has no payload of its own, it only widens a '
      + [...CARD_TARGETING_KINDS].join('/') + ' from the target\'s current card to the whole band. '
      + 'Add one of those to this card, or drop the splash.',
  });
}

const AURA_FIELDS = new Set(['affects', 'reach', 'archetypeFilter', 'propertyFilter', 'mods']);
const AURA_AFFECTS = ['adjacent', 'left', 'right', 'allBoard'] as readonly string[];
const AURA_MODS = ['damageFlat', 'healFlat', 'weightDelta'] as readonly string[];

// NO SIGN RESTRICTION on `mods.damageFlat`/`healFlat`/`weightDelta` here, ON
// PURPOSE (balance-designer decision, 2026-08-17, closing the fail-open hole
// alongside `expose`/`guard`/`lifesteal`/`slow` above): a negative mod is a
// REAL, working effect (a debuff aura — `negative weightDelta` already ships
// as a genuine "cast sooner" haste buff, its mirror would be a genuine
// slow), never an apply-time no-op the way an over-clamped `pct` or an
// under-zero `charges`/`weight` is. The exploit here was a PRICING bug, not
// an authoring-shape bug: `powerLevelDeci`'s aura term used to price
// `damageFlat`/`healFlat` SIGNED while wrapping only `weightDelta` in
// `Math.abs`, letting a card buy down its own budget with a "downside" its
// own aura can never realize on itself (`resolveAuras`'s
// `if (source === piece) continue`, combat/auras.ts — an aura never affects
// its own host). Fixed at the SOURCE (`auraModsDeci` in balance.ts, now
// `Math.abs` on all three terms, not just `weightDelta`) rather than by
// rejecting the shape here, because the shape is legitimate content.

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

const TIER_UPGRADE_FIELDS = new Set(['effects', 'aura', 'speedWeight', 'cooldownTurns', 'scope', 'text']);

function validateTierUpgrade(raw: unknown, where: string, problems: ContentProblem[]): void {
  if (!isObj(raw)) { problems.push({ where, message: 'tier upgrade must be an object' }); return; }
  const changesEffects = Array.isArray(raw.effects);
  if (changesEffects) (raw.effects as unknown[]).forEach((a, i) => validateAction(a, where + '.effects[' + String(i) + ']', problems));
  if (raw.aura !== undefined) validateAura(raw.aura, where, problems);
  opt(raw, 'speedWeight', inRange(0, 200), 'an integer 0..200', where, problems);
  opt(raw, 'cooldownTurns', inRange(0, 99), 'an integer 0..99', where, problems);
  // TARGET SCOPE per tier — the same closed union the card-level field takes
  // (`SkillDef.scope`), validated identically here: a tier block is spread onto
  // the def verbatim by `applyTier`, so an unchecked value would reach
  // `resolveTargets` and `powerLevelDeci` exactly as if it had been authored at
  // card level. A field the validator ignores is how a silent zero ships.
  opt(raw, 'scope', (v) => v === 'one' || v === 'all', 'one or all', where, problems);
  // A tier that changes what the card DOES must say so, or the card face lies at
  // that tier. Changing SCOPE is the loudest such change there is — "hits every
  // foe" is a different ability, not a bigger number — so it demands text on the
  // same terms as an effects swap. (Magnitude/stat-token drift is a separate,
  // deeper gate — see tests/engine/cardText.test.ts.)
  const changesFace = changesEffects || raw.scope !== undefined;
  if (changesFace && (typeof raw.text !== 'string' || raw.text.trim() === '')) {
    problems.push({ where, message: 'a tier upgrade that changes effects or scope must carry non-empty text — otherwise the card face shows the wrong numbers at that tier' });
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

  /**
   * AN AUTHORED `scope: 'all'` + `splash` CARD IS REJECTED (user-locked
   * 2026-08-18: "this doesn't affect aoe the same but only for target's
   * current turn's card").
   *
   * Splash is single-target AT THE UNIT LEVEL by design — what it spreads
   * across is ONE victim's board, not a team. It is nonetheless an `offensive`
   * keyword (`keywords/pricing.ts`, mirroring `isOffensiveAction`), so
   * `resolveTargets` WOULD fan the cast out over every living foe under an AoE
   * scope and spread its card-targeting effects across each one's whole band —
   * quietly turning a board-band keyword into a team-wide one. Two ways to
   * close that: price the fan-out, or refuse it. Refused — the mechanic's
   * stated identity is single-target, and pricing a shape the design forbids
   * would invite it to ship. (Note this refuses the SPREADER, not the payload:
   * an AoE card carrying a bare `burden` is legal and pays the reach multiplier,
   * exactly like an AoE `slow`.)
   *
   * WHAT THIS RULE DOES AND DOES NOT COVER (corrected 2026-08-18 — it used to
   * claim the combination was "rejected outright", full stop). This validator
   * reads the AUTHORED card def, so it can only refuse the combination a
   * DESIGNER writes: it never sees an effect GEM's actions, which are spliced
   * onto the host at resolve time and are the one way an AoE card can acquire
   * a splash after authoring. That path is closed separately, by THE SPLASH
   * GATE in `resolveEffectiveSkill`/`spliceGemActions` (src/engine/cards.ts),
   * which drops a gem `splash` on a multi-target host (and on a host that
   * already splashes, and on one with nothing to spread). Both rules stay: the
   * engine gate makes the combination
   * harmless at runtime, and THIS rule keeps it a loud build failure, so a
   * designer writing AoE + splash by hand is told rather than shipping an
   * effect the engine will silently drop.
   *
   * NOT a silent zero either way: the spread IS priced (its own flat
   * standalone rate, `PRICE.splashFlatDeci`, control family), and because it
   * is marked `offensive` an AoE splash would pay
   * `PRICE.aoeTargetsNum/Den` on top of that if one were ever constructed in
   * code — this rule stops one being AUTHORED.
   *
   * Checked against the EFFECTIVE (scope, effects) pair at every tier: a tier
   * block inherits the base card's effects when it declares none, and the base
   * card's scope when it declares none, so either half can arrive from either
   * place. `tierUpgrades.<tier>.scope` is additionally required to carry
   * upward (see below), so this cannot be dodged by leaving a higher tier
   * unstated.
   */
  /**
   * ...AND THE SAME REFUSAL FOR `shieldBurst` (2026-08-21), on the same grounds
   * one scope down. A burst spends the caster's OWN wall, so it resolves on the
   * caster and runs ONCE per cast (`isOffensiveAction`) — but the flat bonus it
   * arms is `cast.bonusFlat`, which EVERY foe of an AoE damage action reads. One
   * wall, spent once, delivered five times, priced once (a supportive keyword pays
   * no `PRICE.aoeTargetsNum/Den` reach multiplier). Refused rather than priced,
   * exactly like splash: the keyword's identity is "convert your plating into THE
   * hit", and pricing a shape the design forbids would invite it to ship.
   *
   * (The gem path is closed differently for this one: no gem carries `shieldBurst`
   * and a test pins that, because a gem one would need THE SPLASH GATE's
   * treatment in `spliceGemActions` — see `GEM_ACTION_PHASE`'s entry in cards.ts.)
   */
  // A LIST, walked by index — one problem message per offending kind, in a
  // source-fixed order, so the reported problems of a card carrying both are
  // stable rather than object-key-order dependent.
  const UNIT_SCOPED_KINDS: readonly { kind: string; why: string }[] = [
    { kind: 'splash', why: 'splash is single-target at the UNIT level (it spreads across ONE victim\'s board, not across a team)' },
    // NOTE which kind is listed: the SPREADER, not `burden`/`curse`. A bare
    // card-targeting effect under AoE lands on one piece per foe — the same
    // linear reach an AoE `slow` has, priced by the reach multiplier. It is
    // band x foes that is refused.
    { kind: 'shieldBurst', why: 'a shieldBurst spends ONE wall ONCE, and an AoE hit would hand that same bonus to every foe at a single-target price' },
    // `wardRelease` inherits the burst's refusal verbatim: same caster-side
    // resource shape, same scalar `cast.bonusFlat`, same hole. Appended below it
    // rather than folded in with it so each keyword still reports its own message.
    { kind: 'wardRelease', why: 'a wardRelease spends ONE pile of charges ONCE, and an AoE hit would hand that same bonus to every foe at a single-target price' },
  ];
  const rejectAoeUnitScoped = (scope: unknown, effects: unknown, at: string): void => {
    if (scope !== 'all' || !Array.isArray(effects)) return;
    for (let i = 0; i < UNIT_SCOPED_KINDS.length; i += 1) {
      const { kind, why } = UNIT_SCOPED_KINDS[i]!;
      if (!effects.some((a) => isObj(a) && a.kind === kind)) continue;
      problems.push({
        where: at,
        message: 'scope: all cannot be combined with a ' + kind + ' action — ' + why
          + '. Drop the ' + kind + ', or drop the AoE scope.',
      });
    }
  };
  rejectAoeUnitScoped(raw.scope, raw.effects, where);
  rejectSpreaderWithNothingToSpread(raw.effects, where, problems);
  rejectRiderMisordering(raw.effects, where, problems);
  rejectSelfChain(raw.element ?? raw.weapon, raw.effects, where, problems);
  if (isObj(raw.tierUpgrades)) {
    for (const [tier, up] of Object.entries(raw.tierUpgrades)) {
      if (!isObj(up)) continue;
      rejectAoeUnitScoped(up.scope ?? raw.scope, up.effects ?? raw.effects, where + '.tierUpgrades.' + tier);
      rejectSpreaderWithNothingToSpread(up.effects ?? raw.effects, where + '.tierUpgrades.' + tier, problems);
      rejectRiderMisordering(up.effects ?? raw.effects, where + '.tierUpgrades.' + tier, problems);
      rejectSelfChain(up.element ?? raw.element ?? up.weapon ?? raw.weapon, up.effects ?? raw.effects, where + '.tierUpgrades.' + tier, problems);
    }
  }

  if (raw.tierUpgrades !== undefined) {
    if (!isObj(raw.tierUpgrades)) {
      problems.push({ where, message: 'tierUpgrades must be an object keyed by tier' });
    } else {
      for (const [tier, up] of Object.entries(raw.tierUpgrades)) {
        if (tier === 'bronze') { problems.push({ where, message: 'tierUpgrades cannot override bronze — bronze IS the authored base' }); continue; }
        if (!TIERS.includes(tier)) { problems.push({ where, message: 'tierUpgrades key ' + tier + ' is not a tier' }); continue; }
        validateTierUpgrade(up, where + '.tierUpgrades.' + tier, problems);
      }
      // SCOPE MUST CARRY UPWARD. `applyTier` always scales from the BASE def:
      // an authored block wins verbatim at ITS tier, and every tier WITHOUT a
      // block runs the auto-scaler on the base card — which reads the BASE
      // scope. So a card that becomes AoE at Gold and has no Diamond block is
      // AoE at Gold and single-target again at Diamond: a strict DOWNGRADE for
      // paying more. Nothing in the engine can infer the author's intent there,
      // so the schema demands it be stated at every higher tier.
      for (const [tier, up] of Object.entries(raw.tierUpgrades)) {
        const from = TIERS.indexOf(tier);
        if (from < 1 || !isObj(up) || up.scope === undefined) continue;
        for (let t = from + 1; t < TIERS.length; t += 1) {
          const higher = TIERS[t]!;
          const block = (raw.tierUpgrades as Record<string, unknown>)[higher];
          if (isObj(block) && block.scope !== undefined) continue;
          problems.push({
            where: where + '.tierUpgrades.' + tier,
            message: 'a tier upgrade that sets scope must be carried by every higher tier — add tierUpgrades.' + higher
              + ' with its own scope, or the auto-scaler rebuilds ' + higher + ' from the base card and silently drops it',
          });
        }
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
