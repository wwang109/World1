import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { applyTier, GEM_ACTION_PHASE, resolveEffectiveSkill } from '../../src/engine/cards';
import { KEYWORD_PRICING } from '../../src/engine/balance';
import type { Action, SkillTier } from '../../src/engine/types';
import { cfg, tc, NO_ENDGAME } from '../helpers';

/**
 * THE CAST ORDER RULE — SETUP BEFORE THE ATTACK, AFTERMATH BEHIND IT.
 *
 * USER-LOCKED 2026-08-31, in two passes. The first ruling was general: *"I think
 * gems or card affect should be clear when it happens and debuff usually should
 * happen at the end so any attack always come first before applying their debuff
 * effect if it applies one"*. It was REFINED the same day, verbatim: *"maybe we
 * should split the type of debuff like posion/bleed/burn are after attacks but
 * stats debuff/buff are applied before the atk"* — and, asked whether a card's own
 * stat debuff should therefore amplify its OWN hit, the user answered YES.
 *
 * So there are TWO classes, not one:
 *
 *   • AFTERMATH — `poison`/`bleed`/`burn`, plus the `lifesteal` sink. What the
 *     attack LEAVES BEHIND. It trails every hit of the cast. THIS is what moves.
 *   • SETUP — stat debuffs and buffs, and every control/guard/ward/heal line
 *     beside them. What the attack is BUILT ON. It stays exactly where the card
 *     authored it, so a card's own `debuffStat`/`expose` amplifies its own later
 *     hits again.
 *
 * IT IS A BALANCE DECISION, NOT A BUG FIX, in both directions. `judgment_light`
 * at Diamond reads `hit 27 -DEF6 / MDEF -20% / hit 32 -DEF4` — its second hit
 * cashing in the debuff its first hit bought. The one-class rule briefly made that
 * `hit 27 -DEF6 / hit 32 -DEF6 / MDEF -20%`; the refinement put it back, and the
 * user was shown both numbers and chose this one.
 *
 * ENFORCED AT THE RESOLVER SEAM, once, for all three assembly routes: authored
 * effects, a `tierUpgrades` override, and a gem splice (`orderCastRiders`,
 * src/engine/cards.ts). Nothing in `applyCast` or the interpreter loop knows the
 * rule exists — see CLAUDE.md, "Additive features — the resolver seam".
 *
 * WHICH CLASS A KIND IS IN IS DERIVED, never hand-listed: `isHit` kinds and
 * `pre`-phase kinds are the ANCHOR (they ARE the attack, or they PREPARE one and
 * behind it would be DELETED rather than delayed); `family === 'dot'` is the
 * AFTERMATH class exactly; everything else is SETUP. `lifesteal` is the one named
 * member — caster-side, but a sink reading `cast.damageDealt`, the 2026-08-26
 * rule (566bea1) this one absorbs. `splash` needs no exception any more: it is
 * `family: 'control'`, so the derivation leaves it alone by itself.
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
 * THE CLASSIFICATION, re-derived here from the same exhaustive tables the
 * resolver reads, so an assertion cannot drift from the implementation's idea of
 * what an aftermath rider is — and pinned as a literal partition below, so a
 * changed `family` or a new `Action` kind is a visible, reviewed event.
 */
type CastPhase = 'anchor' | 'setup' | 'aftermath';

function phaseOf(kind: Action['kind']): CastPhase {
  if (GEM_ACTION_PHASE[kind] === 'pre') return 'anchor';   // PREPARES the hit
  if (KEYWORD_PRICING[kind].isHit) return 'anchor';        // IS the hit
  if (KEYWORD_PRICING[kind].family === 'dot') return 'aftermath';
  if (kind === 'lifesteal') return 'aftermath';            // caster-side sink (566bea1)
  return 'setup';
}

/** The AFTERMATH riders sitting AHEAD of the last hit — i.e. the rule's violations. */
function aftermathAheadOfHits(kinds: readonly string[]): string[] {
  const last = lastHitIndex(kinds);
  if (last < 0) return [];
  const bad: string[] = [];
  for (let i = 0; i < last; i += 1) {
    const k = kinds[i] as Action['kind'];
    if (phaseOf(k) === 'aftermath') bad.push(`${k}@${i}`);
  }
  return bad;
}

/** The kit with every aftermath line removed — what the rule must NOT have touched. */
function withoutAftermath(kinds: readonly string[]): string[] {
  return kinds.filter((k) => phaseOf(k as Action['kind']) !== 'aftermath');
}

