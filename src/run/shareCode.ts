// Share codes — the dual-use loadout codec (docs/sandbox-features-proposal.md §3).
//
// A code is ONE side's loadout: board (cards + tiers + slots + socketed gems),
// bag, loose gem inventory, hero level and stat buys. On paste the player
// chooses PLAY IT (it becomes the hero setup) or FIGHT IT (it becomes the
// enemy's custom deck — Feature A's `FoeDeckCard[]` shape); those two mappers
// are game-layer glue in `src/game/shareActions.ts`, because they touch
// `demoState`. THIS module is pure TS — no Phaser, no DOM (it lives in
// `src/run`, inside the boundary checker's guarded PURE_DIRS) — so the codec
// runs identically in the browser, in Node tests, and in scripts.
//
// TEXT FORM: `W1-` + Crockford base32 of (payload ‖ 16-bit checksum). Codes
// are minted uppercase; the decoder is case-insensitive, maps the Crockford
// aliases `I`/`L` -> `1` and `O` -> `0`, and ignores hyphens/whitespace after
// the prefix, so a code survives re-typing and chat re-wrapping.
//
// PAYLOAD: an MSB-first bitstream (BitWriter/BitReader below — no dependency):
//
//   | # | field          | bits  | notes                                     |
//   |---|----------------|-------|-------------------------------------------|
//   | 0 | codecVersion   | 8     | 1. Decoder: >1 -> "newer version" reject. |
//   | 1 | flags          | 8     | reserved, 0 in v1 (nonzero -> newer).     |
//   | 2 | heroLevel      | 8     | 1..255 (encode clamps).                   |
//   | 3 | allocation     | 6×8   | buy counts in SHARE_STAT_ORDER.           |
//   | 4 | boardCount     | 4     | 0..10.                                    |
//   | 5 | per board card | 27/47 | cid20 · tier(2) · slot(4) · hasGem(1)     |
//   |   |                |       | · [gid20 when hasGem].                    |
//   | 6 | bagCount       | 4     | 0..10.                                    |
//   | 7 | per bag card   | 22    | cid20 · tier(2).                          |
//   | 8 | gemInvCount    | 6     | 0..63 (encode clamps).                    |
//   | 9 | per loose gem  | 20    | gid20.                                    |
//   |10 | zero-pad       | 0..7  | to the byte boundary.                     |
//   |11 | checksum       | 16    | fold16(FNV-1a-32 over payload bytes).     |
//
// ID REFERENCES (`cid20`/`gid20`): 20-bit folds of FNV-1a-32 over the id
// STRING, in two separate namespaces (card refs resolve only against
// `skillBook`, gem refs only against `gemBook`). Hashed ids never renumber —
// content ADDITIONS are free; only a removed/renamed id degrades, per entry,
// with a report (never the whole code). A fold collision inside one namespace
// would be a silent mis-decode, so `buildRefTable` throws on one and the
// pinned uniqueness test in tests/run/shareCode.test.ts is the authoring-time
// tripwire (verified zero collisions over today's 183 cards + 53 gems); the
// escape is codec v2 with a wider hash.
//
// FAILURE MODES (two classes, two behaviors — §3.5):
//   1. STRUCTURAL -> hard reject (`ShareCodeError`): bad prefix, non-alphabet
//      char, truncation/extension, checksum mismatch, newer version/flags,
//      counts out of range, slot overlap/overflow. Once framing or the
//      checksum is broken no field can be trusted — partial-loading garbage
//      is exactly what the checksum exists to prevent.
//   2. CONTENT DRIFT -> partial load with a report: a well-framed v1 code
//      whose id fold misses the current book (card/gem removed or renamed
//      since minting) skips THAT entry, counts it in `DecodeReport`, and
//      loads the rest.
//
// WIRE CONSTANTS ARE PINNED, NOT IMPORTED, deliberately: the field widths,
// the stat order and the 10-slot geometry are v1's serialized contract. If
// the game's own constants ever move (a wider board, a new stat), v1 codes
// in the wild still mean what they meant — the change is a codec VERSION
// bump, never a silent reinterpretation. Tests assert the pinned copies
// still match the live game so a drift screams at authoring time.

