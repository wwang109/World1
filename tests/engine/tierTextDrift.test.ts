import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { applyTier, autoScaleTier } from '../../src/engine/cards';
import { capViolations, powerLevelDeci, TIER_BUDGET_DECI } from '../../src/engine/balance';
import type { Action, SkillDef, SkillTier } from '../../src/engine/types';

/**
 * TIER TEXT DRIFT — does a card's face still describe the card at tiers ABOVE
 * bronze?
 *
 * THE GAP THIS FILLS. `tests/engine/cardText.test.ts` audits the bronze kit and
 * every AUTHORED `tierUpgrades` entry. But a card with NO `tierUpgrades` is
 * scaled at runtime by `autoScaleTier`, which rewrites its prose through
 * `retextScaledNumbers` — a regex that replaces "the first standalone occurrence
 * of the old number". Nothing tested that path, and it was WRONG on a shipped
 * card:
 *
 *   `piercing_reach` authored `shieldBreak 16` + `damage 16`, text
 *   "{{Shatter}} 16 enemy shield, then deal 16 (+ATK) Lance damage."
 *   Only `damage` scales, so at Silver the engine shattered 16 and hit for 26 —
 *   while the rewrite replaced the FIRST "16" and printed
 *   "Shatter 26 ... deal 16". Both numbers wrong, and swapped.
 *
 * `shieldBreak`'s magnitude is `amount`, a field that rewrite does not track at
 * all, so nothing marked its numeral as already spoken for. It now refuses to
 * rewrite an AMBIGUOUS numeral (one appearing more than once), which turns a
 * confidently-wrong number into a detectable one — and this suite is the
 * detector. The fix for a card it catches is to author explicit `tierUpgrades`
 * text, which wins verbatim over the generic rewrite.
 *
 * WHY IT MATTERS BEYOND COSMETICS: the card face is the only place a player
 * learns what a card does. A face that prints numbers the engine does not use is
 * the same defect class as an engine that ignores an authored number — the two
 * just disagree in opposite directions.
 */

const TIERS: Exclude<SkillTier, 'bronze'>[] = ['silver', 'gold', 'diamond'];

/** The magnitude fields the tier scaler can actually grow (`sinkField`, cards.ts). */
const SCALED_FIELDS = ['power', 'stacks', 'charges'] as const;

function scaledMagnitudes(a: Action): Array<[string, number]> {
  const f = a as unknown as Record<string, number>;
  const out: Array<[string, number]> = [];
  for (const k of SCALED_FIELDS) if (typeof f[k] === 'number') out.push([k, f[k]]);
  return out;
}

/** Is `n` present in `text` as its own numeral (not a digit inside a longer one)? */
function hasStandalone(text: string, n: number): boolean {
  return new RegExp(`(?<!\\d)${n}(?!\\d)`).test(text);
}

/**
 * Every (card, tier) pair the game can actually resolve — `applyTier` picks the
 * authored override when present and falls back to `autoScaleTier` otherwise, so
 * auditing through it covers BOTH paths exactly as the game does.
 */
function resolvedTiers(card: SkillDef): Array<{ tier: SkillTier; skill: SkillDef }> {
  return TIERS.map((tier) => ({ tier, skill: applyTier(card, tier) }));
}

