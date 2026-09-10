import type { Action, BuffableStat, Element, Property, SkillSize, WeaponType } from '../types';

/**
 * KEYWORD TEXT — the TEXT facet of the keyword document, as DATA.
 *
 * The twin of `pricing.ts`, deliberately built to the same shape: a mapped
 * type over `Action['kind']`, so a 37th keyword fails `tsc` until it has a
 * row rather than silently rendering nothing (the exact failure that left
 * `attunedShield` printing an empty clause on every card face until
 * 2026-08-30, and that left 12 of 36 kinds with no `scaffoldCard` phrase at
 * all).
 *
 * THE SPLIT THIS TABLE EXISTS FOR (user-locked 2026-09-06):
 *
 *   "i dont think you need to state that poison happen at the end of the turn
 *    on card description if anything that should be said in the poison
 *    description"
 *
 * So every row carries the card's own PARAMETERS and the keyword's MECHANISM
 * as two SEPARATE fields that are never concatenated:
 *
 *   `faceClause`   — THIS card's numbers, as a keyword token. Printed on the
 *                    face. Contains no mechanism, ever.
 *   `ruleSentence` — THE ONE mechanism definition, shared by every card that
 *                    carries the keyword. NEVER printed on a face; reached
 *                    only by tap/hover (`cardGlossary.ts`).
 *
 * Because the clause is ONE function per kind rather than 450 hand-authored
 * strings, "sometimes wrapped in `{{...}}`, sometimes not" and "this card says
 * the reflect is TRUE, that one says physical" both stop being expressible.
 *
 * LAYER: pure data + string templates. No Phaser, no DOM, no engine state.
 * `src/data/validateSkillContent.ts`, `scripts/scaffoldCard.ts` and every
 * `src/game/ui/*` presentation module read THIS table, never their own switch.
 */

/**
 * Which of the six ordered buckets a keyword's clause lands in
 * (`compose.ts`'s `renderSkillClauses`). The order is fixed and total, so two
 * cards carrying the same kit can never present it in two different orders —
 * the inconsistency the user named on `bramble_ward` vs `bramble_covenant`.
 */
export type ComposeGroup =
  /** `shieldBreak` — it happens BEFORE the hit, so it leads the sentence. */
  | 'setup'
  /** The card's headline number: damage / heal / shield / plating / echo. */
  | 'headline'
  /** This cast's direct consequences on the victim (DoTs, control, taxes). */
  | 'payload'
  /** Buffs this cast grants the CASTER (thorns/guard/negate/ward/taunt/...). */
  | 'selfGrant'
  /** The 11-member cross-cast bonus-rider family. Always trailing. */
  | 'conditional';

/**
 * What a clause needs to know about the CARD beyond the action itself — the
 * card's own type identity and tempo. Built once per render by `compose.ts`;
 * a clause never reaches for ambient state.
 */
export interface RenderCtx {
  property: Property;
  element?: Element | undefined;
  weapon?: WeaponType | undefined;
  size: SkillSize;
  speedWeight?: number | undefined;
  cooldownTurns?: number | undefined;
  /** This card's offensive lines fan out to every living foe. */
  aoe: boolean;
  /**
   * This clause is being rendered INSIDE an `{{Affinity}} {Type} —` wrap.
   *
   * The wrap has already named the card's type, so a gated clause must not
   * name it a second time: `{{Affinity}} Axe — Deal 48 (+ATK) Axe damage`
   * says "Axe" twice and "damage" once more than the headline it sits beside.
   * The two kinds that print a type word (`damage`, `attunedShield`) drop it
   * here — nothing else changes, and no number or stat suffix is ever dropped.
   */
  gated: boolean;
  /**
   * This clause REPEATS the kind its own card already delivered as a headline
   * (damage after damage, heal after heal, shield after shield).
   *
   * WHY IT EXISTS (2026-09-07). 20 authored faces said "hit again for 28" and
   * "restore 12 more" for exactly this shape — an affinity-gated second
   * helping of what the card already does. Generated without the flag, the same
   * card read `Deal 34 (+ATK) Sword damage · {{Affinity}} Sword — Deal 28
   * (+ATK)`, which a player reads as an unrelated SECOND attack rather than the
   * same attack landing twice. The words here are the authored corpus's own
   * ("again" / "more"); no new vocabulary, and no `ruleSentence` changes,
   * because this is a fact about THIS CARD's shape, not about a keyword.
   *
   * Set by `compose.ts` from the card's own effect list, never by content. Only
   * the three plain sinks read it (`damage`, `heal`, `shield`) — the two kinds
   * with an identity of their own (`attunedShield`, `statStrike`) are already
   * distinct from the headline they follow.
   */
  repeatsHeadline?: boolean | undefined;
  /**
   * HOST-LESS MODE — this clause belongs to a GEM being shown on its own.
   *
   * `RenderCtx` otherwise assumes a host card, because the three facts a
   * defensive/offensive clause needs (which property, which type, which stat
   * scales it) belong to the card, not to the action. A gem's `shield 4` has
   * NO property of its own: socketed, it takes the host's; in the pouch, in
   * the shop and in the wiki there is no host at all. So `'gem'` drops exactly
   * those three host-owned terms — the type word, the `(+ATK)`/`(+MDEF)`
   * suffix, and the `physical`/`magical` property word — and nothing else. No
   * number and no keyword token is ever dropped.
   *
   * A gem therefore reads IDENTICALLY standalone and socketed (`renderGemText`
   * passes `'gem'` in both cases), which is the point: one gem, one sentence.
   * Absent/`'card'` is the card-hosted behaviour, byte for byte.
   */
  host?: 'card' | 'gem' | undefined;
}

/** True when this clause is being rendered for a gem with no host card. */
function hostless(ctx: RenderCtx): boolean {
  return ctx.host === 'gem';
}

/**
 * Every player-facing stat key: the engine's five `BuffableStat` scaling stats
 * plus max HP (not itself buffable, but shown on every statline and named by
 * the HP definition below).
 */
export type StatLabelKey = 'maxHp' | BuffableStat;

/** Canonical display order for a full statline (HP first, then the five
 * buffable stats in the order every existing statline already used). */
export const STAT_KEYS: readonly StatLabelKey[] = ['maxHp', 'attack', 'magicPower', 'armor', 'magicResist', 'speed'];

/**
 * THE canonical short stat token — HP, ATK, MATK, DEF (armor), MDEF
 * (magicResist), SPD. THE ONLY DEFINITION IN THE CODEBASE: it used to be
 * written twice (here, for `buffStat`/`debuffStat` clauses, and in
 * `src/game/ui/statLabels.ts`, for every statline) because `src/engine` may
 * not import from `src/game` — the pin test held them equal but two tables
 * is still two tables. `statLabels.ts` now RE-EXPORTS this one (`src/game`
 * importing `src/engine` is allowed and is the direction the layer rule
 * points), so a stat is spelled once for the whole game.
 *
 * `maxHp` joined the table when the stat DEFINITIONS moved here (below);
 * every previously-present value is byte-identical.
 */
