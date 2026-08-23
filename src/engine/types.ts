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
 * Afflictions an `exploit` rider may key off — EXACTLY the cleansable set
 * (`isCleansable`, combat/interpreter.ts), i.e. the negative statuses a unit can
 * be made to carry: poison / burn / bleed / stun / stat debuff / expose.
 *
 * DECLARED HERE, not imported from `StatusInstance['kind']`: `combat/state.ts`
 * imports this module, so reading the status union back out of it would close an
 * import cycle. It is the same duplicated-as-data tradeoff `OFFENSIVE_KINDS`
 * (balance.ts) already accepts, with the same fix — a test pins this union
 * against `isCleansable` so the two can never drift.
 *
 * `thorns`/`guard`/`negate`/`ward`/`buff` are deliberately ABSENT: those are
 * BUFFS on their holder, and "the target is buffed, so hit it harder" is a
 * different mechanic (a punish, not an exploit) that would need its own price.
 */
export type ExploitableStatus = 'poison' | 'burn' | 'bleed' | 'stun' | 'debuff' | 'expose';

/**
 * Statuses that carry a STACK COUNT a `stackBonus` can scale off — the three
 * decaying/halving DoTs plus `thorns`. Every other status kind measures itself
 * in turns, charges or a pct, so `stacks` would read 0 forever and the rider
 * would be a silent no-op priced at full rate.
 *
 * `thorns` is in (and is the whole point of the caster-side form: it is the one
 * stacking pile a unit accumulates ON ITSELF, so it is the only status
 * `of: 'caster'` can ever find in shipped content).
 */
