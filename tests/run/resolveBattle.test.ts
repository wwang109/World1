import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as encounterResolver from '../../src/run/encounter';
import { enemies } from '../../src/data/enemies';
import { onRequestPost } from '../../functions/battle';
import { resolveBattle, type BattleRequest } from '../../src/run/resolveBattle';
import { buildBattleTimeline, type BattleTimelineInput } from '../../src/game/battleTimeline';
import { battleRequestOf } from '../../src/game/battleApi';
import { buildEnemyEncounter, buildAutoHeroSetup } from '../../src/run/encounter';
import { simulate } from '../../src/engine/combat/simulate';
import { skillBook } from '../../src/data/skills';

// Capture the real development route without opening a listener or server.
const devRoute = vi.hoisted(() => ({ handle: undefined as undefined | ((req: IncomingMessage, res: ServerResponse) => void) }));
vi.mock('node:http', () => ({
  createServer: (handle: (req: IncomingMessage, res: ServerResponse) => void) => {
    devRoute.handle = handle;
    return { listen: () => undefined };
  },
}));

const PIECES = [
  { instanceId: 'c1', skillId: 'sword_slash', tier: 'bronze', slot: 0 },
  { instanceId: 'c2', skillId: 'second_wind', tier: 'bronze', slot: 1 },
] as const;

const REQUEST: BattleRequest = {
  pieces: PIECES.map((p) => ({ ...p })),
  heroLevel: 3,
  heroAllocation: {},
  foes: [{ enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2 }],
  seed: 7,
};

const TIMELINE_INPUT: BattleTimelineInput = {
  pieces: PIECES.map((p) => ({ ...p })),
  heroLevel: 3,
  heroAllocation: {},
  enemyId: 'bandit_duelist',
  enemyLevel: 1,
  enemyTitle: 'elite',
  enemyRank: 2,
  seed: 7,
};