export const STAT_TOKEN: Record<StatLabelKey, string> = {
  maxHp: 'HP',
  attack: 'ATK',
  magicPower: 'MATK',
  armor: 'DEF',
  magicResist: 'MDEF',
  speed: 'SPD',
};

/** Long-form name for definition titles and full-word prose ("20 + Magic
 * Power damage") — the prose companion to `STAT_TOKEN`, moved here with it
 * so the pair cannot be split across two layers again. */
export const STAT_LONG_NAME: Record<StatLabelKey, string> = {
  maxHp: 'Hit Points',
  attack: 'Attack',
  magicPower: 'Magic Power',
  armor: 'Armor',
  magicResist: 'Magic Resist',
  speed: 'Speed',
};

/**
 * THE SIX STAT DEFINITIONS — `ruleSentence`'s twin for a stat instead of a
 * keyword, and the reason a stat gem needs NO text of its own.
 *
 * Every word here is MOVED, not authored: these are `src/game/ui/
 * statGlossary.ts`'s `STAT_ENTRY` bodies, verbatim, from the file this change
 * deletes. They now sit beside the keyword rows because the game has exactly
 * one place a description may live (user-locked 2026-09-06: *"they should have
 * same text so that there is no new text for stats every description should
 * come from 1 reference i dont even want a gem glossary"*), and because three
 * different surfaces need the same six sentences:
 *
 *   - a hero statline's `HP 120 · ATK 14 · …` hover (what `statGlossary` did),
 *   - a card's `+20% ATK (2t)` buff/debuff clause,
 *   - a Charm gem's whole face (`Hero: +8 MATK`), which is a stat and nothing
 *     else, so its helper IS the stat's definition.
 *
 * NUMBER-FREE like every `ruleSentence`, with ONE inherited exception stated
 * openly: the HP body ends "0 HP is a loss". That `0` is a rule of the game,
 * not a card's or a gem's magnitude — the thing the digit ban exists to keep
 * out — and rewriting it would be authoring, which this move is not allowed
 * to do. `tests/engine/gemTextRegistry.test.ts` pins all six bodies literally,
 * which is a stricter guard than the digit heuristic anyway.
 */
export const STAT_RULE: Record<StatLabelKey, { title: string; body: string }> = {
  maxHp: {
    title: STAT_TOKEN.maxHp,
    body: 'Hit points. Reaching zero is a loss.',
  },
  attack: {
    title: `${STAT_TOKEN.attack} — ${STAT_LONG_NAME.attack}`,
    body: 'Scales physical damage.',
  },
  magicPower: {
    title: `${STAT_TOKEN.magicPower} — ${STAT_LONG_NAME.magicPower}`,
    body: 'Scales magical damage.',
  },
  armor: {
    title: `${STAT_TOKEN.armor} — ${STAT_LONG_NAME.armor}`,
    body: 'Scales physical healing and Shield. Reduces physical damage taken.',
  },
  magicResist: {
    title: `${STAT_TOKEN.magicResist} — ${STAT_LONG_NAME.magicResist}`,
    body: 'Scales magical healing and Shield. Reduces magical damage taken.',
  },
  speed: {
    title: `${STAT_TOKEN.speed} — ${STAT_LONG_NAME.speed}`,
    body: 'Adds readiness each turn. Playing a card costs weight.',
  },
};

/** The six canonical tokens in statline order — `STAT_KEYS` mapped through
 * `STAT_TOKEN`, so a statline's label list can never drift from the table. */
export const STAT_LABELS: readonly string[] = STAT_KEYS.map((k) => STAT_TOKEN[k]);

/**
 * The definition for a stat named by its TOKEN (`'ATK'`, case-insensitive) —
 * what a statline hover has in its hand. Falls back to a generic entry for an
 * unrecognised label so a caller never has to guard it (moved verbatim from
 * `statGlossary.ts#statHoverEntry`, whose only job this was).
 */
export function statRuleByToken(label: string): { title: string; body: string } {
  const key = label.trim().toUpperCase();
  for (const stat of STAT_KEYS) {
    if (STAT_TOKEN[stat].toUpperCase() === key) return STAT_RULE[stat];
  }
  return { title: label, body: 'A combat stat.' };
}

