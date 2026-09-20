import { resolveEffectiveSkill } from '../engine/cards';
import { effectiveCooldown } from '../engine/combat/castSelect';
import { BASELINE_COOLDOWN, type BoardPiece, type SkillBook, type SkillDef } from '../engine/types';

export interface ExtraCooldownPiece {
  slot: number;
  skill: SkillDef;
}

export function extraCooldownPieces(pieces: readonly BoardPiece[], book: SkillBook): ExtraCooldownPiece[] {
  const ordered = [...pieces].sort((a, b) => a.slot - b.slot);
  const out: ExtraCooldownPiece[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const piece = ordered[i]!;
    const base = book[piece.skillId];
    if (!base) continue;
    const skill = resolveEffectiveSkill(base, piece);
    if (effectiveCooldown(skill) > BASELINE_COOLDOWN) out.push({ slot: piece.slot, skill });
  }
  return out;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

export interface CastableGap {
  slots: number;
  needed: number;
}

export function castableGap(pieces: readonly BoardPiece[], book: SkillBook): CastableGap | null {
  const sizes: number[] = [];
  const periods: number[] = [];
  let slots = 0;
  for (const piece of pieces) {
    const base = book[piece.skillId];
    if (!base) continue;
    const skill = resolveEffectiveSkill(base, piece);
    if (skill.effects.length === 0 && skill.special === undefined && skill.aura === undefined) continue;
    const period = Math.max(skill.size, effectiveCooldown(skill) + 1);
    sizes.push(skill.size);
    periods.push(period);
    slots += skill.size;
  }
  if (slots === 0) return null;

  let denominator = 1;
  for (let i = 0; i < periods.length; i += 1) denominator = lcm(denominator, periods[i]!);

  let sumScaled = 0;
  for (let i = 0; i < periods.length; i += 1) sumScaled += sizes[i]! * (denominator / periods[i]!);
  if (sumScaled >= denominator) return null;

  const defaultPeriod = BASELINE_COOLDOWN + 1;
  const perDefaultCardScaled = denominator / defaultPeriod;
  const needed = slots + Math.ceil((denominator - sumScaled) / perDefaultCardScaled);
  return { slots, needed };
}
