import { describe, expect, it } from 'vitest';
import {
  capabilityStatRun, deckMetaStatRun, foeSecondaryStatRun, ledgerStatRows,
  livesAreCritical, runProgressStatRun, statDeltaInk, statLabelInk,
  statRunPlainText, statSegmentRoles, statValueInk,
  type StatKind, type StatSegment,
} from '../../src/game/ui/statRunModel';
import { INK, TEXT_ROLE_SPEC } from '../../src/game/theme';

/**
 * `statRunModel` is the stat-run twin of `bandBannerViewModel` — the module
 * that exists so a RENDERER cannot decide what colour a number is. This suite
 * pins the mapping in both directions, exactly as
 * `bandBannerViewModel.test.ts` pins `claimTextColor`/`leanColor`: the point of
 * moving those decisions out of the scenes is lost if nothing holds them still
 * afterwards, and there are now four separate surfaces (run HUD, prep foe card,
 * prep hero band, deck-build header) whose only guarantee of agreeing with each
 * other is that they all call these functions.
 */

const seg = (over: Partial<StatSegment>): StatSegment =>
  ({ label: 'X', value: '1', kind: 'stat', ...over });

describe('statRunModel: kind -> value ink (the mapping renderers may not re-derive)', () => {
  const cases: Array<[StatKind, keyof typeof INK]> = [
    ['resource', 'resource'],
    ['vital', 'vital'],
    ['cost', 'cost'],
    ['capacity', 'capacity'],
    ['stat', 'primary'],
    ['identity', 'secondary'],
    ['tally', 'secondary'],
  ];
  for (const [kind, ink] of cases) {
    it(`a ${kind} value is INK.${ink}`, () => {
      expect(statValueInk(seg({ kind }))).toBe(ink);
    });
  }

  it('every StatKind is covered above — a new kind cannot slip in un-inked', () => {
    // The switch in `statValueInk` is exhaustive over `StatKind` at compile
    // time; this asserts the TEST list is too, so adding a kind forces a
    // decision here rather than silently inheriting someone else's ink.
    const kinds = new Set(cases.map(([k]) => k));
    const KNOWN: readonly StatKind[] = ['identity', 'resource', 'vital', 'stat', 'capacity', 'cost', 'tally'];
    expect([...kinds].sort()).toEqual([...KNOWN].sort());
  });

  it('alarm beats the kind — a critical number is never a plain value', () => {
    for (const [kind] of cases) {
      expect(statValueInk(seg({ kind, alarm: true }))).toBe('alarm');
    }
  });

  it('the three HUED kinds are three DIFFERENT inks, and none of them is a neutral', () => {
    const hued = ['resource', 'vital', 'cost'] as const;
    const inks = hued.map((k) => statValueInk(seg({ kind: k })));
    expect(new Set(inks).size).toBe(3);
    for (const ink of inks) expect(['primary', 'secondary']).not.toContain(ink);
  });

  it('identity and tally RECEDE — they are dimmer than a plain stat value', () => {
    // The whole "day/wave/level should not shout as loud as gold" claim,
    // reduced to an assertion instead of a screenshot argument.
    expect(statValueInk(seg({ kind: 'identity' }))).toBe('secondary');
    expect(statValueInk(seg({ kind: 'stat' }))).toBe('primary');
    expect(INK.secondary).not.toBe(INK.primary);
  });
});

describe('statRunModel: tone -> label ink, and the label/value split', () => {
  it('a quiet segment’s label is the first thing to drop out of the reading order', () => {
    expect(statLabelInk(seg({ tone: 'quiet' }))).toBe('disabled');
    expect(statLabelInk(seg({ tone: 'normal' }))).toBe('label');
    expect(statLabelInk(seg({ tone: 'lead' }))).toBe('label');
  });

  it('a label ink is NEVER a value ink — the two halves cannot converge', () => {
    const labelInks = (['lead', 'normal', 'quiet'] as const).map((tone) => statLabelInk(seg({ tone })));
    const valueInks: Array<keyof typeof INK> = ['resource', 'vital', 'cost', 'capacity', 'primary', 'secondary'];
    for (const l of labelInks) expect(valueInks).not.toContain(l);
  });

  it('a delta is a GAIN unless it is signed negative, in which case it is a cost', () => {
    expect(statDeltaInk(seg({ delta: '◆+4' }))).toBe('gain');
    expect(statDeltaInk(seg({ delta: '-2' }))).toBe('cost');
  });
});

