import { describe, expect, it } from 'vitest';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import type { CombatConfig, SkillDef } from '../../src/engine/types';

/**
 * DO RIDER CARDS ACTUALLY PAY? — the "combat matches what the card says" guard
 * for the one keyword family no other test can see.
 *
 * Every OTHER action kind announces itself with an event (`damage`, `heal`,
 * `burdened`, `statusApplied`, …), so a silent no-op is detectable by watching
 * the log. The ten CONDITIONAL RIDERS emit NOTHING of their own — they modify
 * another action's outcome — so a rider that never fires looks exactly like a
 * rider that fires correctly. That is the failure mode this file exists for: a
 * card that prints "+12 if the target is poisoned" and delivers nothing.
 *
 * HOW: each rider card gets a two-card hero board, `[enabler, rider]`. The cast
 * cursor walks the board in slot order, so the enabler always resolves BEFORE
 * the rider — which is exactly the cross-cast payoff the whole family is
 * designed around (user-locked ordering ruling: a rider reads PRE-EXISTING
 * state, so it can never satisfy its own gate within one cast; it leaves the
 * pile on cast 1 and collects on cast 2).
 *
 * The bonus is read off `damage.calculation.effectBonusDamage` — the one channel
 * every damage-side rider funnels through — so this asserts the bonus reached
 * the HIT, not merely that the rider's arm ran.
 *
 * WHY SUB-CAP PAYOUTS PASS: `stackBonus`/`taxBonus`/`wardRelease` pay
 * `per × resource` bounded by `cap`, and `cap` is what is PRICED, not what is
 * promised (the `statStrike` precedent — only a ceiling is honestly priceable).
 * A payout below cap with a small pile is correct behaviour, so the assertion is
 * "> 0", not "== cap".
 */

/**
 * Rider card -> the hero card that opens its gate. `null` means the card opens
 * its own gate across casts (an archetype combo with itself, or a caster-state
 * gate this harness sets directly).
 *
 * DELIBERATELY CONTENT-COUPLED: if a rider card or an enabler is renamed or
 * retired this test fails loudly, which is the correct outcome — a rider whose
 * gate nothing in the catalog can open is a design problem worth surfacing.
 */
const ENABLER: Record<string, string | null> = {
  blight_feast: 'blooming_vine',          // poison on the foe
  second_bite: 'blooming_vine',
  breach_strike: 'piercing_arrow',        // expose on the foe
  control_opportunist: 'stunning_smash',  // stun on the foe
  debuff_crusher: 'armor_break',          // stat debuff on the foe
  bleed_executioner: 'hemorrhage',        // bleed pile on the foe
  burn_detonator: 'cinder_dart',          // burn pile on the foe
  deadweight_toll: 'leaden_bite',         // weight tax on the foe's board
  finishing_cleave: 'sword_slash',        // previous cast was a SWORD
  thermal_shock: 'cinder_dart',           // previous cast was FIRE
  vow_broken: 'umbral_ward',              // ward charges on the caster
  aegis_charge: 'bastion_stance',         // caster plating to spend
  thorn_reckoning: 'sanctum_thorn',       // caster thorns pile
  follow_through: null,                   // archetype combo with its own last cast
  cornered_beast: null,                   // gate is the caster's own low HP
};

/** Lay slots out by card SIZE — a size-N card occupies N slots. */
function board(ids: readonly string[]): Array<{ skillId: string; slot: number }> {
  let next = 0;
  return ids.map((id) => {
    const skill = skillBook[id];
    if (!skill) throw new Error(`riderPayout: unknown card "${id}"`);
    const slot = next;
    next += skill.size;
    return { skillId: id, slot };
  });
}

