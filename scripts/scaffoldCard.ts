/**
 * CARD SCAFFOLD — solve a new card's magnitudes FROM THE RULES.
 *
 *   npm run scaffold:card -- --id ember_dart --name "Ember Dart" \
 *     --tier bronze --size 1 --property magical --element fire \
 *     --archetypes offense --keywords damage,burn
 *
 * The rules already say what a card may cost (`powerLevelDeci`), what each
 * keyword's rate is (`KEYWORD_PRICING`), and what it may not exceed
 * (`capViolations`, weight bounds). This script asks THOSE functions — never a
 * copy of them — to solve the magnitudes so the kit lands EXACTLY on the tier
 * budget, then prints a ready-to-paste `skills.v1.json` document plus an audit
 * summary at every tier.
 *
 * Allocation order (the order matters — it is a coin-change problem):
 *   1. grow requested effects, coarsest whole-PL step first;
 *   2. close any remainder with the weight dial (2 points = exactly 1 PL).
 * Cooldown is deliberately NOT a lever: shortening it concentrates play into a
 * one-or-two-card deck. Weight only shifts WHEN a card fires.
 *
 * The emitted `text` is built from per-keyword phrase templates that match
 * docs/card-text-style-guide.md, so the card-text drift guard passes without
 * hand-editing.
 *
 * KNOWN-INFEASIBLE SOLO KITS: `lifesteal` alone caps at 60% = 40 deci, under
 * every budget, so it refuses cleanly — pair it with a scalable sink.
 *
 * WHAT ACTUALLY BOUNDS A CHARGE KEYWORD is its cap family, not its rate.
 * `cleanse` is perfectly linear (25 deci/charge, whole-PL step of 2 charges), so
 * every budget is reachable by rate alone: 4/6/8/10 charges = 100/150/200/250.
 * `EFFECT_CAPS_DECI.empower` is what closes all but one of those doors — it
 * allows only 100/150/200 deci at size 1/2/3, while the SIZE GRANT means a
 * larger card must spend far MORE than its budget on effects (size 2 grants
 * ~170 deci, size 3 ~550), so the cap tightens exactly as the requirement grows.
 * The two curves touch at a single point: size 1 bronze, where cap = budget =
 * 4 charges. That is why shipped `purify` is size-1 bronze cleanse-4 and why its
 * silver/gold/diamond blocks must bolt on a TRUE heal rather than buy more
 * charges. A capped solo kit is reported as a tier FAIL here, never shipped.
 *
 * KNOWN TODAY-COST: until the legacy literals in src/data/skills.ts are
 * deleted, a new card must be added BOTH to skills.v1.json and to skills.ts —
 * tests/data/skillsJsonParity.test.ts asserts the two agree. This script
 * prints the JSON document; the parity edit is called out at the end.
 */
import {
  capViolations,
  isOnBudget,
  powerLevelDeci,
  KEYWORD_PRICING,
  TIER_BUDGET_DECI,
  WEIGHT_MIN,
} from '../src/engine/balance';
import { applyTier } from '../src/engine/cards';
import { weightOf, type Action, type Archetype, type Element, type Property, type SkillDef, type SkillTier, type WeaponType } from '../src/engine/types';
import { validateSkillDocument } from '../src/data/validateSkillContent';

// ── args ────────────────────────────────────────────────────────────────────
function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  console.error(`missing --${name}`);
  process.exit(1);
}
const TIERS: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];
const id = arg('id');
const name = arg('name');
const tier = arg('tier', 'bronze') as SkillTier;
if (!TIERS.includes(tier)) { console.error(`unknown tier '${tier}' — expected ${TIERS.join('|')}`); process.exit(1); }
const size = Number(arg('size', '1')) as SkillDef['size'];
if (![1, 2, 3].includes(size)) { console.error(`invalid size '${arg('size', '1')}' — expected 1|2|3`); process.exit(1); }
const property = arg('property') as Property;
if (!['physical', 'magical', 'true'].includes(property)) { console.error(`unknown property '${property}' — expected physical|magical|true`); process.exit(1); }
const element = process.argv.includes('--element') ? (arg('element') as Element) : undefined;
const weapon = process.argv.includes('--weapon') ? (arg('weapon') as WeaponType) : undefined;
const archetypes = arg('archetypes').split(',') as Archetype[];
const keywords = arg('keywords').split(',') as Action['kind'][];

