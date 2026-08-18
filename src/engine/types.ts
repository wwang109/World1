// Core shared types for the deterministic readiness skill-board combat engine.
//
// DETERMINISM RULES (apply to everything under src/engine):
// - Simulation state holds integers only. No floats persist between turns;
//   percentage math is computed transiently and floored immediately.
// - Never iterate Map/Set where order can vary — iterate arrays by index.
// - No Date.now()/Math.random(). All randomness flows through Rng, and RNG
//   calls must happen in a fixed order regardless of rendering.

export type Side = 'player' | 'enemy';

/** Which board card produced an effect (for per-card combat attribution). */
export interface EffectSourceRef {
  side: Side;
  unit: number;
  slot: number;
  skillId: string;
}

export interface CombatantStats {
  maxHp: number;
  hp: number;
  /** Scales Physical skills. */
  attack: number;
  /** Scales Magical skills. */
  magicPower: number;
  /** Reduces incoming Physical damage. */
  armor: number;
  /** Reduces incoming Magical damage. */
  magicResist: number;
  /** Initiative added to readiness at the start of every gameplay turn. */
  speed: number;
}

/** Card type identity — a card carries ONE OR MORE of these. */
export type Archetype = 'offense' | 'defensive' | 'healing' | 'support' | 'debuff';

/**
 * Property shapes how the card works in every archetype:
 * - physical: damage vs Armor, scales off Attack; shields block Physical
 * - magical:  damage vs Magic Resist, scales off Magic Power; shields block Magical
 * - true:     damage ignores defenses (scales off higher stat); shields block
 *             EVERYTHING; heals/buffs are flat, no scaling or reduction math
 */
export type Property = 'physical' | 'magical' | 'true';

/** Board slots occupied; traversing slots after the first makes the caster busy. */
export type SkillSize = 1 | 2 | 3;

/**
 * Default per-card reuse cooldown, in GLOBAL turns, when a card does not set
 * its own `cooldownTurns`. A second pacing dial alongside weight (see
 * `SkillDef.cooldownTurns`). Lives here (rather than `combat/castSelect.ts`,
 * which re-exports it) so both the resolver (`cards.ts`) and the pricing
 * table (`balance.ts`) can read it without creating an import cycle through
 * `combat/state.ts`.
 */
export const BASELINE_COOLDOWN = 3;

/** Elements for Magical cards (wheel + Holy↔Dark pair). */
export type Element = 'fire' | 'frost' | 'lightning' | 'nature' | 'holy' | 'dark';

/**
 * Weapon types for Physical damage cards. Sword/axe/lance form the triangle;
 * beast is the natural-weapon class (fangs, claws, monster attacks); bow sits
 * outside the triangle but beats beast.
 */
export type WeaponType = 'sword' | 'axe' | 'lance' | 'bow' | 'beast';

/** Tier = Power Level budget: bronze 10 · silver 15 · gold 20 · diamond 25. */
export type SkillTier = 'bronze' | 'silver' | 'gold' | 'diamond';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export type BuffableStat = 'attack' | 'magicPower' | 'armor' | 'magicResist' | 'speed';

/**
 * How a unit picks its single offensive target among living foes (deterministic,
 * no RNG, no interactivity):
 * - `aggro`: max current `aggro` (default; tanks pull focus via `taunt`).
 * - `first`: lowest living lineup index (== old 1v1 behavior).
 * - `lowestHp`: min current hp, ties broken to the lowest index.
 * - `highestThreat`: max board Power Level (sum of piece PL), ties → lowest index.
 * All ties break to the lowest living index. `focus` overrides any policy.
 */
export type TargetPolicy = 'aggro' | 'first' | 'lowestHp' | 'highestThreat';

/**
 * PROVENANCE MARK (resolver seam, user-locked 2026-08-07). Set ONLY by
 * `resolveEffectiveSkill` (src/engine/cards.ts) on the actions a socketed
 * EFFECT GEM appends to a host card. Never authored in `src/data` — content
 * writes the bare action and the resolver stamps the origin, which is what
 * keeps the core loop feature-agnostic (CLAUDE.md, "Additive features — the
 * resolver seam").
 *
 * A gem-appended hit is a SEPARATE, SELF-CONTAINED hit rather than a bigger
 * version of the host card's hit. Concretely, in `interpreter.ts`:
 *  • it is NOT counted in the multi-hit stat-split DIVISOR, so the host card's
 *    own hit keeps its FULL stat exactly as if the socket were empty; and
 *  • it takes NO attacker-side ADD — no share of the caster's scaling stat, no
 *    `mods.damageFlat` (board auras / card-scope stat gems) and no triggered
 *    `comboBonus`. User's words: "so it cant be buffed".
 * Defender-side and world-rule maths (armor/MR, guard, expose, typed shields,
 * the weapon/element matchup, sudden death, the minimum-1 floor) still apply —
 * those are properties of the victim and the world, not buffs on the attacker,
 * and without them the hit would not be a hit.
 *
 * A gem's payload therefore lands EXACTLY what it prints. A flat `damage`
 * action prints a flat number; a `statStrike` prints a share of your own stat.
 */