/** `hpFrac` low opens `desperation`-style caster-HP gates. */
function bonusSeen(card: SkillDef, enabler: string | null, hpFrac: number): number {
  const ids = enabler ? [enabler, card.id] : [card.id];
  const config: CombatConfig = {
    playerTeam: [{
      name: 'Hero',
      stats: { maxHp: 600, hp: Math.round(600 * hpFrac), attack: 10, magicPower: 10, armor: 2, magicResist: 2, speed: 34 },
      pieces: board(ids), boardSize: 10,
    } as never],
    // A deliberately huge, feeble foe: the fight must last long enough for the
    // enabler->rider rotation to come round, and must not end early.
    enemyTeam: [{
      name: 'Foe',
      stats: { maxHp: 9000, hp: 9000, attack: 4, magicPower: 4, armor: 1, magicResist: 1, speed: 8 },
      pieces: board(['sword_slash', 'bastion_stance']), boardSize: 8,
    } as never],
    skillBook, maxTurns: 60, endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
  } as never;
  let best = 0;
  for (const e of simulate(config, 17).events as unknown as Record<string, unknown>[]) {
    if (e.kind !== 'damage' || e.side !== 'enemy') continue;
    const calc = e.calculation as Record<string, number> | undefined;
    if (calc && typeof calc.effectBonusDamage === 'number') best = Math.max(best, calc.effectBonusDamage);
  }
  return best;
}

describe('conditional riders actually deliver their bonus', () => {
  it('every damage-side rider card pays a bonus once its gate is open', () => {
    const silent: string[] = [];
    for (const [id, enabler] of Object.entries(ENABLER)) {
      const card = skillBook[id];
      expect(card, `rider card missing from the catalog: ${id}`).toBeDefined();
      // Both HP states, so a caster-HP gate gets its chance too.
      const best = Math.max(bonusSeen(card!, enabler, 0.25), bonusSeen(card!, enabler, 1));
      if (best <= 0) silent.push(`${id} (enabler: ${enabler ?? 'self'}) never added bonus damage`);
    }
    expect(silent, silent.join('\n')).toEqual([]);
  });

  it('the ENABLER map covers every damage-side rider card in the catalog', () => {
    // Keeps this suite honest as content grows: a new rider card with no entry
    // here would otherwise be silently unaudited — exactly the blind spot the
    // file exists to remove.
    const DAMAGE_SIDE = new Set(['exploit', 'chainBonus', 'comboBonus', 'stackBonus', 'taxBonus', 'shieldBurst', 'wardRelease', 'desperation']);
    const missing = Object.values(skillBook)
      .filter((c) => c.effects.some((a) => DAMAGE_SIDE.has(a.kind)))
      .map((c) => c.id)
      .filter((id) => !(id in ENABLER));
    expect(missing, `damage-side rider cards with no gate-opener in this test: ${missing.join(', ')}`).toEqual([]);
  });

  it('a rider NEVER pays on the very first cast of a fight (the ordering ruling)', () => {
    // The family's defining rule: a rider reads PRE-EXISTING state, so the cast
    // that creates the resource cannot also collect on it. The probe must be a
    // card that BOTH applies and exploits the same status — `second_bite`
    // (exploit poison + damage + poison). NOT `blight_feast`: that one is a PURE
    // READER (exploit + damage, no poison line of its own), so it can never
    // self-feed and would prove nothing about ordering.
    const card = skillBook.second_bite!;
    const config: CombatConfig = {
      playerTeam: [{
        name: 'Hero', stats: { maxHp: 600, hp: 600, attack: 10, magicPower: 10, armor: 2, magicResist: 2, speed: 34 },
        pieces: board([card.id]), boardSize: 6,
      } as never],
      enemyTeam: [{
        name: 'Foe', stats: { maxHp: 9000, hp: 9000, attack: 4, magicPower: 4, armor: 1, magicResist: 1, speed: 8 },
        pieces: board(['sword_slash']), boardSize: 4,
      } as never],
      skillBook, maxTurns: 40, endgame: { attritionEnabled: false, suddenDeathTurn: 0 },
    } as never;
    const hits = (simulate(config, 5).events as unknown as Record<string, unknown>[])
      .filter((e) => e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill')
      .map((e) => (e.calculation as Record<string, number> | undefined)?.effectBonusDamage ?? 0);
    expect(hits.length, 'the probe must land at least two casts').toBeGreaterThan(1);
    expect(hits[0], 'first cast has no pre-existing poison, so no bonus').toBe(0);
    // ...and it DOES collect later, once its own earlier cast left a pile.
    expect(Math.max(...hits), 'a later cast must collect on the pile').toBeGreaterThan(0);
  });
});
