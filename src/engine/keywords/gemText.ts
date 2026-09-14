import type { Action, BuffableStat, Gem } from '../types';
import { GROUP_ORDER, HEADLINE_ORDER } from './compose';
import {
  CARD_MOD_KEYS,
  CARD_MOD_TEXT,
  HERO_MOD_TEXT,
  KEYWORD_TEXT,
  STAT_KEYS,
  STAT_RULE,
  faceClauseOf,
  ruleEntriesOf,
  type RenderCtx,
} from './text';

/**
 * THE GEM-TEXT GENERATOR — the same registry, the same grammar, 53 gems.
 *
 * `GemDef.text` used to be authored: 53 hand-written strings, 17 of which
 * inlined a keyword's MECHANISM ("attackers take the stack count as physical
 * damage per hit", "poison bypasses shields", "whoever holds the most is the
 * default target") — the exact disease the card migration removed from 450
 * card faces one day earlier, one surface over. And it was the SAME disease
 * twice over: 44 of the 53 gems carry an `Action` list from the very union
 * `KEYWORD_TEXT` already renders, so the gem was re-describing, in its own
 * words, a keyword whose definition already existed.
 *
 * The user's instruction (2026-09-06): *"start on working gems they should be
 * using same keywords tables"*, then *"they should have same text so that
 * there is no new text for stats every description should come from 1
 * reference i dont even want a gem glossary"*.
 *
 * So: a gem's face is `faceClauseOf` per action — the identical function a
 * card's face calls — and a gem's helper is `ruleEntriesOf` per action, the
 * identical definition a card's keyword opens. There is no gem vocabulary at
 * all. The two things a gem has that a card does not are its passive/scope
 * opener (derived from its modifier payload) and the two
 * stat-mod tables in `text.ts`, which reuse `STAT_TOKEN` / `STAT_RULE`.
 *
 * HOST-LESS. Every clause renders with `RenderCtx.host = 'gem'`, standalone
 * and socketed alike, so one gem has ONE sentence wherever it is shown (pouch,
 * socket panel, shop shelf, wiki, reward picker). The three host-owned terms a
 * clause would otherwise print — the type word, the `(+ATK)` suffix, the
 * `physical`/`magical` property word — belong to whatever card the gem is
 * socketed into and are dropped; no number and no keyword token ever is.
 *
 * PURE. A `Gem` in, a string out. No Phaser, no `Rng`, no state. The engine
 * has never read gem `text` (it reads `actions`/`mods`), and still does not.
 */

/** The four gem categories, derived from the PAYLOAD — never from the name. */
export type GemCategory = 'Sliver' | 'Echo' | 'Core' | 'Charm';

/**
 * A gem's category from its resolved payload. The structural twin of
 * `categoryOfGem` in `src/data/validateGemContent.ts`, which classifies an
 * UNVALIDATED `Record<string, unknown>` straight out of the JSON and so cannot
 * be shared with a typed `Gem`; `tests/engine/gemTextRegistry.test.ts` pins the
 * two in agreement across all 53 shipped gems.
 */
export function gemCategoryOf(gem: Gem): GemCategory {
  if (gem.kind === 'stat') return gem.scope === 'card' ? 'Core' : 'Charm';
  return gem.actions.some((a) => a.kind === 'statStrike' && a.echoHostPower === true) ? 'Echo' : 'Sliver';
}

/**
 * The PASSIVE / SCOPE OPENER a category's face leads with.
 *
 * Modifier-only gems are always on while equipped, so their values are labelled
 * Passive. Card-scoped modifiers retain the explicit this-card qualifier; the
 * unqualified Passive label denotes hero stats. Triggered and duration effects
 * are never labelled passive. Their two categories remain empty on purpose.
 * `Sliver` never had an opener. `Echo` used to be required to
 * open "Echo:" (gem ruleset R1.1, when the text was authored prose that could
 * lie about its own category) — but the generated face's first clause is the
 * `statStrike` clause, which already reads "Echo 1/2", so an "Echo:" prefix
 * would print the word twice for zero information. The category is still
 * enforced against the gem's NAME suffix by the validator; what is gone is a
 * check on a string nobody types any more.
 */
export const GEM_OPENER: Record<GemCategory, string> = {
  Sliver: '',
  Echo: '',
  Core: 'Passive (this card):',
  Charm: 'Passive:',
};

/**
 * The host-less context every gem clause renders in.
 *
 * `property` is REQUIRED by `RenderCtx` (a card always has one) and is a
 * PLACEHOLDER here — in host-less mode nothing reads it, which is not a
 * comment but a pinned test: `gemTextRegistry.test.ts` re-renders all 53 gems
 * with `physical`, `magical` and `true` in this slot and asserts the output is
 * byte-identical.
 */
