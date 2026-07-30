import type { HoverTipEntry } from './hoverTip';

/**
 * Plain-language hover copy for the six stat labels shown on every hero/foe
 * statline (battle bars, prep sheets, the stat-allocation panel). Pure text —
 * mirrors `cardGlossary.ts`'s idiom but for stats instead of card regions.
 */
const STAT_ENTRY: Record<'HP' | 'ATK' | 'MAG' | 'DEF' | 'RES' | 'SPD', HoverTipEntry> = {
  HP: { title: 'HP', body: 'Hit points. Hits and DoT ticks (poison/burn/bleed) reduce it; it never lies — 0 HP is a loss.' },
  ATK: { title: 'ATK — Attack', body: 'Scales physical damage/healing/shields. Mitigated by the target’s Armor (DEF) on direct hits.' },
  MAG: { title: 'MAG — Magic Power', body: 'Scales magical damage/healing/shields. Mitigated by the target’s Magic Resist (RES) on direct hits.' },
  DEF: { title: 'DEF — Armor', body: 'Reduces incoming physical damage. Has no effect on magical or TRUE damage.' },
  RES: { title: 'RES — Magic Resist', body: 'Reduces incoming magical damage. Has no effect on physical or TRUE damage.' },
  SPD: { title: 'SPD — Speed', body: 'Acts more often — a turn’s score is banked readiness + Speed minus the queued card’s weight. Heavy (size-N) cards cost turns; the loser of a turn banks their Speed for next time.' },
};

/** Hover entry for one stat label — falls back to a generic explanation for
 * an unrecognized/abbreviated label so a caller never has to guard it. */
export function statHoverEntry(label: string): HoverTipEntry {
  const key = label.trim().toUpperCase() as keyof typeof STAT_ENTRY;
  return STAT_ENTRY[key] ?? { title: label, body: 'A combat stat.' };
}

export const STAT_LABELS = ['HP', 'ATK', 'MAG', 'DEF', 'RES', 'SPD'] as const;
