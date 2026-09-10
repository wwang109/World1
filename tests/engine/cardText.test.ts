import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { applyTier } from '../../src/engine/cards';
import { KEYWORD_PRICING } from '../../src/engine/balance';
import { renderSkillClauses, renderSkillText } from '../../src/engine/keywords/compose';
import { renderGemText } from '../../src/engine/keywords/gemText';
import { TIER_ORDER, type SkillTier } from '../../src/engine/types';

/**
 * CARD TEXT — what is left to test once the text is GENERATED.
 *
 * This file used to be the DRIFT GUARD: 183 cards × 4 tiers of authored prose,
 * audited against the effects beside it for magnitudes (`expectedNumbers`) and
 * stat tokens (`assertStatTokens`). Both audits existed because the prose was
 * hand-typed and could disagree with the kit — and both had already caught real
 * shipped defects (16 defensive lines advertising `(+ATK)`; `purify_echo`
 * claiming "all types" on a TRUE-only guard).
 *
 * Neither failure is expressible now. A card carries no `text`; its face is one
 * function of its `effects` (`renderSkillText`, engine/keywords/compose.ts), so
 * the magnitude on the face IS the magnitude in the kit and the stat suffix IS
 * the one the property picks. The drift guard's job moved INTO the generator,
 * and what is worth pinning here is different:
 *
 *   1. the generator runs on every shipped card at every reachable tier
 *      without throwing and without emitting an empty face (the
 *      `attunedShield` failure mode: a kind with no clause prints nothing);
 *   2. a GOLDEN SET of faces, so a template edit that quietly changes 700 card
 *      faces has to be looked at rather than merely re-run;
 *   3. the stat-suffix ROLE rule, kept because it is cheap and it is the one
 *      rule with a dated regression behind it — now asserted against generated
 *      output, where a violation would be a bug in one template rather than in
 *      one card's prose.
 *
 * The GEM half moved with it: gem `text` is gone too (2026-09-06), so what the
 * gem block below pins is the GENERATOR, not 53 authored strings — see
 * `tests/engine/gemTextRegistry.test.ts` for the gem golden set and the
 * one-reference invariants.
 */

const TIERS: readonly SkillTier[] = TIER_ORDER;

