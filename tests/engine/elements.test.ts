import { describe, expect, it } from 'vitest';
import { elementMatchup, matchupPct, weaponMatchup } from '../../src/engine/elements';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';
import { cfg, tc, NO_ENDGAME } from '../helpers';

describe('element wheel', () => {
  it('Fire → Nature → Lightning → Frost → Fire', () => {
    expect(elementMatchup('fire', 'nature')).toBe('advantage');
    expect(elementMatchup('nature', 'lightning')).toBe('advantage');
    expect(elementMatchup('lightning', 'frost')).toBe('advantage');
    expect(elementMatchup('frost', 'fire')).toBe('advantage');
    // Reverse direction = disadvantage.
    expect(elementMatchup('nature', 'fire')).toBe('disadvantage');
    expect(elementMatchup('fire', 'frost')).toBe('disadvantage');
    // Non-adjacent = neutral.
    expect(elementMatchup('fire', 'lightning')).toBe('neutral');
  });

  it('Holy and Dark are mutually strong', () => {
    expect(elementMatchup('holy', 'dark')).toBe('advantage');
    expect(elementMatchup('dark', 'holy')).toBe('advantage');
    expect(elementMatchup('holy', 'fire')).toBe('neutral');
  });

  it('no affinity means neutral', () => {
    expect(elementMatchup('fire', undefined)).toBe('neutral');
    expect(elementMatchup(undefined, 'fire')).toBe('neutral');
  });
});

describe('weapon triangle', () => {
  it('Sword → Axe → Lance → Sword; bow and beast are outside the triangle', () => {
    expect(weaponMatchup('sword', 'axe')).toBe('advantage');
    expect(weaponMatchup('axe', 'lance')).toBe('advantage');
    expect(weaponMatchup('lance', 'sword')).toBe('advantage');
    expect(weaponMatchup('axe', 'sword')).toBe('disadvantage');
    // Bow and beast: neutral against the triangle.
    expect(weaponMatchup('bow', 'sword')).toBe('neutral');
    expect(weaponMatchup('sword', 'bow')).toBe('neutral');
    expect(weaponMatchup('beast', 'lance')).toBe('neutral');
    expect(weaponMatchup('axe', 'beast')).toBe('neutral');
    // But bow beats beast (the hunter's niche).
    expect(weaponMatchup('bow', 'beast')).toBe('advantage');
    expect(weaponMatchup('beast', 'bow')).toBe('disadvantage');
  });

  it('multipliers are +50% / −25%', () => {
    expect(matchupPct('advantage')).toBe(150);
    expect(matchupPct('disadvantage')).toBe(75);
    expect(matchupPct('neutral')).toBe(100);
  });
});

/**
 * THE DEFENDERS HERE CARRY REAL BOARDS (2026-09-06). They used to be empty-board
 * dummies with `elementAffinity` / `weaponAffinity` set directly on the setup —
 * which stopped working the day affinity became a passive buff derived from the
 * board and from nothing else (user ruling; `initCombatant` no longer reads
 * those setup fields). Each defender below now EARNS its affinity by holding
 * `IDENTITY_THRESHOLD` cards of the type, which is also a truer fixture: the
 * matchup a player actually meets comes off a board.
 *
 * The attacker is faster (speed 20+ vs 10) in every case, so the hit under test
 * is the first thing that resolves and the defender's own cards cannot touch it.
 * Every assertion names the victim's `side` rather than taking "the first damage
 * event" so a future defender cast cannot silently become the thing measured.
 */
const FIRE_BOARD = ['cinder_dart', 'ember_lash', 'scorching_brand'];
const FROST_BOARD = ['frost_shackle', 'glacial_spike', 'slow_hex'];
const AXE_BOARD = ['armor_break', 'cleaving_creed', 'rupturing_strike'];
const SWORD_BOARD = ['sword_slash', 'follow_through', 'silencing_slash'];
const BEAST_BOARD = ['savage_bite', 'blooded_fang', 'nettle_lash'];

