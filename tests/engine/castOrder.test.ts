import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { applyTier, GEM_ACTION_PHASE, resolveEffectiveSkill } from '../../src/engine/cards';
import { KEYWORD_PRICING } from '../../src/engine/balance';
import type { Action, SkillTier } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * THE CAST ORDER RULE — within one cast, every HIT resolves before every RIDER.
 *
 * USER-LOCKED 2026-08-31, verbatim: *"I think gems or card affect should be
 * clear when it happens and debuff usually should happen at the end so any
 * attack always come first before applying their debuff effect if it applies
 * one"*, and, on whether a DoT is in scope: *"like if attack cause bleed or
 * poison the attack happens first then bleed or poison get applied"*.
 *
 * IT IS A BALANCE CHANGE, NOT A BUG FIX, and a nerf where it bites. Before it,
 * `judgment_light` at Diamond read `hit 27 -DEF10 / MDEF -20% / hit 32 -DEF8` —
 * its second hit cashing in the debuff its first hit bought. `GEM_ACTION_PHASE`
 * (src/engine/cards.ts) had already written down that this was a live question
 * and not an ordering defect ("that is a balance change, not an ordering
 * defect"); this is the ruling that answered it.
 *
 * ENFORCED AT THE RESOLVER SEAM, once, for all three assembly routes: authored
 * effects, a `tierUpgrades` override, and a gem splice (`orderCastRiders`,
 * src/engine/cards.ts). Nothing in `applyCast` or the interpreter loop knows the
 * rule exists — see CLAUDE.md, "Additive features — the resolver seam".
 *
 * WHAT COUNTS AS A RIDER IS DERIVED, never hand-listed: `pre`-phase kinds
 * PREPARE the hit and never move; `isHit` kinds ARE the hit; `offensive` is what
 * separates a rider the cast lands on the TARGET from a self-buff the caster
 * gives itself. The two named exceptions are `splash` (applies nothing, read
 * cast-scoped) and `lifesteal` (caster-side, but a sink reading
 * `cast.damageDealt` — the 2026-08-26 rule this one absorbs).
 *
 * DAMAGE AND DEFENSE ARE READ OUT OF THE EVENT LOG (`calculation.defense` /
 * `calculation.hpDamage` / `calculation.exposeBonus` — the same numbers
 * `scripts/logFormat.ts` prints), never recomputed from the card, for the reason
 * 566bea1 gives: a test that re-derives its own expectation cannot catch a cast
 * that read the wrong intermediate state.
 */

const TIERS: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

/** The RESOLVED effect kinds of one piece, at one tier, optionally gemmed. */
function resolvedKinds(id: string, tier: SkillTier, gemId?: string): string[] {
  const gem = gemId === undefined ? undefined : gemBook[gemId]!;
  return resolveEffectiveSkill(skillBook[id]!, { skillId: id, slot: 0, tier, ...(gem ? { gem } : {}) })
    .effects.map((a) => a.kind);
}

/** Index of the last hit in a kind list, or -1. */
function lastHitIndex(kinds: readonly string[]): number {
  let last = -1;
  kinds.forEach((k, i) => { if (KEYWORD_PRICING[k as Action['kind']].isHit) last = i; });
  return last;
}

/**
 * The rider kinds sitting AHEAD of the last hit — i.e. the rule's violations.
 * Derived from the same three tables the resolver reads, so this assertion
 * cannot drift from the implementation's idea of what a rider is; the point of
 * the sweep is that the ANSWER is "none", on every kit in the book.
 */
function isRider(kind: Action['kind']): boolean {
  if (GEM_ACTION_PHASE[kind] === 'pre') return false;      // PREPARES the hit
  if (KEYWORD_PRICING[kind].isHit) return false;           // IS the hit
  if (kind === 'splash') return false;                     // applies nothing, cast-scoped
  if (kind === 'lifesteal') return true;                   // caster-side sink (566bea1)
  return KEYWORD_PRICING[kind].offensive;                  // landed on the target
}

function ridersAheadOfHits(kinds: readonly string[]): string[] {
  const last = lastHitIndex(kinds);
  if (last < 0) return [];
  const bad: string[] = [];
  for (let i = 0; i < last; i += 1) {
    const k = kinds[i] as Action['kind'];
    if (isRider(k)) bad.push(`${k}@${i}`);
  }
  return bad;
}

describe('cast order: every hit resolves before every rider', () => {
  it('THE SWEEP — no shipped kit, at any of the four tiers, lands a rider ahead of a hit', () => {
    const violations: string[] = [];
    let kitsWithAHit = 0;
    for (const id of Object.keys(skillBook)) {
      for (const tier of TIERS) {
        const kinds = resolvedKinds(id, tier);
        if (lastHitIndex(kinds) < 0) continue;
        kitsWithAHit += 1;
        const bad = ridersAheadOfHits(kinds);
        if (bad.length > 0) violations.push(`${id}@${tier}: ${bad.join(', ')} ahead of the hit — [${kinds.join(', ')}]`);
      }
    }
    expect(violations, `a rider resolves ahead of a hit:\n${violations.join('\n')}`).toEqual([]);
    // NON-VACUITY: a book with no attacking kits would pass the loop above.
    expect(kitsWithAHit, 'the sweep must actually have swept attacking kits').toBeGreaterThan(300);
  });

  it('...and it is NOT vacuous — these are the exact kits the resolver reorders', () => {
    // Every (card, tier) whose RESOLVED order differs from the order the content
    // authored at that rank. `applyTier` is the "before" side — the same tier and
    // TIER-LOCK resolution the normalizer runs on top of — so this comparison can
    // only ever disagree about ORDER, never about which lines exist.
    //
    // Pinned as a literal so the sweep above cannot pass because the normalizer
    // quietly stopped normalizing, and so that authoring a card that needs
    // reordering is a visible, reviewed event rather than a silent one.
    const reordered: string[] = [];
    for (const id of Object.keys(skillBook)) {
      for (const tier of TIERS) {
        const authored = applyTier(skillBook[id]!, tier).effects.map((a) => a.kind).join(',');
        if (authored !== resolvedKinds(id, tier).join(',')) reordered.push(`${id}@${tier}`);
      }
    }
    expect(reordered.sort()).toEqual([
      'armor_break@diamond', 'armor_break@gold', 'armor_break@silver',
      'barbed_rampart@bronze', 'barbed_rampart@diamond', 'barbed_rampart@gold', 'barbed_rampart@silver',
      'crippling_gore@bronze', 'crippling_gore@diamond', 'crippling_gore@gold', 'crippling_gore@silver',
      'disarming_blow@diamond', 'disarming_blow@gold', 'disarming_blow@silver',
      'gutting_cleave@bronze', 'gutting_cleave@diamond', 'gutting_cleave@gold', 'gutting_cleave@silver',
      'hemorrhage@bronze', 'hemorrhage@diamond', 'hemorrhage@gold', 'hemorrhage@silver',
      'hex_of_frailty@diamond', 'hex_of_frailty@gold', 'hex_of_frailty@silver',
      'judgment_light@diamond',
      'leeching_fang@diamond',
      'mind_frost@diamond', 'mind_frost@gold', 'mind_frost@silver',
      'ruinous_hex@diamond', 'ruinous_hex@gold', 'ruinous_hex@silver',
      'stunning_smash@diamond', 'stunning_smash@gold', 'stunning_smash@silver',
      'sundering_roar@bronze', 'sundering_roar@diamond', 'sundering_roar@gold', 'sundering_roar@silver',
      'umbral_ward@diamond', 'umbral_ward@gold', 'umbral_ward@silver',
    ].sort());
  });

  it('THE KNOWN CASE — judgment_light@diamond authors a debuff BETWEEN its two hits', () => {
    // The card the ruling was made on, stated as the two orders.
    expect(skillBook['judgment_light']!.effects.map((a) => a.kind)).toEqual(['damage', 'debuffStat', 'damage']);
    expect(resolvedKinds('judgment_light', 'diamond')).toEqual(['damage', 'damage', 'debuffStat']);
    // ...and the content was deliberately NOT re-authored: the resolver is the
    // one normalizer, so a future card written the same way is fixed for free.
    expect(skillBook['judgment_light']!.effects[1]!.kind, 'authored order is untouched on purpose').toBe('debuffStat');
  });

  it('SELF-BUFFS AND `pre` ARMS DO NOT MOVE — the ruling was about debuffs', () => {
    // The class boundary, asserted as the cards that sit on the other side of it.
    // A future widening of the rule to self-buffs (the mirror ruling, not made)
    // would fail here rather than sliding in unnoticed.
    const staysFirst: Record<string, string> = {
      braced_pike: 'guard',        // self guard, ahead of its own lunge
      impaling_charge: 'guard',
      storm_surge: 'buffStat',     // self buff, so its own hit swings buffed
      thunder_step: 'buffStat',
      bramblewrath: 'thorns',      // self reflect pile
      iron_riposte: 'negate',      // self denial charge
      verdant_rebuke: 'ward',      // self ward charge
      shield_splitter: 'shieldBreak',  // PREPARES the hit
      piercing_reach: 'shieldBreak',
      follow_through: 'comboBonus',    // ARMS the hit
      thermal_shock: 'chainBonus',
      second_bite: 'exploit',
      thorn_reckoning: 'stackBonus',
      deadweight_toll: 'taxBonus',
      cornered_beast: 'desperation',
      aegis_charge: 'shieldBurst',
      vow_broken: 'wardRelease',
    };
    for (const [id, firstKind] of Object.entries(staysFirst)) {
      for (const tier of TIERS) {
        const kinds = resolvedKinds(id, tier);
        if (!kinds.includes(firstKind)) continue;   // tier-locked away at this rank
        if (lastHitIndex(kinds) < 0) continue;      // ...or the hit itself is (iron_riposte@bronze)
        expect(kinds[0], `${id}@${tier} must still open with ${firstKind}`).toBe(firstKind);
        expect(kinds.indexOf(firstKind), `${id}@${tier}: ${firstKind} must stay ahead of the hit`)
          .toBeLessThan(lastHitIndex(kinds));
      }
    }
  });

  it('A CARD CAN HAVE BOTH — barbed_rampart keeps its guard first and sends its bleed last', () => {
    // The single clearest proof that the normalizer moves the rider and NOTHING
    // else: one card, two non-damage lines, exactly one of them relocated.
    expect(skillBook['barbed_rampart']!.effects.map((a) => a.kind)).toEqual(['bleed', 'guard', 'damage']);
    expect(resolvedKinds('barbed_rampart', 'bronze')).toEqual(['guard', 'damage', 'bleed']);
  });

  it('AN ORDERED KIT COMES BACK BY REFERENCE (the byte-identical contract)', () => {
    // What keeps "an un-featured piece resolves to the same def" true, and with
    // it every frozen baseline. Asserted on identity, not on value.
    for (const id of ['sword_slash', 'second_bite', 'thorn_reckoning', 'braced_pike', 'siphon_life']) {
      expect(resolveEffectiveSkill(skillBook[id]!, { skillId: id, slot: 0 }), id).toBe(skillBook[id]!);
    }
  });
});

describe('cast order: gems go through the same one rule', () => {
  it('A GEM-APPLIED RIDER TRAILS every hit of the host — whole book x every effect gem x 4 tiers', () => {
    const violations: string[] = [];
    let combos = 0;
    for (const id of Object.keys(skillBook)) {
      for (const gemId of Object.keys(gemBook)) {
        if (gemBook[gemId]!.kind !== 'effect') continue;
        for (const tier of TIERS) {
          const kinds = resolvedKinds(id, tier, gemId);
          if (lastHitIndex(kinds) < 0) continue;
          combos += 1;
          const bad = ridersAheadOfHits(kinds);
          if (bad.length > 0) violations.push(`${id}@${tier} + ${gemId}: ${bad.join(', ')} — [${kinds.join(', ')}]`);
        }
      }
    }
    expect(violations.slice(0, 10), `a gemmed kit lands a rider ahead of a hit:\n${violations.slice(0, 10).join('\n')}`).toEqual([]);
    expect(violations.length).toBe(0);
    expect(combos, 'the gem sweep must actually have swept').toBeGreaterThan(10000);
  });

  it('A GEM HIT RE-ANCHORS THE HOST\'S OWN RIDER — resonant_echo pushes a trailing bleed further back', () => {
    // The case that is UNREACHABLE without a gem, and the reason the anchor is
    // "the last hit" rather than "the last authored damage": `resonant_echo`
    // splices a `statStrike` at `post`, i.e. behind everything the host wrote —
    // including the host's own bleed. The rider has to move again.
    expect(gemBook['resonant_echo']!.kind).toBe('effect');
    expect(resolvedKinds('hemorrhage', 'bronze')).toEqual(['damage', 'bleed']);
    expect(resolvedKinds('hemorrhage', 'bronze', 'resonant_echo')).toEqual(['damage', 'statStrike', 'bleed']);
    // ...and the same for a leech, which is what makes this rule a superset of
    // the 2026-08-26 lifesteal one rather than a second pass beside it.
    expect(resolvedKinds('verdant_rebuke', 'gold')).toEqual(['ward', 'damage', 'lifesteal']);
    expect(resolvedKinds('verdant_rebuke', 'gold', 'resonant_echo')).toEqual(['ward', 'damage', 'statStrike', 'lifesteal']);
  });

  it('A GEM DEBUFF AND THE CARD\'S OWN DEBUFF LAND TOGETHER, behind both hits', () => {
    // `judgment_light_echo` is a `debuffStat` gem on its own host: before the
    // ruling the card's debuff sat between the two hits and the gem's behind
    // them, so the same keyword resolved in two different places in one cast.
    expect(resolvedKinds('judgment_light', 'diamond', 'judgment_light_echo'))
      .toEqual(['damage', 'damage', 'debuffStat', 'debuffStat']);
  });

  it('THE `pre` ARMS SURVIVE THE GEM PATH TOO — no rider is ever pushed behind the action it feeds', () => {
    // The interlock with THE RIDER ORDERING RULE (`rejectRiderMisordering`,
    // src/data/validateSkillContent.ts): that rule is checked on AUTHORED order,
    // so if the normalizer could move a conditional rider behind the `damage`/
    // `heal` it arms, a validated card would still ship a priced no-op. It cannot
    // — every such rider is `pre` — and this sweeps the whole gemmed book to say so.
    const armers = new Set<Action['kind']>([
      'comboBonus', 'chainBonus', 'exploit', 'stackBonus', 'taxBonus',
      'desperation', 'shieldBurst', 'wardRelease', 'overhealShield', 'cleanseConvert', 'shieldBreak',
    ]);
    const broken: string[] = [];
    for (const id of Object.keys(skillBook)) {
      for (const gemId of ['', ...Object.keys(gemBook).filter((g) => gemBook[g]!.kind === 'effect')]) {
        for (const tier of TIERS) {
          const kinds = resolvedKinds(id, tier, gemId === '' ? undefined : gemId);
          const last = lastHitIndex(kinds);
          if (last < 0) continue;
          kinds.forEach((k, i) => {
            if (armers.has(k as Action['kind']) && i > last) {
              broken.push(`${id}@${tier}${gemId ? ' + ' + gemId : ''}: ${k} at ${i} is behind the last hit at ${last}`);
            }
          });
        }
      }
    }
    expect(broken.slice(0, 10)).toEqual([]);
  });
});

/**
 * THE RULING, SEEN IN THE COMBAT LOG — not in the resolved kind list.
 *
 * A reordered array is only evidence about the resolver; these read the event
 * stream `npm run fight` prints, so they are evidence about the FIGHT.
 */
describe('cast order: what the combat log shows', () => {
  /** One passive wall, so the log is one card's behaviour and nothing else. */
  function oneCast(pieces: { skillId: string; slot: number; tier?: SkillTier }[], seed = 5) {
    const c = cfg(
      tc('hero', [], { maxHp: 30000, hp: 30000, speed: 30 }, { pieces, boardSize: 10 }),
      tc('wall', ['sword_slash'], { maxHp: 30000, hp: 30000, attack: 1, speed: 1, armor: 20, magicResist: 6 }),
      { ...NO_ENDGAME, maxTurns: 4 },
    );
    const shape: string[] = [];
    const defenses: number[] = [];
    const exposeBonuses: number[] = [];
    const hp: number[] = [];
    let seen = false;
    const first = pieces[0]!.skillId;
    for (const e of simulate(c, seed).events) {
      if (e.kind === 'play' && e.side === 'player') {
        if (seen) break;
        if (e.skillId === first) seen = true;
        continue;
      }
      if (!seen) continue;
      // A `statusApplied` event carries no `sourceCard` (only damage/heal do), so
      // the window between the `play` and the caster's next play IS the filter —
      // which is also why the wall is passive, slow and holds one harmless card.
      if (e.kind === 'damage' && e.calculation) {
        if ((e as { sourceCard?: { skillId: string } }).sourceCard?.skillId !== first) continue;
        shape.push('damage');
        defenses.push(e.calculation.defense);
        exposeBonuses.push(e.calculation.exposeBonus ?? 0);
        hp.push(e.calculation.hpDamage);
      }
      if (e.kind === 'statusApplied' && e.side === 'enemy') shape.push(e.status);
    }
    return { shape, defenses, exposeBonuses, hp };
  }

  it('judgment_light@diamond: BOTH hits eat the same MDEF, and the debuff lands after them', () => {
    const cast = oneCast([
      { skillId: 'judgment_light', slot: 0, tier: 'diamond' },
      { skillId: 'purging_strike', slot: 1 },
      { skillId: 'purify', slot: 2 },
    ]);
    expect(cast.shape, 'all damage, then the rider').toEqual(['damage', 'damage', 'debuff']);
    expect(cast.defenses.length, 'the affinity hit must actually have fired').toBe(2);
    // THE REGRESSION, stated as the number it confused: before the ruling the
    // second hit met a REDUCED defense (its own debuff, already applied).
    expect(cast.defenses[1], 'the second hit must not benefit from its own debuff')
      .toBe(cast.defenses[0]);
    expect(cast.defenses[0]).toBeGreaterThan(0);
  });

  it('ruinous_hex: its own expose no longer amplifies its own hit', () => {
    const cast = oneCast([{ skillId: 'ruinous_hex', slot: 0, tier: 'diamond' }]);
    expect(cast.shape).toEqual(['damage', 'expose']);
    expect(cast.exposeBonuses[0], 'the hit predates the expose it applies').toBe(0);
  });

  it('hemorrhage: the attack happens first, then the bleed gets applied (the user\'s own example)', () => {
    const cast = oneCast([{ skillId: 'hemorrhage', slot: 0 }]);
    expect(cast.shape).toEqual(['damage', 'bleed']);
  });

  it('crippling_gore: the lance eats FULL armor, then bleed and debuff both land', () => {
    const cast = oneCast([{ skillId: 'crippling_gore', slot: 0 }]);
    expect(cast.shape).toEqual(['damage', 'bleed', 'debuff']);
    expect(cast.defenses[0], 'full armor 20, not the 12 its own -40% would leave').toBe(20);
  });

  it('sundering_roar: `shieldBreak` still PREPARES the hit — only expose and bleed moved', () => {
    const cast = oneCast([{ skillId: 'sundering_roar', slot: 0 }]);
    expect(cast.shape).toEqual(['damage', 'expose', 'bleed']);
    expect(cast.exposeBonuses[0], 'the roar no longer amplifies itself').toBe(0);
  });

  it('second_bite is UNTOUCHED — an exploiter still cannot trigger the poison it applies', () => {
    // The interlock the ruling could most easily have broken: `second_bite` pays
    // the FULL flat rate (`selfSynergyPremiumDeci`) precisely because its bonus
    // is guaranteed only from the SECOND cast. Its `exploit` is a `pre` arm, so
    // the normalizer never touches it; the first bite still finds a clean target.
    expect(resolvedKinds('second_bite', 'diamond')).toEqual(['exploit', 'damage', 'poison']);
    const c = cfg(
      tc('hero', [], { maxHp: 30000, hp: 30000, speed: 30 }, { pieces: [{ skillId: 'second_bite', slot: 0, tier: 'diamond' }], boardSize: 10 }),
      tc('wall', ['sword_slash'], { maxHp: 30000, hp: 30000, attack: 1, speed: 1, armor: 4 }),
      { ...NO_ENDGAME, maxTurns: 12 },
    );
    const bonuses: number[] = [];
    for (const e of simulate(c, 5).events) {
      if (e.kind !== 'damage' || !e.calculation) continue;
      if ((e as { sourceCard?: { skillId: string } }).sourceCard?.skillId !== 'second_bite') continue;
      bonuses.push(e.calculation.effectBonusDamage);
    }
    expect(bonuses.length, 'the bite must land at least twice').toBeGreaterThan(1);
    expect(bonuses[0], 'the first bite finds no poison — it applies it AFTER').toBe(0);
    expect(bonuses[1], 'the second bite collects, exactly as the face promises').toBeGreaterThan(0);
  });
});
