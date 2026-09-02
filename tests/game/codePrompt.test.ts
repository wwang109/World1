import { describe, expect, it } from 'vitest';
import {
  copiedToast, copyTextToClipboard, decodeFailureMessage, decodeReportLines, describeLoadout,
  fightItEnabled, fightItExplainer, PLAY_IT_EXPLAINER, promptForCode,
} from '../../src/game/ui/codePrompt';
import { decodeCode, encodeLoadout, ShareCodeError, type DecodeReport, type ShareLoadout } from '../../src/run/shareCode';

/**
 * SHARE-CODE PROMPT — the view-model half (docs/sandbox-features-proposal.md
 * §3.3/§3.5/§3.7). Both prep scenes render exactly these strings in the
 * import dialog, so the spec's wording is pinned HERE once instead of
 * re-typed per platform; the DOM/clipboard half needs a browser and is
 * covered by the visual pass (vitest runs `environment: 'node'` — the two
 * entry points must at least degrade safely there, which the last cases pin).
 */

const LOADOUT: ShareLoadout = {
  heroLevel: 12,
  allocation: [4, 3, 0, 0, 0, 2],
  board: [
    { skillId: 'sword_slash', tier: 'bronze', slot: 0, gemId: 'swift_charm' },
    { skillId: 'war_banner', tier: 'bronze', slot: 1, gemId: null },
    { skillId: 'fireball', tier: 'silver', slot: 2, gemId: 'war_banner_echo' },
    { skillId: 'second_wind', tier: 'bronze', slot: 4, gemId: null },
    { skillId: 'iron_bulwark', tier: 'bronze', slot: 5, gemId: null },
  ],
  bag: Array.from({ length: 8 }, () => ({ skillId: 'mana_ward', tier: 'bronze' as const })),
  gems: Array.from({ length: 10 }, () => 'venom_sliver'),
};

const EMPTY_BOARD: ShareLoadout = { ...LOADOUT, board: [] };

describe('game/ui/codePrompt: the summary line', () => {
  it('reads LV · CARDS (GEMMED) · BAG · GEMS, exactly the spec example shape', () => {
    expect(describeLoadout(LOADOUT)).toBe('LV 12 · 5 CARDS (2 GEMMED) · BAG 8 · GEMS 10');
  });

  it('drops the gem note when nothing is socketed, and singularizes 1 card', () => {
    expect(describeLoadout({ ...LOADOUT, board: [{ skillId: 'sword_slash', tier: 'bronze', slot: 0, gemId: null }], bag: [], gems: [] }))
      .toBe('LV 12 · 1 CARD · BAG 0 · GEMS 0');
  });
});

describe('game/ui/codePrompt: report lines', () => {
  it('renders the content-drift skip line in the spec wording, then the clamp lines VERBATIM', () => {
    const report: DecodeReport = {
      unknownCards: 2,
      unknownGems: 1,
      clamped: ['LV clamped to 255', 'stat spend re-fit to the LV budget'],
    };
    expect(decodeReportLines(report)).toEqual([
      '2 cards + 1 gem no longer exist — skipped',
      'LV clamped to 255',
      'stat spend re-fit to the LV budget',
    ]);
  });

  it('a clean report renders no lines at all', () => {
    expect(decodeReportLines({ unknownCards: 0, unknownGems: 0, clamped: [] })).toEqual([]);
  });

  it('a REAL decode of a REAL code produces a clean report through these lines', () => {
    const { report } = decodeCode(encodeLoadout(LOADOUT));
    expect(decodeReportLines(report)).toEqual([]);
  });
});

describe('game/ui/codePrompt: failure copy (spec §3.5 — exactly two player-facing lines)', () => {
  it('maps the two ShareCodeError failure classes to the spec strings', () => {
    expect(decodeFailureMessage('invalid')).toBe('Not a valid code');
    expect(decodeFailureMessage('newerVersion')).toBe('Code from a newer game version');
  });

  it('agrees with the real errors decodeCode throws', () => {
    let framing: ShareCodeError | null = null;
    try { decodeCode('W1-NOT A CODE'); } catch (e) { framing = e as ShareCodeError; }
    expect(framing).toBeInstanceOf(ShareCodeError);
    expect(decodeFailureMessage(framing!.failure)).toBe('Not a valid code');
  });
});

describe('game/ui/codePrompt: the two apply explainers (spec §3.3 — no silent drops)', () => {
  it('PLAY IT names every replaced surface', () => {
    expect(PLAY_IT_EXPLAINER).toBe('replaces your board, bag, gems, LV & stat spend');
  });

  it('FIGHT IT names what maps and what drops, with the live card count', () => {
    expect(fightItExplainer(LOADOUT)).toBe(
      'imports board (5 cards, gems kept) + LV → foe LV · drops: bag, loose gems, stat spend (foe auto-spends its LV)',
    );
  });

  it('FIGHT IT is disabled exactly for an empty surviving board', () => {
    expect(fightItEnabled(LOADOUT)).toBe(true);
    expect(fightItEnabled(EMPTY_BOARD)).toBe(false);
  });
});

describe('game/ui/codePrompt: copy acknowledgement', () => {
  it('names the code length so the player knows roughly what got copied', () => {
    expect(copiedToast('W1-ABCDE')).toBe('COPIED · 8 CHARS');
  });
});

describe('game/ui/codePrompt: node-side degradation (no DOM, no clipboard)', () => {
  it('copyTextToClipboard resolves false rather than throwing', async () => {
    await expect(copyTextToClipboard('W1-X')).resolves.toBe(false);
  });

  it('promptForCode resolves null rather than touching a document', async () => {
    await expect(promptForCode()).resolves.toBeNull();
  });
});