import { skillBook } from '../data/skills';
import { gemBook } from '../data/gems';
import { clampTierToCard } from '../engine/types';
import type { SkillTier } from '../engine/types';
import { bankedPL, type Allocation, type LevelStat } from './leveling';

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** One side's complete sandbox build — everything a code carries. */
export interface ShareLoadout {
  heroLevel: number;
  /** Buy counts per stat, in `SHARE_STAT_ORDER` (6 entries). */
  allocation: number[];
  board: Array<{ skillId: string; tier: SkillTier; slot: number; gemId: string | null }>;
  /** Bag cards in stored order; slot GAPS are not carried (bag order is
   * cosmetic — bag cards never fight) and the importer re-packs by size. */
  bag: Array<{ skillId: string; tier: SkillTier }>;
  /** Loose gem inventory ids. */
  gems: string[];
}

export interface DecodeResult { loadout: ShareLoadout; report: DecodeReport }

export interface DecodeReport {
  /** Entries skipped: card id-fold not in this build's book. */
  unknownCards: number;
  /** Gem refs dropped: socketed (card kept, socket cleared) or loose. */
  unknownGems: number;
  /** Human lines: "LV clamped to 1", "stat spend re-fit…", "tier floored on X". */
  clamped: string[];
}

/** Hard-reject classes: `invalid` = framing/checksum/range garbage; `newerVersion`
 * = a well-formed code minted by a future codec (v2+, or v1 reserved flags). */
export type ShareCodeFailure = 'invalid' | 'newerVersion';

export class ShareCodeError extends Error {
  readonly failure: ShareCodeFailure;
  constructor(failure: ShareCodeFailure, message: string) {
    super(message);
    this.name = 'ShareCodeError';
    this.failure = failure;
  }
}

const invalid = (detail: string): ShareCodeError =>
  new ShareCodeError('invalid', `Not a valid code (${detail})`);

// ---------------------------------------------------------------------------
// v1 wire constants (pinned — see the header note)
// ---------------------------------------------------------------------------

export const SHARE_CODE_PREFIX = 'W1-';
export const SHARE_CODEC_VERSION = 1;

/** The v1 wire order for allocation buy counts — pinned copy of the leveling
 * economy's STAT_ORDER (run/leveling.ts). A codec field order may never
 * follow a refactor of the live constant; the shareCode tests assert the two
 * still agree so a divergence is an authoring-time failure, not a silent
 * re-mapping of every code in the wild. */
export const SHARE_STAT_ORDER: readonly LevelStat[] = [
  'maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed',
];

/** The v1 wire order for the 2-bit tier field (0=bronze .. 3=diamond). */
const TIER_WIRE: readonly SkillTier[] = ['bronze', 'silver', 'gold', 'diamond'];

/** v1 geometry: 10 board slots, 10 bag slots (HERO_BOARD_SLOTS' pinned twin). */
const WIRE_BOARD_SLOTS = 10;
const WIRE_BAG_SLOTS = 10;
/** gemInvCount is a 6-bit field. */
const WIRE_MAX_LOOSE_GEMS = 63;
const WIRE_MAX_LEVEL = 255;

// ---------------------------------------------------------------------------
// FNV-1a-32 + folds — the ONE hash algorithm in this module (ids AND checksum)
// ---------------------------------------------------------------------------

