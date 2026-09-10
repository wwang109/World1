import { describe, expect, it } from 'vitest';
import type Phaser from 'phaser';
import { eventCatalog, eventRuntimeCatalog } from '../../src/data/events';
import { shopCatalog } from '../../src/data/shopTypes';
import { createRun } from '../../src/run/runState';
import { INK, UI } from '../../src/game/theme';
import {
  runTravelChoiceCardCopy,
  runTravelChoiceCardLayout,
  runTravelChoiceCardMinHeight,
  runTravelChoiceCardsLayout,
  renderRunTravelChoiceCard,
} from '../../src/game/ui/RunTravelChoiceCard';
import { buildRunTravelChoiceViewModel, type RunTravelChoiceViewModel } from '../../src/game/ui/runTravelChoiceViewModel';

const event: RunTravelChoiceViewModel = {
  nodeId: 'event-1', kind: 'event', title: 'EVENT · THE SECOND TOLL',
  detail: 'The Crossroads Unquiet — the biggest gambles.',
  artKey: 'run-art-event-second-toll', accent: 1, enabled: true,
  event: { eventId: 'the_second_toll', chainUnlocked: false, requirementLines: [] },
};
const chain: RunTravelChoiceViewModel = {
  ...event, nodeId: 'chain', title: 'EVENT · THE BELL UNBOUND',
  event: {
    eventId: 'the_bell_unbound', chainUnlocked: true,
    requirementLines: ['Completed: The Bell Beneath the Ice', 'Completed: The Second Toll — Answer with your own name'],
  },
};
const shop: RunTravelChoiceViewModel = {
  nodeId: 'shop', kind: 'shop', title: 'SHOP · THE GROVEKEEP',
  detail: 'Nature supplies.', footer: '6 CARDS · 5 GEMS',
  artKey: 'run-art-shop-banner', accent: 2, enabled: true,
};

describe('travel card identity and actions', () => {
  it('keeps the actual event identity when returning to a committed stop', () => {
    expect(runTravelChoiceCardCopy(chain, true)).toMatchObject({
      eyebrow: 'CHAIN EVENT · UNLOCKED',
      title: 'RETURN TO EVENT · THE BELL UNBOUND',
      action: 'RETURN TO EVENT ›',
      requirementHeading: 'MET REQUIREMENTS',
      requirementLines: ['✓ Completed: The Bell Beneath the Ice', '✓ Completed: The Second Toll — Answer with your own name'],
    });
  });

  it('uses the event, earned-chain and shop actions without changing their kinds', () => {
    expect(runTravelChoiceCardCopy(event)).toMatchObject({ eyebrow: 'EVENT', title: 'THE SECOND TOLL', action: 'CHOOSE EVENT ›' });
    expect(runTravelChoiceCardCopy(chain)).toMatchObject({ eyebrow: 'CHAIN EVENT · UNLOCKED', action: 'TRAVEL HERE ›' });
    expect(runTravelChoiceCardCopy(shop)).toMatchObject({ eyebrow: 'SHOP', title: 'THE GROVEKEEP', action: 'VISIT SHOP ›' });
  });

  it.each(['EASY', 'MEDIUM', 'HARD'])('derives COMBAT · %s from the existing model title', (tier) => {
    const fight: RunTravelChoiceViewModel = { ...event, kind: 'fight', title: `FIGHT · ${tier}`, event: undefined, artKey: undefined };
    expect(runTravelChoiceCardCopy(fight)).toMatchObject({ eyebrow: `COMBAT · ${tier}`, action: 'INSPECT ENCOUNTER ›' });
  });

  it('keeps the temporary boss continuation and all safe pending return actions', () => {
    const boss: RunTravelChoiceViewModel = { ...event, kind: 'boss', title: 'BOSS', event: undefined };
    expect(runTravelChoiceCardCopy(boss)).toMatchObject({ eyebrow: 'MANDATORY DESTINATION', action: 'CONTINUE ›' });
    expect(runTravelChoiceCardCopy(shop, true).action).toBe('RETURN TO SHOP ›');
    expect(runTravelChoiceCardCopy(boss, true).action).toBe('RETURN TO BOSS ›');
    expect(runTravelChoiceCardCopy({ ...event, kind: 'fight', title: 'FIGHT · EASY', event: undefined }, true).action).toBe('RETURN TO FIGHT ›');
  });

  it('never advertises an enabled action or earned receipt for a disabled ordinary card', () => {
    expect(runTravelChoiceCardCopy({ ...event, enabled: false })).toMatchObject({ action: 'LOCKED', requirementLines: [] });
  });
});