describe('cast order: the two classes', () => {
  it('THE PARTITION — every Action kind is anchor, setup or aftermath, and the split is the ruling', () => {
    // Pinned as a literal because the derivation reads `family`, and `family` is
    // a PRICING field: someone re-homing a keyword's cap family would silently
    // move it between classes. Here that is a failing test with a name on it.
    const byPhase: Record<CastPhase, string[]> = { anchor: [], setup: [], aftermath: [] };
    for (const kind of Object.keys(KEYWORD_PRICING) as Action['kind'][]) byPhase[phaseOf(kind)].push(kind);
    for (const list of Object.values(byPhase)) list.sort();

    // "posion/bleed/burn are after attacks" — plus the one caster-side sink.
    expect(byPhase.aftermath).toEqual(['bleed', 'burn', 'lifesteal', 'poison']);
    // "stats debuff/buff are applied before the atk" — and everything that is
    // neither a DoT nor part of the attack sits with them.
    expect(byPhase.setup).toEqual([
      'attunedShield', 'buffStat', 'burden', 'cleanse', 'curse', 'debuffStat',
      'disrupt', 'empowerNext', 'expose', 'guard', 'heal', 'negate', 'shield',
      'slow', 'splash', 'stun', 'taunt', 'thorns', 'ward',
    ]);
    expect(byPhase.anchor).toEqual([
      'chainBonus', 'cleanseConvert', 'comboBonus', 'damage', 'desperation',
      'exploit', 'overhealShield', 'shieldBreak', 'shieldBurst', 'stackBonus',
      'statStrike', 'taxBonus', 'wardRelease',
    ]);
    // ...and the partition is total: no kind is unclassified or double-counted.
    expect(byPhase.anchor.length + byPhase.setup.length + byPhase.aftermath.length)
      .toBe(Object.keys(KEYWORD_PRICING).length);
  });

  it('THE NAMED CASES — the four kinds the user ruled on land where they were ruled', () => {
    // The user's own words, as four assertions, so the rule cannot drift away
    // from the sentence it came from.
    expect(phaseOf('poison')).toBe('aftermath');
    expect(phaseOf('bleed')).toBe('aftermath');
    expect(phaseOf('burn')).toBe('aftermath');
    expect(phaseOf('debuffStat')).toBe('setup');
    expect(phaseOf('buffStat')).toBe('setup');
    // `expose` is a damage AMPLIFIER, so it reads as a stat debuff and NOT as a
    // DoT — the reading `ruinous_hex`'s and `sundering_roar`'s confirmed numbers
    // require (both amplify their own hit again).
    expect(phaseOf('expose')).toBe('setup');
    // Control changes the victim's FUTURE tempo and no term of this cast, so it
    // is not aftermath either; it stays where the card authored it.
    for (const k of ['stun', 'slow', 'burden', 'curse', 'disrupt'] as Action['kind'][]) {
      expect(phaseOf(k), `${k} is control, not a DoT`).toBe('setup');
    }
    // `shieldBreak` OPENS the plating for the hit — setup in the user's sense and
    // a `pre` arm in the engine's, so both readings keep it ahead of the hit.
    expect(phaseOf('shieldBreak')).toBe('anchor');
    expect(GEM_ACTION_PHASE['shieldBreak']).toBe('pre');
  });
});