function fnv1a32String(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function fnv1a32Bytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The 20-bit id reference: `(h ^ (h >>> 20)) & 0xFFFFF` over the id string. */
export function foldId20(id: string): number {
  const h = fnv1a32String(id);
  return (h ^ (h >>> 20)) & 0xfffff;
}

/** 16-bit checksum fold of an FNV-1a-32 hash. */
function fold16(h: number): number {
  return (h ^ (h >>> 16)) & 0xffff;
}

// ---------------------------------------------------------------------------
// Id-reference tables — built once from the books, fail-loud on collision
// ---------------------------------------------------------------------------

function buildRefTable(ids: readonly string[], what: string): Map<number, string> {
  const table = new Map<number, string>();
  for (const id of ids) {
    const ref = foldId20(id);
    const prev = table.get(ref);
    if (prev !== undefined && prev !== id) {
      // A collision would decode one id as another — a silent field failure.
      // Refuse to run at all instead; the fix is codec v2 with a wider hash.
      throw new Error(`shareCode: 20-bit id fold collision between ${what} "${prev}" and "${id}" — widen the hash (codec v2)`);
    }
    table.set(ref, id);
  }
  return table;
}

let cardRefTable: Map<number, string> | null = null;
let gemRefTable: Map<number, string> | null = null;

function cardRefs(): Map<number, string> {
  cardRefTable ??= buildRefTable(Object.keys(skillBook), 'cards');
  return cardRefTable;
}

function gemRefs(): Map<number, string> {
  gemRefTable ??= buildRefTable(Object.keys(gemBook), 'gems');
  return gemRefTable;
}

// ---------------------------------------------------------------------------
// Bitstream (MSB-first)
// ---------------------------------------------------------------------------

class BitWriter {
  private readonly bytes: number[] = [];
  private cur = 0;
  private nbits = 0;

  /** Write the low `bits` bits of `value`, MSB first. */
  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i -= 1) {
      this.cur = (this.cur << 1) | ((value >>> i) & 1);
      this.nbits += 1;
      if (this.nbits === 8) {
        this.bytes.push(this.cur);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }

  /** Zero-pad to the byte boundary and return the payload bytes. */
  finish(): Uint8Array {
    if (this.nbits > 0) {
      this.bytes.push((this.cur << (8 - this.nbits)) & 0xff);
      this.cur = 0;
      this.nbits = 0;
    }
    return Uint8Array.from(this.bytes);
  }
}

class BitReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  read(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i += 1) {
      const byte = this.bytes[this.pos >> 3];
      if (byte === undefined) throw invalid('truncated payload');
      v = ((v << 1) | ((byte >> (7 - (this.pos & 7))) & 1)) >>> 0;
      this.pos += 1;
    }
    return v;
  }

  bitsLeft(): number {
    return this.bytes.length * 8 - this.pos;
  }
}

// ---------------------------------------------------------------------------
// Crockford base32
// ---------------------------------------------------------------------------

const B32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const B32_INDEX = new Map<string, number>([...B32_ALPHABET].map((ch, i) => [ch, i]));

function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let nbits = 0;
  for (const b of bytes) {
    acc = ((acc << 8) | b) >>> 0;
    nbits += 8;
    while (nbits >= 5) {
      out += B32_ALPHABET[(acc >>> (nbits - 5)) & 31]!;
      nbits -= 5;
    }
  }
  if (nbits > 0) out += B32_ALPHABET[(acc << (5 - nbits)) & 31]!;
  return out;
}

/** `text` must already be canonical (uppercase, aliases mapped, separators
 * stripped). Rejects non-alphabet chars and nonzero final-char padding — the
 * padding check is what keeps a flipped LAST character from decoding to the
 * same bytes (its low bits are outside every byte, so the checksum alone
 * cannot see them). */