export interface GemAppended {
  /** True only on actions appended by an effect gem (see `resolveEffectiveSkill`). */
  fromGem?: true;
}

/**
 * Cast actions. Targets are implicit in 1v1: offensive actions hit the enemy,
 * supportive ones apply to the caster.
 *
 * `power` is a FLAT base amount; the caster's scaling stat is added on top at
 * cast time (TRUE cards: the flat base bypasses defenses, the stat add does
 * not). Durations are GLOBAL turns.
 *
 * Every member also carries the optional `fromGem` provenance mark (see
 * `GemAppended`), which the resolver — never content — sets.
 */
export type Action = ActionKinds & GemAppended;

type ActionKinds =
  | { kind: 'damage'; power: number }
  /**
   * STAT STRIKE — an EXTRA, self-contained hit whose whole payload is ONE
   * SHARE of a `shareOf`-way split of the caster's scaling stat (Attack /
   * Magic Power / the higher of the two for TRUE). `shareOf: 2` is "half your
   * Attack", `shareOf: 4` is a quarter, and so on. There is no `power`: the
   * card/gem authors the FRACTION, never a flat base.
   *
   * WHY A SHARE AND NOT A PERCENTAGE (matters — read before extending). The
   * engine deliberately left the `%-of-stat` damage model in 2026-07-14/15
   * (docs/combat-model-spec.md §"FLAT model"): output proportional to the hero
   * stat with a card-authored coefficient made damage grow multiplicatively
   * against linear HP. A unit fraction `1/shareOf` is the restricted, bounded
   * form of that idea:
   *   • it reuses `statShare` — the SAME exact-integer split the multi-hit rule
   *     runs on — so no float ever exists and the rounding rule is the one
   *     already locked (front-loaded: `shareOf: 2` of Attack 21 is 11);
   *   • it can never exceed 1× the stat, so no single strike can ever
   *     re-deliver more than the ONE stat add a cast is entitled to.
   * Be honest about what it is NOT: `1/2` of the stat is still arithmetically
   * `stat × 0.5`, so an UNCAPPED strike's absolute value grows without bound
   * with hero level and CANNOT be priced against a fixed PL band. That is what
   * `cap` is for.
   *
   * `cap` (optional) is a hard integer ceiling on the WHOLE payload, applied
   * after the share (with `echoHostPower` the payload has two terms and the cap
   * bounds their SUM — the stat term, the one that grows without bound with hero
   * level, is the one trimmed). A CAPPED strike is worth at most `cap` damage at
   * any hero level, so it prices EXACTLY like a flat `damage` action of that size
   * (`actionsPriceDeci`) — it scales with the hero early and plateaus late.
   * An UNCAPPED strike prices at 0 deci ON PURPOSE: its value is unbounded, so
   * there is no honest number, and 0 makes it fail every rarity band in
   * `isGemOnBudget` / every tier budget in `isOnBudget` rather than shipping
   * free power. Do not "fix" that by inventing a rate — cap the effect.
   *
   * It is an offensive action and a separate damage INSTANCE: it is blocked,
   * mitigated and negated on its own (one `negate` charge per instance), which
   * is a real part of its value and the reason a second hit is a high-tier
   * effect rather than a token add-on.
   *
   * ---------------------------------------------------------------------------
   * `echoHostPower` — THE ECHO FORM (user intent 2026-08-08: "echo is suppose to
   * perform a secondary atk at 50% less"). With this flag the payload is one
   * share of the WHOLE ATTACK — the host card's own flat base PLUS the caster's
   * stat — instead of a share of the stat alone:
   *
   *     echo = statShare(hostBase + stat, 1 of `shareOf`)
   *
   * On Sword Slash (base 20) at Attack 20 the card's own hit is 40 and a
   * `shareOf: 2` echo is 20; on Crushing Blow (base 96) the same socket echoes
   * 58. That proportionality is the whole point — it echoes whatever it is
   * attached to, which is also why it cannot be priced host-blind (see PRICE).
   *
   * ONE share of the SUM, not a share of each term (this is the rounding rule,
   * and it is load-bearing): the terms are shared together and only then split
   * back into a base part and a stat part, so the echo is EXACTLY
   * `share(base + stat)`. Sharing each separately would round BOTH up under the
   * front-loaded rule and hand the echo a free point whenever base and stat are
   * both odd — `purging_strike` (base 9) at Attack 21 would echo 5 + 11 = 16 for
   * a 30-damage attack instead of 15.
   *
   * The two parts still exist because `applyStrike`'s TRUE rule mitigates only
   * the stat one: the base half of an echo bypasses defense exactly as the host
   * card's own flat base does. The base part takes the front-loaded rounding
   * (`share(hostBase)`) and the stat part is the remainder.
   *
   * `hostBase` is the sum of the `power` of the host card's OWN `damage` actions
   * (`fromGem` ones excluded, exactly like the multi-hit divisor — a socket must
   * never read itself), so it is hit-count-invariant: Twin Slash's 6 + 6 echoes
   * as a share of 12, once. The stat term is likewise the whole per-cast stat,
   * NOT a per-hit share. A host with no `damage` action of its own echoes 0 base
   * and degrades gracefully to a plain stat strike.
   *
   * TARGETING comes free and follows the host: `scope` is a CARD-level field, so
   * on an AoE host (`scope: 'all'`) the echo fans out to every living foe exactly
   * as the card's own hit does, and on a single-target host it hits the one foe
   * the card's policy picked. Worth knowing before pricing: on a 5-foe board an
   * echo of an AoE card is five hits, not one.
   *
   * It is authored ONLY as a gem payload today, and the resolver stamps it
   * `fromGem` like any other appended action — so it is still a self-contained
   * hit that takes no aura `damageFlat` and no `comboBonus`. It echoes what the
   * card PRINTS plus the caster's stat, never what a board buff added on top.
   *
   * PRICE (gem ruleset v1 §5/§6, 2026-08-09 — this replaces the old "prices at 0,
   * no honest rate exists" note). An echo's value is proportional to a host the
   * ACTION table cannot see (18 damage on a light card, 58 on the heaviest at the
   * same hero stats), so `actionsPriceDeci` still charges an uncapped one 0 — a
   * flat rate there would put a host-blind guess into the card audit. The price
   * lives one level up, in `gemPowerLevelDeci`, SPLIT by what each surface can
   * know:
   *  • host-BLIND (`isGemOnBudget`, the shop): `PRICE.echoRepeatDeci / shareOf`
   *    plus `PRICE.extraHitPremium` — a classification stand-in that lands
   *    `shareOf: 2` on Legendary exactly and every other strength on no band;
   *  • host-KNOWN (`instancePowerLevelDeci`): `echoHostShareDeci` — the share of
   *    the host's OWN damage line the echo repeats, at the host's own rate, so
   *    per-piece PL accounting is right on every card instead of uniformly wrong.
   * A `cap` opts out of both: it bounds the payload absolutely, so the action
   * prices exactly like a flat damage action of that cap — but a cap low enough
   * to fit a gem band also flattens the proportionality that makes it an echo,
   * which is why the ruleset bans capped echoes as CONTENT.
   */
  | { kind: 'statStrike'; shareOf: number; cap?: number; echoHostPower?: true }
  | { kind: 'heal'; power: number }
  | { kind: 'shield'; power: number }
  /**
   * DECAYING DoT (user-locked 2026-07-20): applies `stacks` poison. Each tick
   * deals damage EQUAL to the current stack count, then one stack falls off —
   * N stacks total N×(N+1)/2 damage. Exact printed numbers: no stat scaling,
   * no matchup. New applications MERGE into the existing pile. Poison ticks at
   * the END of each global turn (the victim always acts first) and BYPASSES
   * shields.
   */
  | { kind: 'poison'; stacks: number }
  /**
   * HALVING DoT (user-locked 2026-07-20) — fierce and brief. Ticks at the
   * START of each global turn: deals 2 × current stacks, then stacks HALVE
   * (floored) — burn 8 ticks 16, 8, 4, 2. Can kill before the victim acts;
   * ABSORBED by shields (which is why its PL table is discounted).
   */
  | { kind: 'burn'; stacks: number }
  /**
   * DECAYING DoT, same tick model, but ticks each time the victim PERFORMS a
   * cast — acting costs blood. Bypasses shields once applied, but CANNOT be
   * applied while the target holds any active shield (you can't cut what you
   * can't touch). Fast, multi-cast enemies bleed out faster; turtling stalls it.
   */
  | { kind: 'bleed'; stacks: number }
  /** Consumes the victim's next performance (not a global turn). */
  | { kind: 'stun'; turns: number }
  | { kind: 'buffStat'; stat: BuffableStat; pct: number; turns: number }
  | { kind: 'debuffStat'; stat: BuffableStat; pct: number; turns: number }
  /**
   * The mirror of `guard`: while active, the victim takes +`pct`% damage from
   * ALL direct hits (source `skill`) for `turns` global turns. DoT ticks are
   * unaffected (like guard). Applied on the enemy (offensive). `pct` clamped to
   * <=50 at apply time; amplification is floored. The duration is a real
   * GLOBAL-TURN duration, decremented in `expireStatuses` — see
   * `TURN_DURATIONED_STATUS_KINDS` (combat/state.ts) for the full expiry
   * partition.
   *
   * ONE PILE PER VICTIM, REFRESHED (unlike `guard`, which opens a pile per
   * cast): a re-application keeps the STRONGER `pct` and the LONGER remaining
   * duration and restarts the window, so the amplification a victim can ever
   * carry is one clamped `pct`. Guard may stack because piles compound
   * multiplicatively DOWNWARD (diminishing: 50% then 50% leaves 25%); expose
   * compounds UPWARD (accelerating: +50% then +50% is ×2.25), so stacking it
   * would break the guard-parity `pct × turns` price it is sold at. The same
   * line the other offensive non-additive debuff draws — see `slow`.
   */
  | { kind: 'expose'; pct: number; turns: number }
  /**
   * Remove up to `charges` of the caster's own NEGATIVE effects (poisons,
   * burns, bleeds, stuns, stat debuffs, expose) in a fixed deterministic order:
   * expiring-soonest first, ties by application order. Buffs/guards/negate are
   * never removed.
   */
  | { kind: 'cleanse'; charges: number }
  /**
   * THORNS (self buff): grants `stacks` thorn stacks on the CASTER. Whenever a
   * DIRECT skill hit lands on the holder, the ATTACKER takes the current stack
   * count as TRUE reflect damage and the pile loses one stack (expires at 0).
   * DoT ticks, fatigue and attrition never trigger it, and reflect damage can
   * never trigger the attacker's own thorns (depth-1, non-reentrant) — a
   * reflect loop is the cheapest way to hang the sim. Stacks persist until
   * consumed (no turn expiry) and are NOT cleansable (a buff, not an ailment).
   *
   * A HIT THAT DID NOT TAKE EFFECT DOES NOT REFLECT: a killing blow is not
   * reflected (first to fall loses), and a hit fully cancelled by a `negate`
   * charge is not either — there is no hit to sting back at. A hit merely
   * ABSORBED by a shield does reflect: it landed and spent plating.
   */
  | { kind: 'thorns'; stacks: number }
  /**
   * Raise the CASTER's own `aggro` by `amount` for the rest of the fight
   * (permanent, not turn-decremented). Under the default `aggro` target policy
   * this makes a tank the main target and shields squishier allies.
   */
  | { kind: 'taunt'; amount: number }
  // ---- Special ability riders (combined-archetype cards) ----
  /** The enemy's NEXT action is this much heavier (their attack comes later). */
  | { kind: 'slow'; weight: number }
  /** Drain the enemy's banked readiness (steal their built-up tempo). */
  | { kind: 'disrupt'; amount: number }
  /** Heal the caster for pct% of the damage this cast dealt (place after damage). */
  | { kind: 'lifesteal'; pct: number }
  /** Shatter enemy shields before the hit (place before damage). */
  | { kind: 'shieldBreak'; amount: number }
  /** +amount FLAT damage this cast if the previous cast shared an archetype (place first). */
  | { kind: 'comboBonus'; amount: number }
  // ---- Property-generic defensive keywords ----
  /**
   * Magical Guard: while active, incoming damage of the matching `property` is
   * reduced multiplicatively by `pct`% (floored, min 1) for `turns` global
   * turns. Applied on the caster (self). `pct` is clamped to <=60 at apply time.
   * True damage bypasses (no cross-property match); matching-property DoTs are
   * covered on purpose.
   */
  | { kind: 'guard'; property: Property; pct: number; turns: number }
  /**
   * Magical Negate: grants `charges` counter-charges on the caster (self) that
   * fully nullify the next direct skill hits of the matching `property`. DoT
   * ticks and fatigue never spend a charge. Persists until charges run out (no
   * turn expiry). Total charges of a property are clamped to <=3 at apply time.
   *
   * FULLY means fully: a negated hit runs no HP math, no guard, no expose, no
   * shield drain — and pays no `thorns` reflect, because the hit did not happen.
   */
  | { kind: 'negate'; property: Property; charges: number }
  /**
   * WARD (self buff) — the AFFLICTION mirror of `negate`. Grants `charges`
   * ward charges on the caster (self) that PREVENT incoming afflictions before
   * they land: the next `charges` applications of a WARDABLE status (poison /
   * burn / bleed / stat debuff / expose) are cancelled outright and never reach
   * the holder's status list. "Ailment shield." Persists until the charges run
   * out (no turn expiry); total charges are clamped to `MAX_WARD_CHARGES` at
   * apply time.
   *
   * NOT STUN, which cleanse DOES strip — the one difference between `isWardable`
   * and `isCleansable` (combat/interpreter.ts). User-locked 2026-08-17: ward's
   * remit is the damage-over-time and stat-debuff family, the effects that sit on
   * you and grind you down; a stun is LOCKDOWN, a different class of thing, and
   * is out of scope by design.
   *
   * ONE CHARGE CANCELS THE WHOLE APPLICATION, regardless of stack count and
   * regardless of whether the victim already carries a pile of that kind — a
   * poison-5 costs one charge, not five, and a poison-5 merging into a standing
   * poison-3 also costs exactly one. That is the `negate` parallel (one charge =
   * one whole thing denied) and it is deliberately UNLIKE `cleanse`, which
   * spends one charge per STACK on a stacking DoT. Ward denies every tick a DoT
   * would ever have dealt; cleanse only strips what is left of one that already
   * landed. Hence the price ladder cleanse 25 < ward 50 < negate 100 (see
   * `PRICE.wardPerCharge` in balance.ts).
   *
   * IT PREVENTS, IT DOES NOT CLEANSE: a prevented merge leaves the standing pile
   * untouched and still ticking. The charge buys "none of the incoming stacks
   * land", never "the old ones go away".
   *
   * NO `property` FIELD, deliberately: afflictions carry no attacker property to
   * match against (a poison's `property` is the applying CARD's, inherited for
   * DoT mitigation typing, not a defensive axis), so a property dimension here
   * would be a silent no-op. Ward is universal or it is nothing.
   *
   * It can never block a BUFF (the gate is `isWardable`, built on `isCleansable`,
   * which excludes guard / negate / thorns / buff), and therefore can never
   * consume ITSELF: ward is not a cleansable affliction.
   */
  | { kind: 'ward'; charges: number };