describe('run/resolveBattle', () => {
  it('rebuilds level-2/4 milestone boards, modifiers, and custom decks identically in both service twins and playback', async () => {
    const original = enemies.cinder_sprite!;
    enemies.cinder_sprite = { ...original, growth: [
      { family: { kind: 'element', type: 'fire' }, purpose: 'complete-affinity', candidates: [{ skillId: 'cinder_dart' }] },
      { family: { kind: 'element', type: 'fire' }, purpose: 'reinforce-family', candidates: [{ skillId: 'fireball' }] },
    ] };
    try {
      await import('../../server/battleApi');
      const input: BattleTimelineInput = { ...TIMELINE_INPUT, enemyTeam: [
        { enemyId: 'cinder_sprite', level: 2, title: 'normal', rank: 0, growthLevel: 2, fightNumber: 14, modifiers: [], affix: null },
        { enemyId: 'cinder_sprite', level: 4, title: 'normal', rank: 0, growthLevel: 4, fightNumber: 14, modifiers: ['diamond', 'swift'], affix: null },
        { enemyId: 'cinder_sprite', level: 4, title: 'normal', rank: 0, growthLevel: 4, fightNumber: 14, modifiers: [], affix: null,
          deck: [{ skillId: 'sword_slash', slot: 0, tier: 'silver' }] },
        { enemyId: 'bandit_duelist', level: 3, title: 'elite', rank: 0, growthLevel: 3, fightNumber: 3, modifiers: [], affix: 'braced' },
      ] };
      const preview = input.enemyTeam!.map((f) => buildEnemyEncounter(f.enemyId, f.level, f.title, f.rank, f.modifiers, f.affix, f.fightNumber, f.deck, f.growthLevel).setup);
      expect(preview[0]!.pieces.map((p) => p.skillId)).toEqual(['kindling_rite', 'scorching_brand', 'cinder_dart']);
      expect(preview[1]!.pieces.map((p) => [p.skillId, p.slot, p.tier])).toEqual([
        ['kindling_rite', 0, 'diamond'], ['scorching_brand', 1, 'diamond'], ['cinder_dart', 2, 'diamond'], ['fireball', 3, 'diamond'],
      ]);
      expect(preview[2]!.pieces).toEqual([{ skillId: 'sword_slash', slot: 0, tier: 'silver' }]);
      const payload = JSON.stringify(battleRequestOf(input));
      const capture = vi.spyOn(encounterResolver, 'buildEnemyEncounter');
      try {
        const req = Object.assign(new EventEmitter(), { method: 'POST', url: '/battle' });
        let status = 0;
        let devBody = '';
        const res = { writeHead: (code: number) => { status = code; }, end: (body: string) => { devBody = body; } };
        devRoute.handle!(req as IncomingMessage, res as unknown as ServerResponse);
        req.emit('data', payload);
        req.emit('end');
        expect(status).toBe(200);
        expect(JSON.stringify(capture.mock.results.map((r) => r.value.setup))).toBe(JSON.stringify(preview));
        capture.mockClear();
        const production = await onRequestPost({ request: new Request('http://world1.test/battle', { method: 'POST', body: payload }) });
        expect(production.status).toBe(200);
        expect(await production.text()).toBe(devBody);
        expect(JSON.stringify(capture.mock.results.map((r) => r.value.setup))).toBe(JSON.stringify(preview));
        capture.mockClear();
        buildBattleTimeline(input, JSON.parse(devBody));
        expect(JSON.stringify(capture.mock.results.map((r) => r.value.setup))).toBe(JSON.stringify(preview));
      } finally { capture.mockRestore(); }
    } finally { enemies.cinder_sprite = original; }
  });
  it('preserves every foe base rank and growth level and resolves the prep board exactly once', () => {
    const prep = buildEnemyEncounter('cinder_sprite', 4, 'normal', 0);
    const input: BattleTimelineInput = { ...TIMELINE_INPUT, enemyId: prep.enemyId,
      enemyLevel: prep.level, enemyTitle: prep.title, enemyRank: 0, enemyGrowthLevel: 4,
      enemyTeam: [
        { enemyId: prep.enemyId, level: 4, title: 'normal', rank: 0, growthLevel: 4, modifiers: [] },
        { enemyId: 'cinder_sprite', level: 2, title: 'normal', rank: 1, growthLevel: 6, modifiers: [] },
      ],
    };
    const request = battleRequestOf(input);
    expect(request.foes.map((f) => [f.rank, f.growthLevel])).toEqual([[0, 4], [1, 6]]);
    const singular = battleRequestOf({ ...input, enemyTeam: [] });
    expect(singular.foes[0]!.growthLevel).toBe(4);
    const hero = buildAutoHeroSetup(request.heroLevel, [...request.pieces], request.heroAllocation).setup;
    const second = buildEnemyEncounter('cinder_sprite', 2, 'normal', 1, [], null, undefined, null, 6);
    const expected = simulate({ playerTeam: [hero], enemyTeam: [prep.setup, second.setup], skillBook }, request.seed);
    expect(resolveBattle(request).events).toEqual(expected.events);
    const wrong = { ...request, foes: request.foes.map((f, i) => i === 0 ? { ...f, rank: prep.rank } : f) };
    expect(resolveBattle(wrong).events).not.toEqual(expected.events);
  });
  it('reconstructs the depth-ramped first-boss recipe when fightNumber is explicit', () => {
    const prep = buildEnemyEncounter('bramble_matriarch', 5, 'boss', 0, [], null, 5, null, 5);
    expect(prep.effectiveLevel).toBe(6);
    expect(prep.setup.pieces).toHaveLength(3);
    const request: BattleRequest = {
      ...REQUEST,
      foes: [{ enemyId: prep.enemyId, level: prep.level, title: prep.title, rank: prep.baseRank,
        growthLevel: prep.growthLevel, fightNumber: 5, modifiers: [], affix: null }],
    };
    const expected = simulate({
      playerTeam: [buildAutoHeroSetup(request.heroLevel, [...request.pieces], request.heroAllocation).setup],
      enemyTeam: [prep.setup],
      skillBook,
    }, request.seed);
    expect(resolveBattle(request).events).toEqual(expected.events);
  });
  it('is a pure function of the request — same request, same log', () => {
    const a = resolveBattle(REQUEST);
    const b = resolveBattle(REQUEST);
    expect(b.result).toBe(a.result);
    expect(b.turns).toBe(a.turns);
    expect(b.events).toEqual(a.events);
  });

  it('returns a non-empty event log carrying damage calculations', () => {
    const log = resolveBattle(REQUEST);
    expect(log.events.length).toBeGreaterThan(0);
    const hit = log.events.find((e) => e.kind === 'damage' && e.source === 'skill');
    expect(hit).toBeDefined();
    // The calculation numbers are what let a thin client render damage math it
    // never computed — if these stop shipping, the client cannot show `D:` lines.
    expect((hit as { calculation?: unknown }).calculation).toBeDefined();
  });

  it('omits finalState so the response stays proportional to the events', () => {
    expect(Object.keys(resolveBattle(REQUEST)).sort()).toEqual(['events', 'result', 'turns']);
  });

  it('the request the client would send matches a hand-built one', () => {
    // battleRequestOf is what the client POSTs; if it drifts from the request
    // shape the service expects, every battle silently resolves differently.
    // `affix` rides along with the other per-foe dials: the service rebuilds
    // the foe from these fields alone, so an elite previewed as BRACED would
    // otherwise be re-resolved as a plain elite and fight without its card.
    expect(battleRequestOf(TIMELINE_INPUT)).toEqual({ ...REQUEST, foes: [{ ...REQUEST.foes[0], modifiers: [], affix: null }] });
  });

  it('carries the ELITE AFFIX onto the request, and it changes the resolved deck', () => {
    const affixed: BattleRequest = {
      ...REQUEST,
      foes: [{ ...REQUEST.foes[0]!, affix: 'braced' }],
    };
    const plain = resolveBattle(REQUEST);
    const braced = resolveBattle(affixed);
    // The affix installs `braced_pike` in place of the title's generic filler,
    // so the foe casts a card the plain elite never has.
    const cardsOf = (log: ReturnType<typeof resolveBattle>): string[] =>
      log.events.filter((e) => e.kind === 'play' && e.side === 'enemy').map((e) => (e as { skillId: string }).skillId);
    expect(cardsOf(braced)).toContain('braced_pike');
    expect(cardsOf(plain)).not.toContain('braced_pike');
  });

  it('carries a CUSTOM FOE DECK onto the request, and the event log reflects it', () => {
    // fireball is not on bandit_duelist's authored kit; with a deck the foe
    // casts ONLY its custom cards — the authored board is fully replaced.
    const decked: BattleRequest = {
      ...REQUEST,
      foes: [{ ...REQUEST.foes[0]!, deck: [{ skillId: 'fireball', slot: 0 }] }],
    };
    const cardsOf = (log: ReturnType<typeof resolveBattle>): string[] =>
      log.events.filter((e) => e.kind === 'play' && e.side === 'enemy').map((e) => (e as { skillId: string }).skillId);
    const withDeck = cardsOf(resolveBattle(decked));
    expect(withDeck.length).toBeGreaterThan(0);
    expect(new Set(withDeck)).toEqual(new Set(['fireball']));
    expect(cardsOf(resolveBattle(REQUEST))).not.toContain('fireball');
  });

  it('the affix survives the client -> request hop', () => {
    const request = battleRequestOf({
      ...TIMELINE_INPUT,
      enemyTeam: [{ enemyId: 'bandit_duelist', level: 1, title: 'elite', rank: 2, modifiers: [], affix: 'venomous' }],
    });
    expect(request.foes[0]!.affix).toBe('venomous');
  });

  it('a served log folds into a complete playback model', () => {
    const model = buildBattleTimeline(TIMELINE_INPUT, resolveBattle(battleRequestOf(TIMELINE_INPUT)));
    expect(model.steps.length).toBeGreaterThan(1);
    expect(model.hpByStep).toHaveLength(model.steps.length);
    expect(model.fxByStep).toHaveLength(model.steps.length);
    expect(['VICTORY', 'DEFEAT']).toContain(model.outcome); // no draw exists
    // The damage math survives the wire — a `D:` detail line must be present.
    const details = [...model.linesByTurn.values()].flat().filter((l) => l.detail?.startsWith('D:'));
    expect(details.length).toBeGreaterThan(0);
  });

  it('resolves a multi-foe request in unit order', () => {
    const log = resolveBattle({
      ...REQUEST,
      foes: [
        { enemyId: 'giant_rat', level: 1, title: 'mob', rank: 0 },
        { enemyId: 'ember_imp', level: 1, title: 'normal', rank: 0 },
      ],
    });
    const units = new Set(
      log.events.filter((e) => (e as { side?: string }).side === 'enemy').map((e) => (e as { unit?: number }).unit ?? 0),
    );
    expect(units.has(0)).toBe(true);
    expect(units.has(1)).toBe(true);
  });
});
