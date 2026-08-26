import { describe, expect, it } from 'vitest';
import { enemies } from '../../src/data/enemies';
import { skillBook } from '../../src/data/skills';
import { cardType } from '../../src/engine/combat/typeIdentity';
import { ELEMENT_BEATS, WEAPON_BEATS, elementMatchup, weaponMatchup } from '../../src/engine/elements';
import { REFERENCE_ENEMY_DECK_SIZE } from '../../src/run/encounter';
import { computeEnemyDepthBands, inDepthBand } from '../../src/run/enemyDepth';
import { BOSS_EVERY } from '../../src/run/runMap';
import type { Element, EnemyDef, SkillDef, WeaponType } from '../../src/engine/types';

/**
 * THE SIGNATURE-BOSS CONTRACT.
 *
 * "Boss" in this game is a TITLE assigned by POSITION in the wave
 * (`fightSpecFor` in src/run/runState.ts), and `TITLE_PRESETS.boss` will hang
 * it on whatever mob rolled — so a boss encounter used to be a random monster
 * with +4 levels, never a fight a player could anticipate or build against.
 * The `isBoss`-tagged roster in src/data/enemies.ts is the content answer: a
 * set of MONO-TYPE TRIADS whose authored affinity both names the counter and
 * unlocks the boss's own {{Affinity}} lines.
 *
 * This file pins that shape so a later content pass cannot quietly ship a
 * fourth card (which would move a run-layer pack-budget constant), a deck whose
 * type contradicts its badge (the legibility bug the Warden re-theme closed),
 * or — the one that would silently break the whole promise — a boss nothing in
 * the game can counter.
 */

const ALL = Object.values(enemies);
const BOSSES = ALL.filter((e) => e.isBoss === true);
const UNIVERSAL_STATLINE = { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 };

/** Every card type in the game: the 6 elements + the 5 weapons. */
const ALL_TYPES = [
  ...Object.keys(ELEMENT_BEATS).map((t) => `element:${t}`),
  ...(['sword', 'axe', 'lance', 'bow', 'beast'] as const).map((t) => `weapon:${t}`),
].sort();

const skillOf = (id: string): SkillDef => {
  const skill = skillBook[id];
  if (!skill) throw new Error(`unknown skill on a boss board: ${id}`);
  return skill;
};

/** The single `kind:type` key every card on this board shares, or undefined if they disagree. */
function monoTypeOf(enemy: EnemyDef): string | undefined {
  const keys = enemy.pieces.map((p) => {
    const t = cardType(skillOf(p.skillId));
    return t ? `${t.kind}:${t.type}` : 'none';
  });
  return keys.every((k) => k === keys[0]) ? keys[0] : undefined;
}

/** The affinity badges the def authors, as `kind:type` keys. */
function authoredAffinities(enemy: EnemyDef): string[] {
  const out: string[] = [];
  if (enemy.elementAffinity) out.push(`element:${enemy.elementAffinity}`);
  if (enemy.weaponAffinity) out.push(`weapon:${enemy.weaponAffinity}`);
  return out;
}

describe('signature bosses: the roster exists and covers the type wheel', () => {
  it('the boss pool is more than one monster (it was exactly `wolf_king` before this roster)', () => {
    expect(BOSSES.length).toBeGreaterThan(1);
  });

  it('there is exactly one boss per card type — every buildable identity has a boss it counters', () => {
    const types = BOSSES.map((b) => monoTypeOf(b));
    expect(types.filter((t) => t === undefined)).toEqual([]);
    expect([...types].sort()).toEqual(ALL_TYPES);
  });
});