/**
 * Apply-time ceiling on the TOTAL negate charges of one property a unit may
 * hold — enforced in the `negate` arm of `applyAction`
 * (src/engine/combat/interpreter.ts). Promoted to a named export (was a bare
 * literal at the interpreter call site, MIRRORED by a separately-declared
 * `NEGATE_CHARGE_CLAMP` in `src/data/validateSkillContent.ts`) so the engine
 * and the content validator read ONE constant instead of two copies that can
 * drift — which is exactly what happened before this promotion.
 */
export const MAX_NEGATE_CHARGES = 3;

/**
 * Apply-time ceiling on the TOTAL ward charges one unit may hold — the sibling
 * of `MAX_NEGATE_CHARGES` (`applyAction`'s `negate` arm). A charge denies a
 * whole affliction application, so an unbounded pile would make a unit
 * permanently immune to control; 3 is the same "enough to matter, not enough to
 * lock out" number negate settled on. Enforced in the `ward` arm of
 * `applyAction` (src/engine/combat/interpreter.ts) and respected as a scaffold
 * ceiling by `scripts/scaffoldCard.ts`.
 */
export const MAX_WARD_CHARGES = 3;

/** Positional modifiers a (usually Support/passive) card projects onto board neighbors. */
export interface AuraDef {
  /**
   * DIRECTION selector: adjacent = both sides, left/right = one side,
   * allBoard = whole board (reach ignored). Combined with `reach` to decide
   * which neighbors are covered.
   */
  affects: 'adjacent' | 'left' | 'right' | 'allBoard';
  /**
   * Slots of distance the aura projects, measured as the empty-slot GAP between
   * the source's and target's nearest edges (edge-to-edge). A source touching a
   * target (gap 0) is reached at `reach: 1`; `reach: 2` reaches one empty slot
   * further, etc. DEFAULT when omitted is 1, which reproduces the old
   * touching-only "adjacent/left/right" behavior exactly. Ignored for
   * 'allBoard'. A reach of 0 or negative reaches nothing. See `covers()`.
   */
  reach?: number;
  /** Only cards carrying this archetype receive the aura. */
  archetypeFilter?: Archetype;
  /** Only cards of this property receive the aura. */
  propertyFilter?: Property;
  mods: {
    /** FLAT damage added to each cast the aura reaches (not a percentage). */
    damageFlat?: number;
    /** FLAT healing added to each heal the aura reaches. */
    healFlat?: number;
    /** Reduces (negative) or raises the card's speed weight. */
    weightDelta?: number;
  };
}