export type StackedStatus = 'poison' | 'burn' | 'bleed' | 'thorns';

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
   * count as PHYSICAL reflect damage and the pile loses one stack (expires at 0).
   * DoT ticks, fatigue and attrition never trigger it, and reflect damage can
   * never trigger the attacker's own thorns (depth-1, non-reentrant) — a
   * reflect loop is the cheapest way to hang the sim. Stacks persist until
   * consumed (no turn expiry) and are NOT cleansable (a buff, not an ailment).
   *
   * PHYSICAL, ARMOR FIRST (user-locked 2026-08-21: "its just a reflect — if
   * either side has the thorn buff and either side has armor it should hit armor
   * first"). The reflect is an ordinary physical hit: the recipient's ARMOR comes
   * off it (min-1 floor), a matching physical `guard` reduces it and a physical
   * shield absorbs it. It carries no weapon/element, so no matchup wheel applies.
   * It was TRUE from the keyword's first commit until then — an unratified
   * default, and the odd one out among the typed DoT ticks. See `reflectThorns`
   * in combat/interpreter.ts.
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
  /**
   * The enemy's NEXT action is this much heavier (their attack comes later) —
   * and ONLY for the REST OF THE TURN IT LANDS ON (user-locked 2026-08-18: "a
   * slow is only applied to that 1 card and doesn't stay — after the turn it
   * was applied on, the slow effect is removed").
   *
   * So a slow is spent by whichever of the two comes first: the victim's next
   * cast this turn (which pays the inflated weight, `castSelect.ts`), or the
   * end of the turn (`simulate.ts`, beside `expireStatuses`) — a victim who is
   * stunned, busy mid-span, cooling or simply too poor to afford the taxed
   * weight carries NOTHING into the next turn. Taxes therefore cannot
   * accumulate across turns and no clamp is needed.
   */
  | { kind: 'slow'; weight: number }
  /**
   * BURDEN — `slow` at CARD scope instead of unit scope: the enemy's CURRENT
   * CARD costs `weight` extra the next time it is played.
   *
   * ONE CARD, THE ANCHOR (see `splashAnchor`, combat/splash.ts): the piece the
   * victim's `castCursor` sits in at the moment this resolves — "the target's
   * current turn's card". Nothing about the anchor wraps (user-locked
   * 2026-08-19, the board is a line): parked past the last card, the anchor is
   * the LAST CARD PLAYED rather than the leftmost piece.
   *
   * SINGLE-TARGET AT THE UNIT LEVEL, like `slow`: it resolves against ONE enemy
   * (whatever `resolveTargets` picks) and lands on ONE of that enemy's pieces.
   *
   * WHAT IT DOES: the burdened piece costs `weight` EXTRA the next time it is
   * played (`PieceState.nextWeightPenalty`, summed into the cast weight in
   * `castSelect.ts` and consumed when that piece actually performs). Weight,
   * not cooldown — cooldown is a deck-diversity dial in this codebase, not a
   * balance lever; weight only shifts WHEN a card fires.
   *
   * NON-STACKING, exactly like `slow`: a re-burden takes `Math.max`, never a
   * sum — an unbounded stack would permanently lock a card out.
   *
   * IT RIDES UNTIL IT IS PAID, unlike `slow` (which is dropped at end of the
   * turn it landed on, paid or not): a burden waits however many turns it takes
   * for that piece to be played, then is spent. That divergence is deliberate
   * and priced (see `PRICE.burdenPerWeightNum`).
   *
   * PAIR IT WITH `splash` TO HIT THE WHOLE BAND. Burden alone taxes the anchor;
   * a cast carrying `splash` spreads it over the anchor's neighbours too. The
   * two together are exactly the effect the single old `splash weight N` action
   * delivered before 2026-08-21 (see `splash` below).
   */
  | { kind: 'burden'; weight: number }
  /**
   * CURSE — the anchor card deals `amount` LESS damage for `turns` global turns.
   *
   * THE SECOND CARD-TARGETING EFFECT (user's design), and the mirror of
   * `burden`: burden makes a card come out LATER, curse makes it hit SOFTER.
   * Same target geometry (the anchor by default, the whole band when the cast
   * also carries `splash`), same unit-level single-target identity.
   *
   * WHAT IT DOES: `PieceState.curse` (combat/state.ts) holds `{ amount,
   * expiresAtTurn }`, and `resolveAuras` (combat/auras.ts) folds `-amount` into
   * that piece's `mods.damageFlat` — the same attacker-side flat channel board
   * auras and card-scope stat gems already ride, so every downstream rule
   * (mitigation order, the min-1 damage floor, multi-hit) applies unchanged. A
   * cursed card can never be reduced below 1 damage: the floor lives in
   * `applyStrike`, not here.
   *
   * TIMED, IN GLOBAL TURNS, EXACTLY LIKE A TURN-DURATIONED STATUS: applied on
   * turn T with `turns: N` it covers the rest of turn T and turns T+1..T+N, and
   * is DELETED in the end-of-turn pass of turn T+N (`expireCurses`,
   * simulate.ts). That is the same window `addStatus` + `expireStatuses` give a
   * `fresh` status of N turns; it is stored as an absolute `expiresAtTurn`
   * rather than a countdown so nothing has to walk the boards every turn to
   * decrement it.
   *
   * NON-STACKING, THE `expose` RULE: a re-curse keeps the STRONGER `amount` and
   * the LATER expiry (`Math.max` on both fields independently) — never a sum. A
   * summed curse would compound a damage denial without bound on a resource the
   * holder cannot see, and it is priced as one number, not as a stack.
   *
   * A 0-AMOUNT OR 0-TURN CURSE IS DROPPED OUTRIGHT (the `expose` precedent):
   * it would otherwise be a free, priced-at-almost-nothing effect that still
   * emitted an event and still occupied the anchor's non-stacking slot.
   */
  | { kind: 'curse'; amount: number; turns: number }
  /**
   * SPLASH — THE SPREADER. It carries no payload of its own (user-locked
   * 2026-08-21, verbatim: "splash is an effect that spread other effect. It
   * doesn't just spread wt"). Its ONE meaning: the other CARD-TARGETING effects
   * of this cast — `burden`, `curse` — apply to the whole BAND instead of to the
   * anchor alone.
   *
   * IT IS NOT A WEIGHT TAX. It was shipped as `{ kind: 'splash'; weight }` from
   * 2026-08-18 to 2026-08-21, which conflated the spreader with its first
   * payload; the weight tax is now `burden` and `burden + splash` reproduces the
   * old action exactly (same band, same `Math.max`, same price).
   *
   * A SPREADER WITH NOTHING TO SPREAD IS REFUSED, not silently ignored: an
   * authored card carrying `splash` and no card-targeting effect is a
   * `validateSkillContent` failure, and a GEM `splash` spliced onto a host where
   * neither the host nor the gem supplies one is dropped at the resolver seam
   * (`spliceGemActions`, cards.ts — the `nothingToSpread` arm of THE SPLASH
   * GATE).
   *
   * SINGLE-TARGET AT THE UNIT LEVEL: what it spreads across is ONE victim's
   * BOARD, never their team. Both paths to the forbidden pair are closed — an
   * AUTHORED `scope: 'all'` + splash card is rejected by
   * `validateSkillContent`, and a GEM's splash is dropped by THE SPLASH GATE on
   * any host that already hits more than one target, or that already splashes
   * (a socket must not be able to double a band it cannot widen).
   *
   * THE BAND (see `splashBand`, combat/splash.ts): the ANCHOR plus the piece
   * immediately BEFORE and the piece immediately AFTER it on the board.
   * Adjacency is SPATIAL and does NOT wrap (a card at slot 0 has nothing to its
   * left), measured edge-to-edge with the same footprint arithmetic the aura
   * system uses (`footprintGaps`), so a multi-slot card is ONE piece however
   * many slots it spans. The band is therefore 1..3 pieces wide, decided by the
   * VICTIM's board layout. The spreader is priced FLAT and STANDALONE
   * (`PRICE.splashFlatDeci`, user-locked 2026-08-21 — never a multiplier on
   * its siblings), so a card's PL stays holder- AND opponent-independent and
   * band width beyond the price's assumptions is unpriced upside.
   *
   * CAST-SCOPED, NOT POSITIONAL: the flag is read once per cast from the
   * effective effect list (`castSpreadsBand`, combat/interpreter.ts), so a gem
   * splash spliced after the host's burden still spreads it. There is nothing
   * for list order to decide, which is also why the keyword needs no phase.
   */
  | { kind: 'splash' }
  /** Drain the enemy's banked readiness (steal their built-up tempo). */
  | { kind: 'disrupt'; amount: number }
  /** Heal the caster for pct% of the damage this cast dealt (place after damage). */
  | { kind: 'lifesteal'; pct: number }
  /** Shatter enemy shields before the hit (place before damage). */
  | { kind: 'shieldBreak'; amount: number }
  /** +amount FLAT damage this cast if the previous cast shared an archetype (place first). */
  | { kind: 'comboBonus'; amount: number }
  /**
   * CHAIN BONUS — `comboBonus`'s sibling on the TYPE axis instead of the
   * archetype axis: +`amount` FLAT damage this cast if the caster's PREVIOUS
   * resolved cast was of the named type. Place it BEFORE the damage action it
   * feeds (enforced by `validateSkillContent`); it arms the cast's one
   * caster-side bonus, spent by the first non-gem `damage` action, exactly like
   * `comboBonus`.
   *
   * `after` NAMES ONE CARD TYPE, and "type" is the notion the game already has:
   * `cardType` (combat/typeIdentity.ts) reads `element ?? weapon`, so every card
   * carries exactly one — a WEAPON (sword/axe/lance/bow/beast) for physical
   * cards, an ELEMENT (fire/frost/lightning/nature/holy/dark) for magical ones.
   * One keyword therefore covers both axes with no second variant: an axe card
   * can pay off after a sword, and a frost card after a fire, and the engine
   * compares the same field either way. The two namespaces do not overlap, so a
   * bare name is unambiguous (the validator checks membership in both lists).
   *
   * WHY A NAMED PARTNER rather than "any different type": a named gate is a
   * DECK-BUILDING instruction ("run swords beside this axe") rather than a
   * passive reward for variety, and it is the shape that makes cast ORDER worth
   * engineering. It is also the narrower, cheaper-to-be-honest gate — see the
   * pricing note in `keywords/pricing.ts`.
   *
   * A CARD MAY NOT NAME ITS OWN TYPE (`validateSkillContent`): a sword card
   * gated on `after: 'sword'` satisfies its own gate from its second cast
   * onward, which is exactly the guaranteed-uptime case the conditional-trigger
   * discount does not describe. Refused at authoring rather than priced, the
   * same call `splash`-with-nothing-to-spread gets.
   */
  | { kind: 'chainBonus'; after: Element | WeaponType; amount: number }
  /**
   * EXPLOIT — `comboBonus`'s sibling, gated on the VICTIM'S CONDITION instead of
   * on the caster's own cast history: +`amount` FLAT damage this cast if the
   * target ALREADY CARRIES the named affliction. Place it BEFORE the damage
   * action it feeds (enforced by `validateSkillContent`); it arms the cast's
   * per-target bonus, which the first non-gem `damage` action spends — exactly
   * one bonus per cast, exactly like `comboBonus`.
   *
   * FLAT, NOT A MULTIPLIER (decided 2026-08-21, user asked for "2x this
   * damage"). A `bonusMul` field would have to multiply SOMETHING, and every
   * honest candidate is worse than a flat add:
   *  • multiplying `power + effectiveStat` re-introduces the %-of-stat damage
   *    model the engine deliberately left (docs/combat-model-spec.md, "FLAT
   *    model"): output proportional to a hero stat with a card-authored
   *    coefficient grows multiplicatively against linear HP, and — exactly like
   *    an UNCAPPED `statStrike` — cannot be priced against a fixed PL band;
   *  • multiplying the flat base alone is just `amount = power`, i.e. this
   *    action with a number the card already prints;
   *  • either form needs a new rounding rule and a new term in
   *    `StrikeParts`/`DamageCalculation`, where a flat add telescopes through
   *    `effectBonusDamage` with no new math at all.
   * So "2x" is authored PER CARD as `amount === (the card's own damage power)`,
   * which reads on the face as the number it actually adds and prices per point
   * on the `comboBonus` conditional-discount precedent
   * (`PRICE.comboPerPointNum/Den`; see `PRICE.conditionalBonusDen`).
   *
   * IT READS PRE-EXISTING STATUS ONLY — USER-LOCKED 2026-08-21 ("it should
   * always activate this effect first before activating any poison debuff"). The
   * rider resolves before the card's own DoT/status applications land (the
   * catalog's standing convention: statuses go after the hit), so a card can
   * NEVER self-trigger inside one cast. A card that both exploits poison and
   * applies poison pays off ACROSS casts: cast 1 arms nothing and leaves a pile,
   * cast 2 finds the pile and collects. `validateSkillContent` enforces the
   * order so the rule is unrepresentable rather than merely conventional.
   *
   * OFFENSIVE (it reads the victim), so it resolves against the SAME target(s)
   * the damage action does and is armed PER TARGET: under `scope: 'all'` each
   * foe is checked on its own and only the afflicted ones take the bonus — which
   * is also why it pays the AoE reach multiplier (`OFFENSIVE_KINDS`).
   *
   * Parameterised over the affliction, so bleed / burn / stun / debuff / expose
   * variants are DATA, never new arms.
   */
  | { kind: 'exploit'; status: ExploitableStatus; amount: number }
  /**
   * STACK BONUS — flat bonus damage PROPORTIONAL to a stacking status's current
   * stack count, hard-CAPPED: `bonus = min(per × stacks(status, of), cap)`.
   *
   * `of: 'caster'` reads the CASTER's own pile — the thorn-deck payoff ("spend
   * the wall"): a card that turns the stacks it has been accumulating into
   * damage. `of: 'target'` reads the VICTIM's pile — a DoT executioner that hits
   * harder the deeper the poison. Either way it is a rider on the cast's own
   * hit, NOT a separate instance (`isHit: false`): it takes no extra-hit
   * premium, spends no second `negate` charge, and is spent by the first non-gem
   * `damage` action exactly like `comboBonus`/`exploit`.
   *
   * THE `cap` IS REQUIRED, and the cap is WHAT IS PRICED — the `statStrike`
   * lesson stated as a type instead of a footnote. `per × stacks` is unbounded
   * in a resource the card does not control (piles merge; a thorns wall or a
   * poison stack can be arbitrarily deep), and an unbounded effect has no honest
   * fixed price — `statStrike` handles that by pricing an uncapped strike at 0
   * so it fails every band loudly. Here the field is simply not optional: there
   * is no uncapped form to price. A capped rider is worth at most `cap` damage
   * at any stack depth, so it prices exactly like a conditional flat bonus of
   * that size (`actionsPriceDeci`).
   *
   * SAME ORDERING RULE AS `exploit`, same reason: it reads the pile as it stands
   * when the rider resolves, before this card's own thorns/DoT application lands
   * (`validateSkillContent` enforces it), so the loop is cross-cast — grant now,
   * spend next time.
   */
  | { kind: 'stackBonus'; status: StackedStatus; of: 'caster' | 'target'; per: number; cap: number }
  /**
   * SHIELD BURST — shatter YOUR OWN plating and throw it: up to `cap` points are
   * drained from the caster's own shield pools and armed as flat bonus damage on
   * this cast's hit. `bonus = min(totalShield(caster), cap)`, and exactly that
   * many points leave the pools.
   *
   * THE DECISION IS THE POINT: a wall you are keeping and a wall you are spending
   * are different cards, and this one makes the shield lane choose. It is the
   * mirror image of `shieldBreak` (which strips the VICTIM's plating): same
   * currency, opposite owner, opposite direction.
   *
   * DRAIN ORDER IS FIXED: physical → magical → true, stopping when `cap` is paid
   * or the pools are dry (`spendShieldsForBurst`, combat/state.ts). Deterministic
   * (a literal order, not object-key iteration), and it spends the CHEAPEST
   * plating first: the `true` pool is the only one that blocks every property, so
   * it is drained last and a partial burst leaves the best wall standing.
   *
   * ONE POINT OF SHIELD BECOMES ONE POINT OF DAMAGE, whatever pool it came from.
   * The 2:1 rule typed damage pays to spill into a `true` shield (`consumeShields`)
   * is a rule about BLOCKING an incoming hit; nothing is being blocked here, and
   * the payload is bounded by `cap` regardless, which is the number that is priced.
   *
   * IT READS PRE-EXISTING SHIELD ONLY — the same ordering ruling `exploit` and
   * `stackBonus` carry (user-locked 2026-08-21): a card that grants shield may not
   * feed its own burst inside one cast, so `validateSkillContent` requires any
   * `shield` line to sit AFTER the damage the burst feeds. Grant now, spend next
   * cast.
   *
   * SUPPORTIVE, LIKE `comboBonus` — it resolves on the CASTER (it is the caster's
   * own resource it spends), so it runs ONCE per cast and arms the cast's scalar
   * `bonusFlat`. That is also why an AUTHORED `scope: 'all'` + `shieldBurst` card
   * is rejected (`validateSkillContent`): one wall spent once must not be
   * delivered to five foes at a single-target price. No gem carries this kind, and
   * a test pins that — a gem one would need the splash gate's treatment.
   */
  | { kind: 'shieldBurst'; cap: number }
  /**
   * TAX BONUS — the tempo punisher: flat bonus damage per WEIGHT-TAXED card on
   * the victim's board, hard-CAPPED. `bonus = min(per × taxedCards(target), cap)`.
   *
   * WHAT COUNTS AS ONE TAXED CARD (`taxedCardCount`, combat/state.ts): every
   * board piece carrying a pending `burden` (`PieceState.nextWeightPenalty`),
   * PLUS ONE if the unit itself carries a pending `slow`
   * (`CombatantState.nextWeightPenalty`). Counting the unit-scope slow as one card
   * is deliberate — the fantasy is "punish the backlog", a slow IS part of the
   * backlog (it taxes the very next card that unit plays), and the alternative
   * would make the reaper blind to half the tempo lane it exists to pay off.
   *
   * THE TIMING WRINKLE IS THE SYNERGY LOOP, not an accident. A `slow` lives only
   * until the end of the turn it landed on, while a `burden` rides its piece
   * until that piece is next played — so the reaper wants to fire AFTER your tempo
   * cards, in the same turn for slow and any time later for burden. That is the
   * designed pairing with Line Breaker / Shockwave Slam / the burden gems.
   *
   * A BURDEN SPREAD BY `splash` COUNTS ONCE PER PIECE, which is the whole
   * combo: one `burden + splash` cast can leave 3 taxed cards on the victim's
   * board for the reaper to collect on, where a bare burden leaves 1.
   *
   * THE `cap` IS REQUIRED and the cap is WHAT IS PRICED — the `stackBonus` rule,
   * for the same reason: `per × count` is bounded only by the VICTIM's board size
   * (a resource the card's holder does not control), so only the ceiling is
   * priceable. `per` is unpriced by construction; a huge `per` merely turns the
   * rider into "+cap if they are taxed at all".
   *
   * OFFENSIVE (it reads the victim's board), so it is armed PER VICTIM: under
   * `scope: 'all'` each foe is judged on its own backlog, and the card pays the
   * AoE reach multiplier (`OFFENSIVE_KINDS`).
   *
   * SAME ORDERING RULE as its siblings: it reads taxes that were ALREADY there,
   * so `validateSkillContent` requires this card's own `slow`/`burden` lines to
   * sit AFTER the damage the rider feeds. A slow+reaper card therefore cannot
   * self-feed within one cast — and, because a slow expires at end of turn, only
   * a SECOND cast in the SAME turn collects on it, while a burden keeps paying
   * until the taxed piece is played.
   */
  | { kind: 'taxBonus'; per: number; cap: number }
  /**
   * WARD RELEASE — `shieldBurst`'s twin one currency over: spend the charges of
   * the caster's OWN `ward` piles and arm `per` flat bonus damage per charge
   * released, hard-CAPPED. `bonus = min(per × released, cap)`, and exactly
   * `released` charges leave the caster.
   *
   * HOW MANY CHARGES IT SPENDS — only as many as the cap can pay for:
   * `released = min(wardCharges(caster), ceil(cap / per))`, taken from the
   * lowest-index ward pile first (`releaseWardCharges`, combat/state.ts).
   * Spending exactly what pays is the `shieldBurst` rule (`spendShieldsForBurst`
   * stops at `cap`, it does not empty the wall); the `ceil` makes the cap
   * REACHABLE, at the cost of one partially-paying charge when `cap` is not a
   * multiple of `per` — so authored content keeps `cap` an exact multiple of
   * `per` (the same `cap/per` discipline `deadweight_toll` is pinned on).
   *
   * DRAIN ORDER IS TRIVIAL AND STILL FIXED: unlike a burst's three shield pools
   * there is only ONE kind of ward charge, so the only ordering question is which
   * PILE pays — and it is the same answer `consumeWard` gives, lowest index first,
   * an index walk over `statuses` with no `Map`/`Set` and no RNG.
   *
   * WHY IT IS A REAL DECISION: a ward charge denies the NEXT affliction aimed at
   * you (`consumeWard`). Cashing it in says "I would rather have the damage now
   * than the immunity later" — the same keep-it-or-throw-it choice `shieldBurst`
   * makes with plating, on the resource that answers afflictions rather than hits.
   *
   * SUPPORTIVE, LIKE `shieldBurst` (`offensive: false`): the resource is the
   * caster's own, so it resolves ONCE on the caster and arms the cast's scalar
   * `bonusFlat` rather than a per-victim bonus. That is exactly why an AUTHORED
   * `scope: 'all'` + `wardRelease` card is REFUSED by `validateSkillContent`: one
   * pile of charges, spent once, must not be delivered to five foes at a
   * single-target price. No gem carries this kind, and a test pins that.
   *
   * IT READS PRE-EXISTING CHARGES ONLY — the ordering ruling (user-locked
   * 2026-08-21) unchanged: a card that grants `ward` may not feed its own release
   * inside one cast, so any `ward` line must sit AFTER the damage this feeds.
   * Grant now, cash in next cast.
   */
  | { kind: 'wardRelease'; per: number; cap: number }
  /**
   * DESPERATION — flat bonus damage while the CASTER is at or below HALF its
   * maximum HP. `exploit`'s sibling, reading the caster's own HP bar instead of an
   * affliction on the victim: the last-stand payoff the low-HP archetype is sold
   * on, and the one rider whose gate is a fact about the attacker.
   *
   * THE GATE IS INTEGER-EXACT: `hp * 2 <= maxHp`, never `hp <= maxHp / 2`. Half of
   * an odd maxHp is not an integer, and the engine holds integers only — the
   * multiply form is the SAME predicate with no float and no floor to argue about
   * (`Math.floor(maxHp / 2)` would move the boundary on odd bars: at 50/101 it asks
   * `50 <= 50` and answers yes, which is right, but at 51/101 a `ceil` reading
   * would have answered yes too). It is written here so no caller re-derives it.
   * `maxHp` is not a `BuffableStat`, so no buff can move the goalposts mid-fight.
   *
   * FLAT `amount`, NOT a cap over a `per` — there is nothing to count. It is
   * `exploit`'s shape exactly, and it prices exactly like one.
   *
   * OFFENSIVE, and armed PER VICTIM, even though the condition is CASTER-side —
   * the same call `stackBonus` with `of: 'caster'` already makes. The bonus is
   * delivered once per foe under `scope: 'all'`, so classifying it as offensive is
   * what makes an AoE desperation card pay the reach multiplier
   * (`OFFENSIVE_KINDS`) instead of handing five foes a single-target bonus.
   *
   * NO SELF-SYNERGY VARIANT EXISTS, so it ALWAYS prices at the conditional
   * discount: a card cannot raise the caster's `maxHp` (not a buffable stat) and
   * cannot lower the caster's own HP (no keyword damages its own caster — a
   * `thorns` reflect is the victim's doing, not the card's). There is therefore no
   * kit that guarantees its own gate, which is precisely what the discount is for.
   * `resourceSuppliedBy` returns `null` for every kind, so
   * `selfSynergyPremiumDeci` is 0 for it by construction rather than by exception.
   */
  | { kind: 'desperation'; amount: number }
  /**
   * OVERHEAL SHIELD — healing past a full HP bar becomes PLATING instead of
   * vanishing: when this cast's own `heal` overflows the recipient's `maxHp`, up to
   * `cap` points of that overflow are converted into shield of the CARD'S OWN
   * PROPERTY on the unit that overflowed.
   *
   * NOT A DAMAGE RIDER. It is the family's first member that modifies the cast's
   * own HEAL resolution rather than arming bonus damage, so it feeds a `heal`
   * action (`validateSkillContent` requires one AFTER it) and never touches
   * `bonusFlat`/`bonusByTarget`.
   *
   * THE OVERFLOW IS MEASURED AFTER EVERY REDUCTION THE HEAL ALREADY PAYS — the
   * ANTI-HEAL TAX IS APPLIED FIRST and the taxed heal IS the real heal. `restoreHp`
   * receives the post-tax request, so the conversion reads
   * `applied − healed` where `applied` is what anti-heal left. A heal taxed −60%
   * therefore has 60% less to overflow WITH; the tax is not laundered into shield.
   * (This falls out of the existing order rather than being re-implemented: the
   * `heal` arm taxes, then clamps, and this rider reads the clamp's remainder.)
   *
   * THE CARD'S OWN PROPERTY POOL, TRUE only on a TRUE card — the same rule the
   * `shield` keyword already obeys, which is what makes the price honest: a
   * converted point is worth exactly what a granted point of the same pool is
   * worth, so the conditional discount is applied to the SHIELD rate rather than
   * the damage rate (see `keywords/pricing.ts`). A TRUE overheal shield is a wall
   * against everything and prices at the TRUE shield rate accordingly.
   *
   * THE maxHp SHIELD CEILING STILL APPLIES. Converted plating goes through the
   * same room check the `shield` arm uses (`maxHp − totalShield`), and the part
   * that does not fit is reported as `wasted` on the emitted `shieldGain`. A rider
   * cannot buy an escape from a global cap.
   *
   * WHO GETS THE PLATING: the unit whose bar overflowed, i.e. the heal's RECIPIENT.
   * For every solo-hero cast (and every self-heal) that is the caster; in a pack
   * the honest owner of wasted healing is the ally who could not use it. Sending it
   * to the caster instead would make "heal a full-HP ally" a gate-free self-shield
   * at rider prices, which is the one shape this keyword must not become.
   *
   * SUPPORTIVE (`offensive: false`) and SCOPE-BLIND by construction: `heal` is a
   * support action, so it resolves once on the support target whatever the card's
   * scope — there is no AoE fan-out to hand a single conversion to five units, and
   * so no AoE refusal is needed (unlike `shieldBurst`/`wardRelease`).
   *
   * IT SUPPLIES `shield` on the caster for pricing purposes
   * (`resourceSuppliedBy`), so a kit pairing it with a `shieldBurst` forfeits the
   * burst's discount — conservative in the safe direction, since in the solo case
   * the plating really does land where the burst will spend it.
   */
  | { kind: 'overhealShield'; cap: number }
  /**
   * CLEANSE CONVERT — bonus HEALING per affliction stack this cast's own `cleanse`
   * ACTUALLY REMOVED: `bonus = min(per × removed, cap)`, added to the cast's own
   * heal request.
   *
   * ACTUALLY REMOVED is the whole contract. It reads the `removed` count the
   * `cleanse` arm reports (the same number the `cleansed` event carries — stacks,
   * not piles), so a cleanse that found nothing to strip converts nothing. That is
   * what makes the gate real: the resource is AFFLICTIONS ON YOUR SIDE, which the
   * ENEMY supplies, never this card.
   *
   * THE ORDERING IS INVERTED FROM THE DAMAGE RIDERS, and deliberately so. The
   * others read a resource that was already there, so they run FIRST; this one
   * reads a result its own cast produced, so the `cleanse` must come BEFORE it and
   * the `heal` it feeds must come AFTER — `cleanse → cleanseConvert → heal`.
   * `validateSkillContent` enforces both halves; a rider with no cleanse ahead of
   * it can never pay out, and one with no heal behind it arms a bonus nothing
   * spends (the same priced-no-op the rest of the family is protected from).
   *
   * IT IS NOT SELF-SYNERGY, even though the card supplies its own `cleanse`. The
   * cleanse is the CONVERSION MECHANISM, not the gate: what the rider is really
   * betting on is that somebody on your side is afflicted when it fires, and no
   * card can supply that. `resourceSuppliedBy` returns nothing matching
   * `'cleansed'`, so the discount stands by construction.
   *
   * A LOVELY INTERACTION THAT FALLS OUT FOR FREE: the cleanse runs before the heal,
   * so stripping the poison also strips the ANTI-HEAL CATEGORY it was imposing —
   * the converted heal arrives into a lighter tax, or none.
   *
   * PRICED ON `cap` AT THE HEAL RATE over the conditional discount (`per` is free,
   * the `stackBonus` rule): the payload is bounded only by how afflicted your side
   * happens to be, which the card does not control, so only the ceiling is
   * priceable. Supportive (`offensive: false`); like `overhealShield` it needs no
   * AoE refusal, because a heal resolves once whatever the scope.
   */
  | { kind: 'cleanseConvert'; per: number; cap: number }
  // ---- Property-generic defensive keywords ----
  /**
   * Magical Guard: while active, incoming damage of the matching `property` is
   * reduced multiplicatively by `pct`% (floored, min 1) for `turns` global
   * turns. Applied on the caster (self). `pct` is clamped to <=60 at apply time.
   * True damage bypasses (no cross-property match); matching-property DoTs are
   * covered on purpose.
   *
   * Piles COEXIST and compound (a recast opens a second pile, it does not
   * merge) and the COUNT of same-property piles is UNCAPPED by design
   * (user-locked 2026-08-20: let the player build what they want). Only the
   * per-pile `pct` is clamped. Full rule — and why the 2026-08-19 count cap was
   * reverted — in the `guard` arm of `applyAction`
   * (src/engine/combat/interpreter.ts) and docs/combat-model-spec.md §8.
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

/**
 * Whether this skill's OFFENSIVE effects resolve against MORE THAN ONE unit.
 *
 * THE CONCEPT, ONE DEFINITION — deliberately not a `scope === 'all'` test
 * copied at each call site. `scope: 'all'` is the only multi-target mechanism
 * the game has TODAY, so today this function is exactly that comparison; the
 * point is that the two places which must agree about it read the SAME
 * function:
 *   • `resolveTargets` (combat/interpreter.ts) — the fan-out itself, "AoE: all
 *     living foes, ascending index";
 *   • the SPLASH GATE in `resolveEffectiveSkill` (cards.ts) — a gem's `splash`
 *     no-ops on a host that already hits more than one unit, because splash is
 *     single-target at the UNIT level (see the `splash` action docs above).
 * A future multi-target mechanism (chain / cleave / split shot) is added HERE,
 * and both the fan-out and every rule written against "hits more than one
 * target" inherit it — no new special case, no rule that silently applies to
 * only one of the two mechanisms.
 *
 * Takes just the `scope` field so a partial/effective card can be asked the
 * question as cheaply as a full `SkillDef`.
 */
export function isMultiTargetSkill(skill: Pick<SkillDef, 'scope'>): boolean {
  return skill.scope === 'all';
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
