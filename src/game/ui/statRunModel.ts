import type { CombatantStats } from '../../engine/types';
import type { InkRole, StatDensity, TextRole } from '../theme';
import { STAT_PAIR_ROLES } from '../theme';
import { STAT_KEYS, STAT_TOKEN, type StatKey } from './statLabels';

/**
 * STAT RUNS — the pure model behind every "A 1 · B 2 · C 3" line in the game.
 *
 * WHY THIS MODULE EXISTS. The most-looked-at text in World1 is a dot-separated
 * run of numbers, and there are four of them on the run screens alone:
 *
 *   D3 · W2 · G137 · LV4 · ♥2 · B1                      (the run HUD strip)
 *   HP 100 · SPD 10 · ATK 1 · MATK 1                    (the prep foe card)
 *   HP 100 · ATK 1 · MATK 1 · DEF 1 · MDEF 1 · SPD 10   (the prep hero band)
 *   LV 1 · HP 100 · ATK 1 · ... · 6/10 slots · PL 56    (the deck-build meta)
 *
 * Every one of them was drawn as ONE Phaser Text object in ONE colour at ONE
 * weight, so every stat looked exactly as important as every other stat —
 * which is the same as none of them reading at all. The user's words: "those
 * level hp stats and gold look really plain".
 *
 * The information genuinely has a hierarchy and the flat rendering was hiding
 * three separate distinctions:
 *
 *   1. THE VALUE MATTERS MORE THAN THE LABEL. "100" is what the player reads;
 *      "HP" only says which number it is. So a run is never one string — it is
 *      a list of label/value PAIRS, and the two halves get different roles
 *      (`theme.ts#STAT_PAIR_ROLES`): the value bold and ~1.4x, the label
 *      unbolded and muted. Once the player knows the layout the labels
 *      recede on their own.
 *   2. NOT ALL STATS ARE THE SAME KIND OF FACT. Gold is a resource you spend.
 *      Lives is what keeps you alive. Day/wave/level are near-static identity.
 *      Slots and gems are capacity. Those are four different kinds of thing
 *      wearing one costume, so each carries a `StatKind` and the KIND picks
 *      the ink (`theme.ts#INK`) — never the call site.
 *   3. A ZERO IS NOT NEUTRAL. `♥3` and `♥1` must not look alike, so the last
 *      life raises `alarm` and the value flips to `INK.alarm`.
 *
 * THE POINT OF KEEPING IT PURE, and the precedent it follows. This is the
 * stat-run twin of `bandBannerViewModel.ts` (`counterTypeColor` / `leanColor` /
 * `claimTextColor`, moved out of the renderer in `3c20c98` precisely so the
 * renderer could not re-derive them). Same contract here: the SCENES own
 * pixels, and this module decides every word, every kind and every ink. A
 * renderer that wants to know what colour GOLD is asks `statValueInk`; it may
 * not hand-pick a hue, and `tests/game/statRunModel.test.ts` pins the mapping
 * so a future scene cannot quietly disagree with the one next to it.
 *
 * NO ICONS, deliberately. 94 of 166 cards in this project still have no art;
 * a glyph set that does not exist is not a hierarchy. The only two glyphs used
 * anywhere here are '♥' (already shipped in the mobile HUD strip) and '◆' (the
 * gem marker already shipped in `RunStatPanel`). Type, weight and colour do
 * all the rest.
 */

/**
 * WHAT KIND OF FACT a number is. The ink follows from this and nothing else.
 *
 * Kept deliberately small: the eye can pick out about three things in a strip,
 * so exactly three kinds are given a HUE OF THEIR OWN (`resource`, `vital`,
 * `cost`) and everything else is a plain bright value that recedes behind
 * them. Adding a fourth hue per stat is how a palette stops meaning anything.
 */