/**
 * An AUTHORED tier override for one tier above a card's base. When present for
 * a target tier, `applyTier` uses it verbatim (spread over the base def) instead
 * of the budget-honest auto-scaler — the escape hatch for cards the auto-scaler
 * can't solve (pure control/empower/aura cards) or whose auto-curve a designer
 * wants to hand-shape. Only the listed fields are overridden; everything else
 * (property, size, weapon, element, rarity, archetypes) carries over from base.
 */
export interface TierUpgrade {
  /** Full replacement effect list at this tier. */
  effects?: Action[];
  /** Full replacement aura block at this tier. */
  aura?: AuraDef;
  /** Overrides speedWeight at this tier. */
  speedWeight?: number;
  /** Overrides cooldownTurns at this tier. */
  cooldownTurns?: number;
  /**
   * Overrides the card's target scope at this tier — the one tier dial that
   * buys a card an ABILITY rather than a bigger number: a card can be
   * single-target at Bronze and hit every living foe (`all`) from Gold up.
   * Priced by the same `PRICE.aoeTargetsNum/Den` reach multiplier as a
   * card-level `scope`, because `applyTier` spreads this override onto the def
   * BEFORE anything (the pricer, `resolveTargets`, the card face) reads it.
   *
   * AUTHORING RULE, enforced by `validateSkillContent`: once a tier block sets
   * `scope`, EVERY higher tier must set it too. `applyTier` always scales from
   * the BASE def, so an un-authored higher tier would run the auto-scaler on
   * the base card's scope and silently drop the AoE — a strict DOWNGRADE at a
   * higher tier. The validator makes that unrepresentable instead of latent.
   */
  scope?: 'one' | 'all';
  /** Overrides the card text at this tier. */
  text?: string;
}