describe('signature bosses: the mono-type triad shape', () => {
  it('every boss is exactly three cards — a fourth would raise REFERENCE_ENEMY_DECK_SIZE for the whole game', () => {
    for (const boss of BOSSES) expect(boss.pieces.length, boss.id).toBe(3);
    // The run layer derives this LIVE as the roster's largest base deck and
    // prices every pack member's board with it (src/run/encounter.ts). Bosses
    // buy presence with card SIZE, never card COUNT.
    expect(REFERENCE_ENEMY_DECK_SIZE).toBe(3);
  });

  it("every boss's authored affinity matches the type stamped on all three of its cards", () => {
    for (const boss of BOSSES) {
      const mono = monoTypeOf(boss);
      expect(authoredAffinities(boss), boss.id).toContain(mono);
    }
  });

  it('every boss ships the Bronze floor: no tier override, no gem, the universal statline', () => {
    for (const boss of BOSSES) {
      expect(boss.stats, boss.id).toEqual(UNIVERSAL_STATLINE);
      for (const piece of boss.pieces) {
        expect(piece.tier, `${boss.id}/${piece.skillId}`).toBeUndefined();
        expect(piece.gem ?? null, `${boss.id}/${piece.skillId}`).toBeNull();
        expect(skillOf(piece.skillId).tier, `${boss.id}/${piece.skillId}`).toBe('bronze');
      }
    }
  });

  it('every boss board is an EXACT fit: slots sum to boardSize with no overlap and no slack', () => {
    for (const boss of BOSSES) {
      const occupied = new Set<number>();
      let sum = 0;
      for (const piece of boss.pieces) {
        const size = skillOf(piece.skillId).size;
        sum += size;
        for (let s = piece.slot; s < piece.slot + size; s += 1) {
          expect(occupied.has(s), `${boss.id}: slot ${String(s)} used twice`).toBe(false);
          occupied.add(s);
        }
      }
      expect(sum, `${boss.id} boardSize`).toBe(boss.boardSize);
      expect(occupied.size, `${boss.id} leaves an empty slot`).toBe(boss.boardSize);
    }
  });
});

describe('signature bosses: the affinity does real work in both directions', () => {
  it("a boss's own {{Affinity}} lines are OPEN — the gated half a plain mob can never fire", () => {
    // `affinityOpen` (src/engine/combat/interpreter.ts) checks the CASTER's
    // affinity against the CARD's own type, so an authored affinity turns the
    // conditional half of that type's cards on. This is the mechanical
    // difference between a boss and a buffed rat at the same Bronze budget.
    let gatedActionsFound = 0;
    for (const boss of BOSSES) {
      const affinities = authoredAffinities(boss);
      for (const piece of boss.pieces) {
        const skill = skillOf(piece.skillId);
        const type = cardType(skill);
        for (const action of skill.effects) {
          if (action.affinity !== true) continue;
          gatedActionsFound += 1;
          expect(affinities, `${boss.id}/${piece.skillId} gated line is dead`)
            .toContain(`${type!.kind}:${type!.type}`);
        }
      }
    }
    expect(gatedActionsFound, 'no boss fields a gated line at all').toBeGreaterThan(0);
  });

  it('EVERY boss can be countered — some card type takes advantage against it', () => {
    // The whole point of a telegraphed boss: a player who prepares gets +50%.
    // Bow is the trap this guards — `WEAPON_BEATS` has no entry mapping TO
    // bow, so a bow-only badge would be counter-PROOF. The bow boss therefore
    // carries a second, element badge, and this test is what keeps it there.
    for (const boss of BOSSES) {
      const counters: string[] = [];
      for (const el of Object.keys(ELEMENT_BEATS) as Element[]) {
        if (elementMatchup(el, boss.elementAffinity) === 'advantage') counters.push(el);
      }
      for (const w of Object.keys(WEAPON_BEATS) as WeaponType[]) {
        if (weaponMatchup(w, boss.weaponAffinity) === 'advantage') counters.push(w);
      }
      expect(counters, `${boss.id} has no counter type`).not.toEqual([]);
    }
  });
});

describe('signature bosses: the boss wave actually reaches them', () => {
  const bands = computeEnemyDepthBands(BOSSES);

  it('every boss wave has at least one eligible anchor', () => {
    for (let wave = BOSS_EVERY; wave <= 200; wave += BOSS_EVERY) {
      const eligible = BOSSES.filter((b) => inDepthBand(bands[b.id], wave));
      expect(eligible.length, `wave ${String(wave)} has no boss`).toBeGreaterThan(0);
    }
  });

  it('every boss is reachable on some boss wave (no id is authored into a dead band)', () => {
    for (const boss of BOSSES) {
      const waves: number[] = [];
      for (let wave = BOSS_EVERY; wave <= 200; wave += BOSS_EVERY) {
        if (inDepthBand(bands[boss.id], wave)) waves.push(wave);
      }
      expect(waves.length, `${boss.id} is never eligible`).toBeGreaterThan(0);
    }
  });

  it('goldReward seats bosses ABOVE the fight pool, so the two ladders stay separate', () => {
    const topFight = Math.max(...ALL.filter((e) => !e.isBoss).map((e) => e.goldReward));
    for (const boss of BOSSES) expect(boss.goldReward, boss.id).toBeGreaterThan(topFight);
  });
});