describe('tier text describes the tier-scaled card', () => {
  it('every scaled magnitude appears on the face at every tier', () => {
    const drift: string[] = [];
    for (const card of Object.values(skillBook)) {
      for (const { tier, skill } of resolvedTiers(card)) {
        skill.effects.forEach((action, i) => {
          const before = card.effects[i];
          if (!before || before.kind !== action.kind) return;
          const now = scaledMagnitudes(action);
          const was = scaledMagnitudes(before);
          for (let k = 0; k < now.length; k += 1) {
            const [field, value] = now[k]!;
            const old = was[k]?.[1];
            if (old === undefined || old === value) continue; // unchanged: nothing to say
            if (!hasStandalone(skill.text, value)) {
              drift.push(`${card.id}@${tier} [${action.kind}.${field}]: engine uses ${value}, face never says it — "${skill.text}"`);
            }
          }
        });
      }
    }
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('the face never keeps a BRONZE magnitude the engine has scaled away', () => {
    // The other half of the same defect: printing the pre-scale number next to
    // the scaled one is how `piercing_reach` read at Silver.
    const stale: string[] = [];
    for (const card of Object.values(skillBook)) {
      for (const { tier, skill } of resolvedTiers(card)) {
        skill.effects.forEach((action, i) => {
          const before = card.effects[i];
          if (!before || before.kind !== action.kind) return;
          const now = scaledMagnitudes(action);
          const was = scaledMagnitudes(before);
          for (let k = 0; k < now.length; k += 1) {
            const [field, value] = now[k]!;
            const old = was[k]?.[1];
            if (old === undefined || old === value) continue;
            // Only a problem when the OLD value is not also a legitimate current
            // magnitude somewhere in this kit (a frozen action may genuinely
            // still print it — `piercing_reach`'s own shatter 16 is exactly that).
            const stillReal = skill.effects.some((other) => {
              const f = other as unknown as Record<string, number>;
              return Object.values(f).some((v) => v === old);
            });
            if (!stillReal && hasStandalone(skill.text, old)) {
              stale.push(`${card.id}@${tier} [${action.kind}.${field}]: face still shows the bronze ${old} (engine uses ${value}) — "${skill.text}"`);
            }
          }
        });
      }
    }
    expect(stale, stale.join('\n')).toEqual([]);
  });

  it('AMBIGUITY IS REFUSED, not guessed: a duplicated numeral is left alone', () => {
    // The regression pin for the rewrite's guard. A card whose scaling magnitude
    // collides with a frozen one must come out of `autoScaleTier` with its text
    // UNTOUCHED (so the audits above catch it) rather than with the wrong numeral
    // confidently rewritten.
    const probe: SkillDef = {
      id: 'ambiguity_probe', name: 'Ambiguity Probe',
      archetypes: ['offense'], property: 'physical', weapon: 'lance',
      size: 1, rarity: 'common', tier: 'bronze',
      // Both 16; only `damage` scales — `piercing_reach`'s exact shape.
      effects: [{ kind: 'shieldBreak', amount: 16 }, { kind: 'damage', power: 16 }],
      text: 'Shatter 16 enemy shield, then deal 16 damage.',
    };
    const silver = autoScaleTier(probe, 'silver');
    const damage = silver.effects.find((a) => a.kind === 'damage');
    expect(damage && damage.kind === 'damage' ? damage.power : 0).toBeGreaterThan(16);
    // The text is NOT rewritten — and critically, the shatter numeral was not
    // hijacked into claiming the damage value.
    expect(silver.text).toBe(probe.text);
  });

  it('a card WITH authored tier text uses it verbatim, and it stays on budget', () => {
    // `piercing_reach` is the card the bug was found on; this pins its fix.
    const card = skillBook.piercing_reach!;
    expect(card.tierUpgrades, 'piercing_reach must carry authored tier text').toBeDefined();
    for (const { tier, skill } of resolvedTiers(card)) {
      const shatter = skill.effects.find((a) => a.kind === 'shieldBreak');
      const damage = skill.effects.find((a) => a.kind === 'damage');
      const shatterAmount = shatter && shatter.kind === 'shieldBreak' ? shatter.amount : -1;
      const damagePower = damage && damage.kind === 'damage' ? damage.power : -1;
      // The face says exactly what the engine does — both numbers, right way round.
      expect(skill.text, `${tier} face must state shatter ${shatterAmount}`).toContain(`{{Shatter}} ${shatterAmount} `);
      expect(skill.text, `${tier} face must state damage ${damagePower}`).toContain(`deal ${damagePower} `);
      expect(shatterAmount, 'shieldBreak is frozen control — it must not scale').toBe(16);
      expect(powerLevelDeci(skill), `${tier} budget`).toBe(TIER_BUDGET_DECI[tier]);
      expect(capViolations(skill), `${tier} caps`).toEqual([]);
    }
  });
});
