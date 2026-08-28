import { describe, expect, it } from 'vitest';
import {
  affixBlockLines, ANSWER_LINE_BUDGET, answerLine, charsForWidth, presentEliteAffix, wrapText,
} from '../../src/game/ui/affixPresentation';
import { ELITE_AFFIX_IDS, ENEMY_MODIFIER_IDS, MODIFIER_PRESETS } from '../../src/data/modifiers';
import { skillBook } from '../../src/data/skills';
import { buildEnemyEncounter, eliteAffixIdFor } from '../../src/run/encounter';
import { buildBattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import { battleRequestOf } from '../../src/game/battleApi';
import { resolveBattle } from '../../src/run/resolveBattle';

/**
 * The elite affix as the PREP SCREENS see it. `d1ac673` shipped the affix on
 * `EncounterUnit.affix` and nothing read it, so an elite's behaviour could
 * only be discovered by losing to it; these lock the presentation half of the
 * fix (both platforms draw exactly what this module returns).
 *
 * The load-bearing test is COVERAGE: every id the elite pool can deal must
 * present with a name, an effect AND an answer. A fifth affix added to
 * `src/data/modifiers.ts` without an answer line fails here rather than
 * shipping a chip that names a threat and no counter.
 */
describe('game/ui/affixPresentation', () => {
  it('presents every affix the elite pool can deal — name, effect, answer, installed card', () => {
    expect(ELITE_AFFIX_IDS.length).toBeGreaterThan(0);
    for (const id of ELITE_AFFIX_IDS) {
      const p = presentEliteAffix(id);
      expect(p, `affix "${id}" must present`).not.toBeNull();
      expect(p!.name).toBe(MODIFIER_PRESETS[id]!.name);
      expect(p!.chipLabel).toBe(`AFFIX · ${MODIFIER_PRESETS[id]!.name}`);
      // The effect is the preset's OWN blurb — never re-worded in the UI.
      expect(p!.effect).toBe(MODIFIER_PRESETS[id]!.blurb);
      expect(p!.answer.length, `affix "${id}" needs an answer line`).toBeGreaterThan(0);
      expect(answerLine(p!)).toBe(`ANSWER · ${p!.answer}`);
      // …and it names the card it installs, so the player can find it in the
      // foe's card list on the same screen.
      expect(p!.cardNames).toEqual((MODIFIER_PRESETS[id]!.cards ?? []).map((c) => skillBook[c]!.name));
      expect(p!.cardNames.length).toBeGreaterThan(0);
      // The chip fill and its label colour are ONE value, not a hand-copied pair.
      expect(p!.accentText).toBe(`#${p!.accent.toString(16).padStart(6, '0')}`);
    }
  });

  it('draws NOTHING without an affix — null, undefined, and an unknown id', () => {
    expect(presentEliteAffix(null)).toBeNull();
    expect(presentEliteAffix(undefined)).toBeNull();
    expect(presentEliteAffix('')).toBeNull();
    expect(presentEliteAffix('no_such_affix')).toBeNull();
  });

  it('does not present a deep-run escalation modifier as an affix chip', () => {
    // Two pools, one flag (`src/data/modifiers.ts`). SWIFT/DIAMOND-POWERED
    // ride the escalation ramp and are never dealt to an elite, so they carry
    // no answer line — the coverage test above must not silently include them.
    for (const id of ENEMY_MODIFIER_IDS) {
      expect(ELITE_AFFIX_IDS).not.toContain(id);
    }
  });

  it('the presented affix is the one the encounter actually installs', () => {
    // Preview and fight read the SAME field: what `presentEliteAffix` names is
    // the card `buildEnemyEncounter` puts on the elite's deck.
    for (const id of ELITE_AFFIX_IDS) {
      const unit = buildEnemyEncounter('bandit_duelist', 6, 'elite', undefined, [], id);
      expect(unit.affix).toBe(id);
      const deck = unit.setup.pieces.map((p) => skillBook[p.skillId]?.name);
      for (const cardName of presentEliteAffix(id)!.cardNames) {
        expect(deck, `${id} must install ${String(cardName)}`).toContain(cardName);
      }
    }
  });

  it('the affix a seed deals is presentable — no un-renderable id reaches the chip', () => {
    for (let fight = 1; fight <= 40; fight++) {
      expect(presentEliteAffix(eliteAffixIdFor(4242, fight))).not.toBeNull();
    }
  });

  it('the chip cannot lie: the affix it names is on the board the fight renders', () => {
    // The whole point of the chip. The client ships DIALS, not a resolved
    // board, so an affix dropped anywhere on prep -> timeline -> request would
    // re-resolve as a plain elite: previewed BRACED, fought un-braced.
    const input: BattleTimelineInput = {
      pieces: [
        { instanceId: 'c1', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
        { instanceId: 'c2', skillId: 'second_wind', tier: 'bronze', slot: 1 },
      ],
      heroLevel: 3,
      heroAllocation: {},
      enemyId: 'bandit_duelist',
      enemyLevel: 4,
      enemyTitle: 'elite',
      enemyRank: 2,
      enemyTeam: [{ enemyId: 'bandit_duelist', level: 4, title: 'elite', rank: 2, modifiers: [], affix: 'venomous' }],
      seed: 7,
    };
    const presented = presentEliteAffix(input.enemyTeam![0]!.affix)!;
    const timeline = buildBattleTimeline(input, resolveBattle(battleRequestOf(input)));
    const board = timeline.foes[0]!.skills.map((s) => s.name);
    for (const cardName of presented.cardNames) expect(board).toContain(cardName);
  });

  it('wraps to the character budget, keeps words whole, and splits an over-long word', () => {
    expect(wrapText('', 10)).toEqual([]);
    expect(wrapText('   ', 10)).toEqual([]);
    expect(wrapText('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrapText('supercalifragilistic', 8)).toEqual(['supercal', 'ifragili', 'stic']);
    expect(wrapText('hi supercalifragilistic', 8)).toEqual(['hi', 'supercal', 'ifragili', 'stic']);
  });

  it('every affix block fits the panel it is drawn in', () => {
    // Desktop foe panel inner width 396 @ 11px; mobile foe card 372 @ 9px.
    for (const [width, size] of [[396, 11], [372, 9]] as const) {
      const chars = charsForWidth(width, size);
      for (const id of ELITE_AFFIX_IDS) {
        const block = affixBlockLines(presentEliteAffix(id)!, width, size);
        expect(block.effect.length).toBeGreaterThan(0);
        expect(block.answer.length).toBeGreaterThan(0);
        for (const line of [...block.effect, ...block.answer]) {
          expect(line.length, `"${line}" overruns ${String(chars)} chars`).toBeLessThanOrEqual(chars);
        }
      }
    }
  });

  it('every answer fits ONE line in the narrowest place it is drawn', () => {
    // A two-line answer once pushed the sandbox prep panel past its own bottom
    // edge; the copy is written to the budget so no caller has to truncate.
    expect(ANSWER_LINE_BUDGET).toBe(charsForWidth(396, 11));
    for (const id of ELITE_AFFIX_IDS) {
      const p = presentEliteAffix(id)!;
      expect(wrapText(answerLine(p), ANSWER_LINE_BUDGET), `${id} answer wraps`).toHaveLength(1);
    }
  });

  it('charsForWidth under-estimates rather than over-estimates', () => {
    expect(charsForWidth(396, 11)).toBe(60);
    expect(charsForWidth(372, 9)).toBe(68);
    expect(charsForWidth(1, 40)).toBe(8);
  });
});