/** Authored per-tier overrides, keyed by the (non-bronze) target tier. */
export type TierUpgrades = Partial<Record<Exclude<SkillTier, 'bronze'>, TierUpgrade>>;

export interface SkillDef {
  id: string;
  name: string;
  archetypes: Archetype[];
  property: Property;
  size: SkillSize;
  /**
   * Initiative weight: heavier = comes out later. Defaults to size * 10.
   * A card CAN be big but quick (low weight, long span) or small but heavy.
   */
  speedWeight?: number;
  /**
   * Reuse lockout in GLOBAL turns — a SECOND pacing dial, orthogonal to
   * `speedWeight`: weight decides firing ORDER among eligible cards, cooldown
   * decides card AVAILABILITY. After this card performs on turn T it is
   * unavailable (skipped by `selectCast`) on turns T+1..T+cooldown and eligible
   * again at T+cooldown+1. Defaults to `BASELINE_COOLDOWN` (3) when omitted.
   * Only consulted when `CombatConfig.cooldownsEnabled` is on.
   */
  cooldownTurns?: number;
  rarity: Rarity;
  /** Power-level tier; the card's kit must sum to the tier's PL budget. */
  tier: SkillTier;
  /** Required on every Magical card (advantage wheel + synergy filters). */
  element?: Element;
  /** Required on Physical cards that deal damage (weapon triangle). */
  weapon?: WeaponType;
  /** Cast effects. Empty for pure passives (skipped by the rotation). */
  effects: Action[];
  /**
   * Offensive target scope. `one` (default) = a single foe chosen by the
   * caster's `targetPolicy`; `all` = every living foe (ascending index). Support
   * actions ignore scope (they hit the caster). Un-flagged cards stay
   * single-target and byte-identical.
   */
  scope?: 'one' | 'all';
  /** Positional effect projected onto neighboring board cards. */
  aura?: AuraDef;
  /** Registry key for hand-coded behavior the DSL can't express. */
  special?: string;
  /**
   * Authored per-tier overrides. When a target tier has an entry here,
   * `applyTier` uses it verbatim (spread over the base def) instead of the
   * budget-honest auto-scaler — the escape hatch for cards the auto-scaler
   * can't solve to budget (pure control/empower/aura cards) or whose curve a
   * designer wants to hand-shape.
   */
  tierUpgrades?: TierUpgrades;
  text: string;
}

