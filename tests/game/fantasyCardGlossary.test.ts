import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    GameObjects: { Container: class {} },
    Events: { EventEmitter: class {} },
  },
}));

import { FantasyCardTemplateV2 } from '../../src/game/ui/FantasyCardTemplateV2';

type FakeText = {
  content: string;
  height: number;
  offset: number;
  y: number;
  setOrigin(): FakeText;
  setData(_key: string, value: number): FakeText;
  getData(_key: string): number;
  setY(value: number): FakeText;
};

function fakeText(content: string): FakeText {
  return {
    content,
    height: 10,
    offset: 0,
    y: 0,
    setOrigin() { return this; },
    setData(_key, value) { this.offset = value; return this; },
    getData() { return this.offset; },
    setY(value) { this.y = value; return this; },
  };
}

describe('FantasyCardTemplateV2 glossary layout', () => {
  it('renders a title-only rank without an empty body line or reserved body gap', () => {
    const texts: FakeText[] = [];
    const scene = {
      add: {
        text: (_x: number, _y: number, content: string) => {
          const text = fakeText(content);
          texts.push(text);
          return text;
        },
        graphics: () => ({
          fillStyle() { return this; },
          fillRoundedRect() { return this; },
          lineStyle() { return this; },
          strokeRoundedRect() { return this; },
        }),
        container: () => ({}),
      },
    };
    const host = {
      glossaryTip: undefined,
      skinTrimColor: 0xffffff,
      hideGlossary() {},
      region: () => ({ x: 0, y: 0, w: 260, h: 200 }),
      px: (value: number) => value,
      add() {},
    };

    Reflect.apply(
      (FantasyCardTemplateV2.prototype as unknown as { showGlossary: (...args: unknown[]) => void }).showGlossary,
      host,
      [scene, [
        { title: 'Rank Bronze', body: '' },
        { title: 'Power Level (PL)', body: 'Measures the card cost.' },
      ], 210, 345],
    );

    expect(texts.map((text) => text.content)).toEqual([
      'RANK BRONZE',
      'POWER LEVEL (PL)',
      'Measures the card cost.',
    ]);
    expect(texts[1]!.offset - texts[0]!.offset).toBe(20);
  });
});