describe('generated card text: it runs, on everything', () => {
  it('every card at every reachable tier renders a non-empty, fully-formed face', () => {
    const problems: string[] = [];
    let rendered = 0;
    for (const skill of Object.values(skillBook)) {
      for (const tier of TIERS) {
        if (TIERS.indexOf(tier) < TIERS.indexOf(skill.tier)) continue;
        const resolved = applyTier(skill, tier);
        const face = renderSkillText(resolved);
        rendered += 1;
        if (face.trim() === '') problems.push(`${skill.id}@${tier}: empty face`);
        if (!face.endsWith('.')) problems.push(`${skill.id}@${tier}: face does not end in a full stop — "${face}"`);
        // A card with effects must produce at least one clause. An empty
        // clause list on a card that HAS a kit is exactly the `attunedShield`
        // defect: a kind whose template produced nothing.
        if (resolved.effects.length > 0 && renderSkillClauses(resolved).length === 0) {
          problems.push(`${skill.id}@${tier}: ${resolved.effects.length} effects produced no clause`);
        }
        // No template may emit a dangling separator or a doubled space.
        if (/ {2}| · \.|· $/.test(face)) problems.push(`${skill.id}@${tier}: malformed spacing — "${face}"`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    expect(rendered, 'every card/tier pair the game can reach').toBe(732);
  });
});

/**
 * THE GOLDEN PIN — twelve faces chosen to cover every structural feature of
 * the grammar exactly once, so a template change cannot slide through as "700
 * snapshots updated".
 */
// FOUR of these strings gained `{{shield}}` on 2026-09-06 and NOTHING else:
// `shield` was wrongly on the markup exemption list despite carrying a real
// `ruleSentence`, so 36 cards printed the game's most common defensive keyword
// with no tap cue. The markup is lowercase, so the SENTENCE is byte-identical
// after `stripCardTextMarkup` — only the colour and the tap target are new.
const GOLDEN: Record<string, string> = {
  // The three cards the correction named, and the inconsistency it named:
  // both bramble cards now lead with their headline and trail the other clause.
  'bramble_covenant@bronze': 'Gain 12 (+MDEF) magical {{shield}} · {{Affinity}} Nature — {{Poison}} 8.',
  'bramble_ward@bronze': 'Gain 10 (+DEF) physical {{shield}} · {{Thorns}} 5.',
  'bramblewrath@bronze': 'Deal 56 (+ATK) Lance damage · {{Thorns}} 20.',
  // ...and the same card at Gold, where a `minTier` line resolves in with no
  // authored tier text anywhere on the card.
  'bramblewrath@gold': 'Deal 94 (+ATK) Lance damage · {{Stun}} · {{Thorns}} 20.',
  // setup → headline → payload → conditional, all four buckets on one card.
  'gutting_cleave@bronze': '{{Shatter}} 40 · Deal 26 (+ATK) Axe damage · {{Bleed}} 6.',
  // A conditional rider that names another keyword's status. Also the card
  // spec §4.3 named for the `flavor` field — and the reason NO card carries one:
  // "The fresh barbs feed your next swing" is `stackBonus`'s own cross-cast
  // rider rule in other words, i.e. the mechanism restatement this migration
  // removed, re-authored in the one field still open to hand-authoring. The
  // other three shipped flavour lines named a keyword the card did not even
  // have. The field survives (validated inert, and now also refusing any
  // keyword NAME); zero cards use it.
  'thorn_reckoning@bronze': 'Deal 20 (+ATK) Axe damage · {{Thorns}} 8 · +3/{{Thorns}} (cap 12).',
  // Multi-hit: a COUNT, never a sum (24 × 2 is not 48 against armor).
  'barrage@bronze': 'Deal 24 (+ATK) Bow damage ×2.',
  // ...and the unequal form, which only exists at Silver.
  'twin_slash@silver': 'Deal 12, then 10 (+ATK) Sword damage.',
  // AoE leads, because `scope` widens every offensive line and not just the hit.
  'chain_spark@diamond': 'Hits EVERY foe · Deal 34 (+MATK) Lightning damage · Gain 10 (+MDEF) magical {{shield}} · {{Slow}} +8wt. Cooldown 4 (default 3).',
  // The pile MERGE (spec §2.5): four `thorns` lines, one printed clause. The
  // headline still leads (spec §4.1) — which is the ordering the user named on
  // `bramble_ward` vs `bramble_covenant`, applied without exception.
  'rimebarb_vigil@diamond': 'Gain 64 (+MDEF) magical {{shield}} · {{Thorns}} 14.',
  // TRUE: no stat suffix on defensive output, `(+best stat)` on offence.
  'annihilation_strike@bronze': 'Deal 48 (+best stat) TRUE damage.',
  // An aura card, and the one clause that is not an `Action` at all — plus the
  // two 2026-09-07 grammar fixes on one line: the gated hit REPEATS the
  // headline's kind, so it says "again" the way the authored face did ("hit
  // again for 8"), and the aura's mod words now come from the registry
  // (`+3 damage` — the same words the gem chip and the compact badge use for
  // `damageFlat`) instead of this function's own `deal +3`.
  'enfilade_volley@bronze': 'Deal 10 (+ATK) Bow damage · {{Affinity}} Bow — Hit again for 8 (+ATK) · Passive: the 2 cards to its RIGHT get +3 damage.',
};

describe('generated card text: the golden set', () => {
  for (const [key, expected] of Object.entries(GOLDEN)) {
    const [id, tier] = key.split('@') as [string, SkillTier];
    it(key, () => {
      const skill = skillBook[id];
      expect(skill, `${id} left the catalog`).toBeDefined();
      expect(renderSkillText(applyTier(skill!, tier))).toBe(expected);
    });
  }
});

describe('generated card text: control keywords keep parameters compact', () => {
  it('prints Curse, Burden, and Splash parameters without duplicating their definitions', () => {
    expect(renderSkillText(skillBook.writ_of_sanction!)).toBe(
      '{{Curse}} -12 (2t) · {{Burden}} +8wt · {{Splash}}.',
    );
  });
});

/**
 * STAT-TOKEN ROLE (kept from the drift guard, retargeted at the generator).
 *
 * The rule: a card's `property` picks WHICH stat, the ROLE of the line picks
 * WHICH SIDE of the sheet — offence (damage) reads ATK/MATK, defensive output
 * (heal/shield/plating) reads DEF/MDEF. It caught a real, dated miss: when
 * shields moved to Armor scaling, 16 authored faces kept advertising `(+ATK)`
 * and no test failed, because every NUMBER was still right.
 *
 * A violation now would be a bug in ONE template rather than in sixteen cards,
 * which is exactly why it stays cheap to keep.
 */
const OFFENSE_TOKENS = ['(+ATK)', '(+MATK)'] as const;
const DEFENSE_TOKENS = ['(+DEF)', '(+MDEF)'] as const;

describe('generated card text: the stat suffix names the right side of the sheet', () => {
  it('no purely defensive card advertises an offensive stat, and vice versa', () => {
    const problems: string[] = [];
    for (const skill of Object.values(skillBook)) {
      for (const tier of TIERS) {
        if (TIERS.indexOf(tier) < TIERS.indexOf(skill.tier)) continue;
        const resolved = applyTier(skill, tier);
        const face = renderSkillText(resolved);
        const hasOffense = resolved.effects.some((e) => e.kind === 'damage');
        const hasDefense = resolved.effects.some((e) => {
          const family = KEYWORD_PRICING[e.kind].family;
          return family === 'shield' || family === 'heal';
        });
        if (hasDefense && !hasOffense) {
          for (const token of OFFENSE_TOKENS) {
            if (face.includes(token)) problems.push(`${skill.id}@${tier}: defensive card prints ${token} — "${face}"`);
          }
        }
        if (hasOffense && !hasDefense) {
          for (const token of DEFENSE_TOKENS) {
            if (face.includes(token)) problems.push(`${skill.id}@${tier}: offensive card prints ${token} — "${face}"`);
          }
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

/**
 * GEM TEXT IS GENERATED TOO NOW (2026-09-06) — so the old authored-prose drift
 * guard could not survive, but the invariant it protected can, aimed one layer
 * down at the TEMPLATE instead of at 53 hand-typed strings.
 *
 * What it used to catch: a gem's sentence quoting a magnitude its payload did
 * not carry. What this catches: a `faceClause` that DROPS one. Same failure
 * (the player is told the wrong number), now impossible to author per-gem and
 * possible only once, in a template, where it would hit every gem carrying
 * that kind — which is exactly the trade the card migration made.
 */
function numbersInText(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}

describe('generated gem text: every magnitude the payload carries reaches the face', () => {
  for (const gem of Object.values(gemBook)) {
    if (gem.kind !== 'effect') continue;
    if (!gem.actions.length) continue;
    it(`${gem.id}: every magnitude appears in its generated face`, () => {
      const face = renderGemText(gem);
      const nums = numbersInText(face);
      for (const action of gem.actions) {
        for (const [field, value] of Object.entries(action)) {
          if (typeof value !== 'number') continue;
          // Same two exemptions the old guard carried: a single stun/negate
          // charge is spelled as a word, and `shareOf` prints as a ratio.
          if (action.kind === 'stun' && field === 'turns' && value === 1) continue;
          if (action.kind === 'negate' && field === 'charges' && value === 1) continue;
          if (action.kind === 'statStrike' && field === 'shareOf') continue;
          expect(nums, `${gem.id}: ${action.kind}.${field} = ${value} not in "${face}"`).toContain(value);
        }
      }
      // A GEM NEVER PRINTS A STAT SUFFIX AT ALL — stronger than the old
      // "defensive gem must not name the offensive pair" pair of checks, and
      // for a structural reason: which stat scales a gem's line is the HOST
      // card's property, so host-less mode drops the term rather than picking
      // a side (`RenderCtx.host`, engine/keywords/text.ts).
      for (const token of ['(+ATK)', '(+MATK)', '(+DEF)', '(+MDEF)', '(+best stat)']) {
        expect(face.includes(token), `${gem.id}: a gem face may not carry ${token} — "${face}"`).toBe(false);
      }
    });
  }
});