export type SkillBook = Record<string, SkillDef>;

export function weightOf(skill: SkillDef): number {
  return skill.speedWeight ?? skill.size * 10;
}

export type EquipmentSlot = 'weapon' | 'armor' | 'trinket';

export interface EquipmentDef {
  id: string;
  name: string;
  slot: EquipmentSlot;
  rarity: Rarity;
  statMods: Partial<Omit<CombatantStats, 'hp'>>;
  tags: string[];
  text: string;
}

/**
 * A gem socketed into a board card.
 * - effect: appends extra cast Actions (post-hit/independent riders) to the card.
 * - stat:   flat modifiers, either card-scoped (ride the card's aura bundle) or
 *           hero-scoped (added to the combatant's base stats at setup).
 */
export type Gem =
  | {
      kind: 'effect';
      id: string;
      rarity: Rarity;
      actions: Action[];
      /**
       * Turns shaved off the host card's effective cooldown (additive,
       * floored at 0 turns — never negative/never lengthens). Priced by
       * `PRICE.cooldownPerTurn` in `balance.ts`, folded into the effective
       * skill by `resolveEffectiveSkill` in `cards.ts`.
       */
      cooldownReduction?: number;
      /**
       * TEMPO COST — percent ADDED to the host card's initiative weight, so the
       * socket makes the card hit harder AND come out later (user intent
       * 2026-08-08, for the echo gem: "maybe make it increase wt of skill too").
       * Folded into the effective skill's `speedWeight` by
       * `resolveEffectiveSkill`, so the core loop reads it through the ordinary
       * `weightOf(piece.skill)` path in `castSelect.ts` and needs no branch.
       *
       * PROPORTIONAL, not flat, and that is the design — measured, not assumed
       * (flat-vs-proportional sweep, 2026-08-09: 7 hosts spanning weight 6..30,
       * mean throughput ratio over hero Speed 5..30 × DEF 0/8, cooldowns on, a
       * 3-card board). A gem whose BENEFIT scales with its host must have a COST
       * that scales the same way, or one host-blind price cannot be honest:
       *
       *   a 50% echo, no weight cost  → +15.0%..+32.7% throughput, SPREAD 0.177
       *   the same echo, FLAT +5      → +10.2%..+25.6%, spread 0.154
       *   the same echo, FLAT +12     → + 3.5%..+16.2%, spread 0.127
       *   the same echo, PCT +25%     → +13.1%..+22.3%, spread 0.092
       *   the same echo, PCT +50%     → + 9.8%..+13.6%, spread 0.053
       *
       * Read the SPREAD column, not the level: a flat add is a near-uniform
       * multiplier on the gem's value (a power knob) and barely narrows the gap
       * between the best and worst host even when it is brutal, while a
       * proportional add takes value away IN PROPORTION to how much the host
       * gained (a fairness knob) and halves the spread. The mechanism: a card's
       * flat base — which is what an echo repeats — tracks its weight across the
       * book, so indexing the cost to weight indexes it to the benefit. In the
       * frictionless model the identity is exact: damage-per-weight moves by
       * `(1 + echo%) / (1 + weight%)` on EVERY host, host-independent by
       * construction. The residual spread above is armor (the echo is a separate
       * instance and pays mitigation again, which hurts small echoes most) and
       * the cooldown window — both deliberate, neither a weight-form problem.
       *
       * ROUNDING: `floor(baseWeight × pct / 100)`, integer, computed once at
       * resolve time — but never 0 for a positive `pct` (a weight increase that
       * increases nothing would be a lie on the card face); the min-1 clamp only
       * bites below pct 20 on the lightest cards (`WEIGHT_MIN` is 5).
       * NOT clamped to `WEIGHT_MAX_BY_SIZE`: that is an AUTHORING bound on
       * cards, and effective weight already exceeds it via `slow`.
       *
       * IT IS A SOFT COST, and that is worth knowing before pricing it: weight
       * is only paid out of banked readiness, so a host whose weight already sits
       * under the caster's per-turn Speed gain has slack and pays nothing at all
       * (at Speed 25 the entire sweep above collapses to the no-cost row). The
       * cost is real at low Speed and on heavy hosts, and fades as the hero
       * levels Speed — a scaling gem with a cost that scales the OTHER way.
       *
       * PRICED AT 0 deci today (see `gemPowerLevelDeci`) — deliberately
       * conservative: charging no refund can only ever OVER-price the gem.
       * A refund rate is balance-designer's to set. It stays 0 after the echo
       * pricing landed (gem ruleset v1 §6, 2026-08-09): §6.2 keeps
       * `weightIncreasePct` as the Echo's one PL-FREE tuning dial precisely so
       * the band arithmetic (`echoRepeatDeci / shareOf + extraHitPremium` = 80 at
       * `shareOf: 2`) can be tuned for fairness between hosts without moving the
       * rarity it lands on.
       */
      weightIncreasePct?: number;
    }
  | { kind: 'stat'; id: string; rarity: Rarity; scope: 'card' | 'hero'; mods: StatGemMods };