describe('matchups in combat', () => {
  it('frost magic hits a fire-affinity enemy for +50%', () => {
    // slow_hex (frost): 8 flat + MP 10 = 18, no resist -> 18, x1.5 = 27.
    const c = cfg(
      tc('hero', ['slow_hex'], { magicPower: 10, speed: 20 }),
      tc('imp', FIRE_BOARD, { speed: 10, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(finalState.enemy.elementAffinity, 'the board must earn the affinity').toBe('fire');
    expect(events.find((e) => e.kind === 'damage' && e.side === 'enemy'))
      .toMatchObject({ amount: 27, matchup: 'advantage' });
  });

  it('fire magic into a fire... into frost affinity is resisted −25%', () => {
    // fireball (fire) vs frost affinity: frost beats fire -> disadvantage.
    // 38 flat + MP 10 = 48 -> x0.75 = 36 (floored). The halving burn is NOT
    // matchup-modified: fireball applies 5 burn, first tick = 2×5 = 10 exactly.
    const c = cfg(
      tc('hero', ['fireball'], { magicPower: 10, speed: 20 }),
      tc('yeti', FROST_BOARD, { speed: 10, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 3 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(finalState.enemy.elementAffinity).toBe('frost');
    expect(events.find((e) => e.kind === 'damage' && e.side === 'enemy' && e.source === 'skill')).toMatchObject({
      amount: 36,
      matchup: 'disadvantage',
    });
    const burnTick = events.find((e) => e.kind === 'damage' && e.side === 'enemy' && e.source === 'burn');
    expect(burnTick).toMatchObject({ amount: 10 }); // 2× printed stacks; matchup never touches DoT ticks
  });

  it('sword beats an axe-affinity enemy for +50%', () => {
    // sword_slash: 20 flat + Attack 10 = 30, 0 armor -> 30, x1.5 = 45.
    const c = cfg(
      tc('hero', ['sword_slash'], { attack: 10, speed: 20 }),
      tc('axeman', AXE_BOARD, { speed: 10, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(finalState.enemy.weaponAffinity).toBe('axe');
    expect(events.find((e) => e.kind === 'damage' && e.side === 'enemy'))
      .toMatchObject({ amount: 45, matchup: 'advantage' });
  });

  it('beast attacks are neutral against the triangle', () => {
    // venom_fang (beast): 12 flat + Attack 10 = 22, no multiplier vs sword affinity.
    const c = cfg(
      tc('hero', ['venom_fang'], { attack: 10, speed: 20 }),
      tc('swordsman', SWORD_BOARD, { speed: 10, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(finalState.enemy.weaponAffinity).toBe('sword');
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 22 });
    expect((hit as { matchup?: string }).matchup).toBeUndefined();
  });

  it('a bow hits a beast-affinity monster for +50%', () => {
    // hunter_shot: 20 flat + Attack 10 = 30, x1.5 = 45 vs the beast wolf.
    const c = cfg(
      tc('hero', ['hunter_shot'], { attack: 10, speed: 20 }),
      tc('wolf', BEAST_BOARD, { speed: 10, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(finalState.enemy.weaponAffinity).toBe('beast');
    expect(events.find((e) => e.kind === 'damage' && e.side === 'enemy'))
      .toMatchObject({ amount: 45, matchup: 'advantage' });
  });

  it('true damage ignores affinities entirely', () => {
    // A DUAL-AFFINITY defender out of real content: 3 Fire + 3 Axe earns BOTH
    // axes (they are tallied separately since 2026-09-06). True damage still
    // consults neither.
    const c = cfg(
      tc('hero', ['soul_rend'], { attack: 10, magicPower: 10, speed: 30 }),
      tc('imp', [...FIRE_BOARD, ...AXE_BOARD], { speed: 10, maxHp: 200 }),
      { ...NO_ENDGAME, maxTurns: 1 },
    );
    const { events, finalState } = simulate(c, 1);
    expect(finalState.enemy.elementAffinity).toBe('fire');
    expect(finalState.enemy.weaponAffinity).toBe('axe');
    const hit = events.find((e) => e.kind === 'damage' && e.side === 'enemy');
    expect(hit).toMatchObject({ amount: 37 }); // 27 flat + max(10,10) stat, no matchup
    expect((hit as { matchup?: string }).matchup).toBeUndefined();
  });
});

describe('data completeness', () => {
  // Design rule (user-locked 2026-07-19): EVERY card is visibly typed by
  // exactly one of weapon / element — buffs, shields, and auras included.
  // Magical cards type by element, physical cards by weapon; TRUE cards may
  // carry either (purely cosmetic — the true property still ignores all
  // matchups; the engine only routes matchups for physical/magical damage).
  it('every card has exactly one type: element (magical), weapon (physical), either (true)', () => {
    for (const skill of Object.values(skillBook)) {
      const typeCount = (skill.element ? 1 : 0) + (skill.weapon ? 1 : 0);
      expect(typeCount, `${skill.id} must have exactly one of element/weapon`).toBe(1);
      if (skill.property === 'magical') {
        expect(skill.element, `${skill.id} (magical) types by element`).toBeDefined();
      } else if (skill.property === 'physical') {
        expect(skill.weapon, `${skill.id} (physical) types by weapon`).toBeDefined();
      }
    }
  });
});
