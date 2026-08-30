import { describe, expect, it } from 'vitest';
import { buildBattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import { battleRequestOf } from '../../src/game/battleApi';
import { resolveBattle } from '../../src/run/resolveBattle';
import { buildEnemyEncounter } from '../../src/run/encounter';
import { resolveDisplaySkill } from '../../src/engine/cards';
import { skillBook } from '../../src/data/skills';
import { enemies } from '../../src/data/enemies';

/**
 * WHAT THE BATTLE BOARD DRAWS — the card FACE and the card FRAME.
 *
 * Two defects, both on the foe column, both invisible to every existing test
 * because nothing asserted what the battle board's pieces carry:
 *
 *  1. `BattlePiece` had no `tier`, so the frame stroke fell back to the generic
 *     outline for every card in the fight (`CardToken`: `opts.tier ?
 *     TIER_COLOR[tier] : generic`). The shop's owned-board column has always
 *     passed it — same pieces, same component, two different pictures. Newly
 *     material now that elites field rank-tiered decks: a rank-2 elite fields
 *     two silver and two bronze cards and drew all four identically.
 *  2. The foe column resolved its face with `p.tier ? applyTier(base, p.tier) :
 *     base` while the hero column used `resolveDisplaySkill`. `applyTier` is
 *     also where the TIER LOCK resolves, so SKIPPING it for an untiered piece
 *     left locked lines on the face that the card never casts.
 */

const HERO_BOARD = [
  { instanceId: 'h0', skillId: 'sword_slash', tier: 'silver' as const, slot: 0 },
  { instanceId: 'h1', skillId: 'second_wind', tier: 'bronze' as const, slot: 1 },
];

function timelineFor(over: Partial<BattleTimelineInput> = {}) {
  const input: BattleTimelineInput = {
    pieces: HERO_BOARD, heroLevel: 3, heroAllocation: {},
    enemyId: 'knight', enemyLevel: 5, enemyTitle: 'elite', enemyRank: 2,
    enemyModifiers: [], enemyAffix: 'braced', seed: 9, ...over,
  };
  return buildBattleTimeline(input, resolveBattle(battleRequestOf(input)));
}

describe('game/battleTimeline — the battle board face', () => {
  it('carries each instance tier onto the board pieces, hero AND foe', () => {
    const model = timelineFor();
    expect(model.heroPieces.map((p) => p.tier)).toEqual(['silver', 'bronze']);

    // A rank-2 elite deck is genuinely mixed — this is the board the tier
    // frame exists for, and it must arrive with the tiers still on it.
    const foeTiers = model.foes[0]!.pieces.map((p) => p.tier);
    expect(foeTiers.length).toBeGreaterThan(1);
    expect(new Set(foeTiers.filter((t): t is NonNullable<typeof t> => t !== undefined)).size).toBeGreaterThan(1);
    expect(foeTiers).toEqual(
      buildEnemyEncounter('knight', 5, 'elite', 2, [], 'braced').setup.pieces.map((p) => p.tier),
    );
  });

  it('resolves the FOE face through the same `resolveDisplaySkill` as the hero face', () => {
    // One resolve for both boards. Pinned against the engine function directly
    // so a foe-only shortcut (`applyTier` on tiered pieces only, or a raw
    // `skillBook` lookup) cannot pass.
    for (const enemyId of Object.keys(enemies)) {
      for (const [title, rank] of [['normal', 0], ['elite', 2], ['boss', 4]] as const) {
        const setup = buildEnemyEncounter(enemyId, 4, title, rank, [], null).setup;
        const model = timelineFor({ enemyId, enemyLevel: 4, enemyTitle: title, enemyRank: rank, enemyAffix: null });
        const drawn = model.foes[0]!.pieces;
        expect(drawn.map((p) => p.slot)).toEqual(setup.pieces.map((p) => p.slot));
        for (let i = 0; i < setup.pieces.length; i += 1) {
          const p = setup.pieces[i]!;
          expect(drawn[i]!.skill).toEqual(resolveDisplaySkill(skillBook[p.skillId]!, p));
        }
      }
    }
  });

  it('drops a tier-locked line from an UNTIERED foe card, exactly as the cast does', () => {
    // The half the old foe path got wrong outright: it returned the BASE def for
    // an untiered piece, so a line locked above that card's own tier stayed on
    // the drawn face. 22 pieces across the roster are in this shape today.
    const shown: Array<{ enemyId: string; skillId: string }> = [];
    for (const enemyId of Object.keys(enemies)) {
      const setup = buildEnemyEncounter(enemyId, 4, 'normal', 0, [], null).setup;
      for (const p of setup.pieces) {
        const base = skillBook[p.skillId]!;
        if (p.tier === undefined && resolveDisplaySkill(base, p).effects.length !== base.effects.length) {
          shown.push({ enemyId, skillId: p.skillId });
        }
      }
    }
    expect(shown.length).toBeGreaterThan(0); // the case must exist, or this is vacuous

    const { enemyId, skillId } = shown[0]!;
    const model = timelineFor({ enemyId, enemyLevel: 4, enemyTitle: 'normal', enemyRank: 0, enemyAffix: null });
    const drawn = model.foes[0]!.pieces.find((p) => p.skill.id === skillId)!;
    expect(drawn.skill.effects.length).toBeLessThan(skillBook[skillId]!.effects.length);
  });
});