// ── seed each requested keyword at ZERO magnitude; the solver grows it ──────
function seedAction(kind: Action['kind']): Action {
  switch (kind) {
    case 'damage': case 'heal': case 'shield': return { kind, power: 0 };
    case 'poison': case 'burn': case 'bleed': case 'thorns': return { kind, stacks: 0 };
    case 'stun': return { kind, turns: 1 }; // LOCKED at 1 (MAX_STUN_PER_CARD)
    case 'buffStat': return { kind, stat: 'attack', pct: 0, turns: 2 };
    case 'debuffStat': return { kind, stat: 'armor', pct: 0, turns: 2 };
    case 'expose': return { kind, pct: 0, turns: 2 };
    case 'guard': return { kind, property: property === 'physical' ? 'physical' : 'magical', pct: 0, turns: 2 };
    case 'negate': return { kind, property: property === 'physical' ? 'physical' : 'magical', charges: 1 };
    // Seeded at ZERO like every other growable field: seeding cleanse at 1 made
    // only ODD charge counts reachable (its whole-PL step is 2 charges), so
    // 25/75/125/175 deci were the only totals and no budget was hit. From 0 the
    // solver reaches 4/6/8 charges = 100/150/200 deci exactly.
    case 'cleanse': return { kind, charges: 0 };
    case 'slow': return { kind, weight: 0 };
    case 'disrupt': return { kind, amount: 0 };
    case 'lifesteal': return { kind, pct: 0 };
    case 'shieldBreak': return { kind, amount: 0 };
    case 'comboBonus': return { kind, amount: 0 };
    default:
      console.error(`no scaffold seed for keyword '${kind}'`);
      process.exit(1);
  }
}

/** The field the solver grows per keyword — mirrors the growth facet. */
const GROW_FIELD: Partial<Record<Action['kind'], string>> = {
  damage: 'power', heal: 'power', shield: 'power',
  poison: 'stacks', burn: 'stacks', bleed: 'stacks', thorns: 'stacks',
  buffStat: 'pct', debuffStat: 'pct', expose: 'pct', guard: 'pct',
  slow: 'weight', disrupt: 'amount', lifesteal: 'pct',
  shieldBreak: 'amount', comboBonus: 'amount',
  negate: 'charges', cleanse: 'charges',
};
/** Intrinsic ceilings (engine clamps); the solver must not author past them. */
const CEILING: Partial<Record<Action['kind'], number>> = { guard: 60, expose: 50, lifesteal: 60, negate: 3 };

const base: SkillDef = {
  id, name, archetypes, property, size, rarity: 'common', tier,
  ...(element ? { element } : {}), ...(weapon ? { weapon } : {}),
  effects: keywords.map(seedAction),
  text: '',
};

const clone = (s: SkillDef): SkillDef => JSON.parse(JSON.stringify(s)) as SkillDef;

/** Smallest unit increment of `field` whose price is a whole PL — derived, never stored. */
function stepFor(card: SkillDef, idx: number, field: string): number | null {
  const before = powerLevelDeci(card);
  for (let n = 1; n <= 40; n += 1) {
    const trial = clone(card);
    (trial.effects[idx] as unknown as Record<string, number>)[field] = ((trial.effects[idx] as unknown as Record<string, number>)[field] ?? 0) + n;
    const delta = powerLevelDeci(trial) - before;
    if (delta > 0 && delta % 10 === 0) return n;
  }
  return null;
}