export interface StatGemMods {
  /** Hero-scope: flat integer stat adds folded into base stats. */
  hero?: Partial<Record<BuffableStat, number>>;
  /** Card-scope: modifiers applied to the socketed card only (AuraMods-shaped). */
  card?: { damageFlat?: number; healFlat?: number; weightDelta?: number };
}

/** A card placed on a board; `slot` is its leftmost occupied slot. */
export interface BoardPiece {
  skillId: string;
  slot: number;
  /** Optional per-piece skill tier override. */
  tier?: SkillTier;
  /** Optional socketed gem. */
  gem?: Gem | null;
}

/** A fully resolved combatant fed into simulate(). */
export interface CombatantSetup {
  name: string;
  stats: CombatantStats;
  /** Board width in slots (10 for the hero). */
  boardSize: number;
  /** Placed cards; sizes come from the skill book. Must not overlap. */
  pieces: BoardPiece[];
  /** How this unit picks its single offensive target among living foes. Default `aggro`. */
  targetPolicy?: TargetPolicy;
  /** Starting aggro (threat) this unit carries into the fight. Default 0. */
  baseAggro?: number;
  /**
   * Explicit target override: the opposing lineup index this unit focuses.
   * When set and that foe is living, it wins over `targetPolicy`; otherwise the
   * policy applies. Ignored by AoE (`scope: 'all'`) cards.
   */
  focus?: number;
  /** Takes +50% from the element that beats this, −25% from the one it beats. */
  elementAffinity?: Element;
  /** Same rule against the weapon triangle. */
  weaponAffinity?: WeaponType;
}