describe('cast order: aftermath trails every hit', () => {
  it('THE SWEEP — no shipped kit, at any of the four tiers, lands a DoT or leech ahead of a hit', () => {
    const violations: string[] = [];
    let kitsWithAHit = 0;
    for (const id of Object.keys(skillBook)) {
      for (const tier of TIERS) {
        const kinds = resolvedKinds(id, tier);
        if (lastHitIndex(kinds) < 0) continue;
        kitsWithAHit += 1;
        const bad = aftermathAheadOfHits(kinds);
        if (bad.length > 0) violations.push(`${id}@${tier}: ${bad.join(', ')} ahead of the hit — [${kinds.join(', ')}]`);
      }
    }
    expect(violations, `an aftermath rider resolves ahead of a hit:\n${violations.join('\n')}`).toEqual([]);
    // NON-VACUITY: a book with no attacking kits would pass the loop above.
    expect(kitsWithAHit, 'the sweep must actually have swept attacking kits').toBeGreaterThan(300);
  });

  it('THE OTHER HALF OF THE SPLIT — no SETUP line is ever moved, whole book x 4 tiers', () => {
    // The regression the refinement exists to prevent, stated positively: strip
    // the aftermath lines out of both the authored kit and the resolved one, and
    // what is left must be IDENTICAL, in order. So a stat debuff, an expose, a
    // stun, a self-buff and a guard all resolve exactly where the card wrote
    // them — including ahead of the card's own later hits, which is the
    // self-amplification the user confirmed.
    const moved: string[] = [];
    for (const id of Object.keys(skillBook)) {
      for (const tier of TIERS) {
        const authored = withoutAftermath(applyTier(skillBook[id]!, tier).effects.map((a) => a.kind));
        const resolved = withoutAftermath(resolvedKinds(id, tier));
        if (authored.join(',') !== resolved.join(',')) {
          moved.push(`${id}@${tier}: [${authored.join(',')}] -> [${resolved.join(',')}]`);
        }
      }
    }
    expect(moved, `a setup line was moved:\n${moved.join('\n')}`).toEqual([]);
  });

  it('...and it is NOT vacuous — these are the exact kits the resolver reorders', () => {
    // Every (card, tier) whose RESOLVED order differs from the order the content
    // authored at that rank. `applyTier` is the "before" side — the same tier and
    // TIER-LOCK resolution the normalizer runs on top of — so this comparison can
    // only ever disagree about ORDER, never about which lines exist.
    //
    // Pinned as a literal so the sweep above cannot pass because the normalizer
    // quietly stopped normalizing, and so that authoring a card that needs
    // reordering is a visible, reviewed event rather than a silent one. Under the
    // one-class rule this list held 43 kits across 13 cards; the refinement cut it
    // to the DoT carriers and the one leech, and every kit that left the list is a
    // stat/control line put back where its card authored it.
    const reordered: string[] = [];
    for (const id of Object.keys(skillBook)) {
      for (const tier of TIERS) {
        const authored = applyTier(skillBook[id]!, tier).effects.map((a) => a.kind).join(',');
        if (authored !== resolvedKinds(id, tier).join(',')) reordered.push(`${id}@${tier}`);
      }
    }
    expect(reordered.sort()).toEqual([
      'barbed_rampart@bronze', 'barbed_rampart@diamond', 'barbed_rampart@gold', 'barbed_rampart@silver',
      'crippling_gore@bronze', 'crippling_gore@diamond', 'crippling_gore@gold', 'crippling_gore@silver',
      'gutting_cleave@bronze', 'gutting_cleave@diamond', 'gutting_cleave@gold', 'gutting_cleave@silver',
      'hemorrhage@bronze', 'hemorrhage@diamond', 'hemorrhage@gold', 'hemorrhage@silver',
      'leeching_fang@diamond',
      'sundering_roar@bronze', 'sundering_roar@diamond', 'sundering_roar@gold', 'sundering_roar@silver',
    ].sort());
  });

  it('THE KNOWN CASE — judgment_light@diamond keeps its debuff BETWEEN its two hits', () => {
    // The card the whole ruling was argued on, stated as the two orders — which
    // under the refinement are the SAME order. Its second hit is meant to cash in
    // the debuff its first hit bought ("stats debuff/buff are applied before the
    // atk", plus the user's explicit YES on self-amplification).
    expect(skillBook['judgment_light']!.effects.map((a) => a.kind)).toEqual(['damage', 'debuffStat', 'damage']);
    expect(resolvedKinds('judgment_light', 'diamond')).toEqual(['damage', 'debuffStat', 'damage']);
  });

  it('SELF-BUFFS AND `pre` ARMS DO NOT MOVE — and now neither do stat debuffs', () => {
    // The class boundary, asserted as the cards that sit on the other side of it.
    // The bottom block is what the refinement restored: under the one-class rule
    // every one of those `debuffStat`/`expose`/`stun` openers was pushed behind
    // the hit, and this case is what fails if that ever comes back.
    const staysFirst: Record<string, string> = {
      braced_pike: 'guard',        // self guard, ahead of its own lunge
      impaling_charge: 'guard',
      storm_surge: 'buffStat',     // self buff, so its own hit swings buffed
      thunder_step: 'buffStat',
      battle_howl: 'buffStat',
      bramblewrath: 'thorns',      // self reflect pile
      iron_riposte: 'negate',      // self denial charge
      verdant_rebuke: 'ward',      // self ward charge
      shield_splitter: 'shieldBreak',  // PREPARES the hit
      piercing_reach: 'shieldBreak',
      gutting_cleave: 'shieldBreak',
      sundering_roar: 'shieldBreak',
      follow_through: 'comboBonus',    // ARMS the hit
      thermal_shock: 'chainBonus',
      second_bite: 'exploit',
      thorn_reckoning: 'stackBonus',
      deadweight_toll: 'taxBonus',
      cornered_beast: 'desperation',
      aegis_charge: 'shieldBurst',
      vow_broken: 'wardRelease',
      // SETUP, restored by the 2026-08-31 refinement — the stat/control openers.
      armor_break: 'debuffStat',
      hex_of_frailty: 'debuffStat',
      mind_frost: 'debuffStat',
      disarming_blow: 'debuffStat',
      ruinous_hex: 'expose',
      stunning_smash: 'stun',
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
    // One card, two non-damage lines, exactly one of them relocated.
    expect(skillBook['barbed_rampart']!.effects.map((a) => a.kind)).toEqual(['bleed', 'guard', 'damage']);
    expect(resolvedKinds('barbed_rampart', 'bronze')).toEqual(['guard', 'damage', 'bleed']);
  });

  it('THE MIXED CARD — crippling_gore splits a DoT and a stat debuff around its own lance', () => {
    // THE proof the split is real rather than a relabelling: one authored kit,
    // both classes, and the resolver sends them in OPPOSITE directions around the
    // same hit. Under the one-class rule this read [damage, bleed, debuffStat].
    expect(skillBook['crippling_gore']!.effects.map((a) => a.kind)).toEqual(['bleed', 'debuffStat', 'damage']);
    expect(resolvedKinds('crippling_gore', 'diamond')).toEqual(['debuffStat', 'damage', 'bleed']);
    // `sundering_roar` is the same shape one keyword over, with a `pre` arm in
    // front of it: the shatter opens the plating, the expose amplifies the roar's
    // own hit, the bleed lands behind it.
    expect(resolvedKinds('sundering_roar', 'diamond')).toEqual(['shieldBreak', 'expose', 'damage', 'bleed']);
  });

  it('AN ORDERED KIT COMES BACK BY REFERENCE (the byte-identical contract)', () => {
    // What keeps "an un-featured piece resolves to the same def" true, and with
    // it every frozen baseline. Asserted on identity, not on value.
    //
    // The cards the refinement PUT BACK cannot join this list, and not because
    // the normalizer touches them: `armor_break`/`judgment_light`/`ruinous_hex`/
    // `stunning_smash` all carry a `minTier` lock, so `tierResolved` builds a new
    // def before the normalizer is ever asked. Their restoration is pinned by the
    // reordered-kits literal above instead, which no longer names any of them.
    for (const id of ['sword_slash', 'second_bite', 'thorn_reckoning', 'braced_pike', 'siphon_life']) {
      expect(resolveEffectiveSkill(skillBook[id]!, { skillId: id, slot: 0 }), id).toBe(skillBook[id]!);
    }
  });
});

describe('cast order: gems go through the same one rule', () => {
  it('A GEM-APPLIED DoT TRAILS every hit of the host — whole book x every effect gem x 4 tiers', () => {
    const violations: string[] = [];
    let combos = 0;
    for (const id of Object.keys(skillBook)) {
      for (const gemId of Object.keys(gemBook)) {
        if (gemBook[gemId]!.kind !== 'effect') continue;
        for (const tier of TIERS) {
          const kinds = resolvedKinds(id, tier, gemId);
          if (lastHitIndex(kinds) < 0) continue;
          combos += 1;
          const bad = aftermathAheadOfHits(kinds);
          if (bad.length > 0) violations.push(`${id}@${tier} + ${gemId}: ${bad.join(', ')} — [${kinds.join(', ')}]`);
        }
      }
    }
    expect(violations.slice(0, 10), `a gemmed kit lands an aftermath rider ahead of a hit:\n${violations.slice(0, 10).join('\n')}`).toEqual([]);
    expect(violations.length).toBe(0);
    expect(combos, 'the gem sweep must actually have swept').toBeGreaterThan(10000);
  });

  it('A GEM HIT RE-ANCHORS THE HOST\'S OWN DoT — resonant_echo pushes a trailing bleed further back', () => {
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

  it('A GEM HIT DOES NOT RE-ANCHOR A SETUP LINE — deep_freeze\'s debuff now amplifies the extra hit', () => {
    // The mirror of the case above, and the one place the refinement CHANGES a
    // gemmed kit rather than restoring one: `deep_freeze` authors [damage,
    // debuffStat], so under the one-class rule a spliced `statStrike` pushed the
    // debuff behind it. It no longer does — the debuff is setup, so it sits ahead
    // of the gem's hit and the gem's hit meets the reduced DEF.
    expect(resolvedKinds('deep_freeze', 'bronze')).toEqual(['damage', 'debuffStat']);
    expect(resolvedKinds('deep_freeze', 'bronze', 'resonant_echo')).toEqual(['damage', 'debuffStat', 'statStrike']);
  });

  it('A GEM DEBUFF LANDS BEHIND THE HOST, THE HOST\'S OWN DEBUFF DOES NOT — and that is deliberate', () => {
    // `judgment_light_echo` is a `debuffStat` gem on its own host. The card's own
    // debuff is SETUP and sits between the two hits; the gem's copy is spliced at
    // `post` and stays behind both. The asymmetry is `GEM_ACTION_PHASE`'s default
    // holding: a gem is ADDITIVE to the host's kit, never hoisted ahead of it, and
    // moving those rows to `pre` would raise what every debuff gem is worth —
    // pricing, not ordering. Pinned here so the choice is visible, not assumed.
    expect(GEM_ACTION_PHASE['debuffStat']).toBe('post');
    expect(resolvedKinds('judgment_light', 'diamond', 'judgment_light_echo'))
      .toEqual(['damage', 'debuffStat', 'damage', 'debuffStat']);
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

  it('judgment_light@diamond: the debuff lands BETWEEN the hits, and the second hit cashes it in', () => {
    const cast = oneCast([
      { skillId: 'judgment_light', slot: 0, tier: 'diamond' },
      { skillId: 'purging_strike', slot: 1 },
      { skillId: 'purify', slot: 2 },
    ]);
    expect(cast.shape, 'hit, debuff, hit').toEqual(['damage', 'debuff', 'damage']);
    expect(cast.defenses.length, 'the affinity hit must actually have fired').toBe(2);
    // THE SELF-AMPLIFICATION, the thing the user said YES to: the second hit meets
    // a REDUCED defense, because the first hit's debuff is already on the target.
    expect(cast.defenses[0], 'the first hit meets full MDEF 6').toBe(6);
    expect(cast.defenses[1], 'the second hit meets the MDEF its own card debuffed').toBe(4);
    // HP is not asserted here: this wall's caster carries the suite's default
    // stats, not `npm run fight`'s hero, so the absolute numbers differ from the
    // ones in the commit message. DEFENSE is the fact the ruling is about, and it
    // is read straight off `calculation`.
  });

  it('ruinous_hex@diamond: its own expose amplifies its own hit', () => {
    const cast = oneCast([{ skillId: 'ruinous_hex', slot: 0, tier: 'diamond' }]);
    expect(cast.shape).toEqual(['expose', 'damage']);
    // Under the one-class rule this was exactly 0 — the hit predated the expose
    // it applied. The bonus term existing at all IS the refinement.
    expect(cast.exposeBonuses[0], 'the hit collects the expose it just applied').toBeGreaterThan(0);
  });

  it('hemorrhage: the attack happens first, then the bleed gets applied (the user\'s own example)', () => {
    const cast = oneCast([{ skillId: 'hemorrhage', slot: 0 }]);
    expect(cast.shape).toEqual(['damage', 'bleed']);
  });

  it('crippling_gore: THE MIXED PROOF — debuff before the lance, bleed after it', () => {
    // One cast, one log, both classes: the DEF debuff resolves first (so the
    // lance meets 12 armor, not 20), the lance lands, the bleed lands behind it.
    const cast = oneCast([{ skillId: 'crippling_gore', slot: 0 }]);
    expect(cast.shape).toEqual(['debuff', 'damage', 'bleed']);
    expect(cast.defenses[0], 'armor 20 already cut to 12 by this card\'s own -40%').toBe(12);
  });

  it('sundering_roar: `shieldBreak` and `expose` both PREPARE the hit — only the bleed trails', () => {
    const cast = oneCast([{ skillId: 'sundering_roar', slot: 0 }]);
    expect(cast.shape).toEqual(['expose', 'damage', 'bleed']);
    expect(cast.exposeBonuses[0], 'the roar amplifies itself again').toBeGreaterThan(0);
  });

  it('armor_break@diamond: the chop eats the DEF its own debuff just halved', () => {
    // The plainest single-hit statement of the refinement, and the number the
    // user was shown: DEF 20 -> 10 before the chop, not after it.
    const cast = oneCast([{ skillId: 'armor_break', slot: 0, tier: 'diamond' }]);
    expect(cast.shape).toEqual(['debuff', 'damage']);
    expect(cast.defenses[0]).toBe(10);
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
