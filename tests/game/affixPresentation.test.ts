import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  affixBlockLines, AFFIX_MAP_INK, affixMapFooter, ANSWER_LINE_BUDGET, answerLine, charsForWidth,
  presentEliteAffix, presentPackAffix, wrapText,
} from '../../src/game/ui/affixPresentation';
import { ELITE_AFFIX_IDS, ENEMY_MODIFIER_IDS, MODIFIER_PRESETS } from '../../src/data/modifiers';
import { skillBook } from '../../src/data/skills';
import { buildEnemyEncounter, eliteAffixIdFor, type EncounterPack } from '../../src/run/encounter';
import { buildBattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import { battleRequestOf } from '../../src/game/battleApi';
import { resolveBattle } from '../../src/run/resolveBattle';
import { applyRunDraft, clearRun, getActiveRun, previewEncounter, startRun } from '../../src/game/runStore';
import { DRAFT_SET_KEYS, rollStartDraft, type DraftSetKey } from '../../src/run/draft';
import { fightTableEntryForNode, type RunNode } from '../../src/run/runState';
import { runChoicePanelLayout } from '../../src/game/ui/RunChoicePanel';
import { runScreenTemplate } from '../../src/game/ui/runScreenTemplate';
import { DESKTOP_PROFILE, MOBILE_PROFILE, type LayoutProfile } from '../../src/game/layoutProfile';
import { INK } from '../../src/game/theme';

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

// ---------------------------------------------------------------------------
// THE RUN MAP — the affix on the screen where the CHOICE is actually made.
//
// `76b3033` drew the chip on RUN PREP, one screen AFTER the player commits to
// a fight; the easy/medium/hard pick happens on the MAP. These hold the three
// things that makes true: the map names the same affix prep does, it names it
// on exactly the options that carry one, and the line fits the slot it takes.
// ---------------------------------------------------------------------------

const MAP_SEEDS = [2, 6, 11, 42, 99, 1234, 7, 3];

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const draft = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = draft[key][0]!.skillId;
  return picks;
}

/** Every fight/boss node of a started run, grouped the way the map draws them:
 * one entry per COLUMN, which is the set of options a single stop offers. */
function combatColumns(seed: number): RunNode[][] {
  startRun(seed);
  applyRunDraft(draftPicksFor(seed));
  const run = getActiveRun()!;
  return run.map.depths
    .map((column) => column.filter((n) => n.kind === 'fight' || n.kind === 'boss'))
    .filter((column) => column.length > 0);
}

/** A minimal stand-in pack — only `units[0].affix` is ever read, and the cast
 * keeps the exported signature tied to the REAL `EncounterPack` (so a rename
 * on `EncounterUnit.affix` breaks the build) instead of loosening it for a
 * test's convenience. */
function packWithAffix(affix: string | null): Pick<EncounterPack, 'units'> {
  return { units: [{ affix }] as unknown as EncounterPack['units'] };
}

/** What `Desktop/MobileRunPrepScene` chips for this pack — `pack.units[0].affix`
 * through `presentEliteAffix`, which is literally the line those scenes run. */
function prepChipLabel(pack: EncounterPack | null): string | undefined {
  return presentEliteAffix(pack?.units[0]?.affix ?? null)?.chipLabel;
}

