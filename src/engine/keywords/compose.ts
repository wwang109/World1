import {
  BASELINE_COOLDOWN,
  tierResolved,
  type Action,
  type AuraDef,
  type SkillDef,
} from '../types';
import { OFFENSIVE_KINDS } from '../balance';
import {
  CARD_MOD_KEYS,
  CARD_MOD_TEXT,
  KEYWORD_TEXT,
  damageClause,
  faceClauseOf,
  typeName,
  type ComposeGroup,
  type RenderCtx,
} from './text';

/**
 * THE CARD-TEXT GENERATOR — one function, one grammar, 183 cards × 4 tiers.
 *
 * `SkillDef.text` used to be authored: 450 hand-written strings (183 base +
 * 267 per-tier overrides) restating the same mechanism in 4–7 different
 * wordings per keyword, drifting from both the effects beside them and the
 * glossary entry that also explained them. This function replaces every one of
 * them, reading ONLY the registry's `faceClause` facet (`text.ts`) — the card's
 * own parameters — so no mechanism sentence can reach a face at all.
 *
 * THE GRAMMAR, in the order clauses always come out (spec §4.1):
 *
 *   1. setup       — `shieldBreak`, because it happens before the hit
 *   2. headline    — damage → heal → shield → plating → echo
 *   3. payload     — this cast's consequences on the victim
 *   4. selfGrant   — buffs this cast grants the caster
 *   5. conditional — the eleven cross-cast riders, always trailing
 *   6. aura        — the passive projected onto neighbouring cards
 *   7. attributes  — tempo (weight) and cooldown deviations
 *   8. flavor      — the card's own authored colour, if it has any
 *
 * A FIXED, TOTAL ORDER is the point: `bramble_ward` and `bramble_covenant`
 * carry the same shape of kit and used to present it in two different orders
 * (thorns-first vs shield-first) purely because two authors typed them. They
 * cannot now.
 *
 * PURE. No Phaser, no `Rng`, no state, no `Date.now()` — a `SkillDef` in, a
 * string out. The engine has never read `text` and still does not; this is a
 * presentation projection that happens to live in the pure layer so the
 * validator, the scaffolder and both platforms' UIs all read ONE grammar.
 */

/** Clause groups in printed order. */
export const GROUP_ORDER: readonly ComposeGroup[] = ['setup', 'headline', 'payload', 'selfGrant', 'conditional'];

/**
 * Within `headline`, the sinks come out biggest-decision-first: what it does
 * TO them, then what it does FOR you, then the walls, then the extra hit.
 */
export const HEADLINE_ORDER: readonly Action['kind'][] = ['damage', 'heal', 'shield', 'attunedShield', 'statStrike'];

/**
 * The stacking piles the engine MERGES into one status on the victim
 * (`applyStatus`), so the face must print one clause too. `rimebarb_vigil`
 * carries four separate `thorns` lines (three of them tier-locked); at Diamond
 * all four resolve in and, unmerged, would print four `{{Thorns}} N` clauses
 * for a single pile of 14 — the longest card in the catalog describing
 * something the engine never does.
 */
const MERGEABLE = new Set<Action['kind']>(['poison', 'burn', 'bleed', 'thorns']);

/** `stacks` is the magnitude every mergeable kind carries. */
type Stacking = Extract<Action, { kind: 'poison' | 'burn' | 'bleed' | 'thorns' }>;

export function renderCtxOf(skill: SkillDef): RenderCtx {
  return {
    property: skill.property,
    element: skill.element,
    weapon: skill.weapon,
    size: skill.size,
    speedWeight: skill.speedWeight,
    cooldownTurns: skill.cooldownTurns,
    aoe: skill.scope === 'all' && skill.effects.some((a) => OFFENSIVE_KINDS.has(a.kind)),
    gated: false,
  };
}

/**
 * MERGE PASS, on UNGATED same-kind piles only. An affinity-gated pile is a
 * DIFFERENT clause on the face (it only exists on the right board), so folding
 * it into the always-on number would print a total the card does not always
 * deliver — the same reason `summarizeEffectSegments` pulls a gated hit back
 * out of its headline accumulator.
 */
