import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => ({ default: {
  Events: { EventEmitter: (await import('node:events')).EventEmitter },
  Scene: class {},
  GameObjects: { Container: class {} },
  Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) },
} }));
vi.mock('../../src/game/audio/sfxSynth', () => ({ playSfx: vi.fn() }));
vi.mock('../../src/game/ui/runArt', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/game/ui/runArt')>(),
  addRunArt: vi.fn(),
}));

import { DRAFT_SET_KEYS, rollStartDraft, type DraftSetKey } from '../../src/run/draft';
import {
  applyDraftResult,
  availableChoices,
  chooseNode,
  createRun,
  ensureRunShopShelf,
  leaveEvent,
  recordBattleResult,
  type RunNode,
  type RunState,
} from '../../src/run/runState';
import {
  clearRun,
  currentShopShelf,
  getActiveRun,
  installDevRunFixture,
} from '../../src/game/runStore';
import { MobileShopScene } from '../../src/game/scenes/MobileShopScene';

function chainObject(extra: Record<string, unknown> = {}) {
  const obj: any = { x: 0, y: 0, width: 80, height: 18, ...extra };
  for (const name of ['setOrigin', 'setStrokeStyle', 'setInteractive', 'setDepth', 'setAlpha']) {
    obj[name] = vi.fn(() => obj);
  }
  obj.setPosition = vi.fn((x: number, y: number) => { Object.assign(obj, { x, y }); return obj; });
  obj.setSize = vi.fn((width: number, height: number) => { Object.assign(obj, { width, height }); return obj; });
  obj.on = vi.fn((event: string, callback: () => void) => {
    if (event === 'pointerdown') obj.pointerdown = callback;
    return obj;
  });
  return obj;
}

function draftPicksFor(seed: number): Partial<Record<DraftSetKey, string>> {
  const hand = rollStartDraft(seed);
  const picks: Partial<Record<DraftSetKey, string>> = {};
  for (const key of DRAFT_SET_KEYS) picks[key] = hand[key][0]!.skillId;
  return picks;
}

function stateAtFirstShop(seed: number): { state: RunState; node: RunNode } {
  let state = applyDraftResult(createRun(seed), draftPicksFor(seed));
  for (let guard = 0; guard < 200; guard += 1) {
    const choices = availableChoices(state);
    const node = choices.find((choice) => choice.kind === 'shop') ?? choices[0];
    if (!node) throw new Error('run ended before reaching a shop');
    state = chooseNode(state, node.id);
    if (node.kind === 'shop') return { state, node };
    if (node.kind === 'event') state = leaveEvent(state);
    else state = recordBattleResult(state, { won: true, goldEarned: 1 });
  }
  throw new Error('guard exceeded while finding a shop');
}

function installCardOfferFixture(mode: 'BUY' | 'MERGE', gold = 20): void {
  const { state, node } = stateAtFirstShop(3);
  const withShelf = ensureRunShopShelf(state, node.id);
  const shelf = withShelf.shopShelves[node.id]!;
  const offered = { skillId: 'sword_slash', tier: 'bronze' as const, price: 2 };
  installDevRunFixture({
    ...withShelf,
    gold,
    pieces: mode === 'MERGE'
      ? [{ instanceId: 'owned-sword', skillId: offered.skillId, tier: 'bronze', slot: 0 }]
      : [],
    bagSlots: new Array(10).fill(null),
    shopShelves: {
      ...withShelf.shopShelves,
      [node.id]: { ...shelf, cards: [offered, ...shelf.cards.slice(1)] },
    },
  });
}

function confirmationScene() {
  const buttons: any[] = [];
  const scene = new MobileShopScene() as any;
  scene.W = 412;
  scene.H = 892;
  scene.selectedCardIndex = 0;
  scene.pendingBuy = { kind: 'card', index: 0 };
  scene.rerender = vi.fn();
  scene.showToast = vi.fn();
  scene.add = {
    rectangle: (_x: number, _y: number, _w: number, _h: number, fill: number) => {
      const obj = chainObject({ fill });
      buttons.push(obj);
      return obj;
    },
    text: (x: number, _y: number, value: string) => chainObject({ x, width: value.length * 7 }),
  };
  scene.renderConfirm();
  return {
    scene,
    press: (fill: number) => buttons.find((button) => button.fill === fill && button.pointerdown)!.pointerdown(),
  };
}

describe('Mobile Run Shop transaction selection', () => {
  it.each([
    ['BUY', 0xe8b446],
    ['MERGE', 0x7cab63],
  ] as const)('clears selection after successful %s removes the selected offer', (mode, fill) => {
    installCardOfferFixture(mode);
    const before = currentShopShelf()!.cards;
    const shiftedSkillId = before[1]!.skillId;
    const { scene, press } = confirmationScene();

    press(fill);

    const after = currentShopShelf()!.cards;
    expect(after).toHaveLength(before.length - 1);
    expect(after[0]!.skillId).toBe(shiftedSkillId);
    expect(scene.selectedCardIndex).toBeNull();
  });

  it('keeps the selected card after a failed Run BUY', () => {
    installCardOfferFixture('BUY', 0);
    const before = currentShopShelf()!.cards;
    const { scene, press } = confirmationScene();

    press(0xe8b446);

    expect(currentShopShelf()!.cards).toEqual(before);
    expect(scene.selectedCardIndex).toBe(0);
  });

  it('uses a real active Run Shop fixture rather than Sandbox state', () => {
    installCardOfferFixture('BUY');
    expect(getActiveRun()?.currentNodeId).not.toBeNull();
    expect(currentShopShelf()?.cards[0]?.skillId).toBe('sword_slash');
    clearRun();
  });
});
