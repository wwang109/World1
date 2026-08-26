import { afterEach, describe, expect, it } from 'vitest';
import { eventCatalog, eventCatalogIds, type EventChoiceDef, type EventDef } from '../../src/data/events';
import type { CardFilter } from '../../src/data/shopTypes';
import { skillBook } from '../../src/data/skills';
import { EVENT_CHOICE_SIZE, isEventChoiceUsable, resolveEventChoice, rollEventForNode } from '../../src/run/events';
import {
  applyDraftResult, availableChoices, chooseNode, createRun, leaveEvent, leaveShop,
  recordBattleResult, rollEncounter, shopStockDepthForWave, type RunNode, type RunState,
} from '../../src/run/runState';
import { DRAFT_SET_KEYS, rollStartDraft } from '../../src/run/draft';
import { battleGoldReward, cardMatchesFilter, rollShopStock } from '../../src/run/shop';
import { cardType, IDENTITY_THRESHOLD } from '../../src/engine/combat/typeIdentity';
import type { SkillDef } from '../../src/engine/types';

/**
 * ARE THE EVENT LAYER'S CARD REWARDS STEERABLE?
 *
 * The affinity payoff asks for `IDENTITY_THRESHOLD` (3) cards of ONE type
 * (`src/engine/combat/typeIdentity.ts`). Shops answer that with single-type
 * stalls (`tests/run/affinityReachability.test.ts`); before the 2026-08-26
 * content pass documented at the top of `src/data/events.ts`, events answered
 * it with nothing at all — not one of the 14 card-granting event pools was
 * single-type, three were the whole book, and the widest put ELEVEN types
 * behind a button labelled "take a spare blade".
 *
 * This file audits the four properties that pass has to keep true, all of them
 * over the REAL filter code (`cardMatchesFilter`), the REAL resolver
 * (`resolveEventChoice`) and the REAL run layer (map gen, node commit, shop
 * stock), never a reimplementation:
 *
 *   1. every card type has a door whose pool is 100% that type (P22);
 *   2. no pool is narrower than the width its outcome deals — the rule that
 *      THROWS for `cardChoice` and, worse, fails SILENTLY for `bonusDraft`;
 *   3. the text on a door is true: a label naming a type gets that type on
 *      every roll, and a guaranteed door says which type it is (P19 — the
 *      label is the only place a player can read it);
 *   4. and the point of all of it: reading the doors has to be worth
 *      something. The last describe block walks runs to wave 10 and compares a
 *      player who reads the labels against one who ignores them. Before the
 *      pass those two numbers were IDENTICAL to two decimals, per type — the
 *      measurement that says an unsteerable reward layer is not a reward layer.
 */

const ALL = Object.values(skillBook);
const typeKeyOf = (s: SkillDef): string => {
  const t = cardType(s);
  return t ? `${t.kind}:${t.type}` : 'none';
};
/** Sorted, deterministic — an array, not a Set, because order is asserted on. */
const TYPES: readonly string[] = (() => {
  const out: string[] = [];
  for (let i = 0; i < ALL.length; i += 1) {
    const k = typeKeyOf(ALL[i]!);
    if (out.indexOf(k) === -1) out.push(k);
  }
  return [...out].sort();
})();
/** The bare type word a label has to contain ("weapon:sword" -> "sword"). */
const typeWord = (t: string): string => t.slice(t.indexOf(':') + 1);

// ---------------------------------------------------------------------------
// The catalog's card-granting choices, flattened once (catalog order).
// ---------------------------------------------------------------------------

interface CardDoor {
  eventId: string;
  choice: EventChoiceDef;
  /** Offer width this outcome deals: a named grant is 1. */
  kind: 'grantCard' | 'cardChoice' | 'bonusDraft';
  /** Named single-card grants have a 1-card "pool" of exactly that card. */
  pool: readonly SkillDef[];
  filter?: CardFilter;
  named: boolean;
}