export type StatKind =
  /** Which run/hero this is — DAY, WAVE, LV. Real information, but it does not
   * change under the player's hand, so it recedes. */
  | 'identity'
  /** Spendable currency — GOLD. One of the two numbers the player watches. */
  | 'resource'
  /** What keeps the run alive — LIVES, HP. The other one. */
  | 'vital'
  /** A hero/foe capability figure — ATK, MATK, DEF, MDEF, SPD. A plain value. */
  | 'stat'
  /** How much ROOM there is — deck slots, gem sockets, card counts. */
  | 'capacity'
  /** A price or an outlay — PL cost, GOLD SPENT, DAMAGE TAKEN, FIGHTS LOST. */
  | 'cost'
  /** An accumulated count with no pressure attached — BOSSES, FIGHTS WON,
   * DAMAGE DEALT. */
  | 'tally';

/**
 * How loud a segment is WITHIN its run. Only affects the LABEL's ink and (in
 * a roomy run) which of the two size pairs the value uses — never the value's
 * hue, which belongs to the kind.
 */
export type StatTone =
  /** The one or two segments the run is really about. */
  | 'lead'
  /** The default. */
  | 'normal'
  /** Present for completeness; the player is not meant to stop here. */
  | 'quiet';

export interface StatSegment {
  /** 'HP', 'GOLD', '♥' — whatever this run's width allows. */
  label: string;
  /** Already formatted: '137', '6/10', '2C / 1G'. Never a number, so the model
   * never has to know how a surface wants a figure spelled. */
  value: string;
  kind: StatKind;
  /** Default `'normal'`. */
  tone?: StatTone;
  /**
   * ACT NOW. Overrides the kind's ink with `INK.alarm`. Set by the BUILDERS
   * below off the actual number (last life), never by a renderer eyeballing a
   * value — that is the whole reason the builders live here.
   */
  alarm?: boolean;
  /** A trailing delta drawn after the value in `INK.gain` — a gem's '+4'. */
  delta?: string;
}

/** A whole run: the segments plus the separator they are joined with. */
export interface StatRun {
  segments: readonly StatSegment[];
  /** '·' padded per surface. Part of the model so two surfaces showing the
   * same run cannot disagree about how wide the gaps are. */
  separator: string;
}

// ---------------------------------------------------------------------------
// INK — the mapping the renderers may not re-derive.
// ---------------------------------------------------------------------------

/** The ink a segment's VALUE half gets. `alarm` wins over everything. */
export function statValueInk(seg: StatSegment): InkRole {
  if (seg.alarm) return 'alarm';
  switch (seg.kind) {
    case 'resource': return 'resource';
    case 'vital': return 'vital';
    case 'cost': return 'cost';
    case 'capacity': return 'capacity';
    // A stat is the plainest kind of value there is, so it gets the brightest
    // NEUTRAL ink — it leads by luminance, not by hue, which is what leaves
    // the three hued kinds legible as exceptions.
    case 'stat': return 'primary';
    // Identity and tallies are the two kinds that must RECEDE: same family as
    // `primary`, one step down, so a strip reads gold/lives/stats first.
    case 'identity': return 'secondary';
    case 'tally': return 'secondary';
  }
}

/** The ink a segment's LABEL half gets. Tone-driven: a label is never the
 * point, and a `quiet` segment's label is the first thing that should drop out
 * of the reading order. */
export function statLabelInk(seg: StatSegment): InkRole {
  switch (seg.tone ?? 'normal') {
    case 'lead': return 'label';
    case 'normal': return 'label';
    case 'quiet': return 'disabled';
  }
}

/** The ink a segment's trailing DELTA gets. Always a gain today (a gem bonus,
 * a level buy); a negative delta would be `cost`, hence the sign check rather
 * than a hardcoded role. */
export function statDeltaInk(seg: StatSegment): InkRole {
  return seg.delta?.startsWith('-') ? 'cost' : 'gain';
}