function mergePiles(effects: readonly Action[]): Action[] {
  const out: Action[] = [];
  const pileAt = new Map<Action['kind'], number>();
  for (const action of effects) {
    if (action.affinity === true || !MERGEABLE.has(action.kind)) { out.push(action); continue; }
    const at = pileAt.get(action.kind);
    if (at === undefined) {
      pileAt.set(action.kind, out.length);
      out.push({ ...action });
      continue;
    }
    const existing = out[at] as Stacking;
    out[at] = { ...existing, stacks: existing.stacks + (action as Stacking).stacks };
  }
  return out;
}

/**
 * THE AURA CLAUSE — the one card-face fact that is not an `Action` at all
 * (`AuraDef` is a positional passive, projected onto neighbours rather than
 * cast). Generated here for the same reason everything else is: six cards
 * authored it five different ways.
 */
function auraClause(aura: AuraDef): string {
  const filter = aura.archetypeFilter ?? aura.propertyFilter;
  const target = filter === undefined ? 'cards' : `${filter.charAt(0).toUpperCase()}${filter.slice(1)} cards`;
  const reach = aura.reach ?? 1;
  const where = aura.affects === 'allBoard'
    ? `ALL ${target}`
    : aura.affects === 'adjacent'
      ? (reach <= 1 ? `adjacent ${target}` : `${target} within ${reach}`)
      : `the ${reach} ${target} to its ${aura.affects.toUpperCase()}`;
  // THE MOD WORDS COME FROM THE REGISTRY (2026-09-07), not from here.
  //
  // `AuraDef.mods` and a card-scope stat gem's `StatGemMods.card` are the SAME
  // THREE MODS (the type comment on `StatGemMods` says so: "AuraMods-shaped"),
  // and this function used to spell two of them its own way — `deal +6` /
  // `heal +10` on the face while the gem chip and the compact badge said
  // `+6 damage` / `+10 healing` for the identical mod. Same mod, two wordings,
  // which is the whole defect this migration exists to remove; `weightDelta`
  // happened to already agree. Both readers now call
  // `CARD_MOD_TEXT[key].faceClause`, so a fourth mod key or a reworded one
  // moves every surface at once. `get` is the only word added here — a verb
  // for the subject, not a second name for the mod.
  const mods = CARD_MOD_KEYS
    .map((key) => {
      const value = aura.mods[key];
      return value === undefined ? '' : CARD_MOD_TEXT[key].faceClause(value);
    })
    .filter(Boolean);
  return `Passive: ${where} get ${mods.join(', ')}`;
}

/**
 * NO TEMPO CLAUSE — deliberately, against spec §2.2's recommendation.
 *
 * §2.2 is right that 19 cards deviate from `weightOf`'s default and 11 said
 * nothing about it, and right that weight decides cast ORDER. But the fix it
 * proposes prints, in the card BODY, a number that is ALREADY on the card
 * face: `FantasyCardTemplateV2` draws a dedicated weight plate (with
 * `weightEntry`'s "costs N readiness to play — lighter cards come out sooner"
 * attached as its own tap target) and `CardToken` draws a `W{n}` badge, on
 * both platforms, on every card. Restating it in prose is exactly the
 * duplication this migration exists to remove, and it cost 8 cards a whole
 * text bucket when measured. The DEVIATION from default is the only fact the
 * plate does not carry, and it is a comparison a player makes against the
 * other cards in front of them, not a rule.
 */

export function cooldownRemainingClause(turnsLeft: number): string {
  return `on cooldown, ${turnsLeft} turn${turnsLeft === 1 ? '' : 's'} remaining`;
}

export function emptySlotClause(slot: number): string {
  return `empty slot ${slot + 1}`;
}

/** THE COOLDOWN CLAUSE (spec §2.4). 9 cards deviate from `BASELINE_COOLDOWN`,
 * and unlike weight there is no plate, badge or glossary entry for it
 * anywhere on the face — so this is the only place it can be read. */