const DOORS: readonly CardDoor[] = (() => {
  const out: CardDoor[] = [];
  for (let i = 0; i < eventCatalogIds.length; i += 1) {
    const eventId = eventCatalogIds[i]!;
    const choices = eventCatalog[eventId]!.choices;
    for (let j = 0; j < choices.length; j += 1) {
      const choice = choices[j]!;
      const spec = choice.outcome;
      if (spec.kind === 'grantCard') {
        if (spec.cardId) {
          out.push({ eventId, choice, kind: 'grantCard', pool: [skillBook[spec.cardId]!], named: true });
        } else {
          const pool = spec.filter ? ALL.filter((s) => cardMatchesFilter(s, spec.filter!)) : ALL;
          out.push({ eventId, choice, kind: 'grantCard', pool, filter: spec.filter, named: false });
        }
      } else if (spec.kind === 'cardChoice' || spec.kind === 'bonusDraft') {
        const pool = spec.filter ? ALL.filter((s) => cardMatchesFilter(s, spec.filter!)) : ALL;
        out.push({ eventId, choice, kind: spec.kind, pool, filter: spec.filter, named: false });
      }
    }
  }
  return out;
})();

/** The single type a door GUARANTEES, or undefined if its pool spans more. */
function guaranteedType(door: CardDoor): string | undefined {
  if (door.pool.length === 0) return undefined;
  const first = typeKeyOf(door.pool[0]!);
  for (let i = 1; i < door.pool.length; i += 1) if (typeKeyOf(door.pool[i]!) !== first) return undefined;
  return first;
}

/** Pool draws only (a named grant names its own reward; it is not a pool). */
const POOL_DRAWS = DOORS.filter((d) => !d.named);
const GUARANTEED = POOL_DRAWS.filter((d) => guaranteedType(d) !== undefined);
const BROAD = POOL_DRAWS.filter((d) => guaranteedType(d) === undefined);

// ---------------------------------------------------------------------------
// A real run state parked on a real event node, so the resolver runs for real.
// ---------------------------------------------------------------------------

function startedRun(seed: number): RunState {
  const draft = rollStartDraft(seed);
  const picks: Record<string, string> = {};
  for (let i = 0; i < DRAFT_SET_KEYS.length; i += 1) {
    const key = DRAFT_SET_KEYS[i]!;
    picks[key] = draft[key][0]!.skillId;
  }
  return applyDraftResult(createRun(seed), picks as never);
}

function stateAtFirstEvent(seed: number): RunState {
  let state = startedRun(seed);
  for (let guard = 0; guard < 200; guard += 1) {
    const choices = availableChoices(state);
    if (choices.length === 0) break;
    const eventNode = choices.find((n) => n.kind === 'event');
    if (eventNode) return chooseNode(state, eventNode.id);
    const node = choices[0]!;
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') state = leaveShop(state);
    else state = recordBattleResult(state, { won: true, goldEarned: 1 });
  }
  throw new Error(`no event node reachable for seed ${seed}`);
}

/** Cards a resolved card-granting outcome actually offered the player. */
function offeredCards(state: RunState, eventId: string, choice: EventChoiceDef): SkillDef[] {
  const { outcome } = resolveEventChoice({ ...state, gold: Math.max(5, choice.cost ?? 0) }, eventId, choice.id);
  if (outcome.kind === 'bonusDraft') return outcome.cards.map((c) => skillBook[c.skillId]!);
  if (outcome.kind === 'grantCard') return [skillBook[outcome.skillId]!];
  return [];
}