describe('game/ui/affixPresentation: the run map names the affix BEFORE the choice', () => {
  // Same stance as `tests/run/eliteAffix.test.ts`: `runStore` is the real
  // preview surface and it persists through a `window.localStorage` driver, so
  // an in-memory `window` keeps this a test OF the store, not of its storage.
  beforeAll(() => {
    const cells = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => cells.get(k) ?? null,
        setItem: (k: string, v: string) => void cells.set(k, v),
        removeItem: (k: string) => void cells.delete(k),
      },
    });
  });
  afterAll(() => {
    clearRun();
    vi.unstubAllGlobals();
  });

  it('THE AGREEMENT: the map footer is exactly the chip RunPrep draws, for every combat node of a real run', () => {
    // The point of the feature. Map, prep and fight all read ONE field
    // (`EncounterUnit.affix` off the SAME `previewEncounter` roll), so this is
    // an identity check, not two derivations that happen to line up today.
    let named = 0;
    let silent = 0;
    for (const seed of MAP_SEEDS) {
      for (const column of combatColumns(seed)) {
        for (const node of column) {
          const pack = previewEncounter(node);
          expect(pack, `no preview for ${node.id}`).not.toBeNull();
          const map = affixMapFooter(pack);
          const prep = prepChipLabel(pack);
          expect(map?.footer, `${node.id} on seed ${seed}: map and prep disagree`).toBe(prep);
          if (map) { named += 1; expect(map.footerInk).toBe(AFFIX_MAP_INK); } else silent += 1;
        }
      }
    }
    // NON-VACUITY, both ways: a sample with no affixed option (or with nothing
    // BUT affixed options) would pass the loop above without proving anything.
    expect(named, 'no map option named an affix at all').toBeGreaterThan(10);
    expect(silent, 'every map option named an affix — the gate is not being exercised').toBeGreaterThan(30);
  });

  it('THE GATE: only an ELITE option carries a line — and at most ONE rung of any column can', () => {
    // `eliteAffixIdFor` is keyed on the FIGHT NUMBER, so a column's three rungs
    // agree on WHICH affix that rung of the ladder holds — but not on whether
    // they carry it, because `'hard'` promotes the title one rung and `'easy'`
    // caps it at normal. On a NORMAL fight number that makes `'hard'` the only
    // elite; on an ELITE fight number `'hard'` becomes a boss and `'easy'` a
    // normal, leaving `'standard'`. Either way: never more than one.
    let mixedColumns = 0;
    for (const seed of MAP_SEEDS) {
      for (const column of combatColumns(seed)) {
        const carriers: RunNode[] = [];
        for (const node of column) {
          const pack = previewEncounter(node)!;
          const primary = pack.units[0]!;
          const line = affixMapFooter(pack);
          // The gate reads through the UNIT, which is `rollEncounter`'s own
          // `title === 'elite'` verdict — packs (capped to mob/normal) and
          // bosses included, with no second copy of the rule here.
          expect(Boolean(line), `${node.id}: line vs title "${primary.title}"`).toBe(primary.title === 'elite');
          expect(Boolean(line), `${node.id}: line vs affix`).toBe(primary.affix !== null);
          if (node.kind === 'boss') expect(line, 'a BOSS node named an affix').toBeUndefined();
          if (node.fightOption === 'easy') expect(line, "an 'easy' option named an affix").toBeUndefined();
          if (line) {
            carriers.push(node);
            expect(fightTableEntryForNode(node).title).toBe('elite');
          }
        }
        expect(carriers.length, `column at depth ${column[0]!.depth} had ${carriers.length} affixed rungs`)
          .toBeLessThanOrEqual(1);
        if (carriers.length === 1 && column.length > 1) mixedColumns += 1;
      }
    }
    // THE PAIR THE SCREENSHOT SHOWS: a column where one option names its affix
    // beside siblings that do not. If this were 0 the feature would be
    // invisible in exactly the place it is supposed to inform a decision.
    expect(mixedColumns, 'no column ever offered an affixed option beside an unaffixed one').toBeGreaterThan(5);
  });

  it('a column\'s rungs never name two DIFFERENT affixes (the affix belongs to the fight number)', () => {
    for (const seed of MAP_SEEDS) {
      for (const column of combatColumns(seed)) {
        const labels = new Set(
          column.map((n) => affixMapFooter(previewEncounter(n))?.footer).filter((l): l is string => l !== undefined),
        );
        expect(labels.size, `column at depth ${column[0]!.depth} named ${labels.size} affixes`).toBeLessThanOrEqual(1);
        for (const label of labels) {
          const fightNumber = column[0]!.fightNumber!;
          expect(label).toBe(`AFFIX · ${MODIFIER_PRESETS[eliteAffixIdFor(seed, fightNumber)]!.name}`);
        }
      }
    }
  });

  it('MAP, PREP AND FIGHT cannot disagree: the card the map names is on the board the battle renders', () => {
    // The map line is a claim about a fight that has not happened. This walks a
    // real affixed map option all the way through the client's own seam —
    // preview -> timeline input -> `battleRequestOf` -> `resolveBattle` -> the
    // rendered foe board — and asserts the named card is really there. It is
    // the assertion that would have caught `76b3033`'s dropped-affix bug from
    // the MAP end.
    let proven = 0;
    for (const seed of MAP_SEEDS) {
      for (const column of combatColumns(seed)) {
        for (const node of column) {
          const pack = previewEncounter(node)!;
          const line = affixMapFooter(pack);
          if (!line) continue;
          const input: BattleTimelineInput = {
            pieces: [
              { instanceId: 'c1', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
              { instanceId: 'c2', skillId: 'second_wind', tier: 'bronze', slot: 1 },
            ],
            heroLevel: 3,
            heroAllocation: {},
            enemyId: pack.units[0]!.enemyId,
            enemyLevel: pack.units[0]!.level,
            enemyTitle: pack.units[0]!.title,
            enemyRank: pack.units[0]!.rank,
            // Exactly the mapping `battleContext.runBattleInput` performs.
            enemyTeam: pack.units.map((u) => ({
              enemyId: u.enemyId, level: u.level, title: u.title, rank: u.rank,
              modifiers: [...u.modifiers], affix: u.affix,
            })),
            seed: node.encounterSeed!,
          };
          const timeline = buildBattleTimeline(input, resolveBattle(battleRequestOf(input)));
          const board = timeline.foes[0]!.skills.map((s) => s.name);
          const named = presentPackAffix(pack)!;
          expect(line.footer).toBe(named.chipLabel);
          for (const cardName of named.cardNames) {
            expect(board, `${node.id} previewed ${line.footer} and fought without ${cardName}`).toContain(cardName);
          }
          proven += 1;
          if (proven >= 6) return;
        }
      }
    }
    expect(proven, 'no affixed map option was found to prove').toBeGreaterThan(0);
  });

  it('the line fits the footer slot the choice panel reserves — one line, both platforms', () => {
    // The map has no height to give (band banner + windowed trail + a 94px
    // panel already share it), which is why this lands in the FOOTER slot the
    // panel already reserves whether or not a model fills it. `footerW` is the
    // width left free by the SELECT/LOCKED affordance on the same row, so a
    // label inside it can neither wrap into the reward line above nor run into
    // the affordance beside it. Widths come from the real template, not retyped.
    const PROFILES: Array<[LayoutProfile, 'mobile' | 'desktop']> = [
      [MOBILE_PROFILE, 'mobile'], [DESKTOP_PROFILE, 'desktop'],
    ];
    for (const [profile, platform] of PROFILES) {
      const slot = runScreenTemplate(platform).contentSlots.choices;
      // A fight/boss CHOICE has no art thumbnail on the map (only boss does),
      // so both are measured — the narrower column is the one that must fit.
      for (const hasImage of [false, true]) {
        const layout = runChoicePanelLayout({ x: 0, y: 0, w: slot.width, h: 94 }, profile.font, hasImage);
        const budget = charsForWidth(layout.footerW, profile.font.tiny);
        for (const id of ELITE_AFFIX_IDS) {
          const label = presentEliteAffix(id)!.chipLabel;
          expect(
            wrapText(label, budget),
            `"${label}" wraps in ${platform}'s ${String(layout.footerW)}px footer slot`,
          ).toHaveLength(1);
        }
      }
    }
  });

  it('NAME ONLY on the map — the answer line is deliberately NOT here, and would not fit if it were', () => {
    // The decision, stated as an assertion: the map choice is WHICH RUNG, and
    // the affix name is the part of it that varies between rungs. "What answers
    // it" is a deck-building read and lives one tap later on prep, with the
    // deck. It is also the only thing that fits: the answer line is written to
    // a 60-char budget and the narrowest footer slot on the map is well under
    // that, so putting it here would wrap the reserved single-line row into the
    // reward line above it.
    const slot = runScreenTemplate('mobile').contentSlots.choices;
    const layout = runChoicePanelLayout({ x: 0, y: 0, w: slot.width, h: 94 }, MOBILE_PROFILE.font, false);
    const budget = charsForWidth(layout.footerW, MOBILE_PROFILE.font.tiny);
    expect(budget).toBeLessThan(ANSWER_LINE_BUDGET);
    for (const id of ELITE_AFFIX_IDS) {
      const p = presentEliteAffix(id)!;
      expect(affixMapFooter(packWithAffix(id))!.footer).toBe(p.chipLabel);
      expect(affixMapFooter(packWithAffix(id))!.footer).not.toContain(p.answer);
      expect(wrapText(`${p.chipLabel} · ${answerLine(p)}`, budget).length).toBeGreaterThan(1);
    }
  });

  it('presentPackAffix reads the PRIMARY unit, and draws nothing without one', () => {
    expect(presentPackAffix(null)).toBeNull();
    expect(presentPackAffix(undefined)).toBeNull();
    expect(presentPackAffix({ units: [] })).toBeNull();
    expect(presentPackAffix(packWithAffix(null))).toBeNull();
    expect(affixMapFooter(packWithAffix(null))).toBeUndefined();
    const id = ELITE_AFFIX_IDS[0]!;
    expect(presentPackAffix(packWithAffix(id))!.id).toBe(id);
    // The ink is a ROLE the theme owns, not a colour this module invented.
    expect(INK[AFFIX_MAP_INK]).toBeDefined();
  });
});