/**
 * Which size pair a segment's value uses. In a `'tight'` run every
 * segment shares the tight pair — a 30px band cannot hold two value sizes
 * without going ragged. In a `'roomy'` run the `lead` segments get the full
 * pair and everything else the tight one, which is what actually puts GOLD and
 * LIVES at the top of the reading order rather than merely tinting them.
 */
export function statSegmentRoles(seg: StatSegment, density: StatDensity): { value: TextRole; label: TextRole } {
  if (density === 'tight') return STAT_PAIR_ROLES.tight;
  // A grid cell ignores tone by design — see `STAT_PAIR_ROLES.grid`.
  if (density === 'grid') return STAT_PAIR_ROLES.grid;
  return (seg.tone ?? 'normal') === 'lead' ? STAT_PAIR_ROLES.roomy : STAT_PAIR_ROLES.tight;
}

// ---------------------------------------------------------------------------
// BUILDERS — one per stat run in the game. Each decides its own kinds/tones
// once, so a stat means the same thing on every screen that shows it.
// ---------------------------------------------------------------------------

/** The shape the run HUD strip needs — structurally compatible with
 * `RunProgressStrip.ts#RunProgressSnapshot`, declared here so this module
 * stays free of any Phaser-importing file. */
export interface RunProgressFacts {
  day: number;
  wave: number;
  gold: number;
  heroLevel: number;
  lives: number;
  bossesCleared: number;
}

/**
 * Alarm colour for the last life. EXACTLY 1, not `<= 1` — the pre-run "START A
 * NEW RUN" state reports 0 lives (there is no run yet) and `<= 1` painted that
 * whole strip red as if the player were about to die. In a real run 0 lives
 * means the run is already over and the end banner has replaced the strip, so
 * 0 is never a live in-run value. (This rule is carried over verbatim from
 * `RunProgressStrip.ts`, which is where it was learned.)
 */
export function livesAreCritical(lives: number): boolean {
  return lives === 1;
}

/**
 * THE run HUD strip — DAY · WAVE · GOLD · LV · LIVES · BOSSES, in that order,
 * on every run screen.
 *
 * WHAT IS DEMOTED AND WHY. The mobile strip has ~28 characters of usable
 * width, so the hierarchy has to be bought, not added. It is bought entirely
 * out of the four `identity`/`tally` segments: DAY, WAVE, LV and BOSSES go
 * `quiet` (a fainter label, a one-step-down value, the tight size), which
 * hands GOLD and LIVES the full pair. Nothing is dropped — the six stats and
 * their single-letter mobile labels are unchanged, so the line's character
 * count is identical to what shipped and cannot overflow where it did not
 * before.
 */
export function runProgressStatRun(facts: RunProgressFacts, compact: boolean): StatRun {
  const critical = livesAreCritical(facts.lives);
  return {
    separator: compact ? ' · ' : '   ·   ',
    segments: [
      { label: compact ? 'D' : 'DAY ', value: `${facts.day}`, kind: 'identity', tone: 'quiet' },
      { label: compact ? 'W' : 'WAVE ', value: `${facts.wave}`, kind: 'identity', tone: 'quiet' },
      { label: compact ? 'G' : 'GOLD ', value: `${facts.gold}`, kind: 'resource', tone: 'lead' },
      { label: compact ? 'LV' : 'LV ', value: `${facts.heroLevel}`, kind: 'identity', tone: 'quiet' },
      { label: compact ? '♥' : 'LIVES ', value: `${facts.lives}`, kind: 'vital', tone: 'lead', alarm: critical },
      { label: compact ? 'B' : 'BOSSES ', value: `${facts.bossesCleared}`, kind: 'tally', tone: 'quiet' },
    ],
  };
}

/** `" (+N)"`-style gem attribution, as a `delta` rather than a string glued to
 * the value — so the bonus can be inked as a GAIN instead of disappearing into
 * the number it modifies (which is what `gemStatSuffix` did). */
function gemDelta(key: StatKey, gemAdds: Partial<CombatantStats>): string | undefined {
  const add = gemAdds[key];
  return add ? `◆+${add}` : undefined;
}