function solve(card: SkillDef): SkillDef | null {
  const target = TIER_BUDGET_DECI[card.tier];
  const slots = card.effects
    .map((a, idx) => ({ idx, field: GROW_FIELD[a.kind], kind: a.kind }))
    .filter((s): s is { idx: number; field: string; kind: Action['kind'] } => s.field !== undefined)
    .map((s) => ({ ...s, step: stepFor(card, s.idx, s.field) }))
    .filter((s): s is typeof s & { step: number } => s.step !== null);

  let guard = 0;
  let cursor = 0;
  while (powerLevelDeci(card) < target && guard < 500) {
    guard += 1;
    let moved = false;
    // ROUND-ROBIN across the requested keywords: each takes one whole-PL step
    // in turn, so the budget spreads across the kit instead of the coarsest
    // step eating everything and leaving "Deal 0 damage" degenerates. The
    // weight dial is still reserved to close any remainder.
    for (let tries = 0; tries < slots.length; tries += 1) {
      const s = slots[(cursor + tries) % slots.length]!;
      const trial = clone(card);
      const f = trial.effects[s.idx] as unknown as Record<string, number>;
      const next = (f[s.field] ?? 0) + s.step;
      const ceiling = CEILING[s.kind];
      if (ceiling !== undefined && next > ceiling) continue;
      f[s.field] = next;
      if (powerLevelDeci(trial) > target) continue;
      if (capViolations(trial).length > 0) continue;
      card.effects = trial.effects;
      cursor = (cursor + tries + 1) % slots.length;
      moved = true;
      break;
    }
    if (moved) continue;
    // weight dial: 2 points lighter = exactly 1 PL
    const w = weightOf(card) - 2;
    if (w < WEIGHT_MIN) break;
    const trial = clone(card);
    trial.speedWeight = w;
    if (powerLevelDeci(trial) > target || capViolations(trial).length > 0) break;
    card.speedWeight = w;
  }
  if (powerLevelDeci(card) !== target) return null;
  // Every requested keyword must have received real magnitude — a zero-power
  // effect on budget is a policy failure, not a solution.
  for (const s of slots) {
    const f = card.effects[s.idx] as unknown as Record<string, number>;
    if ((f[s.field] ?? 0) <= 0) return null;
  }
  return card;
}

// ── text from phrase templates (docs/card-text-style-guide.md) ──────────────
const STAT_TOKEN: Record<string, string> = { attack: 'ATK', magicPower: 'MATK', armor: 'DEF', magicResist: 'MDEF', speed: 'SPD' };
function typeWord(): string {
  const w = element ?? weapon ?? '';
  return w.charAt(0).toUpperCase() + w.slice(1);
}
function damageToken(): string {
  return property === 'physical' ? '(+ATK)' : property === 'magical' ? '(+MATK)' : '(+best stat)';
}
function defToken(): string {
  return property === 'magical' ? '(+MDEF)' : '(+DEF)';
}
function phrase(a: Action): string {
  switch (a.kind) {
    case 'damage':
      return property === 'true'
        ? `Deal ${a.power} (+best stat) TRUE damage — ignores DEF/MDEF`
        : `Deal ${a.power} ${damageToken()} ${typeWord()} damage`;
    case 'heal': return property === 'true' ? `Restore ${a.power} HP` : `Restore ${a.power} ${defToken()} HP`;
    case 'shield':
      return property === 'true'
        ? `Gain ${a.power} TRUE shield`
        : `Gain ${a.power} ${defToken()} ${property} shield`;
    case 'poison': return `{{Poison}} ${a.stacks}`;
    case 'burn': return `{{Burn}} ${a.stacks}`;
    case 'bleed': return `{{Bleed}} ${a.stacks}`;
    case 'thorns': return `{{Thorns}} ${a.stacks} — attackers take the stack count as TRUE damage per hit`;
    case 'stun': return `{{Stun}} the enemy's next performance`;
    case 'buffStat': return `+${a.pct}% ${STAT_TOKEN[a.stat]} (${a.turns} turns)`;
    case 'debuffStat': return `-${a.pct}% enemy ${STAT_TOKEN[a.stat]} (${a.turns} turns)`;
    case 'expose': return `Enemy takes +${a.pct}% damage (${a.turns} turns)`;
    case 'guard': return `-${a.pct}% incoming ${a.property} damage (${a.turns} turns)`;
    case 'negate': return `{{Negate}} the next ${a.charges > 1 ? `${a.charges} ${a.property} attacks` : `${a.property} attack`}`;
    case 'cleanse': return `{{Cleanse}} ${a.charges} ailment${a.charges > 1 ? 's' : ''}`;
    case 'slow': return `Enemy's next action is +${a.weight} heavier`;
    case 'disrupt': return `{{Disrupt}} ${a.amount} banked readiness`;
    case 'lifesteal': return `{{Lifesteal}} ${a.pct}% of damage dealt`;
    case 'shieldBreak': return `{{Shatter}} ${a.amount} enemy shield`;
    case 'comboBonus': return `{{Combo}} +${a.amount} damage (previous cast shared an archetype)`;
    default: return '';
  }
}
function textOf(card: SkillDef): string {
  const parts = card.effects.map(phrase).filter((p) => p.length > 0);
  const weightNote = card.speedWeight !== undefined && card.speedWeight !== card.size * 10
    ? ` Lighter stance (weight ${card.speedWeight}).`
    : '';
  return parts.join(' · ') + '.' + weightNote;
}