export function cooldownClause(skill: SkillDef): string | undefined {
  if (skill.cooldownTurns === undefined || skill.cooldownTurns === BASELINE_COOLDOWN) return undefined;
  return `Cooldown ${skill.cooldownTurns} (default ${BASELINE_COOLDOWN}).`;
}

export const EXTRA_COOLDOWN_LIST_CAP = 3;

export interface ExtraCooldownWarningEntry {
  name: string;
  clause: string;
}

export function extraCooldownWarningEntries(skills: readonly SkillDef[]): { entries: ExtraCooldownWarningEntry[]; moreCount: number } {
  const capped = skills.slice(0, EXTRA_COOLDOWN_LIST_CAP);
  const entries = capped.map((skill) => ({ name: skill.name, clause: cooldownClause(skill) ?? '' }));
  return { entries, moreCount: Math.max(0, skills.length - EXTRA_COOLDOWN_LIST_CAP) };
}

export function castableGapWarningLines(needed: number | null): string[] {
  if (needed === null) return [];
  return [
    'This board will hit card',
    `cooldown — need at least ${needed}`,
    'cards to avoid it.',
  ];
}

/**
 * AFFINITY, wrapped ONCE for every keyword it can gate (spec §2.1). Affinity
 * is not a family of keywords — it is the single `AffinityGated` modifier any
 * action may carry — so 39 raw occurrences collapse to this one template, and
 * it wraps the action's own BARE face clause, never a rule sentence.
 */
function affinityWrap(clause: string, ctx: RenderCtx): string {
  const type = ctx.element ?? ctx.weapon;
  return `{{Affinity}} ${type === undefined ? 'type' : typeName(type)} — ${clause}`;
}

/**
 * Every clause of a card's generated face, in order — the list `renderSkillText`
 * joins. Exposed separately because `selectBodyRule`
 * (`fantasyCardTemplateSpec.ts`) needs the POST-MERGE clause count as its
 * density term: feeding it the raw `effects.length` would over-penalise
 * exactly the cards the merge rule exists to help.
 */