function base32Decode(text: string): Uint8Array {
  const bytes: number[] = [];
  let acc = 0;
  let nbits = 0;
  for (const ch of text) {
    const v = B32_INDEX.get(ch);
    if (v === undefined) throw invalid(`character "${ch}"`);
    acc = ((acc << 5) | v) >>> 0;
    nbits += 5;
    if (nbits >= 8) {
      bytes.push((acc >>> (nbits - 8)) & 0xff);
      nbits -= 8;
    }
  }
  if (nbits > 0 && (acc & ((1 << nbits) - 1)) !== 0) throw invalid('padding');
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------
// Allocation helpers (shared by the codec and the game-layer mappers)
// ---------------------------------------------------------------------------

/** `Allocation` (buy counts by stat) -> the 6 wire counts in SHARE_STAT_ORDER. */
export function allocationToCounts(alloc: Allocation): number[] {
  return SHARE_STAT_ORDER.map((stat) => Math.max(0, Math.floor(alloc[stat] ?? 0)));
}

/** The 6 wire counts -> `Allocation` (zero counts omitted, canonical form). */
export function countsToAllocation(counts: readonly number[]): Allocation {
  const alloc: Allocation = {};
  SHARE_STAT_ORDER.forEach((stat, i) => {
    const buys = Math.max(0, Math.floor(counts[i] ?? 0));
    if (buys > 0) alloc[stat] = buys;
  });
  return alloc;
}

/** The LV stepper's un-buy order (DesktopPrepScene's level-down loop):
 * cheapest-last, so maxHp survives the longest. */
const REFIT_ORDER: readonly LevelStat[] = ['speed', 'magicResist', 'armor', 'magicPower', 'attack', 'maxHp'];

/**
 * Un-buy stats (in the LV stepper's exact order) until `alloc` fits the PL
 * banked at `level`, so `applyPlayerLevelAllocation` can never throw on an
 * imported spend. Returns a NEW allocation and whether anything changed.
 */
export function refitAllocation(level: number, alloc: Allocation): { alloc: Allocation; changed: boolean } {
  const next: Allocation = { ...alloc };
  let changed = false;
  while (bankedPL(level, next) < 0) {
    const stat = REFIT_ORDER.find((st) => (next[st] ?? 0) > 0);
    if (!stat) break;
    next[stat] = (next[stat] ?? 0) - 1;
    if (next[stat] === 0) delete next[stat];
    changed = true;
  }
  return { alloc: next, changed };
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function tierWireIndex(tier: SkillTier): number {
  const idx = TIER_WIRE.indexOf(tier);
  if (idx < 0) throw new Error(`encodeLoadout: unknown tier "${String(tier)}"`);
  return idx;
}

/**
 * Mint the canonical code for `loadout`. The board is sorted by slot and
 * bag/gems are emitted in stored order, so equal builds mint equal codes and
 * `encodeLoadout(decodeCode(c).loadout) === c`. Out-of-band values that a
 * REAL captured loadout cannot produce are clamped into the wire range
 * (heroLevel 1..255, alloc counts 0..255, loose gems capped at 63); a board
 * or bag that cannot exist at all (more than 10 entries, slots outside the
 * 10-slot rail) throws. Ids are NOT validated against the books — encode is
 * a pure serializer; an id the current book lacks simply degrades on decode.
 */
export function encodeLoadout(loadout: ShareLoadout): string {
  if (loadout.board.length > WIRE_BOARD_SLOTS) {
    throw new Error(`encodeLoadout: ${loadout.board.length} board cards cannot fit ${WIRE_BOARD_SLOTS} slots`);
  }
  if (loadout.bag.length > WIRE_BAG_SLOTS) {
    throw new Error(`encodeLoadout: ${loadout.bag.length} bag cards cannot fit ${WIRE_BAG_SLOTS} slots`);
  }
  const w = new BitWriter();
  w.write(SHARE_CODEC_VERSION, 8);
  w.write(0, 8); // flags — reserved, 0 in v1
  const level = Math.max(1, Math.min(WIRE_MAX_LEVEL, Math.floor(loadout.heroLevel)));
  w.write(level, 8);
  const counts = allocationToCounts(countsToAllocation(loadout.allocation));
  for (const count of counts) w.write(Math.min(255, count), 8);

  const board = [...loadout.board].sort((a, b) => a.slot - b.slot);
  w.write(board.length, 4);
  for (const card of board) {
    if (!Number.isInteger(card.slot) || card.slot < 0 || card.slot >= WIRE_BOARD_SLOTS) {
      throw new Error(`encodeLoadout: board slot ${card.slot} is outside the ${WIRE_BOARD_SLOTS}-slot rail`);
    }
    w.write(foldId20(card.skillId), 20);
    w.write(tierWireIndex(card.tier), 2);
    w.write(card.slot, 4);
    if (card.gemId != null) {
      w.write(1, 1);
      w.write(foldId20(card.gemId), 20);
    } else {
      w.write(0, 1);
    }
  }

  w.write(loadout.bag.length, 4);
  for (const card of loadout.bag) {
    w.write(foldId20(card.skillId), 20);
    w.write(tierWireIndex(card.tier), 2);
  }

  const gems = loadout.gems.slice(0, WIRE_MAX_LOOSE_GEMS);
  w.write(gems.length, 6);
  for (const gemId of gems) w.write(foldId20(gemId), 20);

  const payload = w.finish();
  const crc = fold16(fnv1a32Bytes(payload));
  const framed = new Uint8Array(payload.length + 2);
  framed.set(payload, 0);
  framed[payload.length] = (crc >> 8) & 0xff;
  framed[payload.length + 1] = crc & 0xff;
  return SHARE_CODE_PREFIX + base32Encode(framed);
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Prefix check + alias mapping + separator stripping -> canonical base32 text. */
function canonicalBody(text: string): string {
  const raw = text.trim();
  if (!/^w1-/i.test(raw)) throw invalid('missing W1- prefix');
  const body = raw
    .slice(SHARE_CODE_PREFIX.length)
    .toUpperCase()
    .replace(/[-\s]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
  if (body.length === 0) throw invalid('empty');
  return body;
}

/**
 * Decode a share code. STRUCTURAL failures throw `ShareCodeError` (`failure:
 * 'invalid' | 'newerVersion'`) — see the header's failure-mode contract.
 * CONTENT DRIFT (an id fold the current books no longer contain) degrades per
 * entry and is counted in `report`; decode-side clamps (LV 0, a tier under
 * the card's authored floor, an over-spent allocation) are applied and named
 * in `report.clamped`, mirroring `createOwnedCard`'s own stamping floor.
 */
export function decodeCode(text: string): DecodeResult {
  const bytes = base32Decode(canonicalBody(text));
  if (bytes.length < 3) throw invalid('too short');
  const payload = bytes.subarray(0, bytes.length - 2);
  const carried = ((bytes[bytes.length - 2]! << 8) | bytes[bytes.length - 1]!) & 0xffff;
  if (fold16(fnv1a32Bytes(payload)) !== carried) throw invalid('checksum mismatch');

  const r = new BitReader(payload);
  const version = r.read(8);
  if (version > SHARE_CODEC_VERSION) {
    throw new ShareCodeError('newerVersion', 'Code from a newer game version');
  }
  if (version !== SHARE_CODEC_VERSION) throw invalid(`version ${version}`);
  const flags = r.read(8);
  if (flags !== 0) {
    // Reserved bits set = a v1.x minor this build does not know how to read.
    throw new ShareCodeError('newerVersion', 'Code from a newer game version');
  }

  const report: DecodeReport = { unknownCards: 0, unknownGems: 0, clamped: [] };

  let heroLevel = r.read(8);
  if (heroLevel < 1) {
    heroLevel = 1;
    report.clamped.push('LV clamped to 1');
  }

  const counts: number[] = [];
  for (let i = 0; i < SHARE_STAT_ORDER.length; i += 1) counts.push(r.read(8));

  const boardCount = r.read(4);
  if (boardCount > WIRE_BOARD_SLOTS) throw invalid('board count out of range');
  const board: ShareLoadout['board'] = [];
  const rawSlots = new Set<number>();
  for (let i = 0; i < boardCount; i += 1) {
    const cardRef = r.read(20);
    const tierIdx = r.read(2);
    const slot = r.read(4);
    const hasGem = r.read(1) === 1;
    const gemRef = hasGem ? r.read(20) : null;
    if (slot >= WIRE_BOARD_SLOTS) throw invalid('board slot out of range');
    if (rawSlots.has(slot)) throw invalid('board slots overlap');
    rawSlots.add(slot);
    const skillId = cardRefs().get(cardRef);
    if (skillId === undefined) {
      // Content drift: this card no longer exists in the book — skip the
      // entry (its socketed gem rides the card and goes with it).
      report.unknownCards += 1;
      continue;
    }
    let gemId: string | null = null;
    if (gemRef !== null) {
      gemId = gemRefs().get(gemRef) ?? null;
      if (gemId === null) report.unknownGems += 1; // card kept, socket cleared
    }
    const carriedTier = TIER_WIRE[tierIdx]!;
    const skill = skillBook[skillId]!;
    const tier = clampTierToCard(skill, carriedTier) ?? carriedTier;
    if (tier !== carriedTier) report.clamped.push(`tier floored on ${skillId}`);
    board.push({ skillId, tier, slot, gemId });
  }
  // Geometry over the surviving (known) cards: size-aware overlap/overflow is
  // a STRUCTURAL failure — a genuinely minted code cannot contain it.
  const covered = new Array<boolean>(WIRE_BOARD_SLOTS).fill(false);
  for (const card of board) {
    const size = skillBook[card.skillId]?.size ?? 1;
    if (card.slot + size > WIRE_BOARD_SLOTS) throw invalid('board slot overflow');
    for (let s = card.slot; s < card.slot + size; s += 1) {
      if (covered[s]) throw invalid('board slots overlap');
      covered[s] = true;
    }
  }

  const bagCount = r.read(4);
  if (bagCount > WIRE_BAG_SLOTS) throw invalid('bag count out of range');
  const bag: ShareLoadout['bag'] = [];
  for (let i = 0; i < bagCount; i += 1) {
    const cardRef = r.read(20);
    const tierIdx = r.read(2);
    const skillId = cardRefs().get(cardRef);
    if (skillId === undefined) {
      report.unknownCards += 1;
      continue;
    }
    const carriedTier = TIER_WIRE[tierIdx]!;
    const tier = clampTierToCard(skillBook[skillId]!, carriedTier) ?? carriedTier;
    if (tier !== carriedTier) report.clamped.push(`tier floored on ${skillId}`);
    bag.push({ skillId, tier });
  }

  const gemCount = r.read(6); // 6 bits cannot exceed the 63 cap by construction
  const gems: string[] = [];
  for (let i = 0; i < gemCount; i += 1) {
    const gemId = gemRefs().get(r.read(20));
    if (gemId === undefined) {
      report.unknownGems += 1;
      continue;
    }
    gems.push(gemId);
  }

  // Nothing may trail the declared fields but the byte-boundary zero pad.
  const left = r.bitsLeft();
  if (left >= 8) throw invalid('trailing data');
  if (left > 0 && r.read(left) !== 0) throw invalid('nonzero padding');

  // An over-spent allocation (possible only from a tampered-but-checksum-lucky
  // or future-minted code) is re-fit with the LV stepper's own un-buy loop so
  // `applyPlayerLevelAllocation` can never throw on an import.
  const refit = refitAllocation(heroLevel, countsToAllocation(counts));
  if (refit.changed) report.clamped.push('stat spend re-fit to the LV budget');

  return {
    loadout: {
      heroLevel,
      allocation: allocationToCounts(refit.alloc),
      board,
      bag,
      gems,
    },
    report,
  };
}