/** Which kind each of the six statline stats is. HP is the one that keeps you
 * alive; the rest are capability figures. */
function statlineKind(key: StatKey): StatKind {
  return key === 'maxHp' ? 'vital' : 'stat';
}

/**
 * A full six-stat capability line — HP · ATK · MATK · DEF · MDEF · SPD, in
 * `STAT_KEYS` order. Used for BOTH the hero band and the foe card, so a
 * matchup is read off two runs with identical grammar (the reason those two
 * lines were written to the same order in the first place).
 *
 * `keys` narrows it where a surface has less room (the prep foe card splits
 * the six across two rows). HP leads: it is the number that decides whether
 * the fight is survivable.
 */
export function capabilityStatRun(
  stats: Readonly<Record<StatKey, number>>,
  opts?: { keys?: readonly StatKey[]; gemAdds?: Partial<CombatantStats>; compact?: boolean },
): StatRun {
  const keys = opts?.keys ?? STAT_KEYS;
  const gemAdds = opts?.gemAdds ?? {};
  return {
    separator: opts?.compact === false ? '   ·   ' : ' · ',
    segments: keys.map((key): StatSegment => ({
      label: STAT_TOKEN[key],
      value: `${stats[key]}`,
      kind: statlineKind(key),
      tone: key === 'maxHp' ? 'lead' : 'normal',
      ...(gemDelta(key, gemAdds) !== undefined ? { delta: gemDelta(key, gemAdds)! } : {}),
    })),
  };
}

/** The prep foe card's second row — DEF · MDEF · n cards. Split out because
 * the card is fixed-height and the six stats do not fit one row on a phone. */
export function foeSecondaryStatRun(
  stats: Readonly<Record<StatKey, number>>,
  cardCount: number,
): StatRun {
  return {
    separator: ' · ',
    segments: [
      { label: STAT_TOKEN.armor, value: `${stats.armor}`, kind: 'stat', tone: 'normal' },
      { label: STAT_TOKEN.magicResist, value: `${stats.magicResist}`, kind: 'stat', tone: 'normal' },
      { label: 'CARDS', value: `${cardCount}`, kind: 'capacity', tone: 'quiet' },
    ],
  };
}

/** The four stats the deck-build header keeps (see `deckMetaStatRun`) — typed
 * exactly, so a caller cannot pass DEF/MDEF in and wonder why they vanish. */
export type DeckMetaStatKey = 'maxHp' | 'attack' | 'magicPower' | 'speed';

export interface DeckMetaFacts {
  heroLevel: number;
  stats: Readonly<Record<DeckMetaStatKey, number>>;
  gemAdds: Partial<CombatantStats>;
  /** Board slots filled / total. */
  used: number;
  slots: number;
  /** Whole PL (the caller floors the deci figure — this module formats, it
   * does not do balance math). */
  powerLevel: number;
  gems: number;
}

/**
 * The deck-build header meta line — LV · the six stats · slots · PL · gems.
 *
 * THE ONE STAT DROPPED, and why. The shipped line carried all six capability
 * stats plus four more facts; on a 412px phone that is 74 characters at 10px
 * with no room to give the values a size lead. DEF and MDEF come out: they are
 * the two the deck-build screen cannot change (nothing on this screen edits
 * armour) and they are both still one tap away on PREP, which shows the full
 * six. What is left is exactly the facts a deck edit moves — LV, HP, ATK,
 * MATK, SPD, slots, PL, gems — and dropping two segments is what pays for the
 * value/label split on the remaining ones.
 */