describe('statRunModel: density -> which size pair a segment draws at', () => {
  it('in a TIGHT run every segment shares the small pair (a 30px band cannot hold two sizes)', () => {
    for (const tone of ['lead', 'normal', 'quiet'] as const) {
      expect(statSegmentRoles(seg({ tone }), 'tight').value).toBe('statValueTight');
    }
  });

  it('in a ROOMY run only a LEAD segment gets the full value size', () => {
    expect(statSegmentRoles(seg({ tone: 'lead' }), 'roomy').value).toBe('statValue');
    expect(statSegmentRoles(seg({ tone: 'normal' }), 'roomy').value).toBe('statValueTight');
    expect(statSegmentRoles(seg({ tone: 'quiet' }), 'roomy').value).toBe('statValueTight');
  });

  it('a GRID cell ignores tone — a boxed cell must not vary its value size down a column', () => {
    for (const tone of ['lead', 'normal', 'quiet'] as const) {
      expect(statSegmentRoles(seg({ tone }), 'grid').value).toBe('statValue');
      expect(statSegmentRoles(seg({ tone }), 'grid').label).toBe('statLabel');
    }
  });

  it('so a roomy lead really is bigger on both profiles, not just re-tinted', () => {
    const lead = statSegmentRoles(seg({ tone: 'lead' }), 'roomy');
    const rest = statSegmentRoles(seg({ tone: 'normal' }), 'roomy');
    for (const p of ['mobile', 'desktop'] as const) {
      expect(TEXT_ROLE_SPEC[lead.value].size[p]).toBeGreaterThan(TEXT_ROLE_SPEC[rest.value].size[p]);
    }
  });
});

describe('statRunModel: the run HUD strip', () => {
  const facts = { day: 3, wave: 2, gold: 137, heroLevel: 4, lives: 2, bossesCleared: 1 };

  it('shows the SAME six stats in the SAME order on both platforms', () => {
    const m = runProgressStatRun(facts, true);
    const d = runProgressStatRun(facts, false);
    expect(m.segments.map((s) => s.kind)).toEqual(d.segments.map((s) => s.kind));
    expect(m.segments.map((s) => s.value)).toEqual(d.segments.map((s) => s.value));
    expect(m.segments).toHaveLength(6);
  });

  it('GOLD and LIVES are the two leads; everything else is demoted', () => {
    const s = runProgressStatRun(facts, true).segments;
    const leads = s.filter((x) => x.tone === 'lead').map((x) => x.label);
    expect(leads).toEqual(['G', '♥']);
    expect(s.filter((x) => x.tone === 'quiet')).toHaveLength(4);
  });

  it('the mobile line is not one character wider than the flat string it replaced', () => {
    // The hierarchy on the phone strip is bought out of TONE, not out of extra
    // characters — ~28 chars is the whole budget (CLAUDE.md, USER-LOCKED).
    // This is the exact string `RunProgressStrip.statsStripText` shipped.
    const shipped = 'D3 · W2 · G137 · LV4 · ♥2 · B1';
    const built = runProgressStatRun(facts, true).segments
      .map((s) => `${s.label}${s.value}`)
      .join(' · ');
    expect(built).toBe(shipped);
  });

  it('LIVES goes alarm at EXACTLY 1 — not at 0, which is the pre-run state', () => {
    expect(livesAreCritical(1)).toBe(true);
    expect(livesAreCritical(0)).toBe(false);
    expect(livesAreCritical(3)).toBe(false);
    const lastLife = runProgressStatRun({ ...facts, lives: 1 }, true).segments[4]!;
    const preRun = runProgressStatRun({ ...facts, lives: 0 }, true).segments[4]!;
    expect(statValueInk(lastLife)).toBe('alarm');
    expect(statValueInk(preRun)).toBe('vital');
  });

  it('LIVES 3 and LIVES 1 do not look alike — the user’s "a zero is not neutral" rule', () => {
    const three = runProgressStatRun({ ...facts, lives: 3 }, true).segments[4]!;
    const one = runProgressStatRun({ ...facts, lives: 1 }, true).segments[4]!;
    expect(statValueInk(three)).not.toBe(statValueInk(one));
  });

  it('GOLD does not read the same as BOSSES — the complaint in one assertion', () => {
    const s = runProgressStatRun(facts, true).segments;
    const gold = s[2]!;
    const bosses = s[5]!;
    expect(statValueInk(gold)).not.toBe(statValueInk(bosses));
    expect(statLabelInk(gold)).not.toBe(statLabelInk(bosses));
    expect(statSegmentRoles(gold, 'roomy').value).not.toBe(statSegmentRoles(bosses, 'roomy').value);
  });
});