describe('data/events: the reward on the door is a real category', () => {
  it('the audit has something to audit — pool draws, doors, broad pools and >1 type all exist', () => {
    // Non-vacuity, first: every assertion below is a filter over these four
    // sets, so a content change that emptied one would otherwise turn this
    // whole file green while measuring nothing.
    expect(TYPES.length, `only ${TYPES.length} card type(s) in the book`).toBeGreaterThan(1);
    expect(TYPES).not.toContain('none'); // an untyped card can never open an affinity gate
    expect(POOL_DRAWS.length, 'no card-granting POOL draws in the catalog').toBeGreaterThanOrEqual(14);
    expect(GUARANTEED.length, 'no guaranteed single-type door in the catalog').toBeGreaterThanOrEqual(TYPES.length);
    // And the other half of P23: the pass must NOT have turned every reward
    // into a guarantee. A catalog with no broad pool left has deleted the
    // routing decision the doors exist to create.
    expect(BROAD.length, 'every event pool is now single-type — the constraint was removed, not steered')
      .toBeGreaterThanOrEqual(5);
  });

  it('EVERY card type has at least one event door whose pool is 100% that type', () => {
    // The property that makes an event door worth walking toward (P22). Failing
    // this means a player who commits to that type gets nothing steerable from
    // the entire event layer — which is exactly the state this pass found.
    const missing: string[] = [];
    for (let i = 0; i < TYPES.length; i += 1) {
      const type = TYPES[i]!;
      const doors = GUARANTEED.filter((d) => guaranteedType(d) === type);
      if (doors.length === 0) missing.push(type);
    }
    expect(missing, `card types with no guaranteed event door: ${missing.join(', ')}`).toEqual([]);
  });

  it('and the door is not a token gesture — every one offers more than the width it deals', () => {
    const thin: string[] = [];
    for (let i = 0; i < GUARANTEED.length; i += 1) {
      const d = GUARANTEED[i]!;
      if (d.pool.length < 2 * EVENT_CHOICE_SIZE) {
        thin.push(`${d.eventId}/${d.choice.id}: ${d.pool.length} cards`);
      }
    }
    // P22's other half — the CATEGORY is guaranteed, the INSTANCE is rolled. A
    // door whose pool is barely as wide as the offer deals the same cards every
    // time, which is a named grant wearing a filter.
    expect(thin, `single-type doors with no roll left in them: ${thin.join(', ')}`).toEqual([]);
  });
});

