import { decodeCode, encodeLoadout, countsToAllocation, type ShareLoadout } from './shareCode';
import { canAfford } from './leveling';
import { bandIndexOf, BAND_WAVES } from './biome';
import { MAX_LEVEL } from './runState';
import { GHOST_NAME_MAX, type GhostRecord } from './ghost';

export interface GhostSubmissionInput {
  code: string;
  displayName: string;
  fightNumber: number;
  ownerLocalId: string;
}

export type GhostValidationFailureReason =
  | 'missing-owner'
  | 'empty-name'
  | 'invalid-fight-number'
  | 'invalid-code'
  | 'empty-board'
  | 'decode-drift'
  | 'level-too-high';

export type GhostValidationResult =
  | { ok: true; record: Omit<GhostRecord, 'id' | 'createdAt'> }
  | { ok: false; reason: GhostValidationFailureReason; detail?: string };

const CONTROL_OR_C1 = (code: number): boolean =>
  code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);

export function normalizeGhostName(raw: string): string | null {
  const printable = [...raw].filter((ch) => !CONTROL_OR_C1(ch.codePointAt(0)!)).join('');
  const collapsed = printable.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return [...collapsed].slice(0, GHOST_NAME_MAX).join('');
}

export function maxHeroLevelForFightNumber(fightNumber: number): number {
  return Math.min(MAX_LEVEL, 1 + Math.max(0, Math.floor(fightNumber)));
}

export function isBossFightNumber(fightNumber: number): boolean {
  return Number.isInteger(fightNumber) && fightNumber > 0 && fightNumber % BAND_WAVES === 0;
}

export function validateGhostSubmission(input: GhostSubmissionInput): GhostValidationResult {
  if (typeof input.ownerLocalId !== 'string' || input.ownerLocalId.length === 0) {
    return { ok: false, reason: 'missing-owner' };
  }
  const displayName = normalizeGhostName(input.displayName);
  if (displayName === null) return { ok: false, reason: 'empty-name' };

  if (!isBossFightNumber(input.fightNumber)) {
    return { ok: false, reason: 'invalid-fight-number', detail: `fightNumber ${String(input.fightNumber)}` };
  }

  let decoded: ReturnType<typeof decodeCode>;
  try {
    decoded = decodeCode(input.code);
  } catch (err) {
    return { ok: false, reason: 'invalid-code', detail: err instanceof Error ? err.message : String(err) };
  }
  const { loadout, report } = decoded;
  if (loadout.board.length === 0) return { ok: false, reason: 'empty-board' };
  if (report.clamped.length > 0) {
    return { ok: false, reason: 'decode-drift', detail: report.clamped.join('; ') };
  }

  const maxLevel = maxHeroLevelForFightNumber(input.fightNumber);
  if (loadout.heroLevel > maxLevel) {
    return { ok: false, reason: 'level-too-high', detail: `LV ${String(loadout.heroLevel)} > ${String(maxLevel)}` };
  }
  if (!canAfford(loadout.heroLevel, countsToAllocation(loadout.allocation))) {
    return { ok: false, reason: 'decode-drift', detail: 'allocation exceeds banked PL' };
  }

  const canonical: ShareLoadout = {
    heroLevel: loadout.heroLevel,
    allocation: loadout.allocation,
    board: loadout.board,
    bag: [],
    gems: [],
  };

  return {
    ok: true,
    record: {
      code: encodeLoadout(canonical),
      displayName,
      band: bandIndexOf(input.fightNumber),
      fightNumber: input.fightNumber,
      ownerLocalId: input.ownerLocalId,
    },
  };
}