// Real renderer + real motion helpers, with only Phaser's display/tween
// boundary replaced. killTweensOf removes the pending property tween exactly
// as the engine does; this catches entrance/hover ownership conflicts.
function travelMotionProbe() {
  type Display = {
    x: number; y: number; alpha: number; parent?: Display; interactive: boolean;
    width: number; height: number; displayWidth: number; displayHeight: number;
    text: string; style: { fontSize: number; color?: string }; fillColor?: number;
    on: (event: string, handler: () => void) => Display;
    emit: (event: string) => void;
    setOrigin: () => Display; setStrokeStyle: () => Display; setData: () => Display;
    setInteractive: () => Display; setFillStyle: () => Display;
    setFontSize: (size: number) => Display; setText: (value: string) => Display;
  };
  const objects: Display[] = [];
  const make = (x: number, y: number, width = 0, height = 0, text = '', fontSize = 9): Display => {
    const handlers = new Map<string, () => void>();
    const object: Display = {
      x, y, alpha: 1, interactive: false, width, height, displayWidth: width, displayHeight: height,
      text, style: { fontSize },
      on(event, handler) { handlers.set(event, handler); return this; },
      emit(event) { handlers.get(event)?.(); },
      setOrigin() { return this; }, setStrokeStyle() { return this; }, setData() { return this; },
      setInteractive() { this.interactive = true; return this; }, setFillStyle() { return this; },
      setFontSize(size) { this.style.fontSize = size; return this; },
      setText(value) { this.text = value; return this; },
    };
    objects.push(object);
    return object;
  };
  type Tween = { targets: Display; y?: number; alpha?: number; fromY: number; fromAlpha: number };
  let tweens: Tween[] = [];
  const scene = {
    textures: { exists: () => false },
    add: {
      rectangle: (x: number, y: number, width: number, height: number, fillColor: number) => Object.assign(make(x, y, width, height), { fillColor }),
      text: (x: number, y: number, value: string, style: { color?: string }) => {
        const object = make(x, y, 0, 0, value);
        object.style.color = style.color;
        return object;
      },
      container: (x: number, y: number, children: Display[]) => {
        const parent = make(x, y);
        children.forEach((child) => { child.parent = parent; });
        return parent;
      },
    },
    tweens: {
      add: (config: Omit<Tween, 'fromY' | 'fromAlpha'>) => {
        tweens.push({ ...config, fromY: config.targets.y, fromAlpha: config.targets.alpha });
      },
      killTweensOf: (target: Display) => { tweens = tweens.filter((tween) => tween.targets !== target); },
      addCounter: () => undefined,
    },
  } as unknown as Phaser.Scene;
  const advance = (progress: number) => {
    tweens.forEach((tween) => {
      if (tween.y !== undefined) tween.targets.y = tween.fromY + (tween.y - tween.fromY) * progress;
      if (tween.alpha !== undefined) tween.targets.alpha = tween.fromAlpha + (tween.alpha - tween.fromAlpha) * progress;
    });
  };
  const worldY = (object: Display): number => object.y + (object.parent ? worldY(object.parent) : 0);
  const worldAlpha = (object: Display): number => object.alpha * (object.parent ? worldAlpha(object.parent) : 1);
  return { scene, objects, advance, worldY, worldAlpha };
}

describe('travel card entrance and hover compose safely', () => {
  it.each([[false, 348, 368], [true, 354, 374]] as const)(
    'compact=%s: hovering before arrival finishes cannot strand the action or label', (compact, actionY, labelY) => {
      const probe = travelMotionProbe();
      renderRunTravelChoiceCard(probe.scene, { x: 0, y: 0, width: 392, height: 400 },
        { ...event, artKey: undefined }, { compact, appearIndex: 2, onSelect: () => undefined });
      const action = probe.objects.find((object) => object.interactive)!;
      const label = probe.objects.find((object) => object.text === 'CHOOSE EVENT ›')!;
      probe.advance(0.4);
      action.emit('pointerover');
      action.emit('pointerout');
      probe.advance(1);
      expect(probe.worldAlpha(action)).toBe(1);
      expect(probe.worldAlpha(label)).toBe(1);
      expect(probe.worldY(action)).toBe(actionY);
      expect(probe.worldY(label)).toBe(labelY);
    },
  );
});