describe('run/events: no pool is narrower than the offer it deals', () => {
  // `cardChoiceOutcome` THROWS below `EVENT_CHOICE_SIZE`; `bonusDraft` does
  // something worse — `sampleDistinct` silently hands back fewer than 5 cards.
  // Both bounds are taken from the REAL resolver rather than written down here.

  /** The mini-draft width, observed by resolving a real unfiltered bonusDraft. */
  const OBSERVED_DRAFT_WIDTH = (() => {
    const unfiltered = POOL_DRAWS.find((d) => d.kind === 'bonusDraft' && d.filter === undefined);
    if (!unfiltered) throw new Error('no unfiltered bonusDraft left to measure the mini-draft width with');
    return offeredCards(stateAtFirstEvent(4), unfiltered.eventId, unfiltered.choice).length;
  })();

  it('the widths this suite measures against came from the resolver, not from a literal', () => {
    expect(OBSERVED_DRAFT_WIDTH, 'a full-book mini-draft dealt nothing').toBeGreaterThan(EVENT_CHOICE_SIZE);
    expect(EVENT_CHOICE_SIZE).toBeGreaterThan(1);
  });

  it('every cardChoice pool clears EVENT_CHOICE_SIZE and every bonusDraft pool clears the mini-draft width', () => {
    const violations: string[] = [];
    for (let i = 0; i < POOL_DRAWS.length; i += 1) {
      const d = POOL_DRAWS[i]!;
      const need = d.kind === 'bonusDraft' ? OBSERVED_DRAFT_WIDTH : d.kind === 'cardChoice' ? EVENT_CHOICE_SIZE : 1;
      if (d.pool.length < need) violations.push(`${d.eventId}/${d.choice.id} [${d.kind}]: ${d.pool.length} < ${need}`);
    }
    expect(violations, `pools narrower than the offer they deal: ${violations.join(', ')}`).toEqual([]);
  });

  it('and every card-granting choice really deals a full, distinct offer through the resolver', () => {
    // The pool-size lint above is arithmetic on the filter; this is the
    // behaviour. A `bonusDraft` over a 3-card pool passes no error and simply
    // deals 3 — so the only way to catch it is to count what comes back.
    let checked = 0;
    for (let i = 0; i < POOL_DRAWS.length; i += 1) {
      const d = POOL_DRAWS[i]!;
      const want = d.kind === 'bonusDraft' ? OBSERVED_DRAFT_WIDTH : EVENT_CHOICE_SIZE;
      const cards = offeredCards(stateAtFirstEvent(4), d.eventId, d.choice);
      expect(cards, `${d.eventId}/${d.choice.id} dealt ${cards.length}, expected ${want}`).toHaveLength(want);
      const ids: string[] = [];
      for (let j = 0; j < cards.length; j += 1) ids.push(cards[j]!.id);
      expect([...ids].sort(), `${d.eventId}/${d.choice.id} repeated a card`).toEqual([...new Set(ids)].sort());
      checked += 1;
    }
    expect(checked, 'no card-granting choice was resolved').toBe(POOL_DRAWS.length);
    expect(checked).toBeGreaterThanOrEqual(14);
  });

  describe('the silent failure this lint exists for', () => {
    // Synthetic catalog entry, same rig `tests/run/events.test.ts` uses for the
    // cardChoice throw: `resolveEventChoice` looks its event up in the plain,
    // mutable `eventCatalog` record, so the REAL resolver can be pointed at a
    // filter no shipped event carries.
    const RIGGED_ID = '__qa_rigged_bonus_draft_narrow__';
    afterEach(() => {
      delete (eventCatalog as Record<string, EventDef>)[RIGGED_ID];
    });

    it('a bonusDraft over a too-narrow pool deals a SHORT offer and throws nothing — which is why the catalog is linted', () => {
      const narrow = ALL.filter((s) => s.weapon === 'bow' && s.archetypes.includes('debuff'));
      expect(narrow.length, 'fixture pool moved — pick another narrow filter').toBe(2);
      (eventCatalog as Record<string, EventDef>)[RIGGED_ID] = {
        id: RIGGED_ID,
        title: 'QA rig',
        body: '',
        theme: 'training',
        choices: [
          { id: 'narrow', label: '', outcome: { kind: 'bonusDraft', filter: [{ weapons: ['bow'], archetypes: ['debuff'] }] } },
        ],
      };
      const cards = offeredCards(stateAtFirstEvent(4), RIGGED_ID, eventCatalog[RIGGED_ID]!.choices[0]!);
      expect(cards).toHaveLength(narrow.length); // 2, not 5 — no error raised
      expect(cards.length).toBeLessThan(OBSERVED_DRAFT_WIDTH);
      // Which is precisely what the catalog-wide lint above would have caught:
      const need = OBSERVED_DRAFT_WIDTH;
      expect(narrow.length < need, 'the rig no longer violates the bound it is demonstrating').toBe(true);
    });
  });
});