export function renderSkillClauses(raw: SkillDef): string[] {
  // Tier locks resolved here too, idempotently: a line locked above this
  // copy's tier does not exist on it, so it must not appear on its face.
  const skill = tierResolved(raw);
  const ctx = renderCtxOf(skill);
  const effects = mergePiles(skill.effects);

  const byGroup = new Map<ComposeGroup, string[]>();
  for (const group of GROUP_ORDER) byGroup.set(group, []);

  const push = (group: ComposeGroup, clause: string): void => { byGroup.get(group)!.push(clause); };
  /** A gated clause renders in a context that has already named the type. */
  const gatedCtx: RenderCtx = { ...ctx, gated: true };

  /**
   * WHICH HEADLINE KINDS THIS CARD ALREADY DELIVERS UNGATED — so a gated
   * SECOND helping of the same kind can say "again"/"more" instead of reading
   * as an unrelated extra hit (`RenderCtx.repeatsHeadline`).
   *
   * Computed up front, not accumulated during the loop: the gated action can
   * appear BEFORE its ungated twin in `effects` (authoring order is free), and
   * a flag that depended on which came first would print the repeat form on
   * some cards and not others for the same shape — the exact class of
   * inconsistency this generator exists to make unexpressible. Membership is
   * queried, never iterated, so no `Set` order reaches the output.
   */
  const ungatedHeadline = new Set<Action['kind']>(
    effects
      .filter((a) => a.affinity !== true && KEYWORD_TEXT[a.kind].composeGroup === 'headline')
      .map((a) => a.kind),
  );
  const repeatCtx: RenderCtx = { ...gatedCtx, repeatsHeadline: true };
  /** The context a gated clause of `kind` renders in. */
  const ctxForGated = (kind: Action['kind']): RenderCtx => (ungatedHeadline.has(kind) ? repeatCtx : gatedCtx);

  // AOE LEADS, exactly as the compact board badge does (`summarizeEffectSegments`
  // pushes `AOE` first "so it survives this line's own ellipsis clamp"). It is
  // a STANDALONE clause rather than a suffix on the damage line because `scope`
  // widens EVERY offensive action, not just the hit: `chain_spark@diamond`
  // slows every foe as well as hitting them, and a `... damage to ALL foes`
  // suffix would have quietly said otherwise. The rule ("ascending board
  // order, not a single chosen target") stays in `targetingEntry`, tap-only.
  if (ctx.aoe) push('setup', 'Hits EVERY foe');

  // HEADLINE is ordered by KIND, not by authoring order, so two cards with the
  // same sinks read the same way round. Everything else keeps authored order
  // within its group, which is the order the interpreter applies them in.
  //
  // AND WITHIN A KIND: UNGATED FIRST, GATED SECOND — structurally, for all
  // three sinks (corrected 2026-09-07, review 2). `damage` always read that way
  // because its ungated line is accumulated into ONE clause and pushed before
  // the loop; `heal` and `shield` did not, so `gravelight_choir` with its two
  // heals authored the other way round would have led with
  // "Restore 12 (+MDEF) more HP" — a repeat announced before the thing it
  // repeats, and the same card shape reading two ways depending on typing
  // order. That is exactly what `repeatsHeadline` exists to prevent, so the
  // ordering it depends on cannot itself be an authoring accident.
  for (const kind of HEADLINE_ORDER) {
    // Every UNGATED damage line is ONE clause built from the whole power list
    // (`damageClause`) — see its doc for why a multi-hit is a count and not a
    // sum. Gated hits are excluded and emitted separately below.
    if (kind === 'damage') {
      const powers = effects.filter((a) => a.kind === 'damage' && a.affinity !== true).map((a) => (a as { power: number }).power);
      if (powers.length > 0) push('headline', damageClause(powers, ctx));
    }
    // Two passes over the SAME list rather than a sort: authored order is still
    // what decides two ungated heals' order between themselves (it is the order
    // the interpreter applies them in), and a stable sort would be a heavier
    // way to say the same thing.
    for (const gatedPass of [false, true]) {
      for (const action of effects) {
        if (action.kind !== kind) continue;
        const gated = action.affinity === true;
        if (gated !== gatedPass) continue;
        // The ungated damage line was already emitted above, whole.
        if (kind === 'damage' && !gated) continue;
        const clause = faceClauseOf(action, gated ? ctxForGated(kind) : ctx);
        push('headline', gated ? affinityWrap(clause, ctx) : clause);
      }
    }
  }
  for (const action of effects) {
    const group = KEYWORD_TEXT[action.kind].composeGroup;
    if (group === 'headline') continue;
    const gated = action.affinity === true;
    // Nothing outside the headline group is a repeat by construction (no
    // conditional rider or payload shares a kind with a sink), so this arm
    // keeps the plain gated context.
    const clause = faceClauseOf(action, gated ? gatedCtx : ctx);
    push(group, gated ? affinityWrap(clause, ctx) : clause);
  }

  const clauses: string[] = [];
  for (const group of GROUP_ORDER) clauses.push(...byGroup.get(group)!);
  if (skill.aura) clauses.push(auraClause(skill.aura));
  return clauses;
}

/**
 * The card's whole printed body: the mechanical clauses, then the card
 * attributes, then its optional authored flavour.
 *
 * The clause list is joined with ` · ` and closed with a full stop — the
 * separator the catalog already used — and each trailing attribute is its own
 * sentence, so a phone reads one fact per visual unit.
 */
export function renderSkillText(raw: SkillDef): string {
  const skill = tierResolved(raw);
  const clauses = renderSkillClauses(skill);
  const sentences: string[] = [];
  if (clauses.length > 0) sentences.push(`${clauses.join(' · ')}.`);
  const cooldown = cooldownClause(skill);
  if (cooldown) sentences.push(cooldown);
  if (skill.flavor) sentences.push(skill.flavor);
  // A card with no effects, no aura and no deviations (there are none today,
  // but `effects: []` is legal for a pure passive) still needs SOMETHING.
  return sentences.length > 0 ? sentences.join(' ') : 'Passive.';
}