// ── solve, audit with the REAL gates, emit ──────────────────────────────────
const solved = solve(clone(base));
if (!solved) {
  console.error(`could not land exactly on ${TIER_BUDGET_DECI[tier] / 10} PL with keywords [${keywords.join(', ')}] — try a different mix or size`);
  process.exit(1);
}
solved.text = textOf(solved);

console.log('=== AUDIT (via src/engine/balance.ts — the real gates) ===');
const auditFailures: string[] = [];
for (const t of TIERS) {
  if (TIERS.indexOf(t) < TIERS.indexOf(tier)) continue;
  const at = t === tier ? solved : applyTier(solved, t);
  const pl = powerLevelDeci(at);
  const caps = capViolations(at);
  const ok = pl === TIER_BUDGET_DECI[t] && caps.length === 0;
  if (!ok) auditFailures.push(`${t}: PL ${(pl / 10).toFixed(1)} vs budget ${TIER_BUDGET_DECI[t] / 10}${caps.length ? '; ' + caps.join('; ') : ''}`);
  console.log(`  ${t.padEnd(8)} PL ${(pl / 10).toFixed(1).padStart(5)} / ${TIER_BUDGET_DECI[t] / 10}  caps ${caps.length === 0 ? 'clean' : caps.join('; ')}  ${ok ? 'OK' : '** FAIL **'}`);
}
console.log(`  isOnBudget: ${isOnBudget(solved)}`);

const doc = {
  id,
  versions: [{ version: 1, def: (() => { const { id: _drop, ...def } = solved; return def; })() }],
};
const problems = validateSkillDocument({ schemaVersion: 1, notes: [], cards: [doc] });
console.log(`  content validator: ${problems.length === 0 ? 'clean' : problems.map((p) => `${p.where}: ${p.message}`).join(' | ')}`);

// THE AUDIT IS A GATE, NOT AN ANNOTATION. Shipping a card that fails its own
// printed audit is the silent-zero failure mode in tool form: an author who
// pastes the block ships a card the suite will reject (or worse, one the
// tierUpgrades test exempts into a dead tier path). Refuse instead.
if (auditFailures.length > 0 || problems.length > 0) {
  console.error('\nREFUSED — the card does not pass its own gates:');
  for (const f of auditFailures) console.error(`  tier audit: ${f}`);
  for (const pr of problems) console.error(`  validator: ${pr.where}: ${pr.message}`);
  if (auditFailures.length > 0) {
    console.error('  hint: kits with no scalable sink (damage/heal/shield) cannot grow to');
    console.error('  higher tiers — add one to the --keywords list, or author tierUpgrades by hand.');
  }
  process.exit(1);
}

console.log('\n=== PASTE INTO src/data/content/skills.v1.json (cards[]) ===');
console.log(JSON.stringify(doc, null, 2));
console.log('\nNOTE: until the legacy literals are deleted, also add the card to');
console.log('src/data/skills.ts (tests/data/skillsJsonParity.test.ts asserts parity).');