describe('data/events: the text on a door is true', () => {
  /** Does `text` name `word` as a whole word ("frost-work" counts, "bowstring" does not)? */
  const names = (text: string, word: string): boolean =>
    new RegExp(`(^|[^a-z])${word}(s|es)?($|[^a-z])`, 'i').test(text);

  it('every guaranteed door names its own type in its LABEL — the only place the player can read it', () => {
    // `choiceOutcomeHint` (src/game/ui/eventOutcomeText.ts) renders an offer's
    // WIDTH ("MINI-DRAFT", "CHOICE OF 3 CARDS"), never its category, so a door
    // whose label doesn't say "sword" is a door with nothing written on it.
    const silent: string[] = [];
    for (let i = 0; i < GUARANTEED.length; i += 1) {
      const d = GUARANTEED[i]!;
      const word = typeWord(guaranteedType(d)!);
      if (!names(d.choice.label, word)) silent.push(`${d.eventId}/${d.choice.id} ("${d.choice.label}") never says "${word}"`);
    }
    expect(silent, `guaranteed doors that don't name their category: ${silent.join('; ')}`).toEqual([]);
  });

  it('and no card-granting label names a type its pool does not deliver on EVERY roll', () => {
    // The other direction, and the one that was a live defect: the old "take a
    // spare blade from the rack" was an eleven-type `offense` pool that paid a
    // sword 13% of the time. A label may stay silent about its category (the
    // broad pools do, and their bodies say so) — it may not name one it cannot
    // keep.
    const lies: string[] = [];
    for (let i = 0; i < DOORS.length; i += 1) {
      const d = DOORS[i]!;
      const guaranteed = guaranteedType(d);
      for (let j = 0; j < TYPES.length; j += 1) {
        const word = typeWord(TYPES[j]!);
        if (!names(d.choice.label, word)) continue;
        if (guaranteed === TYPES[j]!) continue;
        const share = d.pool.filter((s) => typeKeyOf(s) === TYPES[j]!).length;
        lies.push(
          `${d.eventId}/${d.choice.id} ("${d.choice.label}") says "${word}" but only ${share}/${d.pool.length} of its pool is`,
        );
      }
    }
    expect(lies, `labels promising a type they don't guarantee: ${lies.join('; ')}`).toEqual([]);
  });

  it('and the doors deliver it through the real resolver, at every seed, not just on paper', () => {
    const wrong: string[] = [];
    let offersChecked = 0;
    for (let i = 0; i < GUARANTEED.length; i += 1) {
      const d = GUARANTEED[i]!;
      const type = guaranteedType(d)!;
      for (const seed of [1, 4, 9, 17]) {
        const cards = offeredCards(stateAtFirstEvent(seed), d.eventId, d.choice);
        expect(cards.length, `${d.eventId}/${d.choice.id} @seed ${seed} offered nothing`).toBeGreaterThan(0);
        for (let j = 0; j < cards.length; j += 1) {
          offersChecked += 1;
          if (typeKeyOf(cards[j]!) !== type) {
            wrong.push(`${d.eventId}/${d.choice.id} @seed ${seed} offered ${cards[j]!.id} (${typeKeyOf(cards[j]!)}), not ${type}`);
          }
        }
      }
    }
    expect(offersChecked, 'no door offers were inspected').toBeGreaterThan(100);
    expect(wrong, wrong.join('; ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE PAYOFF. Everything above is a property of the catalog; this is the
// question the pass exists to answer, walked over the real run layer.
// ---------------------------------------------------------------------------

describe('the event layer can supply an identity, and reading the doors is what supplies it', () => {
  const SEEDS = 24;
  const THROUGH_WAVE = 10;

  /**
   * Expected same-type cards in one offer from `choice`, in MILLI-cards
   * (integer): `width * ofType * 1000 / pool`. Read off the DECLARED pool —
   * the thing a label describes — never off a rolled result, so this is a model
   * of a player comparing two doors, not of one peeking at the dice. Integer
   * and order-stable, so the walk stays deterministic.
   */
  function declaredMilliYield(choice: EventChoiceDef, type: string, draftWidth: number): number {
    const spec = choice.outcome;
    if (spec.kind === 'grantCard' && spec.cardId) return typeKeyOf(skillBook[spec.cardId]!) === type ? 1000 : 0;
    if (spec.kind !== 'grantCard' && spec.kind !== 'cardChoice' && spec.kind !== 'bonusDraft') return 0;
    const pool = spec.filter ? ALL.filter((s) => cardMatchesFilter(s, spec.filter!)) : ALL;
    if (pool.length === 0) return 0;
    const width = Math.min(spec.kind === 'bonusDraft' ? draftWidth : spec.kind === 'cardChoice' ? EVENT_CHOICE_SIZE : 1, pool.length);
    const ofType = pool.filter((s) => typeKeyOf(s) === type).length;
    return Math.floor((width * ofType * 1000) / pool.length);
  }

  const isCardGranting = (c: EventChoiceDef): boolean =>
    c.outcome.kind === 'grantCard' || c.outcome.kind === 'cardChoice' || c.outcome.kind === 'bonusDraft';

  interface Walk { kept: number; offered: number; events: number; fights: number; waves: number }

  /**
   * One run, committed to `type` from the draft onward, walked to wave
   * `THROUGH_WAVE`. `reads` picks the card choice with the best declared yield
   * for `type`; otherwise the player takes the first card-granting choice it
   * sees. Shops are preferred where a column offers one (their stall is already
   * labelled on the map) — nothing is BOUGHT and no pick is applied: this
   * measures SUPPLY, the same posture affinityReachability.test.ts takes.
   */
  function walk(seed: number, type: string, reads: boolean, draftWidth: number): Walk {
    const out: Walk = { kept: 0, offered: 0, events: 0, fights: 0, waves: 0 };
    const draft = rollStartDraft(seed);
    const picks: Record<string, string> = {};
    for (let i = 0; i < DRAFT_SET_KEYS.length; i += 1) {
      const key = DRAFT_SET_KEYS[i]!;
      const set = draft[key];
      const want = set.find((c) => typeKeyOf(skillBook[c.skillId]!) === type) ?? set[0]!;
      picks[key] = want.skillId;
    }
    let state = applyDraftResult(createRun(seed), picks as never);

    for (let step = 0; step < 400; step += 1) {
      const choices = availableChoices(state);
      if (choices.length === 0) break;
      out.waves = choices[0]!.wave;
      if (out.waves > THROUGH_WAVE) break;
      const node: RunNode = choices.find((n) => n.kind === 'shop')
        ?? choices.find((n) => n.kind === 'event')
        ?? choices.find((n) => n.fightOption === 'standard')
        ?? choices[0]!;
      state = chooseNode(state, node.id);

      if (node.kind === 'shop') {
        rollShopStock(node.shopId!, node.shopSeed!, shopStockDepthForWave(node.wave));
        state = leaveShop(state);
      } else if (node.kind === 'event') {
        const rolled = rollEventForNode(state, node);
        state = rolled.state;
        const usable = rolled.event.choices.filter(
          (c) => isEventChoiceUsable(state, c) && c.outcome.kind !== 'nothing',
        );
        let pick = usable.find(isCardGranting);
        if (reads) {
          let best = -1;
          for (let i = 0; i < usable.length; i += 1) {
            const y = declaredMilliYield(usable[i]!, type, draftWidth);
            if (y > best) { best = y; pick = usable[i]!; }
          }
        }
        if (pick) {
          const resolved = resolveEventChoice(state, rolled.event.id, pick.id);
          let n = 0;
          if (resolved.outcome.kind === 'bonusDraft') {
            n = resolved.outcome.cards.filter((c) => typeKeyOf(skillBook[c.skillId]!) === type).length;
          } else if (resolved.outcome.kind === 'grantCard') {
            n = typeKeyOf(skillBook[resolved.outcome.skillId]!) === type ? 1 : 0;
          }
          out.offered += n;
          if (n > 0) out.kept += 1; // a player keeps ONE card per event, whatever the width
          out.events += 1;
          state = resolved.state;
        }
        state = leaveEvent(state);
      } else {
        const pack = rollEncounter(state);
        const reward = battleGoldReward(
          pack.units.map((u) => ({ level: u.level, title: u.title, rank: u.rank, modifiers: u.modifiers })),
          state.heroLevel,
        );
        state = recordBattleResult(state, { won: true, goldEarned: reward.base + reward.winBonus });
        out.fights += 1;
      }
      if (state.status !== 'active') break;
    }
    return out;
  }

  const DRAFT_WIDTH = (() => {
    const unfiltered = POOL_DRAWS.find((d) => d.kind === 'bonusDraft' && d.filter === undefined)!;
    return offeredCards(stateAtFirstEvent(4), unfiltered.eventId, unfiltered.choice).length;
  })();

  /** Every (type, seed) walk under one policy, tallied per type. */
  function sweep(reads: boolean): { perType: { type: string; kept: number; reached: number; zero: number }[]; events: number; fights: number; waves: number } {
    const perType: { type: string; kept: number; reached: number; zero: number }[] = [];
    let events = 0;
    let fights = 0;
    let waves = 0;
    for (let i = 0; i < TYPES.length; i += 1) {
      const type = TYPES[i]!;
      let kept = 0;
      let reached = 0;
      let zero = 0;
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const w = walk(seed, type, reads, DRAFT_WIDTH);
        kept += w.kept;
        if (w.kept >= IDENTITY_THRESHOLD) reached += 1;
        if (w.kept === 0) zero += 1;
        events += w.events;
        fights += w.fights;
        if (w.waves > waves) waves = w.waves;
      }
      perType.push({ type, kept, reached, zero });
    }
    return { perType, events, fights, waves };
  }

  const READS = sweep(true);
  const BLIND = sweep(false);
  const RUNS = TYPES.length * SEEDS;
  const sum = (rows: { kept: number; reached: number; zero: number }[], f: (r: { kept: number; reached: number; zero: number }) => number): number => {
    let n = 0;
    for (let i = 0; i < rows.length; i += 1) n += f(rows[i]!);
    return n;
  };

  it('the walk actually walked — real events resolved, real fights won, wave 10 reached', () => {
    // Non-vacuity for the whole block. A policy that fell out on the first
    // column would leave every count at 0 and every floor below "passing"
    // against nothing.
    expect(READS.waves, 'never reached the wave the measurement is about').toBeGreaterThanOrEqual(THROUGH_WAVE);
    expect(READS.events, 'no event choice was ever resolved').toBeGreaterThan(4 * RUNS);
    expect(READS.fights, 'no fight was ever resolved, so no run economy was exercised').toBeGreaterThan(RUNS);
    expect(BLIND.events, 'the control policy resolved no events').toBeGreaterThan(4 * RUNS);
  });

  it('READING the doors beats ignoring them — before this pass the two were identical', () => {
    // THE MEASUREMENT THE PASS EXISTS FOR. Walked at 60 seeds/type over the
    // real run layer, BEFORE the 2026-08-26 door pass: a player who read every
    // label kept 2.64 same-type cards from events and a player who ignored them
    // kept 2.64 — the same number to two decimals, per type, because not one
    // card-granting choice in the catalog carried a type the label could have
    // named. AFTER: 2.91 reading versus 1.67 ignoring, and runs where the
    // events alone handed over an identity (3+) went 48% -> 56% while runs where
    // they handed over NONE of the committed type went 8% -> 4%.
    //
    // This assertion is the invariant that survives those numbers moving: the
    // event layer must reward reading it. It failed on the pre-pass catalog by
    // construction (equal), and it fails again the moment the doors are widened
    // back into undifferentiated pools.
    const keptReading = sum(READS.perType, (r) => r.kept);
    const keptBlind = sum(BLIND.perType, (r) => r.kept);
    expect(keptReading, `reading ${keptReading} vs ignoring ${keptBlind} over ${RUNS} runs`).toBeGreaterThan(keptBlind);
    // Not by a rounding error, either: a tenth of a card per run of daylight.
    expect((keptReading - keptBlind) * 10).toBeGreaterThan(RUNS);
  });

  it('every card type gets at least one same-type card per run out of the events alone', () => {
    // The floor a type falls through when its door is deleted or diluted: with
    // no door and no broad pool carrying it, a committed player's events pay
    // them nothing. Integer comparison — `kept` summed over `SEEDS` runs.
    const starved: string[] = [];
    for (let i = 0; i < READS.perType.length; i += 1) {
      const row = READS.perType[i]!;
      if (row.kept < SEEDS) starved.push(`${row.type}: ${row.kept} cards over ${SEEDS} runs`);
    }
    expect(starved, `types the event layer starves: ${starved.join(', ')}`).toEqual([]);
  });

  it('and a committed player is rarely shut out entirely: fewer than 1 run in 5 gets NOTHING of its type', () => {
    // The cost side of P23, pinned. Narrowing pools without keeping the broad
    // ones beside them drove this from 8% to 15% in a discarded first cut of
    // the pass (measured at 60 seeds/type over the same walk); it is the number
    // that says the doors were added beside the breadth, not swapped in for it.
    const zero = sum(READS.perType, (r) => r.zero);
    expect(zero * 5, `${zero} of ${RUNS} runs got no card of the committed type from events`).toBeLessThan(RUNS);
  });

  it('for a third of runs or more, the events alone hand over a whole identity', () => {
    const reached = sum(READS.perType, (r) => r.reached);
    expect(reached * 3, `only ${reached} of ${RUNS} runs reached ${IDENTITY_THRESHOLD} same-type cards from events`)
      .toBeGreaterThanOrEqual(RUNS);
  });
});
