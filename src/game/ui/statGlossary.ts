import type { HoverTipEntry } from './hoverTip';
import { STAT_KEYS, STAT_TOKEN, type StatKey } from './statLabels';

/**
 * Plain-language hover copy for the six stat labels shown on every hero/foe
 * statline (battle bars, prep sheets, the stat-allocation panel). Pure text —
 * mirrors `cardGlossary.ts`'s idiom but for stats instead of card regions.
 * Keyed by the CANONICAL token (`statLabels.ts#STAT_TOKEN`) — never a
 * synonym (no MAG/RES here; that's MATK/MDEF everywhere in `src/game`).
 */
const STAT_ENTRY: Record<string, HoverTipEntry> = {
  [STAT_TOKEN.maxHp]: { title: STAT_TOKEN.maxHp, body: 'Hit points. Hits and DoT ticks (poison/burn/bleed) reduce it; it never lies — 0 HP is a loss.' },
  [STAT_TOKEN.attack]: { title: `${STAT_TOKEN.attack} — Attack`, body: `Scales physical damage/healing/shields. Mitigated by the target’s Armor (${STAT_TOKEN.armor}) on direct hits.` },
  [STAT_TOKEN.magicPower]: { title: `${STAT_TOKEN.magicPower} — Magic Power`, body: `Scales magical damage/healing/shields. Mitigated by the target’s Magic Resist (${STAT_TOKEN.magicResist}) on direct hits.` },
  [STAT_TOKEN.armor]: { title: `${STAT_TOKEN.armor} — Armor`, body: 'Reduces incoming physical damage. Has no effect on magical or TRUE damage.' },
  [STAT_TOKEN.magicResist]: { title: `${STAT_TOKEN.magicResist} — Magic Resist`, body: 'Reduces incoming magical damage. Has no effect on physical or TRUE damage.' },
  [STAT_TOKEN.speed]: { title: `${STAT_TOKEN.speed} — Speed`, body: 'Acts more often — a turn’s score is banked readiness + Speed minus the queued card’s weight. Heavy (size-N) cards cost turns; the loser of a turn banks their Speed for next time.' },
};

/** Hover entry for one stat label — falls back to a generic explanation for
 * an unrecognized/abbreviated label so a caller never has to guard it. */
export function statHoverEntry(label: string): HoverTipEntry {
  const key = label.trim().toUpperCase();
  return STAT_ENTRY[key] ?? { title: label, body: 'A combat stat.' };
}

/** The six canonical stat tokens, in statline order — `STAT_KEYS` mapped
 * through `STAT_TOKEN` so this can never drift from the single source. */
export const STAT_LABELS: readonly string[] = STAT_KEYS.map((k: StatKey) => STAT_TOKEN[k]);