export function deckMetaStatRun(facts: DeckMetaFacts): StatRun {
  const keys: readonly DeckMetaStatKey[] = ['maxHp', 'attack', 'magicPower', 'speed'];
  return {
    separator: ' · ',
    segments: [
      { label: 'LV', value: `${facts.heroLevel}`, kind: 'identity', tone: 'quiet' },
      ...keys.map((key): StatSegment => ({
        label: STAT_TOKEN[key],
        value: `${facts.stats[key]}`,
        kind: statlineKind(key),
        tone: key === 'maxHp' ? 'lead' : 'normal',
        ...(gemDelta(key, facts.gemAdds) !== undefined ? { delta: gemDelta(key, facts.gemAdds)! } : {}),
      })),
      { label: 'SLOTS', value: `${facts.used}/${facts.slots}`, kind: 'capacity', tone: 'lead' },
      { label: 'PL', value: `${facts.powerLevel}`, kind: 'cost', tone: 'normal' },
      { label: 'GEMS', value: `${facts.gems}`, kind: 'capacity', tone: 'quiet' },
    ],
  };
}

// ---------------------------------------------------------------------------
// The run LEDGER — the same kind vocabulary applied to the stats overlay grid.
// ---------------------------------------------------------------------------

/** A ledger cell is a stat segment that happens to be drawn in a box rather
 * than in a row. Same kinds, same inks — which is the point: GOLD SPENT is a
 * `cost` on the ledger for the same reason PL is a `cost` in the header. */
export interface LedgerFacts {
  wins: number;
  losses: number;
  bossesCleared: number;
  deepestWave: number;
  goldEarned: number;
  goldSpent: number;
  damageDealt: number;
  damageTaken: number;
  healingDone: number;
  cardsBought: number;
  gemsBought: number;
}

/**
 * The 5x2 ledger, in the fixed meaningful pairing it has always used (won/lost,
 * cleared/wave, earned/spent, dealt/taken, healing/purchases) — SAME order
 * everywhere it is shown.
 *
 * What changes here is only that the ten cells stop being ten identical bronze
 * numbers: what you EARNED is a `resource`, what you SPENT and what was TAKEN
 * are `cost`, healing is a `gain`, and the neutral counts are `tally`. The
 * left column no longer reads the same as the right by accident.
 */
export function ledgerStatRows(facts: LedgerFacts): ReadonlyArray<readonly [StatSegment, StatSegment]> {
  return [
    [
      { label: 'FIGHTS WON', value: `${facts.wins}`, kind: 'tally', tone: 'normal' },
      { label: 'FIGHTS LOST', value: `${facts.losses}`, kind: 'cost', tone: 'normal' },
    ],
    [
      { label: 'BOSSES CLEARED', value: `${facts.bossesCleared}`, kind: 'tally', tone: 'normal' },
      { label: 'DEEPEST WAVE', value: `${facts.deepestWave}`, kind: 'identity', tone: 'quiet' },
    ],
    [
      { label: 'GOLD EARNED', value: `${facts.goldEarned}`, kind: 'resource', tone: 'lead' },
      { label: 'GOLD SPENT', value: `${facts.goldSpent}`, kind: 'cost', tone: 'normal' },
    ],
    [
      { label: 'DAMAGE DEALT', value: `${facts.damageDealt}`, kind: 'stat', tone: 'normal' },
      { label: 'DAMAGE TAKEN', value: `${facts.damageTaken}`, kind: 'cost', tone: 'normal' },
    ],
    [
      { label: 'HEALING DONE', value: `${facts.healingDone}`, kind: 'vital', tone: 'normal' },
      { label: 'PURCHASES', value: `${facts.cardsBought}C / ${facts.gemsBought}G`, kind: 'capacity', tone: 'quiet' },
    ],
  ];
}

/** The plain single-string form of a run — for a hidden MEASURING pass, and
 * for tests that need to prove the segmented line still reads as the same
 * sentence it did before it was split. Never drawn. */
export function statRunPlainText(run: StatRun): string {
  return run.segments
    .map((s) => `${s.label}${s.label.endsWith(' ') ? '' : ' '}${s.value}${s.delta ? ` ${s.delta}` : ''}`)
    .join(run.separator);
}
