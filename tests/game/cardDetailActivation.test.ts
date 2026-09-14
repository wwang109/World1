import { describe, expect, it } from 'vitest';
import { CardDetailActivation } from '../../src/game/ui/cardDetailActivation';

describe('card detail activation', () => {
  it('opens only on the second completed activation of the same card', () => {
    const activation = new CardDetailActivation();
    expect(activation.release('board:one', 100)).toBe(false);
    expect(activation.release('board:one', 280)).toBe(true);
    expect(activation.release('board:one', 300)).toBe(false);
  });
  it('never pairs different cards or different surfaces', () => {
    const activation = new CardDetailActivation();
    expect(activation.release('board:1', 100)).toBe(false);
    expect(activation.release('bag:1', 200)).toBe(false);
    expect(activation.release('board:1', 300)).toBe(false);
  });
  it('expires a slow click and tolerates a reset clock', () => {
    const activation = new CardDetailActivation();
    activation.release('shelf:0', 1000);
    expect(activation.release('shelf:0', 1500)).toBe(false);
    expect(activation.release('shelf:0', 10)).toBe(false);
    expect(activation.release('shelf:0', 150)).toBe(true);
  });
  it('cancels the first click when a drag, scroll, or rebuild intervenes', () => {
    const activation = new CardDetailActivation();
    activation.release('bag:1', 100);
    activation.reset();
    expect(activation.release('bag:1', 200)).toBe(false);
  });
});