const GEM_CTX: RenderCtx = {
  property: 'physical',
  element: undefined,
  weapon: undefined,
  size: 1,
  speedWeight: undefined,
  cooldownTurns: undefined,
  aoe: false,
  gated: false,
  host: 'gem',
};

/**
 * The registry's own clause ORDER, applied to a gem's actions.
 *
 * Reads `GROUP_ORDER` and `HEADLINE_ORDER` from `compose.ts` — the same two
 * tables the card grammar walks — so a gem carrying `ward` + `buffStat` prints
 * them in the order a card carrying `ward` + `buffStat` prints them, and a
 * future reordering moves both. (No merge pass: unlike a card, no gem carries
 * two actions of the same kind, and `gemTextRegistry.test.ts` holds that so
 * the case cannot appear silently.)
 */
function orderedActions(actions: readonly Action[]): Action[] {
  const rank = (a: Action): number => {
    const group = GROUP_ORDER.indexOf(KEYWORD_TEXT[a.kind].composeGroup);
    const within = HEADLINE_ORDER.indexOf(a.kind);
    return group * 100 + (within < 0 ? 0 : within);
  };
  return actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map((e) => e.a);
}

/**
 * Every clause of a gem's generated face, in order — the list `renderGemText`
 * joins. Exposed separately so a caller that wants one fact per line (a chip
 * row, a narrow mobile panel) does not have to split a sentence back apart.
 */
export function renderGemClauses(gem: Gem): string[] {
  const clauses: string[] = [];
  if (gem.kind === 'stat') {
    // ONE bundle per gem (the validator rejects an off-scope one), so exactly
    // one of these two loops contributes.
    const hero = gem.mods.hero;
    if (hero) {
      for (const stat of STAT_KEYS) {
        if (stat === 'maxHp') continue; // not a `BuffableStat`; no gem grants it
        const value = hero[stat as BuffableStat];
        if (value !== undefined) clauses.push(HERO_MOD_TEXT[stat as BuffableStat].faceClause(value));
      }
    }
    const card = gem.mods.card;
    if (card) {
      for (const key of CARD_MOD_KEYS) {
        const value = card[key];
        if (value !== undefined) clauses.push(CARD_MOD_TEXT[key].faceClause(value));
      }
    }
    return clauses;
  }
  for (const action of orderedActions(gem.actions)) clauses.push(faceClauseOf(action, GEM_CTX));
  // The Echo's two dials, printed as the parameters they are. Weight needs no
  // sentence of its own: the card face carries a weight plate, and the SPD
  // definition (`STAT_RULE.speed`, attached by `gemRuleEntries`) is the one
  // place the turn-order formula including card weight is stated.
  if (gem.weightIncreasePct !== undefined) clauses.push(`+${gem.weightIncreasePct}% weight`);
  if (gem.cooldownReduction !== undefined) clauses.push(`-${gem.cooldownReduction}t cooldown`);
  return clauses;
}

/**
 * A gem's whole printed face: its scope opener, then its clauses joined with
 * the ` · ` separator every card face uses, closed with a full stop.
 */
export function renderGemText(gem: Gem): string {
  const clauses = renderGemClauses(gem);
  const opener = GEM_OPENER[gemCategoryOf(gem)];
  const body = clauses.length > 0 ? `${clauses.join(' · ')}.` : 'No effect.';
  return opener === '' ? body : `${opener} ${body}`;
}

/**
 * Every definition a gem's face invites, deduplicated by title and in printed
 * order — the SAME entries a card's keywords open (`ruleEntriesOf`), plus the
 * stat definitions a stat gem's mods name.
 *
 * This is what replaces the deleted `src/game/ui/gemGlossary.ts`: that file
 * pasted the gem's authored sentence into a tooltip, so a gem's explanation was
 * whatever its author had typed. A gem now hands a player the game's one
 * definition of Poison, or of ATK, word for word identical to the card's.
 */
export function gemRuleEntries(gem: Gem): Array<{ title: string; body: string }> {
  const entries: Array<{ title: string; body: string }> = [];
  const seen = new Set<string>();
  const push = (entry: { title: string; body: string } | undefined): void => {
    if (!entry || seen.has(entry.title)) return;
    seen.add(entry.title);
    entries.push(entry);
  };
  if (gem.kind === 'stat') {
    const hero = gem.mods.hero;
    if (hero) {
      for (const stat of STAT_KEYS) {
        if (stat === 'maxHp') continue;
        if (hero[stat as BuffableStat] !== undefined) push(HERO_MOD_TEXT[stat as BuffableStat].rule);
      }
    }
    const card = gem.mods.card;
    if (card) {
      for (const key of CARD_MOD_KEYS) if (card[key] !== undefined) push(CARD_MOD_TEXT[key].rule);
    }
    return entries;
  }
  for (const action of orderedActions(gem.actions)) for (const entry of ruleEntriesOf(action)) push(entry);
  if (gem.weightIncreasePct !== undefined) push(STAT_RULE.speed);
  return entries;
}
