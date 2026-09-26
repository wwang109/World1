import type { TurnFx } from '../battleTimeline';
import type { SfxKey } from './sfxRecipes';

export function sfxKeyForFx(fx: TurnFx): SfxKey | null {
  switch (fx.kind) {
    case 'damage':
      if (fx.source) return 'dotTick';
      if (fx.weapon) return `hit:${fx.weapon}`;
      if (fx.element) return `hit:${fx.element}`;
      if (fx.property === 'magical') return 'hitMagical';
      if (fx.property === 'true') return 'hitTrue';
      return 'hitPhysical';
    case 'heal':
      return 'heal';
    case 'shield':
      return 'shieldGain';
    case 'cast':
      return fx.archetype ? `cast:${fx.archetype}` : null;
    case 'shieldBroken':
      return 'shieldBreak';
    case 'negated':
      return 'negated';
    case 'warded':
      return 'warded';
    case 'statusApplied':
      return fx.status ? `status:${fx.status}` : null;
    case 'died':
      return 'died';
    case 'phase':
      return 'phase';
    default:
      return null;
  }
}