/** `sword` -> `Sword`, `lightning` -> `Lightning`. */
export function typeName(type: Element | WeaponType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * The card's printed TYPE WORD on a damage line: its element or weapon, or
 * `TRUE` when the property makes the type cosmetic (TRUE ignores both
 * matchup wheels, so naming the weapon there would advertise a matchup the
 * card does not have).
 */
function damageTypeWord(ctx: RenderCtx): string {
  if (hostless(ctx)) return ''; // the type is the HOST card's, not the gem's
  if (ctx.property === 'true') return 'TRUE';
  const type = ctx.element ?? ctx.weapon;
  return type === undefined ? '' : typeName(type);
}

/**
 * The stat-scaling suffix — a PARAMETER OF THIS CARD (which stat this line
 * reads), not a rule about a keyword, so it stays inline on the face
 * (spec §3, recommendation A). Offense reads ATK/MATK, defensive output reads
 * DEF/MDEF — the presentation mirror of the engine's `scaleStat`/
 * `scaleDefStat` pair.
 */
function offenseSuffix(ctx: RenderCtx): string {
  if (hostless(ctx)) return ''; // which stat scales it is the HOST's property
  if (ctx.property === 'true') return '(+best stat)';
  return ctx.property === 'physical' ? '(+ATK)' : '(+MATK)';
}
function defenseSuffix(ctx: RenderCtx): string {
  if (hostless(ctx)) return '';
  // TRUE defensive output is FLAT BY IDENTITY — no stat term at all, so no
  // suffix (an empty one, collapsed by the template's own spacing).
  if (ctx.property === 'true') return '';
  return ctx.property === 'physical' ? '(+DEF)' : '(+MDEF)';
}

/** `physical`/`magical`/`TRUE` — a property named on an action, not the card. */
function propertyWord(property: Property): string {
  return property === 'true' ? 'TRUE' : property;
}

/** Collapses the double space a missing (TRUE) stat suffix would leave. */
function tidy(s: string): string {
  return s.replace(/\s{2,}/g, ' ').trim();
}

/**
 * THE WHOLE DAMAGE HEADLINE, from every ungated `damage` power on the card at
 * once — one template rather than one clause per action.
 *
 * MULTI-HIT IS NOT A SUM. Two hits of 24 are not one hit of 48: armor, a
 * guard, a negate charge and a thorns pile all apply PER HIT, so the count is
 * a mechanical fact the face has to carry. Three cards ship it (`barrage`,
 * `rapid_volley`, `twin_slash`), and `twin_slash` grows a SECOND, smaller hit
 * at Silver — which is why unequal powers get their own form rather than
 * being rounded into the `×N` one.
 *
 * `ctx.gated` drops the type word: inside an `{{Affinity}} Axe —` wrap the
 * type has already been named by the wrap itself.
 */
export function damageClause(powers: readonly number[], ctx: RenderCtx): string {
  const suffix = offenseSuffix(ctx);
  const type = ctx.gated ? '' : damageTypeWord(ctx);
  const noun = ctx.gated ? '' : 'damage';
  const first = powers[0] ?? 0;
  const allEqual = powers.every((p) => p === first);
  // THE REPEAT FORM — the authored corpus's own words ("hit again for 28",
  // sworn_edge/lance_thrust/arcane_bolt and 17 more). It replaces the verb and
  // nothing else: the number and the stat suffix are parameters and stay.
  const head = ctx.repeatsHeadline
    ? `Hit again for ${allEqual ? first : powers.join(', then ')}`
    : (allEqual ? `Deal ${first}` : `Deal ${powers.join(', then ')}`);
  const tail = allEqual && powers.length > 1 ? ` ×${powers.length}` : '';
  return tidy(`${head} ${suffix} ${type} ${noun}`) + tail;
}

export interface KeywordTextDef<K extends Action['kind'] = Action['kind']> {
  composeGroup: ComposeGroup;
  /**
   * The `KEYWORD_TEXT_COLOR` id this kind's face clause marks up, a function
   * of the action's own fields for the two dynamic kinds (`exploit`/
   * `stackBonus` key off `action.status`), or `undefined` for the EXEMPTION
   * LIST — the kinds whose face clause names no keyword at all.
   *
   * This field is what `tests/engine/keywordRegistryReachability.test.ts`
   * enforces in BOTH directions: a kind with a token must emit exactly that
   * token, wrapped, resolving to a real colour; a kind without one must emit
   * no markup. So "the colour exists but no card ever wraps the word" — the
   * live `guard`/`negate`/`shield` gap this migration closes — cannot recur.
   */
  displayToken: string | ((action: Extract<Action, { kind: K }>) => string | undefined) | undefined;
  /**
   * THIS CARD'S OWN NUMBERS, NOTHING ELSE. No mechanism, no "ticks at end of
   * turn", no "bypasses shields", no "attackers take the stack count...".
   * Where `displayToken` names an id, this MUST wrap it in `{{...}}` markup —
   * with the rule prose gone, that coloured word is the ONLY thing left on the
   * face inviting the tap that teaches the rule.
   */
  faceClause: (action: Extract<Action, { kind: K }>, ctx: RenderCtx) => string;
  /** Glossary heading for `ruleSentence`. Empty when there is no entry. */
  ruleTitle: string;
  /**
   * THE ONE MECHANISM DEFINITION — the helper a player gets when they press
   * the keyword. Never printed inline on any face. `''` for the two kinds
   * that genuinely have no rule of their own beyond what the type badge
   * already teaches unconditionally (`damage`, `heal`).
   *
   * A PLAIN STRING LITERAL, NOT A FUNCTION OF THE ACTION — and that is the
   * whole point of the type (user-locked 2026-09-06):
   *
   *   "I dont think you should be explaining the amount of x debuff like
   *    poison 8 or thorn 5 as other cards that have other amounts"
   *
   * The CARD carries the amount (`{{Poison}} 8`); the definition explains
   * what the keyword DOES and reads IDENTICALLY on every card that carries
   * it. Today's `cardGlossary.ts` bodies interpolate the action
   * (`Applies ${action.stacks} poison — ... = ${total} total`), which is the
   * card text's own disease one surface over. Typing this as `string` makes
   * a parameterised helper a compile error rather than a convention, and
   * `tests/engine/keywordRegistryReachability.test.ts` additionally asserts
   * no rule sentence contains a digit, a `%` or `{{...}}` markup — so a
   * card-specific number cannot be smuggled in as a literal either.
   */
  ruleSentence: string;
  /**
   * The COMPACT board/list badge (`PSN 5`, `THORN 5`) — unchanged in content
   * from `summarizeEffectSegments`'s own switch, moved here so the face body
   * and the board badge cannot drift into two vocabularies.
   *
   * `keyword` is the `KEYWORD_TEXT_COLOR` id the badge tints with; it is NOT
   * always `displayToken` (the conditional riders borrow the colour of the
   * resource they read), which is why it is carried separately.
   */
  faceToken: (action: Extract<Action, { kind: K }>, ctx: RenderCtx) => { text: string; keyword?: string };
}

export type KeywordTextTable = { [K in Action['kind']]: KeywordTextDef<K> };

/**
 * Aura is positional card metadata rather than an `Action`, so it cannot be a
 * row in the exhaustively Action-keyed `KEYWORD_TEXT` table below. It still
 * has one canonical glossary record consumed by card detail, template
 * glossary, and desktop hover routes.
 */
export const AURA_RULE_ENTRY = {
  title: 'Aura',
  body: 'Provides effects to affected cards within range.',
} as const;

/**
 * Compact face names for the statuses a conditional rider (`exploit` /
 * `stackBonus`) keys off — the SAME abbreviations those statuses use as their
 * own badges, so one status reads as one word wherever it appears.
 */
const STATUS_TOKEN: Record<'poison' | 'burn' | 'bleed' | 'stun' | 'debuff' | 'expose' | 'thorns', string> = {
  poison: 'PSN',
  burn: 'BRN',
  bleed: 'BLD',
  stun: 'STUN',
  debuff: 'DEBUFF',
  expose: 'EXPOSE',
  thorns: 'THORN',
};

/** Title-cased status names for a rider's FACE CLAUSE markup token. */
const STATUS_MARKUP: Record<'poison' | 'burn' | 'bleed' | 'stun' | 'debuff' | 'expose' | 'thorns', string> = {
  poison: 'Poison',
  burn: 'Burn',
  bleed: 'Bleed',
  stun: 'Stun',
  // `debuff` covers both buffStat/debuffStat and has no keyword colour of its
  // own — matching `skillPresentation.ts`'s existing
  // `action.status === 'debuff' ? undefined : ...` rule exactly.
  debuff: 'debuff',
  expose: 'Expose',
  thorns: 'Thorns',
};

/**
 * THE SHARED RULE of the eleven cross-cast riders, stated once and attached to
 * all of them rather than re-typed per row.
 */
const RIDER_RULE =
  'Checks state before this cast applies its effects. A card cannot meet its own condition until a later cast.';

const GLOBAL_TURNS = 'Duration decreases at the end of each global turn.';

/** Every affliction the `ward`/`cleanse` pair speak about, named once. */
const AFFLICTIONS = 'poison, burn, bleed, stat debuffs and expose';

export const KEYWORD_TEXT: KeywordTextTable = {
  // ── setup ────────────────────────────────────────────────────────────────
  shieldBreak: {
    composeGroup: 'setup',
    displayToken: 'shatter',
    faceClause: (a) => `{{Shatter}} ${a.amount}`,
    // TITLED FOR THE WORD THE PLAYER TAPPED (2026-09-07). The face prints
    // `{{Shatter}}` and the compact badge prints `SHATTER 16`, so a panel
    // headed "Shield break" was a third name for one keyword. Renamed to the
    // face word rather than the reverse: `shatter` is the `KEYWORD_TEXT_COLOR`
    // id, so the colour, the face, the badge and the heading are now one word.
    ruleTitle: 'Shatter',
    ruleSentence: 'Remove X Shield before this card deals damage. Does not remove Attuned Shield.',
    faceToken: (a) => ({ text: `SHATTER ${a.amount}`, keyword: 'shatter' }),
  },

  // ── headline ─────────────────────────────────────────────────────────────
  // The two plain sinks are EXEMPT from the markup requirement: their
  // mechanism (property -> which stat scales, defence-vs-offence role) is
  // taught unconditionally by the type badge's own tooltip, on every card,
  // whether or not a word is coloured — and they carry no `ruleSentence` of
  // their own at all, which is the honest test for exemption (see `shield`
  // below, which failed it and has been corrected).
  damage: {
    composeGroup: 'headline',
    displayToken: undefined,
    faceClause: (a, ctx) => damageClause([a.power], ctx),
    ruleTitle: '',
    ruleSentence: '',
    faceToken: (a) => ({ text: `DMG ${a.power}` }),
  },
  heal: {
    composeGroup: 'headline',
    displayToken: undefined,
    // Host-less mode falls through to the plain arm on purpose: the TRUE
    // wording is a statement about the HOST card's property, which a gem's
    // heal does not have (`defenseSuffix` already returns '' there).
    // `repeatsHeadline` prints the authored corpus's own word for a second
    // helping ("restore 12 more", gravelight_choir) — see `RenderCtx`.
    faceClause: (a, ctx) => {
      const more = ctx.repeatsHeadline ? ' more' : '';
      return ctx.property === 'true' && !hostless(ctx)
        ? `Restore ${a.power} TRUE${more} HP`
        : tidy(`Restore ${a.power} ${defenseSuffix(ctx)}${more} HP`);
    },
    ruleTitle: '',
    ruleSentence: '',
    faceToken: (a) => ({ text: `HEAL ${a.power}` }),
  },
  // `shield` USED to sit with the two plain sinks above (2026-09-06, corrected
  // same day). It does not belong there: unlike `damage`/`heal` it carries a
  // real `ruleSentence` — the TRUE-blocks-everything / two-points-for-one drain
  // rule, which nothing on a card face teaches — and 31 cards printed the word
  // uncoloured, i.e. the most common defensive keyword was the one with no tap
  // cue. The MARKUP IS LOWERCASE (`{{shield}}`) on purpose: the keyword id is
  // the LOWERCASED brace content (`cardTextMarkup.ts`) while the display text
  // keeps the author's casing, so the colour resolves exactly as `{{Shield}}`
  // does on `shieldBurst` while this clause's own sentence stays byte-identical
  // ("Gain 10 (+DEF) physical shield" — mid-sentence, so mid-sentence casing).
  shield: {
    composeGroup: 'headline',
    displayToken: 'shield',
    // The property word is the ONE host-owned term a clause interpolates
    // directly rather than through a suffix helper, so host-less mode needs
    // its own arm here (and only here — every other clause's host terms come
    // from `damageTypeWord`/`offenseSuffix`/`defenseSuffix`, which already
    // return `''`). A gem's plating takes the property of whatever card it is
    // socketed into, so naming one would be a guess.
    faceClause: (a, ctx) => {
      // `more` is the same word the heal repeat uses, for the same shape.
      const more = ctx.repeatsHeadline ? ' more' : '';
      return hostless(ctx)
        ? `Gain ${a.power}${more} {{shield}}`
        : ctx.property === 'true'
          ? `Gain ${a.power} TRUE${more} {{shield}}`
          : tidy(`Gain ${a.power} ${defenseSuffix(ctx)}${more} ${ctx.property} {{shield}}`);
    },
    ruleTitle: 'Shield',
    ruleSentence: 'Absorb X matching damage and prevent Bleed while active.',
    faceToken: (a) => ({ text: `SHLD ${a.power}`, keyword: 'shield' }),
  },
  attunedShield: {
    composeGroup: 'headline',
    displayToken: 'attuned',
    faceClause: (a, ctx) => {
      const type = ctx.gated ? undefined : (ctx.element ?? ctx.weapon);
      return tidy(`{{Attuned}} shield ${a.power} ${defenseSuffix(ctx)}${type === undefined ? '' : ` — ${typeName(type)}`}`);
    },
    ruleTitle: 'Attuned Shield',
    ruleSentence: 'Gain X Attuned Shield that absorbs 2 matching damage per Shield and 1 other same-property damage, using Attuned Shield first when matched and last otherwise.',
    faceToken: (a) => ({ text: `ATTUNED SHLD ${a.power}`, keyword: 'attuned' }),
  },
  // `statStrike` is the Resonant Echo gem's payload and has ZERO authored card
  // uses, so it is deferred out of the markup requirement rather than forced
  // to a decision for content that does not exist (spec §1.3).
  statStrike: {
    composeGroup: 'headline',
    displayToken: undefined,
    faceClause: (a) => `${a.echoHostPower ? 'Echo' : 'Strike'} 1/${a.shareOf}${a.cap === undefined ? '' : ` (cap ${a.cap})`}`,
    ruleTitle: 'Echo',
    ruleSentence: 'Echo deals a separate hit using 1/X of this card’s base damage and stat; Strike uses 1/X of the stat only. Each hit resolves separately.',
    faceToken: (a) => ({ text: `${a.echoHostPower ? 'ECHO' : 'STRIKE'} 1/${a.shareOf}${a.cap === undefined ? '' : ` (cap ${a.cap})`}` }),
  },

  // ── payload ──────────────────────────────────────────────────────────────
  lifesteal: {
    composeGroup: 'payload',
    displayToken: 'lifesteal',
    faceClause: (a) => `{{Lifesteal}} ${a.pct}%`,
    ruleTitle: 'Lifesteal',
    ruleSentence: 'Heal for 1/X of damage dealt by this card.',
    faceToken: (a) => ({ text: `LSTEAL ${a.pct}%`, keyword: 'lifesteal' }),
  },
  poison: {
    composeGroup: 'payload',
    displayToken: 'poison',
    faceClause: (a) => `{{Poison}} ${a.stacks}`,
    ruleTitle: 'Poison',
    ruleSentence: 'Deal X damage at the end of each turn, then lose 1 Poison.',
    faceToken: (a) => ({ text: `PSN ${a.stacks}`, keyword: 'poison' }),
  },
  burn: {
    composeGroup: 'payload',
    displayToken: 'burn',
    faceClause: (a) => `{{Burn}} ${a.stacks}`,
    ruleTitle: 'Burn',
    ruleSentence: 'Deal 2X damage at the start of each turn, then halve Burn.',
    faceToken: (a) => ({ text: `BRN ${a.stacks}`, keyword: 'burn' }),
  },
  bleed: {
    composeGroup: 'payload',
    displayToken: 'bleed',
    faceClause: (a) => `{{Bleed}} ${a.stacks}`,
    ruleTitle: 'Bleed',
    ruleSentence: 'After the first card played each turn, deal X damage and lose 1 Bleed.',
    faceToken: (a) => ({ text: `BLD ${a.stacks}`, keyword: 'bleed' }),
  },
  stun: {
    composeGroup: 'payload',
    displayToken: 'stun',
    faceClause: (a) => (a.turns > 1 ? `{{Stun}} ×${a.turns}` : '{{Stun}}'),
    ruleTitle: 'Stun',
    ruleSentence: 'Prevents the next card from activating and sets readiness to 0.',
    faceToken: () => ({ text: 'STUN', keyword: 'stun' }),
  },
  debuffStat: {
    composeGroup: 'payload',
    // EXEMPT (judgment call, spec §1.3): the only hidden mechanism here is
    // "global turns", a clarification rather than a rule a player is punished
    // for not knowing. Still reachable via the unconditional glossary
    // attachment, just without a coloured word inviting the tap.
    displayToken: undefined,
    faceClause: (a) => `-${a.pct}% enemy ${STAT_TOKEN[a.stat]} (${a.turns}t)`,
    ruleTitle: 'Stat debuff',
    ruleSentence: 'Reduce the named stat by X% for X turns.',
    faceToken: (a) => ({ text: `-${a.pct}% ${STAT_TOKEN[a.stat]} ${a.turns}t` }),
  },
  expose: {
    composeGroup: 'payload',
    displayToken: 'expose',
    faceClause: (a) => `{{Expose}} +${a.pct}% (${a.turns}t)`,
    ruleTitle: 'Expose',
    ruleSentence: 'Deal X% more damage on next attacks for X turns.',
    faceToken: (a) => ({ text: `EXPOSE ${a.pct}% ${a.turns}t`, keyword: 'expose' }),
  },
  slow: {
    composeGroup: 'payload',
    displayToken: 'slow',
    faceClause: (a) => `{{Slow}} +${a.weight}wt`,
    ruleTitle: 'Slow',
    ruleSentence: 'Add X Weight to the next card this turn.',
    faceToken: (a) => ({ text: `SLOW +${a.weight}`, keyword: 'slow' }),
  },
  burden: {
    composeGroup: 'payload',
    displayToken: 'burden',
    faceClause: (a) => `{{Burden}} +${a.weight}wt`,
    ruleTitle: 'Burden',
    ruleSentence: 'Add X Weight to the target card until it is played.',
    faceToken: (a) => ({ text: `BURDEN +${a.weight} WT`, keyword: 'burden' }),
  },
  curse: {
    composeGroup: 'payload',
    displayToken: 'curse',
    faceClause: (a) => `{{Curse}} -${a.amount} (${a.turns}t)`,
    ruleTitle: 'Curse',
    ruleSentence: 'Reduce the target card’s damage by X for X turns.',
    faceToken: (a) => ({ text: `CURSE -${a.amount} DMG ${a.turns}t`, keyword: 'curse' }),
  },
  splash: {
    composeGroup: 'payload',
    displayToken: 'splash',
    faceClause: () => '{{Splash}}',
    ruleTitle: 'Splash',
    ruleSentence: 'Spread this card’s debuffs to neighboring cards.',
    faceToken: () => ({ text: 'SPLASH', keyword: 'splash' }),
  },
  disrupt: {
    composeGroup: 'payload',
    displayToken: 'disrupt',
    faceClause: (a) => `{{Disrupt}} ${a.amount}`,
    // ONE NAME, AND THE CODEBASE ALREADY VOTED (2026-09-07). This keyword was
    // called three things: `{{Disrupt}}` on the face, `STAG` on the compact
    // badge, "Stagger" on the panel heading. Every OTHER player-facing use in
    // the game says Disrupt — the battle log line (`battleTimeline.ts`:
    // "Disrupt −N readiness"), the enemy-design notes, the colour id — and
    // "Stagger" appeared exactly once, here. So the heading and the badge move
    // to Disrupt rather than the other way round, which would also have needed
    // a new `KEYWORD_TEXT_COLOR` key for a word nothing else uses.
    ruleTitle: 'Disrupt',
    ruleSentence: 'Remove X readiness from the target.',
    faceToken: (a) => ({ text: `DISRUPT ${a.amount}`, keyword: 'disrupt' }),
  },

  // ── selfGrant ────────────────────────────────────────────────────────────
  thorns: {
    composeGroup: 'selfGrant',
    displayToken: 'thorns',
    faceClause: (a) => `{{Thorns}} ${a.stacks}`,
    ruleTitle: 'Thorns',
    ruleSentence: 'Deal X physical damage when hit by an attack, then lose 1 Thorns.',
    faceToken: (a) => ({ text: `THORN ${a.stacks}`, keyword: 'thorns' }),
  },
  guard: {
    composeGroup: 'selfGrant',
    displayToken: 'guard',
    faceClause: (a) => `{{Guard}} -${a.pct}% ${propertyWord(a.property)} (${a.turns}t)`,
    ruleTitle: 'Guard',
    ruleSentence: 'Reduce matching damage by X% for X turns.',
    faceToken: (a) => ({
      text: `${a.property === 'physical' ? 'P' : a.property === 'magical' ? 'M' : 'T'}.GUARD ${a.pct}% ${a.turns}t`,
      keyword: 'guard',
    }),
  },
  negate: {
    composeGroup: 'selfGrant',
    displayToken: 'negate',
    faceClause: (a) => `{{Negate}} ×${a.charges} ${propertyWord(a.property)}`,
    ruleTitle: 'Negate',
    ruleSentence: 'Prevent the next X attacks matching this card’s property.',
    faceToken: (a) => ({
      text: `${a.property === 'physical' ? 'P' : a.property === 'magical' ? 'M' : 'T'}.NEGATE ×${a.charges}`,
      keyword: 'negate',
    }),
  },
  ward: {
    composeGroup: 'selfGrant',
    displayToken: 'ward',
    faceClause: (a) => `{{Ward}} ${a.charges}`,
    ruleTitle: 'Ward',
    ruleSentence: 'Prevent the next X Poison, Burn, Bleed, stat debuff, or Expose applications.',
    faceToken: (a) => ({ text: `WARD ×${a.charges}`, keyword: 'ward' }),
  },
  buffStat: {
    composeGroup: 'selfGrant',
    // EXEMPT for the same reason as `debuffStat` above.
    displayToken: undefined,
    faceClause: (a) => `+${a.pct}% ${STAT_TOKEN[a.stat]} (${a.turns}t)`,
    ruleTitle: 'Stat buff',
    ruleSentence: 'Increase the named stat by X% for X turns.',
    faceToken: (a) => ({ text: `+${a.pct}% ${STAT_TOKEN[a.stat]} ${a.turns}t` }),
  },
  taunt: {
    composeGroup: 'selfGrant',
    displayToken: 'taunt',
    faceClause: (a) => `{{Taunt}} +${a.amount}`,
    ruleTitle: 'Taunt',
    ruleSentence: 'Add X Aggro permanently; enemies attack the living target with the highest Aggro.',
    faceToken: (a) => ({ text: `TAUNT +${a.amount}`, keyword: 'taunt' }),
  },
  cleanse: {
    composeGroup: 'selfGrant',
    displayToken: 'cleanse',
    faceClause: (a) => `{{Cleanse}} ${a.charges}`,
    ruleTitle: 'Cleanse',
    ruleSentence: 'Remove X afflictions from an ally or self.',
    faceToken: (a) => ({ text: `CLEANSE ${a.charges}`, keyword: 'cleanse' }),
  },

  // ── conditional (the eleven cross-cast riders) ───────────────────────────
  comboBonus: {
    composeGroup: 'conditional',
    displayToken: 'combo',
    faceClause: (a) => `{{Combo}} +${a.amount}`,
    ruleTitle: 'Combo',
    ruleSentence: 'Deal X more damage if the previous card shared this card’s Archetype.',
    faceToken: (a) => ({ text: `COMBO +${a.amount}`, keyword: 'combo' }),
  },
  chainBonus: {
    composeGroup: 'conditional',
    displayToken: 'chain',
    faceClause: (a) => `{{Chain}} +${a.amount}/${typeName(a.after)}`,
    ruleTitle: 'Chain',
    ruleSentence: 'Deal X more damage if the previous card had X type.',
    faceToken: (a) => ({ text: `CHAIN +${a.amount} AFTER ${a.after.toUpperCase()}`, keyword: 'chain' }),
  },
  empowerNext: {
    composeGroup: 'conditional',
    displayToken: 'charge',
    faceClause: (a, ctx) => {
      const type = ctx.element ?? ctx.weapon;
      return `{{Charge}} +${a.amount}${type === undefined ? '' : `/${typeName(type)}`}`;
    },
    ruleTitle: 'Charge',
    ruleSentence: 'Add X damage to the next card with matching type.',
    faceToken: (a, ctx) => {
      const type = ctx.element ?? ctx.weapon;
      return { text: `NEXT ${type === undefined ? '' : `${type.toUpperCase()} `}+${a.amount}`, keyword: 'charge' };
    },
  },
  exploit: {
    composeGroup: 'conditional',
    displayToken: (a) => (a.status === 'debuff' ? undefined : a.status),
    faceClause: (a) => `+${a.amount} vs ${a.status === 'debuff' ? 'debuff' : `{{${STATUS_MARKUP[a.status]}}}`}`,
    ruleTitle: 'Exploit',
    ruleSentence: 'Deal X more damage if the target already has X affliction.',
    faceToken: (a) => ({ text: `+${a.amount} vs ${STATUS_TOKEN[a.status]}`, keyword: a.status === 'debuff' ? undefined : a.status }),
  },
  stackBonus: {
    composeGroup: 'conditional',
    displayToken: (a) => a.status,
    faceClause: (a) => `+${a.per} damage per {{${STATUS_MARKUP[a.status]}}}${a.of === 'caster' ? ' you have' : ' debuff'} (max ${a.cap})`,
    ruleTitle: 'Status Bonus',
    ruleSentence: 'Each point of the listed status adds X damage, up to X.',
    faceToken: (a) => ({
      text: `+${a.per} DMG PER ${STATUS_TOKEN[a.status]}${a.of === 'caster' ? '' : ' DEBUFF'} (MAX ${a.cap})`,
      keyword: a.status,
    }),
  },
  taxBonus: {
    composeGroup: 'conditional',
    // EXEMPT: its face clause names no keyword. What it reads is a STATE (the
    // victim's tempo backlog) assembled from two different keywords, so there
    // is no single word here that could honestly be coloured as one of them.
    displayToken: undefined,
    faceClause: (a) => `+${a.per}/tax (cap ${a.cap})`,
    ruleTitle: 'Taxed cards',
    ruleSentence: 'Deal X more damage per Burdened card, plus one if the target has Slow, up to X.',
    faceToken: (a) => ({ text: `+${a.per}/TAXED CARD (cap ${a.cap})`, keyword: 'slow' }),
  },
  shieldBurst: {
    composeGroup: 'conditional',
    displayToken: 'shield',
    faceClause: (a) => `{{Shield}} spend (cap ${a.cap})`,
    ruleTitle: 'Shield Spend',
    ruleSentence: 'Spends Shield to add the same amount to this card’s damage, up to the maximum shown.',
    faceToken: (a) => ({ text: `SPEND SHLD ${a.cap}`, keyword: 'shield' }),
  },
  wardRelease: {
    composeGroup: 'conditional',
    displayToken: 'ward',
    faceClause: (a) => `{{Ward}} spend +${a.per} (cap ${a.cap})`,
    ruleTitle: 'Ward Spend',
    ruleSentence: 'Spends Ward to add the shown damage per charge, up to the maximum shown.',
    faceToken: (a) => ({ text: `SPEND WARD +${a.per}/CHG (cap ${a.cap})`, keyword: 'ward' }),
  },
  desperation: {
    composeGroup: 'conditional',
    // EXEMPT: the gate is a fact about the CASTER'S OWN HP BAR, not a keyword
    // — there is no named mechanic here to colour or tap.
    displayToken: undefined,
    faceClause: (a) => `+${a.amount} below half HP`,
    ruleTitle: 'Desperation',
    ruleSentence: 'Deal X more damage while at or below half HP.',
    faceToken: (a) => ({ text: `+${a.amount} BELOW HALF HP`, keyword: 'bleed' }),
  },
  overhealShield: {
    composeGroup: 'conditional',
    displayToken: 'shield',
    faceClause: (a) => `overheal→{{Shield}} (cap ${a.cap})`,
    ruleTitle: 'Overheal shield',
    ruleSentence: 'Convert up to X excess healing into matching Shield.',
    faceToken: (a) => ({ text: `OVERHEAL -> SHLD ${a.cap}`, keyword: 'shield' }),
  },
  cleanseConvert: {
    composeGroup: 'conditional',
    displayToken: 'cleanse',
    faceClause: (a) => `+${a.per}/{{Cleanse}}d (cap ${a.cap})`,
    ruleTitle: 'Cleanse convert',
    ruleSentence: 'Heal X per affliction removed by this card’s Cleanse, up to X.',
    faceToken: (a) => ({ text: `+${a.per} HP/CLEANSED (cap ${a.cap})`, keyword: 'cleanse' }),
  },
};

/**
 * The eight kinds whose face clause carries NO `{{...}}` markup, each for a
 * stated reason on its own row above. Derived from the table rather than
 * hand-kept, so it can never disagree with it.
 */
export const MARKUP_EXEMPT_KINDS: readonly Action['kind'][] =
  (Object.keys(KEYWORD_TEXT) as Action['kind'][]).filter((k) => KEYWORD_TEXT[k].displayToken === undefined);

/** Every `Action['kind']`, in registry declaration order. */
export const ACTION_KINDS: readonly Action['kind'][] = Object.keys(KEYWORD_TEXT) as Action['kind'][];

/**
 * One row, looked up WITHOUT losing the per-kind narrowing — the mapped type
 * makes `KEYWORD_TEXT[a.kind]` a union of every row, whose `faceClause`
 * parameter collapses to `never`. Callers hold an `Action`, so this is the
 * one place the cast lives.
 */
export function faceClauseOf(action: Action, ctx: RenderCtx): string {
  const row = KEYWORD_TEXT[action.kind] as KeywordTextDef;
  return row.faceClause(action as never, ctx);
}

export function faceTokenOf(action: Action, ctx: RenderCtx): { text: string; keyword?: string } {
  const row = KEYWORD_TEXT[action.kind] as KeywordTextDef;
  return row.faceToken(action as never, ctx);
}

/** The `{title, body}` a tap/hover glossary shows for this action, or `undefined`
 * for the two kinds with no rule of their own (`damage`, `heal`). */
export function ruleEntryOf(action: Action): { title: string; body: string } | undefined {
  return ruleEntryByKind(action.kind);
}

/** Canonical rule lookup for consumers that know the mechanic kind but do not
 * carry a parameterized card action, such as battle-log status events. */
export function ruleEntryByKind(kind: Action['kind']): { title: string; body: string } | undefined {
  const row = KEYWORD_TEXT[kind] as KeywordTextDef;
  if (row.ruleSentence === '') return undefined;
  return { title: row.ruleTitle, body: row.ruleSentence };
}

/** The `KEYWORD_TEXT_COLOR` id this action's face clause marks up, if any. */
export function displayTokenOf(action: Action): string | undefined {
  const token = (KEYWORD_TEXT[action.kind] as KeywordTextDef).displayToken;
  return typeof token === 'function' ? token(action as never) : token;
}

/**
 * EVERY definition one action invites, in order — the keyword's own rule, then
 * the STAT's rule where the clause names a stat.
 *
 * `ruleEntryOf` above answers "what does this KEYWORD do"; a `buffStat` /
 * `debuffStat` clause (`+20% ATK (2t)`) additionally names a stat, and until
 * the stat definitions moved into this file there was nowhere for that half to
 * come from — the keyword's own sentence only explains the DURATION ("lasts a
 * run of global turns"), never what ATK is. Now a card's `+20% ATK` and a
 * Charm gem's `Hero: +8 ATK` hand a player the SAME two sentences, from the
 * same table, which is the whole point of the consolidation.
 *
 * Additive by construction: the keyword entry is always first and unchanged.
 */
export function ruleEntriesOf(action: Action): Array<{ title: string; body: string }> {
  const entries: Array<{ title: string; body: string }> = [];
  const own = ruleEntryOf(action);
  if (own) entries.push(own);
  if (action.kind === 'buffStat' || action.kind === 'debuffStat') entries.push(STAT_RULE[action.stat]);
  if (action.kind === 'exploit' || action.kind === 'stackBonus') {
    const referencedKind = action.status === 'debuff' ? 'debuffStat' : action.status;
    const referenced = ruleEntryByKind(referencedKind);
    if (referenced) entries.push(referenced);
  }
  return entries;
}

// ───────────────────────────────────────────────────────────────────────────
// STAT-GEM MODS — the second registry shape (spec's gem deferral, blocker 1)
// ───────────────────────────────────────────────────────────────────────────

/**
 * A `StatGemMods` bundle is NOT an `Action`, which is why the 9 stat gems could
 * not migrate with the other 44: there is no `kind` to look up. It is a small
 * closed record instead — five hero keys (the engine's `BuffableStat`s) and
 * three card keys — so it gets the same treatment `KEYWORD_TEXT` gets: a
 * MAPPED TYPE per scope, making a sixth hero key or a fourth card key a `tsc`
 * error until it has a row, and `faceClause`/`rule` split the same way.
 *
 * NO NEW FACE VOCABULARY IS INVENTED HERE, in either scope:
 *   - hero keys reuse `STAT_TOKEN` and `STAT_RULE` — the tokens and the six
 *     definitions every statline and every `buffStat` card clause already use;
 *   - card keys are THE aura's three mods (`StatGemMods.card` is AuraMods-shaped
 *     by design), so this table is where their one wording lives and BOTH aura
 *     readers now call it: `compose.ts#auraClause` for the card face and
 *     `skillPresentation.ts#formatAuraModifiers` for the chip and the badge.
 *     (Corrected 2026-09-07: this comment claimed that already, and it was only
 *     true of the chip — the FACE said `deal +6` / `heal +10` for the same mod
 *     the chip called `+6 damage` / `+10 healing`.)
 *
 * The three card keys DO carry definitions of their own (`MOD_RULE`), because
 * "on every hit" is a mechanic and a face may not state it.
 */
export interface StatModTextDef {
  /** THIS GEM'S OWN NUMBER, nothing else — the `faceClause` of a mod. */
  faceClause: (value: number) => string;
  /**
   * The ONE definition this mod's face word opens.
   *
   * The hero keys point at `STAT_RULE`; the three card keys have `MOD_RULE`
   * entries of their own (below). It stayed `undefined` for two of them for
   * one round and that was a DEFECT, not a stance: `This card: +6 damage.`
   * on a two-hit card is worth double what it says, because `mods.damageFlat`
   * applies PER HIT (`balance.ts#extraHitPremium`, `interpreter.ts`'s
   * per-target `flatBonus`) — a mechanic, and therefore something a
   * `ruleSentence` owes the player rather than something the face should
   * restate. Optional only because a future mod key might genuinely have no
   * rule; every key shipped today has one.
   */
  rule: { title: string; body: string } | undefined;
}

const signedInt = (value: number): string => (value >= 0 ? `+${value}` : String(value));

/** Hero-scope (Charm) mods: a flat add to one of the five scaling stats. */
export const HERO_MOD_TEXT: Record<BuffableStat, StatModTextDef> = {
  attack: { faceClause: (v) => `${signedInt(v)} ${STAT_TOKEN.attack}`, rule: STAT_RULE.attack },
  magicPower: { faceClause: (v) => `${signedInt(v)} ${STAT_TOKEN.magicPower}`, rule: STAT_RULE.magicPower },
  armor: { faceClause: (v) => `${signedInt(v)} ${STAT_TOKEN.armor}`, rule: STAT_RULE.armor },
  magicResist: { faceClause: (v) => `${signedInt(v)} ${STAT_TOKEN.magicResist}`, rule: STAT_RULE.magicResist },
  speed: { faceClause: (v) => `${signedInt(v)} ${STAT_TOKEN.speed}`, rule: STAT_RULE.speed },
};

/** The three card-scope (Core) mod keys — AuraMods-shaped, by design. */
export type CardModKey = 'damageFlat' | 'healFlat' | 'weightDelta';

/**
 * THE THREE CARD-MOD DEFINITIONS — `ruleSentence`'s twin for an aura/gem mod,
 * and the answer to the one real information loss the gem migration shipped.
 *
 * `+6 damage` is a PARAMETER and stays on the face. "on every hit" is the
 * MECHANIC and belongs here, exactly as "ticks at the end of every turn"
 * belongs in Poison's definition and not on a poison card. Each sentence is
 * a statement of what the engine does, sourced from the engine:
 *
 *   damageFlat  `interpreter.ts` adds `mods.damageFlat` to the flat bonus of
 *               EACH hit instance (`flatBonus`, per target), which is half of
 *               why `balance.ts#extraHitPremium` exists ("flat `mods.damageFlat`
 *               applies PER HIT, so a multi-hit card is the best host for one").
 *               MITIGATION IS PROPERTY-DEPENDENT and the first wording of this
 *               rule got it wrong (corrected 2026-09-07, review 2): on a
 *               physical/magical hit `defense = mitigation(...)` is subtracted
 *               from `scaledDamage + flatBonus`, so the add IS eaten; on a TRUE
 *               hit `defense = min(effectiveStat, armor|magicResist)` — the
 *               engine's own comment reads "defense can eat up to the stat add,
 *               never the flat base or bonuses" — so the add passes WHOLE. Five
 *               shipped TRUE cards host one (`annihilation_strike`,
 *               `mortal_wound`, `purging_strike`, `soul_rend`, `void_pierce`).
 *               A gem-appended hit takes none of it — a gem's printed payload
 *               is its whole payload.
 *   healFlat    added to every heal EXCEPT a TRUE one: `interpreter.ts`'s heal
 *               case takes no stat term and no `mods` for TRUE ("flat by
 *               identity"), and `resolveDisplaySkill` mirrors that so the face
 *               agrees. It is NOT true that a TRUE heal takes no bonus at all
 *               (the first wording said so): `cast.healBonusFlat` — the
 *               `cleanseConvert` rider — is added on BOTH branches on purpose
 *               ("a TRUE heal is irreducible, not unbuffable"). Latent today
 *               because the one card carrying that rider is magical, and wrong
 *               the moment a TRUE one ships.
 *   weightDelta folded into the card's effective weight in `castSelect.ts`
 *               (`max(1, weightOf + mods.weightDelta + …)`), so it moves when
 *               the card comes out rather than what it does.
 *
 * NUMBER-FREE, like every `ruleSentence`: no digit, no percent, no markup —
 * the floor in `weightDelta` is spelled as a word for that reason, and
 * `gemTextRegistry.test.ts` asserts it.
 */
export const MOD_RULE: Record<CardModKey, { title: string; body: string }> = {
  damageFlat: {
    title: 'Damage bonus',
    body: 'Add X damage to each hit from this card.',
  },
  healFlat: {
    title: 'Flat healing',
    body: 'Add X healing to each heal from this card.',
  },
  weightDelta: {
    title: 'Weight change',
    body: 'Change this card’s Weight by X.',
  },
};

export const MULTI_HIT_RULE_ENTRY = {
  title: 'Multi-Hit',
  body: 'This card hits X times. Each hit resolves separately.',
};

export const LIGHTWEIGHT_RULE_ENTRY = {
  title: 'Lightweight',
  body: 'This card has X less Weight.',
};

export const HEAVY_RULE_ENTRY = {
  title: 'Heavy',
  body: 'This card has X more Weight.',
};

export const TRUE_RULE_ENTRY = {
  damage: {
    title: '(T) Damage',
    body: 'Deal X damage plus the higher of ATK or MATK. Ignores type matchups.',
  },
  heal: {
    title: '(T) Healing',
    body: 'Restore X HP. Does not scale with stats.',
  },
  shield: {
    title: '(T) Shield',
    body: 'Gain X Shield. Does not scale with stats.',
  },
  other: {
    title: '(T) TRUE',
    body: 'Ignores type matchups.',
  },
} as const;

/**
 * Card-scope (Core) mods — the same three an AURA carries (`StatGemMods.card`
 * is AuraMods-shaped by design), so `compose.ts#auraClause` and
 * `skillPresentation.ts#formatAuraModifiers` both render through THIS table.
 * One wording for one mod, whether it arrives from a neighbour's aura or from
 * a gem in this card's socket.
 */
export const CARD_MOD_TEXT: Record<CardModKey, StatModTextDef & { compactToken: string }> = {
  damageFlat: { faceClause: (v) => `${signedInt(v)} damage`, compactToken: 'DMG', rule: MOD_RULE.damageFlat },
  healFlat: { faceClause: (v) => `${signedInt(v)} healing`, compactToken: 'HEAL', rule: MOD_RULE.healFlat },
  weightDelta: { faceClause: (v) => `${signedInt(v)} weight`, compactToken: 'WT', rule: MOD_RULE.weightDelta },
};

/** Card-scope mod keys in printed order (the order `formatAuraModifiers`
 * has always printed them in, stated once so both readers share it). */
export const CARD_MOD_KEYS: readonly CardModKey[] = ['damageFlat', 'healFlat', 'weightDelta'];
