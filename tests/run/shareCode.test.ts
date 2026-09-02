import { describe, expect, it } from 'vitest';
import {
  allocationToCounts,
  countsToAllocation,
  decodeCode,
  encodeLoadout,
  foldId20,
  refitAllocation,
  ShareCodeError,
  SHARE_CODE_PREFIX,
  SHARE_STAT_ORDER,
  type ShareLoadout,
} from '../../src/run/shareCode';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { LEVEL_STAT_COST, spentPL, totalLevelPL } from '../../src/run/leveling';

// ---------------------------------------------------------------------------
// Test-local wire pins — a SECOND, independent implementation of the framing
// (Crockford base32 + FNV-1a-32 fold16 checksum) used for byte surgery, so a
// crafted stale-version / bad-count code carries a VALID checksum and the test
// proves the decoder rejects the FIELD, not just the frame. Duplicating ~30
// lines here also pins the wire algorithm itself: if the codec's hash or
// alphabet ever drifts, these helpers stop agreeing and the suite screams.
// ---------------------------------------------------------------------------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function b32Bytes(body: string): number[] {
  const bytes: number[] = [];
  let acc = 0;
  let n = 0;
  for (const ch of body) {
    acc = ((acc << 5) | ALPHABET.indexOf(ch)) >>> 0;
    n += 5;
    if (n >= 8) {
      bytes.push((acc >>> (n - 8)) & 0xff);
      n -= 8;
    }
  }
  return bytes;
}

function b32Of(bytes: readonly number[]): string {
  let out = '';
  let acc = 0;
  let n = 0;
  for (const b of bytes) {
    acc = ((acc << 8) | b) >>> 0;
    n += 8;
    while (n >= 5) {
      out += ALPHABET[(acc >>> (n - 5)) & 31]!;
      n -= 5;
    }
  }
  if (n > 0) out += ALPHABET[(acc << (5 - n)) & 31]!;
  return out;
}