describe('statRunModel: the capability statline (hero band + foe card, one grammar)', () => {
  const stats = { maxHp: 100, attack: 12, magicPower: 8, armor: 3, magicResist: 2, speed: 10 };

  it('HP leads and is a VITAL; the other five are plain stats', () => {
    const s = capabilityStatRun(stats).segments;
    expect(s[0]!.label).toBe('HP');
    expect(s[0]!.kind).toBe('vital');
    expect(s[0]!.tone).toBe('lead');
    for (const rest of s.slice(1)) expect(rest.kind).toBe('stat');
  });

  it('a gem bonus becomes a GAIN-inked delta, not a "(+N)" swallowed by the number', () => {
    const s = capabilityStatRun(stats, { gemAdds: { speed: 4 } }).segments;
    const spd = s.find((x) => x.label === 'SPD')!;
    expect(spd.delta).toBe('◆+4');
    expect(statDeltaInk(spd)).toBe('gain');
    expect(spd.value).toBe('10'); // the total is untouched — the delta is beside it
  });

  it('narrowing to fewer keys keeps the order and the kinds', () => {
    const s = capabilityStatRun(stats, { keys: ['maxHp', 'speed', 'attack'] }).segments;
    expect(s.map((x) => x.label)).toEqual(['HP', 'SPD', 'ATK']);
  });

  it('the foe secondary row makes CARDS a quiet CAPACITY, not another stat', () => {
    const s = foeSecondaryStatRun(stats, 3).segments;
    expect(s.map((x) => x.label)).toEqual(['DEF', 'MDEF', 'CARDS']);
    expect(s[2]!.kind).toBe('capacity');
    expect(s[2]!.tone).toBe('quiet');
  });
});

describe('statRunModel: the deck-build header', () => {
  const facts = {
    heroLevel: 1,
    stats: { maxHp: 100, attack: 12, magicPower: 8, speed: 14 },
    gemAdds: { speed: 4 },
    used: 6, slots: 10, powerLevel: 56, gems: 2,
  };

  it('drops DEF/MDEF and says so — eight facts, not ten', () => {
    const s = deckMetaStatRun(facts).segments;
    expect(s.map((x) => x.label)).toEqual(['LV', 'HP', 'ATK', 'MATK', 'SPD', 'SLOTS', 'PL', 'GEMS']);
    expect(s.map((x) => x.label)).not.toContain('DEF');
    expect(s.map((x) => x.label)).not.toContain('MDEF');
  });

  it('SLOTS leads (it is what a deck edit is about), PL is a cost, GEMS is capacity', () => {
    const byLabel = new Map(deckMetaStatRun(facts).segments.map((s) => [s.label, s]));
    expect(byLabel.get('SLOTS')!.tone).toBe('lead');
    expect(statValueInk(byLabel.get('PL')!)).toBe('cost');
    expect(statValueInk(byLabel.get('GEMS')!)).toBe('capacity');
    expect(statValueInk(byLabel.get('LV')!)).toBe('secondary');
  });

  it('the plain-text form is shorter than the flat line it replaced, for the same data', () => {
    // The exact string `MobileDeckBuildScene` shipped for these facts: 79
    // characters of one colour at one weight in a 412px header. Fewer
    // characters is what pays for the value/label size split — the labels then
    // render 2-4px SMALLER than the values on top of that, so the pixel saving
    // is larger than the character saving.
    const SHIPPED = 'LV 1 · HP 100 · ATK 12 · MATK 8 · SPD 14 (+4)   ·   6/10 slots · PL 56 · 2 gems';
    expect(SHIPPED).toHaveLength(79);
    const plain = statRunPlainText(deckMetaStatRun(facts));
    expect(plain.length).toBeLessThan(SHIPPED.length);
  });
});

describe('statRunModel: the run ledger', () => {
  const facts = {
    wins: 3, losses: 1, bossesCleared: 1, deepestWave: 4,
    goldEarned: 214, goldSpent: 77, damageDealt: 1840, damageTaken: 962,
    healingDone: 120, cardsBought: 2, gemsBought: 1,
  };

  it('keeps the five fixed pairings, in order', () => {
    const rows = ledgerStatRows(facts);
    expect(rows.map(([l, r]) => [l.label, r.label])).toEqual([
      ['FIGHTS WON', 'FIGHTS LOST'],
      ['BOSSES CLEARED', 'DEEPEST WAVE'],
      ['GOLD EARNED', 'GOLD SPENT'],
      ['DAMAGE DEALT', 'DAMAGE TAKEN'],
      ['HEALING DONE', 'PURCHASES'],
    ]);
  });

  it('what you EARNED no longer reads the same as what you SPENT or what was TAKEN', () => {
    const rows = ledgerStatRows(facts);
    const [earned, spent] = rows[2]!;
    const [dealt, taken] = rows[3]!;
    expect(statValueInk(earned)).not.toBe(statValueInk(spent));
    expect(statValueInk(dealt)).not.toBe(statValueInk(taken));
    // ...and a LOSS is inked like a cost, not like a neutral count.
    expect(statValueInk(rows[0]![1])).toBe('cost');
    expect(statValueInk(rows[0]![0])).not.toBe('cost');
  });

  it('the ten cells are no longer ten identical numbers', () => {
    const inks = new Set(ledgerStatRows(facts).flat().map((s) => statValueInk(s)));
    expect(inks.size).toBeGreaterThanOrEqual(4);
  });
});