export interface CombatConfig {
  /** Player-side units, canonical (index-ascending) order. 1-element = 1v1. */
  playerTeam?: CombatantSetup[];
  /** Enemy-side units, canonical order. */
  enemyTeam?: CombatantSetup[];
  /**
   * @deprecated Use `playerTeam` (or the `simulate1v1` adapter). Legacy single
   * setup is still accepted for the pre-team UI (Wave-4 migration) and wraps to
   * a 1-element `playerTeam`. Teams XOR legacy: providing both throws.
   */
  player?: CombatantSetup;
  /**
   * @deprecated Use `enemyTeam` (or `simulate1v1`). Wraps to a 1-element
   * `enemyTeam`. Teams XOR legacy.
   */
  enemy?: CombatantSetup;
  skillBook: SkillBook;
  /**
   * Rounds (both sides have performed N times) before sudden death: damage
   * ramps +10%/turn for the player, +30%/turn for the enemy. Default 5.
   */
  suddenDeathRound?: number;
  /** Global turn after which the flat fatigue backstop starts. Default 40. */
  fatigueTurn?: number;
  /**
   * First global turn on which the ATTRITION stalemate breaker fires: from this
   * turn on, every living combatant takes ACCELERATING unblockable true damage
   * (`ATTRITION_STEP × T × (T+1) / 2` with `T = turn − attritionTurn + 1`, i.e.
   * 5, 15, 30, 50, 75, 105…), applied in ascending initiative score (lowest first). Global and symmetric,
   * so PL-neutral — it is priced nowhere. Default `ATTRITION_START_TURN` (15).
   * Set to a huge number to disable (tests isolating a single mechanic).
   */
  attritionTurn?: number;
  /** Hard global-turn guard; sudden death ends fights long before this. */
  maxTurns?: number;
  /**
   * Per-card reuse cooldowns (see `SkillDef.cooldownTurns`). A SECOND pacing
   * dial that coexists with readiness and card weight: weight is the readiness
   * paid to play, while cooldown gates which cards are eligible. Every living
   * combatant still gains Speed while cards cool. DEFAULT true for real play.
   */
  cooldownsEnabled?: boolean;
}

/**
 * A fight is ALWAYS decided (user-locked 2026-07-31): there is no draw. Someone's
 * HP reaches 0 first, and when both sides' last units fall inside the same step
 * the engine decides it in one place — `decideOutcome` in `combat/simulate.ts`
 * (lower initiative score loses → lower HP loses → player wins an exact tie).
 */
export type CombatOutcome = 'win' | 'loss';

export interface EnemyDef {
  id: string;
  name: string;
  /** Difficulty anchor; stats/boards scale with zone depth at setup time. */
  baseDepth: number;
  isElite?: boolean;
  isBoss?: boolean;
  stats: CombatantStats;
  boardSize: number;
  pieces: BoardPiece[];
  elementAffinity?: Element;
  weaponAffinity?: WeaponType;
  goldReward: number;
  xpReward: number;
}