function fnv(bytes: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Rewrite payload byte `idx` of a minted code and re-frame with a VALID checksum. */
function withByte(code: string, idx: number, value: number): string {
  const bytes = b32Bytes(code.slice(SHARE_CODE_PREFIX.length));
  bytes[idx] = value;
  const payload = bytes.slice(0, bytes.length - 2);
  const h = fnv(payload);
  const crc = (h ^ (h >>> 16)) & 0xffff;
  return SHARE_CODE_PREFIX + b32Of([...payload, (crc >> 8) & 0xff, crc & 0xff]);
}

// ---------------------------------------------------------------------------
// Fixtures (hand-built pure loadouts; demoState-derived ones live in
// tests/game/shareImport.test.ts where the game layer is in scope)
// ---------------------------------------------------------------------------

const EMPTY: ShareLoadout = {
  heroLevel: 1,
  allocation: [0, 0, 0, 0, 0, 0],
  board: [],
  bag: [],
  gems: [],
};

const STARTER: ShareLoadout = {
  heroLevel: 4,
  allocation: [2, 1, 0, 0, 0, 1], // 2+1+2 = 5 PL of the 9 banked at LV 4
  board: [
    { skillId: 'sword_slash', tier: 'bronze', slot: 0, gemId: null },
    { skillId: 'war_banner', tier: 'silver', slot: 1, gemId: 'swift_charm' },
    { skillId: 'fireball', tier: 'bronze', slot: 2, gemId: null }, // size 2 — covers 3
    { skillId: 'second_wind', tier: 'gold', slot: 4, gemId: 'war_banner_echo' },
    { skillId: 'iron_bulwark', tier: 'diamond', slot: 5, gemId: null },
  ],
  bag: [
    { skillId: 'mana_ward', tier: 'bronze' },
    { skillId: 'armor_break', tier: 'silver' },
    { skillId: 'arcane_bolt', tier: 'bronze' },
  ],
  gems: ['venom_sliver', 'stunning_shard', 'archmages_core'],
};

const SIZE_ONE_CARDS = ['sword_slash', 'mana_ward', 'arcane_bolt', 'follow_through', 'armor_break', 'second_wind', 'war_banner', 'sword_slash', 'mana_ward', 'arcane_bolt'];
const GEM_IDS = Object.keys(gemBook);

/** Legal maximum: 10 gemmed size-1 board cards, 10 bag cards, 63 loose gems.
 * Allocation exercises the 8-bit count ceiling while staying AFFORDABLE at
 * LV 255 (762 banked PL) — an over-spend would be re-fit on decode and could
 * not round-trip byte-identically. */
const MAX: ShareLoadout = {
  heroLevel: 255,
  allocation: [255, 255, 100, 0, 0, 0],
  board: SIZE_ONE_CARDS.map((skillId, i) => ({
    skillId, tier: 'diamond' as const, slot: i, gemId: GEM_IDS[i % GEM_IDS.length]!,
  })),
  bag: SIZE_ONE_CARDS.map((skillId) => ({ skillId, tier: 'gold' as const })),
  gems: Array.from({ length: 63 }, (_, i) => GEM_IDS[i % GEM_IDS.length]!),
};

/** The spec's "realistic full loadout": 5-card board with 2 gems, 8 bag cards,
 * 10 loose gems — the ~135-char band. */
const REALISTIC: ShareLoadout = {
  heroLevel: 12,
  allocation: [10, 8, 0, 4, 0, 2],
  board: STARTER.board,
  bag: SIZE_ONE_CARDS.slice(0, 8).map((skillId) => ({ skillId, tier: 'bronze' as const })),
  gems: Array.from({ length: 10 }, (_, i) => GEM_IDS[i % GEM_IDS.length]!),
};

const CLEAN = { unknownCards: 0, unknownGems: 0, clamped: [] };

describe('run/shareCode: round-trips (T1)', () => {
  it.each([
    ['empty-everything', EMPTY],
    ['starter board', STARTER],
    ['legal maximum', MAX],
    ['realistic full loadout', REALISTIC],
  ])('decode(encode(L)) reproduces %s exactly, with a clean report', (_name, loadout) => {
    const { loadout: decoded, report } = decodeCode(encodeLoadout(loadout));
    expect(decoded).toEqual(loadout);
    expect(report).toEqual(CLEAN);
  });

  it('the MAX fixture really is affordable (else the round-trip above would be vacuous)', () => {
    expect(spentPL(countsToAllocation(MAX.allocation))).toBeLessThanOrEqual(totalLevelPL(MAX.heroLevel));
  });
});

describe('run/shareCode: canonical form (T9)', () => {
  it('encode(decode(c).loadout) === c, byte-identical', () => {
    for (const loadout of [EMPTY, STARTER, MAX, REALISTIC]) {
      const code = encodeLoadout(loadout);
      expect(encodeLoadout(decodeCode(code).loadout)).toBe(code);
    }
  });

  it('board order independence — shuffled pieces mint the same code', () => {
    const shuffled: ShareLoadout = { ...STARTER, board: [...STARTER.board].reverse() };
    expect(encodeLoadout(shuffled)).toBe(encodeLoadout(STARTER));
  });
});

describe('run/shareCode: tamper rejection (T3)', () => {
  it('flipping ANY single character to another alphabet char hard-rejects', () => {
    const code = encodeLoadout(STARTER);
    for (let i = SHARE_CODE_PREFIX.length; i < code.length; i += 1) {
      const original = code[i]!;
      const replacement = ALPHABET[(ALPHABET.indexOf(original) + 1) % ALPHABET.length]!;
      const tampered = code.slice(0, i) + replacement + code.slice(i + 1);
      expect(() => decodeCode(tampered), `flip at ${i} (${original} -> ${replacement})`).toThrow(ShareCodeError);
    }
  });
});

describe('run/shareCode: truncation / extension (T4)', () => {
  it('any prefix/suffix/middle mutation rejects', () => {
    const code = encodeLoadout(STARTER);
    const mutations = [
      code.slice(0, -1),
      code.slice(0, -7),
      code.slice(0, SHARE_CODE_PREFIX.length + 4),
      `${code}A`,
      `${code}00`,
      code.slice(0, 20) + code.slice(21), // drop a middle char
      `${SHARE_CODE_PREFIX}`,
      'W2-ABCDEF',
      'not a code at all',
      '',
    ];
    for (const bad of mutations) {
      expect(() => decodeCode(bad), JSON.stringify(bad.slice(0, 24))).toThrow(ShareCodeError);
    }
  });
});

describe('run/shareCode: version gate (T5)', () => {
  it('version byte 2 rejects as "newer game version" (valid checksum, so the FIELD is what rejects)', () => {
    const crafted = withByte(encodeLoadout(STARTER), 0, 2);
    let failure: ShareCodeError | null = null;
    try { decodeCode(crafted); } catch (err) { failure = err as ShareCodeError; }
    expect(failure).toBeInstanceOf(ShareCodeError);
    expect(failure!.failure).toBe('newerVersion');
    expect(failure!.message).toMatch(/newer game version/);
  });

  it('nonzero reserved flags reject as newer-minor', () => {
    const crafted = withByte(encodeLoadout(STARTER), 1, 1);
    let failure: ShareCodeError | null = null;
    try { decodeCode(crafted); } catch (err) { failure = err as ShareCodeError; }
    expect(failure!.failure).toBe('newerVersion');
  });

  it('version byte 0 is not a mintable code — plain invalid, not "newer"', () => {
    const crafted = withByte(encodeLoadout(STARTER), 0, 0);
    let failure: ShareCodeError | null = null;
    try { decodeCode(crafted); } catch (err) { failure = err as ShareCodeError; }
    expect(failure!.failure).toBe('invalid');
  });
});

describe('run/shareCode: structural range rejects (§3.5 class 1)', () => {
  // On the EMPTY loadout, payload byte 9 is boardCount(4) ‖ bagCount(4).
  it('boardCount 11 rejects', () => {
    expect(() => decodeCode(withByte(encodeLoadout(EMPTY), 9, 0xb0))).toThrow(/board count/);
  });

  it('bagCount 11 rejects', () => {
    expect(() => decodeCode(withByte(encodeLoadout(EMPTY), 9, 0x0b))).toThrow(/bag count/);
  });

  it('slot overflow (a size-2 card at slot 9) rejects', () => {
    const code = encodeLoadout({
      ...EMPTY,
      board: [{ skillId: 'fireball', tier: 'bronze', slot: 9, gemId: null }],
    });
    expect(() => decodeCode(code)).toThrow(/overflow/);
  });

  it('overlapping slots reject — same slot, and size-covered slot', () => {
    const sameSlot = encodeLoadout({
      ...EMPTY,
      board: [
        { skillId: 'sword_slash', tier: 'bronze', slot: 0, gemId: null },
        { skillId: 'mana_ward', tier: 'bronze', slot: 0, gemId: null },
      ],
    });
    expect(() => decodeCode(sameSlot)).toThrow(/overlap/);
    const spanned = encodeLoadout({
      ...EMPTY,
      board: [
        { skillId: 'fireball', tier: 'bronze', slot: 0, gemId: null }, // covers 1
        { skillId: 'sword_slash', tier: 'bronze', slot: 1, gemId: null },
      ],
    });
    expect(() => decodeCode(spanned)).toThrow(/overlap/);
  });

  it('encode itself refuses unmintable shapes (11 board/bag cards, out-of-rail slots)', () => {
    const eleven = SIZE_ONE_CARDS.concat('sword_slash');
    expect(() => encodeLoadout({ ...EMPTY, board: eleven.map((skillId, i) => ({ skillId, tier: 'bronze' as const, slot: i % 10, gemId: null })) })).toThrow(/board cards/);
    expect(() => encodeLoadout({ ...EMPTY, bag: eleven.map((skillId) => ({ skillId, tier: 'bronze' as const })) })).toThrow(/bag cards/);
    expect(() => encodeLoadout({ ...EMPTY, board: [{ skillId: 'sword_slash', tier: 'bronze', slot: 10, gemId: null }] })).toThrow(/slot/);
    expect(() => encodeLoadout({ ...EMPTY, board: [{ skillId: 'sword_slash', tier: 'bronze', slot: -1, gemId: null }] })).toThrow(/slot/);
  });
});

describe('run/shareCode: content drift degrades per entry (T6)', () => {
  const GONE_CARD = '__gone_card__';
  const GONE_GEM = '__gone_gem__';

  it('the synthetic ids really are absent from the books (fixture guard)', () => {
    expect(Object.keys(skillBook).some((id) => foldId20(id) === foldId20(GONE_CARD))).toBe(false);
    expect(Object.keys(gemBook).some((id) => foldId20(id) === foldId20(GONE_GEM))).toBe(false);
  });

  it('skips unknown entries, counts them, loads the rest', () => {
    const code = encodeLoadout({
      heroLevel: 3,
      allocation: [0, 0, 0, 0, 0, 0],
      board: [
        { skillId: 'sword_slash', tier: 'bronze', slot: 0, gemId: null },
        { skillId: GONE_CARD, tier: 'gold', slot: 1, gemId: 'swift_charm' }, // whole entry skipped
        { skillId: 'mana_ward', tier: 'silver', slot: 2, gemId: GONE_GEM },  // card kept, socket cleared
      ],
      bag: [
        { skillId: GONE_CARD, tier: 'bronze' },
        { skillId: 'arcane_bolt', tier: 'bronze' },
      ],
      gems: [GONE_GEM, 'venom_sliver'],
    });
    const { loadout, report } = decodeCode(code);
    expect(loadout.board).toEqual([
      { skillId: 'sword_slash', tier: 'bronze', slot: 0, gemId: null },
      { skillId: 'mana_ward', tier: 'silver', slot: 2, gemId: null },
    ]);
    expect(loadout.bag).toEqual([{ skillId: 'arcane_bolt', tier: 'bronze' }]);
    expect(loadout.gems).toEqual(['venom_sliver']);
    expect(report.unknownCards).toBe(2);
    expect(report.unknownGems).toBe(2);
  });

  it('a board of ONLY unknown cards decodes to an empty board (FIGHT IT disables on this)', () => {
    const code = encodeLoadout({
      ...EMPTY,
      board: [{ skillId: GONE_CARD, tier: 'bronze', slot: 0, gemId: null }],
    });
    const { loadout, report } = decodeCode(code);
    expect(loadout.board).toEqual([]);
    expect(report.unknownCards).toBe(1);
  });
});

describe('run/shareCode: degenerate values clamp (T7)', () => {
  it('encode clamps LV 300 -> 255 and LV 0 -> 1', () => {
    expect(decodeCode(encodeLoadout({ ...EMPTY, heroLevel: 300 })).loadout.heroLevel).toBe(255);
    expect(decodeCode(encodeLoadout({ ...EMPTY, heroLevel: 0 })).loadout.heroLevel).toBe(1);
  });

  it('encode clamps the loose gem inventory at 63', () => {
    const gems = Array.from({ length: 70 }, (_, i) => GEM_IDS[i % GEM_IDS.length]!);
    const { loadout } = decodeCode(encodeLoadout({ ...EMPTY, gems }));
    expect(loadout.gems).toEqual(gems.slice(0, 63));
  });

  it('an over-spent allocation is re-fit via the LV stepper\'s un-buy order, with a report line', () => {
    const { loadout, report } = decodeCode(encodeLoadout({ ...EMPTY, heroLevel: 1, allocation: [9, 9, 9, 9, 9, 9] }));
    expect(loadout.allocation).toEqual([0, 0, 0, 0, 0, 0]); // LV 1 banks 0 PL
    expect(report.clamped.some((line) => line.includes('re-fit'))).toBe(true);
  });

  it('refitAllocation un-buys cheapest-last (speed first, maxHp last) until affordable', () => {
    // LV 2 banks 3 PL; {maxHp:2, attack:2} spends 4 -> one attack un-buy fits it.
    const { alloc, changed } = refitAllocation(2, { maxHp: 2, attack: 2 });
    expect(changed).toBe(true);
    expect(alloc).toEqual({ maxHp: 2, attack: 1 });
    expect(spentPL(alloc)).toBeLessThanOrEqual(totalLevelPL(2));
    // Already-affordable spends pass through untouched.
    const fit = refitAllocation(4, { maxHp: 2, attack: 1 });
    expect(fit.changed).toBe(false);
    expect(fit.alloc).toEqual({ maxHp: 2, attack: 1 });
  });
});

describe('run/shareCode: alphabet forgiveness (T8)', () => {
  const rewrap = (code: string): string => {
    const body = code.slice(SHARE_CODE_PREFIX.length);
    const chunks = body.match(/.{1,4}/g) ?? [];
    return `${SHARE_CODE_PREFIX}${chunks.join('-')}`;
  };

  it('lowercase, I/L/O aliases, and inserted hyphens/spaces all decode to the same loadout', () => {
    const code = encodeLoadout(STARTER);
    const body = code.slice(SHARE_CODE_PREFIX.length);
    expect(body).toMatch(/[01]/); // the alias substitutions below must bite
    const expected = decodeCode(code).loadout;

    expect(decodeCode(code.toLowerCase()).loadout).toEqual(expected);
    expect(decodeCode(rewrap(code)).loadout).toEqual(expected);
    expect(decodeCode(`  ${SHARE_CODE_PREFIX}${body.split('').join(' ')}  `).loadout).toEqual(expected);

    const aliased = SHARE_CODE_PREFIX + body.replace(/1/g, 'I').replace(/0/g, 'O');
    expect(decodeCode(aliased).loadout).toEqual(expected);
    const aliasedL = SHARE_CODE_PREFIX + body.replace(/1/g, 'l').replace(/0/g, 'o');
    expect(decodeCode(aliasedL).loadout).toEqual(expected);
  });

  it('a truly non-alphabet character still rejects (U is not Crockford)', () => {
    const code = encodeLoadout(STARTER);
    expect(() => decodeCode(`${code.slice(0, 10)}U${code.slice(11)}`)).toThrow(ShareCodeError);
    expect(() => decodeCode(`${code.slice(0, 10)}!${code.slice(11)}`)).toThrow(ShareCodeError);
  });
});

describe('run/shareCode: id-fold uniqueness gate (T10 — the content regression net)', () => {
  it.each([
    ['cards', Object.keys(skillBook)],
    ['gems', Object.keys(gemBook)],
  ])('fold20 over all current %s ids has no duplicates', (_name, ids) => {
    const seen = new Map<number, string>();
    for (const id of ids) {
      const ref = foldId20(id);
      const prev = seen.get(ref);
      expect(prev, `fold collision: "${prev}" vs "${id}" -> ${ref} — widen the hash (codec v2)`).toBeUndefined();
      seen.set(ref, id);
    }
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe('run/shareCode: wire pins', () => {
  it('SHARE_STAT_ORDER is the v1 wire order and covers exactly the leveling economy\'s stats', () => {
    expect(SHARE_STAT_ORDER).toEqual(['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed']);
    expect([...SHARE_STAT_ORDER].sort()).toEqual(Object.keys(LEVEL_STAT_COST).sort());
  });

  it('allocation helpers round-trip and canonicalize', () => {
    expect(allocationToCounts(countsToAllocation([2, 1, 0, 0, 0, 1]))).toEqual([2, 1, 0, 0, 0, 1]);
    expect(countsToAllocation([0, 0, 0, 0, 0, 0])).toEqual({});
    expect(allocationToCounts({ attack: 3, speed: 1 })).toEqual([0, 3, 0, 0, 0, 1]);
  });

  it('a realistic full loadout lands in the spec\'s length band (generous ceiling)', () => {
    const code = encodeLoadout(REALISTIC);
    expect(code.startsWith(SHARE_CODE_PREFIX)).toBe(true);
    expect(code.length).toBeLessThanOrEqual(200);
    // The legal maximum stays one chat message.
    expect(encodeLoadout(MAX).length).toBeLessThanOrEqual(450);
  });
});