describe('travel cards reserve art, copy, receipt, and a separate 40px action', () => {
  for (const compact of [false, true]) {
    const width = compact ? 392 : 280;
    it(`${compact ? 'compact' : 'desktop'}: each ordinary and chain block clears the action at minimum height`, () => {
      for (const model of [event, chain, shop]) {
        const h = runTravelChoiceCardMinHeight(model, { compact, width });
        const layout = runTravelChoiceCardLayout({ x: 10, y: 20, width, height: h }, model, { compact });
        expect(layout.bounds.height).toBe(h);
        expect(layout.action.height).toBeGreaterThanOrEqual(40);
        expect(layout.action.y + layout.action.height).toBeLessThanOrEqual(20 + h);
        const blocks = [layout.eyebrow, layout.title, layout.detail, ...(layout.footer ? [layout.footer] : []),
          ...(layout.requirements ? [layout.requirements.heading, ...layout.requirements.lines] : [])];
        for (const block of blocks) {
          expect(block.width).toBeGreaterThan(0);
          expect(block.height).toBeGreaterThan(0);
          expect(block.y + block.height).toBeLessThan(layout.action.y);
          expect(block.x).toBeGreaterThanOrEqual(10);
          expect(block.x + block.width).toBeLessThanOrEqual(10 + width);
        }
        expect(layout.requirements?.lines.length ?? 0).toBe(model.event?.requirementLines.length ?? 0);
      }
    });

    it(`${compact ? 'compact' : 'desktop'}: longer receipts grow the card instead of losing a line`, () => {
      const five = { ...chain, event: { ...chain.event!, requirementLines: [...chain.event!.requirementLines, 'Won 3 fights', 'Suffered 2 defeats', 'Cleared 1 boss'] } };
      const h = runTravelChoiceCardMinHeight(five, { compact, width });
      expect(h).toBeGreaterThan(runTravelChoiceCardMinHeight(chain, { compact, width }));
      const layout = runTravelChoiceCardLayout({ x: 0, y: 0, width, height: 40 }, five, { compact });
      expect(layout.bounds.height).toBe(h);
      expect(layout.requirements?.lines).toHaveLength(5);
      expect(layout.requirements!.lines[4]!.y + layout.requirements!.lines[4]!.height).toBeLessThan(layout.action.y);
    });
  }

  it('places authored art above desktop copy and to the left of compact copy', () => {
    for (const compact of [false, true]) {
      const layout = runTravelChoiceCardLayout({ x: 0, y: 0, width: 392, height: 500 }, event, { compact });
      expect(layout.art).toBeDefined();
      if (compact) expect(layout.art!.x + layout.art!.width).toBeLessThan(layout.title.x);
      else expect(layout.art!.y + layout.art!.height).toBeLessThan(layout.eyebrow.y);
    }
    const noArt = runTravelChoiceCardLayout({ x: 0, y: 0, width: 280, height: 300 }, { ...event, artKey: undefined }, { compact: false });
    expect(noArt.art).toBeUndefined();
  });

  it('fits three desktop choices side by side with aligned bottoms inside the planner', () => {
    const layout = runTravelChoiceCardsLayout({ x: 526, y: 222, width: 866, height: 514 }, [chain, event, shop], { compact: false });
    expect(layout.cards).toHaveLength(3);
    expect(layout.height).toBeLessThan(514);
    for (let i = 0; i < 3; i++) {
      const card = layout.cards[i]!;
      expect(card.y).toBe(222);
      expect(card.width).toBeGreaterThanOrEqual(280);
      expect(card.x + card.width).toBeLessThanOrEqual(1392.001);
      if (i > 0) expect(card.x - (layout.cards[i - 1]!.x + layout.cards[i - 1]!.width)).toBeCloseTo(12);
    }
  });

  it('fits one chain and two ordinary compact rows in the phone planner, growing only the chain row', () => {
    const bounds = { x: 10, y: 326, width: 392, height: 502 };
    const ordinary = runTravelChoiceCardsLayout(bounds, [event, event, shop], { compact: true });
    const earned = runTravelChoiceCardsLayout(bounds, [chain, event, shop], { compact: true });
    expect(earned.cards[0]!.height).toBeGreaterThan(ordinary.cards[0]!.height);
    expect(earned.cards[1]!.height).toBe(ordinary.cards[1]!.height);
    expect(earned.cards[2]!.height).toBe(ordinary.cards[2]!.height);
    expect(earned.height).toBeLessThanOrEqual(502);
    for (let i = 1; i < 3; i++) {
      expect(earned.cards[i]!.y - (earned.cards[i - 1]!.y + earned.cards[i - 1]!.height)).toBe(8);
    }
    expect(earned.cards[2]!.y + earned.cards[2]!.height).toBeLessThanOrEqual(828);
  });

  it('has no phantom card for an empty destination list', () => {
    expect(runTravelChoiceCardsLayout({ x: 0, y: 0, width: 392, height: 490 }, [], { compact: true })).toEqual({ cards: [], height: 0 });
  });

  it('fits real catalog copy and earned receipts in every distinct-theme phone stop composition', () => {
    const run = createRun(404);
    run.eventResolutions = {};
    run.wins = 999; run.losses = 999; run.bossesCleared = 999;
    Object.assign(run.stats, { goldSpent: 999, cardsBought: 999, gemsBought: 999, livesLost: 999 });
    for (const prior of Object.values(eventCatalog)) {
      for (const choice of prior.choices) {
        const instanceId = `${prior.id}:${choice.id}`;
        run.eventResolutions[instanceId] = { eventId: prior.id, choiceId: choice.id, contentVersion: 1, instanceId };
      }
    }
    const byTheme = new Map<string, RunTravelChoiceViewModel>();
    const height = (model: RunTravelChoiceViewModel) => runTravelChoiceCardMinHeight(model, { compact: true, width: 392 });
    for (const preview of [...Object.values(eventCatalog), ...Object.values(eventRuntimeCatalog)]) {
      const model = buildRunTravelChoiceViewModel(run, {
        id: preview.id, kind: 'event', depth: 3, wave: 1, eventTheme: preview.theme,
      }, preview, null);
      if (!byTheme.has(preview.theme) || height(model) > height(byTheme.get(preview.theme)!)) byTheme.set(preview.theme, model);
    }
    const events = [...byTheme.values()];
    const shops = Object.values(shopCatalog).map((def) => buildRunTravelChoiceViewModel(run, {
      id: def.id, kind: 'shop', depth: 3, wave: 1, shopId: def.id,
    }, null, null));
    let tallest = { height: 0, titles: '' };
    for (let i = 0; i < events.length; i++) {
      for (let j = i + 1; j < events.length; j++) {
        // The generator supplies distinct event themes, with at most one shop.
        for (const third of [...events.slice(j + 1), ...shops]) {
          const models = [events[i]!, events[j]!, third];
          const layout = runTravelChoiceCardsLayout({ x: 10, y: 326, width: 392, height: 502 }, models, { compact: true });
          if (layout.height > tallest.height) tallest = { height: layout.height, titles: models.map((model) => model.title).join(' / ') };
        }
      }
    }
    expect(326 + tallest.height, tallest.titles).toBeLessThanOrEqual(828);
  });
});

describe('route card visual hierarchy', () => {
  it.each([false, true])('compact=%s: difficulty and kind headers use the existing semantic colors', (compact) => {
    const cases: Array<[RunTravelChoiceViewModel, string]> = [
      [event, INK.accent], [shop, INK.gain],
      [{ ...event, kind: 'fight', title: 'FIGHT · EASY', artKey: undefined }, INK.gain],
      [{ ...event, kind: 'fight', title: 'FIGHT · MEDIUM', artKey: undefined }, INK.resource],
      [{ ...event, kind: 'fight', title: 'FIGHT · HARD', artKey: undefined }, INK.alarm],
      [{ ...event, kind: 'boss', title: 'BOSS', artKey: undefined }, INK.alarm],
    ];
    for (const [model, color] of cases) {
      const probe = travelMotionProbe();
      renderRunTravelChoiceCard(probe.scene, { x: 0, y: 0, width: 392, height: 0 }, model, { compact, onSelect: () => undefined });
      const eyebrow = probe.objects.find((object) => object.text === runTravelChoiceCardCopy(model).eyebrow)!;
      expect(eyebrow.style.color, model.title).toBe(color);
      expect(probe.objects.some((object) => object.fillColor === UI.panelMuted && object.y === eyebrow.y && !object.interactive)).toBe(true);
      expect(probe.objects.filter((object) => object.interactive)).toHaveLength(1);
    }
  });

  it('keeps artless desktop encounter cards content-sized instead of stretching empty bodies to the planner floor', () => {
    const models = ['EASY', 'MEDIUM', 'HARD'].map((tier) => ({
      ...event, kind: 'fight' as const, title: `FIGHT · ${tier}`, detail: `${tier} · Stone Beetle · LV 1 · NORMAL`, artKey: undefined,
    }));
    const layout = runTravelChoiceCardsLayout({ x: 526, y: 332, width: 866, height: 800 }, models, { compact: false });
    expect(layout.height).toBeLessThan(250);
    expect(new Set(layout.cards.map((card) => card.height)).size).toBe(1);
    for (const [index, model] of models.entries()) {
      const probe = travelMotionProbe();
      renderRunTravelChoiceCard(probe.scene, layout.cards[index]!, model, { compact: false, onSelect: () => undefined });
      expect(probe.objects.filter((object) => object.text === 'Stone Beetle')).toHaveLength(1);
      expect(probe.objects.some((object) => object.text === 'LV 1 · NORMAL')).toBe(true);
    }
  });
});
