import { applyTier } from '../../engine/cards';
import {
  capViolations,
  isOnBudget,
  powerLevelBreakdown,
  powerLevelDeci,
  TIER_BUDGET_DECI,
  type PlBreakdownPart,
} from '../../engine/balance';
import { actionExistsAtTier, TIER_ORDER, type Action, type Property, type SkillDef, type SkillSize, type SkillTier } from '../../engine/types';
import { KEYWORD_TEXT } from '../../engine/keywords/text';
import { editableFieldsFor, ELEMENT_OPTIONS, selectorsFor, WEAPON_OPTIONS, type EditableField, type EditorContext } from '../../engine/keywords/editor';
import { validateSkillDocument, type ContentProblem } from '../../data/validateSkillContent';
import skillDocument from '../../data/content/skills.v1.json';

/**
 * CARD DESIGNER — pure state/pricing/validation for the desktop Card Designer
 * scene. No Phaser here (src/game/scenes/DesktopCardDesignScene.ts is the
 * only Phaser-facing half); every number and every validation message comes
 * from the REAL engine functions (`src/engine/balance.ts`, `applyTier`,
 * `validateSkillDocument`) — this module folds/unfolds the editable JSON
 * shape around them, it never re-derives a price or a rule of its own.
 *
 * KEYWORD LIST IS GENERATED, NOT HAND-LISTED: `KEYWORD_KINDS` below is
 * `Object.keys(KEYWORD_TEXT)` (`src/engine/keywords/text.ts`, the single
 * source of truth for keyword identity/wording) sorted — so a new `Action`
 * kind lands in the palette the moment its text row does, with no second
 * place to remember.
 *
 * PER-KIND FORM METADATA now comes from `src/engine/keywords/editor.ts`
 * (`KEYWORD_EDITOR` / `editableFieldsFor` for an effect's own numeric/
 * selector/flag fields; `CARD_FIELDS` / `TIER_UPGRADE_FIELDS` for the
 * card-level and tier-override fields) — that module landed mid-task
 * (2026-09-16, `combat-engine-programmer`); the setters below
 * (`setEffectField`/`setEffectSelector`/`toggleEffectFlag`/`setCardField`/
 * `setTierUpgradeField`) are the glue that applies a change described by
 * that metadata onto a draft. They still never invent a bound of their own —
 * `editableFieldsFor`'s live `min`/`max`/`step` (recomputed against the
 * draft's OWN current property/size/tier/scope) is what the scene renders.
 * The raw JSON layer editor (`layerObjectFor`/`withLayerObject`) remains for
 * `aura`, `special`, `flavor` and `notes` — compound/free-text shapes
 * `CARD_FIELDS` marks `control: 'aura' | 'text'` rather than a stepper.
 */

export type NonBronzeTier = Exclude<SkillTier, 'bronze'>;
export const NON_BRONZE_TIERS: readonly NonBronzeTier[] = ['silver', 'gold', 'diamond'];

/** Every `Action['kind']` this build's engine knows, alphabetical — the
 * PALETTE list. Generated from the real registry (see file doc comment). */
export const KEYWORD_KINDS: readonly string[] = Object.keys(KEYWORD_TEXT).sort((a, b) => a.localeCompare(b));

export interface RawEffect {
  kind: string;
  [field: string]: unknown;
}

export interface RawTierUpgrade {
  effects?: RawEffect[];
  aura?: Record<string, unknown>;
  speedWeight?: number;
  cooldownTurns?: number;
  scope?: string;
  [field: string]: unknown;
}

/** The base (bronze) card body, loosely typed — this is the editable shape,
 * not the engine's `SkillDef`; `resolvedAt` below is the one place a draft
 * becomes a real `SkillDef` for pricing/preview. */
export interface CardDesignerDef {
  name: string;
  archetypes: string[];
  property: string;
  size: number;
  rarity: string;
  tier: SkillTier;
  weapon?: string;
  element?: string;
  speedWeight?: number;
  cooldownTurns?: number;
  scope?: string;
  effects: RawEffect[];
  aura?: Record<string, unknown>;
  special?: string;
  flavor?: string;
  tierUpgrades?: Partial<Record<NonBronzeTier, RawTierUpgrade>>;
  [field: string]: unknown;
}

export interface CardDesignerDraft {
  id: string;
  def: CardDesignerDef;
}

/** snake_case of a display name — the JSON shape rule's default id. */
export function deriveId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug === '' ? 'new_card' : slug;
}

interface RawSkillVersion {
  version: number;
  def: CardDesignerDef;
}

interface RawSkillCard {
  id: string;
  versions: RawSkillVersion[];
}

export interface CardDesignerTemplate {
  id: string;
  name: string;
  version: number;
}

const rawSkillCards = (skillDocument as unknown as { cards: RawSkillCard[] }).cards;
const catalogIds = new Set(rawSkillCards.map((card) => card.id));

function latestVersion(card: RawSkillCard): RawSkillVersion {
  let latest = card.versions[0]!;
  for (const version of card.versions) if (version.version > latest.version) latest = version;
  return latest;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function distinctDraftId(id: string): string {
  let next = id;
  while (catalogIds.has(next)) next = `${next}_draft`;
  return next;
}

export function deriveDraftId(name: string): string {
  return distinctDraftId(deriveId(name));
}

export const cardDesignerTemplates: readonly CardDesignerTemplate[] = rawSkillCards
  .map((card) => {
    const current = latestVersion(card);
    return { id: card.id, name: current.def.name, version: current.version };
  })
  .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

export function draftFromTemplate(templateId: string): CardDesignerDraft {
  const card = rawSkillCards.find((entry) => entry.id === templateId);
  if (!card) throw new Error(`unknown card template "${templateId}"`);
  return {
    id: distinctDraftId(`${card.id}_draft`),
    def: cloneJson(latestVersion(card).def),
  };
}

/** A fresh designer draft: `[card] New Card`, no effects yet (0 PL — under
 * every tier's budget, meter starts red) so the "empty designer" screenshot
 * shows an honestly-empty card rather than a pre-filled one. */
export function defaultCardDesignerDraft(): CardDesignerDraft {
  const name = 'New Card';
  return {
    id: deriveDraftId(name),
    def: {
      name,
      archetypes: ['offense'],
      property: 'physical',
      size: 1,
      rarity: 'common',
      tier: 'bronze',
      weapon: 'sword',
      effects: [],
    },
  };
}

function hasOwn(object: object | undefined, key: string): boolean {
  return object !== undefined && Object.prototype.hasOwnProperty.call(object, key);
}

function baseTierConfiguration(draft: CardDesignerDraft): RawTierUpgrade {
  const config: RawTierUpgrade = { effects: cloneJson(draft.def.effects) };
  const writable = config as Record<string, unknown>;
  for (const key of ['aura', 'speedWeight', 'cooldownTurns', 'scope'] as const) {
    const value = draft.def[key];
    if (value !== undefined) writable[key] = cloneJson(value);
  }
  return config;
}

function activeEffects(effects: readonly RawEffect[], tier: SkillTier, stripTierLock = false): RawEffect[] {
  return effects
    .filter((effect) => actionExistsAtTier(effect as Action, tier))
    .map((effect) => {
      if (!stripTierLock) return cloneJson(effect);
      const { minTier: _minTier, ...active } = effect;
      return cloneJson(active as RawEffect);
    });
}

/** Replace the effects active at `tier` without discarding future-locked
 * actions carried by the predecessor. Locked actions keep their relative
 * authored positions; extra replacement actions append after that skeleton. */
function replaceActiveEffects(
  predecessor: readonly RawEffect[],
  replacement: readonly RawEffect[],
  tier: SkillTier,
): RawEffect[] {
  const next: RawEffect[] = [];
  let replacementIndex = 0;
  for (const effect of predecessor) {
    if (actionExistsAtTier(effect as Action, tier)) {
      const substitute = replacement[replacementIndex];
      if (substitute !== undefined) next.push(cloneJson(substitute));
      replacementIndex += 1;
    } else {
      next.push(cloneJson(effect));
    }
  }
  while (replacementIndex < replacement.length) {
    next.push(cloneJson(replacement[replacementIndex]!));
    replacementIndex += 1;
  }
  return next;
}

function sequentialTierConfigurations(draft: CardDesignerDraft): Partial<Record<SkillTier, RawTierUpgrade>> {
  const configurations: Partial<Record<SkillTier, RawTierUpgrade>> = {};
  const baseIndex = TIER_ORDER.indexOf(draft.def.tier);
  let previous = baseTierConfiguration(draft);
  configurations[draft.def.tier] = previous;

  for (let index = baseIndex + 1; index < TIER_ORDER.length; index += 1) {
    const tier = TIER_ORDER[index]!;
    if (tier === 'bronze') continue;
    const explicit = draft.def.tierUpgrades?.[tier];
    const ownEffects = hasOwn(explicit, 'effects');
    const next: RawTierUpgrade = explicit === undefined ? {} : cloneJson(explicit);
    const writable = next as Record<string, unknown>;
    const explicitEffects = explicit?.effects ?? [];
    const carriesFutureLocks = explicitEffects.some((effect) => !actionExistsAtTier(effect as Action, tier));
    next.effects = ownEffects
      ? carriesFutureLocks
        ? cloneJson(explicitEffects)
        : replaceActiveEffects(previous.effects ?? [], activeEffects(explicitEffects, tier), tier)
      : cloneJson(previous.effects ?? []);
    for (const key of ['aura', 'speedWeight', 'cooldownTurns', 'scope'] as const) {
      const value = hasOwn(explicit, key) ? explicit![key] : previous[key];
      if (value === undefined) delete writable[key];
      else writable[key] = cloneJson(value);
    }
    configurations[tier] = next;
    previous = next;
  }
  return configurations;
}

/** The selected tier's editor-visible configuration. Missing fields inherit
 * sequentially from the previous reachable tier; raw override presence remains
 * the marker that a field has been customized. */
export function tierConfigurationAt(draft: CardDesignerDraft, tier: SkillTier): RawTierUpgrade {
  const configurations = sequentialTierConfigurations(draft);
  const configuration = cloneJson(configurations[tier] ?? configurations[draft.def.tier] ?? baseTierConfiguration(draft));
  configuration.effects = activeEffects(configuration.effects ?? [], tier, tier !== draft.def.tier);
  return configuration;
}

export function tierIsCustomized(draft: CardDesignerDraft, tier: SkillTier): boolean {
  if (tier === draft.def.tier) return true;
  if (tier === 'bronze') return false;
  const explicit = draft.def.tierUpgrades?.[tier];
  return explicit !== undefined && Object.keys(explicit).length > 0;
}

function materializedDef(draft: CardDesignerDraft): CardDesignerDef {
  const def = cloneJson(draft.def);
  const configurations = sequentialTierConfigurations(draft);
  const upgrades: Partial<Record<NonBronzeTier, RawTierUpgrade>> = {};
  const baseIndex = TIER_ORDER.indexOf(def.tier);
  for (let index = baseIndex + 1; index < TIER_ORDER.length; index += 1) {
    const tier = TIER_ORDER[index]!;
    if (tier === 'bronze') continue;
    const configuration = cloneJson(configurations[tier]!);
    configuration.effects = activeEffects(configuration.effects ?? [], tier, true);
    upgrades[tier] = configuration;
  }
  if (Object.keys(upgrades).length === 0) delete def.tierUpgrades;
  else def.tierUpgrades = upgrades;
  return def;
}

/** The full multi-tier document shape `src/data/content/skills.v1.json`
 * entries use — exactly what `validateSkillDocument` and the download button
 * both consume. */
export function cardDesignerDocument(draft: CardDesignerDraft): { schemaVersion: 1; cards: unknown[] } {
  return {
    schemaVersion: 1,
    cards: [{ id: draft.id, versions: [{ version: 1, def: materializedDef(draft) }] }],
  };
}

export function exportJsonText(draft: CardDesignerDraft): string {
  return JSON.stringify(cardDesignerDocument(draft), null, 2);
}

/** Schema problems, straight from the real validator — never re-derived. */
export function validationProblems(draft: CardDesignerDraft): ContentProblem[] {
  return validateSkillDocument(cardDesignerDocument(draft));
}

/** The draft resolved to a real engine `SkillDef` at `tier` — the ONE place a
 * draft becomes something the pricer/preview can read, via the real
 * `applyTier`. The editor materializes sequential tier configurations first,
 * so the form, preview, meter, validator and export all read the same kit. */
export function resolvedAt(draft: CardDesignerDraft, tier: SkillTier): SkillDef {
  const base = { id: draft.id, ...materializedDef(draft) } as unknown as SkillDef;
  return applyTier(base, tier);
}

export interface TierMeter {
  tier: SkillTier;
  plDeci: number;
  budgetDeci: number;
  deltaDeci: number;
  onBudget: boolean;
  breakdown: PlBreakdownPart[];
  violations: string[];
}

/** The meter for one tier — spend, budget, delta, itemized breakdown and any
 * cap violations, all read from the real pricer against the real resolved
 * kit. Throws only if `resolvedAt` itself throws (caller wraps display in a
 * try/catch — an in-progress edit can be transiently unrenderable). */
export function tierMeter(draft: CardDesignerDraft, tier: SkillTier): TierMeter {
  const resolved = resolvedAt(draft, tier);
  const plDeci = powerLevelDeci(resolved);
  const budgetDeci = TIER_BUDGET_DECI[tier];
  return {
    tier,
    plDeci,
    budgetDeci,
    deltaDeci: plDeci - budgetDeci,
    onBudget: isOnBudget(resolved),
    breakdown: powerLevelBreakdown(resolved),
    violations: capViolations(resolved),
  };
}

/** Every tier this card can reach, from its authored minimum upward. */
export function reachableTiers(draft: CardDesignerDraft): SkillTier[] {
  return TIER_ORDER.slice(TIER_ORDER.indexOf(draft.def.tier));
}

export interface ExportGate {
  ready: boolean;
  problems: ContentProblem[];
  /** Per reachable tier, only the ones that are NOT clean (empty when ready). */
  failingTiers: Array<{ tier: SkillTier; reason: string }>;
}

/** Whether COPY/DOWNLOAD may enable: clean schema AND every reachable tier
 * exactly on budget with no cap violation (USER RULING — bounds behaviour). */
export function exportGate(draft: CardDesignerDraft): ExportGate {
  const problems = validationProblems(draft);
  const failingTiers: Array<{ tier: SkillTier; reason: string }> = [];
  for (const tier of reachableTiers(draft)) {
    try {
      const meter = tierMeter(draft, tier);
      if (!meter.onBudget) {
        const sign = meter.deltaDeci > 0 ? '+' : '';
        failingTiers.push({ tier, reason: `${sign}${(meter.deltaDeci / 10).toFixed(1)} PL off budget` });
      } else if (meter.violations.length > 0) {
        failingTiers.push({ tier, reason: meter.violations[0]! });
      }
    } catch (err) {
      failingTiers.push({ tier, reason: err instanceof Error ? err.message : 'could not be priced' });
    }
  }
  return { ready: problems.length === 0 && failingTiers.length === 0, problems, failingTiers };
}

// ---------------------------------------------------------------------------
// Effect list editing (palette clicks — no JSON round-trip needed)
// ---------------------------------------------------------------------------

function layerEffects(draft: CardDesignerDraft, tier: SkillTier): RawEffect[] {
  if (tier === draft.def.tier) return draft.def.effects;
  return sequentialTierConfigurations(draft)[tier]?.effects ?? [];
}

function visibleEffectEntries(draft: CardDesignerDraft, tier: SkillTier): Array<{ effect: RawEffect; rawIndex: number }> {
  const entries: Array<{ effect: RawEffect; rawIndex: number }> = [];
  layerEffects(draft, tier).forEach((effect, rawIndex) => {
    if (actionExistsAtTier(effect as Action, tier)) entries.push({ effect, rawIndex });
  });
  return entries;
}

function withLayerEffects(draft: CardDesignerDraft, tier: SkillTier, effects: RawEffect[]): CardDesignerDraft {
  if (tier === draft.def.tier) {
    return { ...draft, def: { ...draft.def, effects } };
  }
  const nt = tier as NonBronzeTier;
  const existing = draft.def.tierUpgrades?.[nt] ?? {};
  return {
    ...draft,
    def: { ...draft.def, tierUpgrades: { ...draft.def.tierUpgrades, [nt]: { ...existing, effects } } },
  };
}

export function withEffectAdded(draft: CardDesignerDraft, tier: SkillTier, kind: string): CardDesignerDraft {
  const effect: RawEffect = { kind };
  if (kind in KEYWORD_TEXT) {
    const actionKind = kind as Action['kind'];
    const ctx = editorContextFor(draft, tier);
    for (const field of editableFieldsFor(actionKind, ctx)) effect[field.key] = field.default;
    for (const selector of selectorsFor(actionKind, ctx)) effect[selector.key] = selector.default;
  }
  return withLayerEffects(draft, tier, [...layerEffects(draft, tier), effect]);
}

export function hasEffectKind(draft: CardDesignerDraft, tier: SkillTier, kind: string): boolean {
  return visibleEffectEntries(draft, tier).some(({ effect }) => effect.kind === kind);
}

export function withEffectToggled(draft: CardDesignerDraft, tier: SkillTier, kind: string): CardDesignerDraft {
  const effects = layerEffects(draft, tier);
  if (!visibleEffectEntries(draft, tier).some(({ effect }) => effect.kind === kind)) return withEffectAdded(draft, tier, kind);
  return withLayerEffects(draft, tier, effects.filter((effect) => effect.kind !== kind || !actionExistsAtTier(effect as Action, tier)));
}

export function withStatDebuffAdded(draft: CardDesignerDraft, tier: SkillTier): CardDesignerDraft {
  const usedStats = new Set(effectsAt(draft, tier)
    .filter((effect) => effect.kind === 'debuffStat' && typeof effect.stat === 'string')
    .map((effect) => effect.stat as string));
  const next = withEffectAdded(draft, tier, 'debuffStat');
  const index = effectsAt(next, tier).length - 1;
  const effect = effectsAt(next, tier)[index]!;
  const selector = selectorsFor('debuffStat', editorContextForEffect(next, tier, effect))
    .find((field) => field.key === 'stat');
  const current = typeof effect.stat === 'string' ? effect.stat : selector?.default;
  if (current !== undefined && !usedStats.has(current)) return next;
  const unused = selector?.options.find((stat) => !usedStats.has(stat));
  return unused === undefined ? next : setEffectSelector(next, tier, index, 'stat', unused);
}

export function withEffectRemoved(draft: CardDesignerDraft, tier: SkillTier, index: number): CardDesignerDraft {
  const next = layerEffects(draft, tier).slice();
  const rawIndex = visibleEffectEntries(draft, tier)[index]?.rawIndex;
  if (rawIndex === undefined) return draft;
  next.splice(rawIndex, 1);
  return withLayerEffects(draft, tier, next);
}

export function effectsAt(draft: CardDesignerDraft, tier: SkillTier): readonly RawEffect[] {
  return visibleEffectEntries(draft, tier).map(({ effect }) => effect);
}

/** This tier's sequentially inherited `scope` for pricing/editor bounds. */
function layerScope(draft: CardDesignerDraft, tier: SkillTier): 'one' | 'all' | undefined {
  return tierConfigurationAt(draft, tier).scope as 'one' | 'all' | undefined;
}

/** The `EditorContext` `editableFieldsFor`/`KEYWORD_EDITOR` bounds-checking
 * needs for THIS draft at THIS tier — live, not the static table's
 * conservative size-1/worst-property floor (`editor.ts`'s own doc comment).
 * `values` are the effect's OWN current fields, so a field's live max is
 * solved against its siblings' actual values, not their defaults. */
export function editorContextFor(
  draft: CardDesignerDraft,
  tier: SkillTier,
  effectValues?: Readonly<Record<string, number>>,
  flags?: Readonly<Record<string, boolean>>,
): EditorContext {
  return {
    property: draft.def.property as Property,
    size: draft.def.size as SkillSize,
    tier,
    scope: layerScope(draft, tier),
    values: effectValues,
    flags,
  };
}

function numericFieldsOf(effect: RawEffect): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(effect)) if (typeof v === 'number') out[k] = v;
  return out;
}

function flagFieldsOf(effect: RawEffect): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(effect)) if (typeof v === 'boolean') out[k] = v;
  return out;
}

/** `editorContextFor`, pre-filled from one effect's own current values —
 * what a stepper/selector/flag control for THAT effect renders bounds from. */
export function editorContextForEffect(draft: CardDesignerDraft, tier: SkillTier, effect: RawEffect): EditorContext {
  return editorContextFor(draft, tier, numericFieldsOf(effect), flagFieldsOf(effect));
}

export function editableFieldsForEffect(
  draft: CardDesignerDraft,
  tier: SkillTier,
  effect: RawEffect,
): readonly EditableField[] {
  const kind = effect.kind as Action['kind'];
  const values = numericFieldsOf(effect);
  const flags = flagFieldsOf(effect);
  const fields = editableFieldsFor(kind, editorContextFor(draft, tier, undefined, flags));
  return fields.map((field) => {
    const siblingValues = { ...values };
    delete siblingValues[field.key];
    return editableFieldsFor(kind, editorContextFor(draft, tier, siblingValues, flags))
      .find((candidate) => candidate.key === field.key) ?? field;
  });
}

function updateEffectAt(draft: CardDesignerDraft, tier: SkillTier, index: number, patch: (effect: RawEffect) => RawEffect): CardDesignerDraft {
  const effects = layerEffects(draft, tier).slice();
  const rawIndex = visibleEffectEntries(draft, tier)[index]?.rawIndex;
  if (rawIndex === undefined) return draft;
  const current = effects[rawIndex];
  if (!current) return draft;
  effects[rawIndex] = patch(current);
  return withLayerEffects(draft, tier, effects);
}

export function setEffectField(draft: CardDesignerDraft, tier: SkillTier, index: number, key: string, value: number): CardDesignerDraft {
  return updateEffectAt(draft, tier, index, (effect) => ({ ...effect, [key]: value }));
}

export function setEffectSelector(draft: CardDesignerDraft, tier: SkillTier, index: number, key: string, value: string): CardDesignerDraft {
  return updateEffectAt(draft, tier, index, (effect) => ({ ...effect, [key]: value }));
}

export function toggleEffectFlag(draft: CardDesignerDraft, tier: SkillTier, index: number, key: string): CardDesignerDraft {
  return updateEffectAt(draft, tier, index, (effect) => {
    const next = { ...effect };
    if (next[key] === true) delete next[key]; else next[key] = true;
    return next;
  });
}

// ---------------------------------------------------------------------------
// Card-level and tier-override field editing (CARD_FIELDS / TIER_UPGRADE_FIELDS)
// ---------------------------------------------------------------------------

/** Sets a base-card field by `CARD_FIELDS` key. `id`/`name` are
 * handled by their own dedicated UI (the name prompt derives `id`); this
 * covers property/size/rarity/archetypes/speedWeight/cooldownTurns/scope. */
export function setCardField(draft: CardDesignerDraft, key: string, value: unknown): CardDesignerDraft {
  const nextDef = { ...draft.def } as Record<string, unknown>;
  if (value === undefined) delete nextDef[key];
  else nextDef[key] = value;
  if (key === 'property' && value === 'physical') {
    delete nextDef.element;
    if (!(WEAPON_OPTIONS as readonly unknown[]).includes(nextDef.weapon)) nextDef.weapon = WEAPON_OPTIONS[0]!;
  } else if (key === 'property' && value === 'magical') {
    delete nextDef.weapon;
    if (!(ELEMENT_OPTIONS as readonly unknown[]).includes(nextDef.element)) nextDef.element = ELEMENT_OPTIONS[0]!;
  }
  return { ...draft, def: nextDef as unknown as CardDesignerDef };
}

export function toggleArchetype(draft: CardDesignerDraft, value: string): CardDesignerDraft {
  const list = draft.def.archetypes;
  const next = list.includes(value) ? list.filter((a) => a !== value) : [...list, value];
  return { ...draft, def: { ...draft.def, archetypes: next } };
}

/** ONE combined "type" control cycling `CARD_TYPE_OPTIONS` (weapons then
 * elements, `editor.ts`) — a card carries exactly one of `weapon`/`element`
 * (`validateSkillContent`), so picking either clears the other. */
export function setCardType(draft: CardDesignerDraft, value: string): CardDesignerDraft {
  const isWeapon = (WEAPON_OPTIONS as readonly string[]).includes(value);
  const { element: _e, weapon: _w, ...rest } = draft.def;
  return { ...draft, def: { ...(rest as CardDesignerDef), ...(isWeapon ? { weapon: value } : { element: value }) } };
}

/** Sets/clears a `tierUpgrades[tier]` override field (scope/cooldownTurns/
 * speedWeight — `TIER_UPGRADE_FIELDS`'s number/enum controls). `undefined`
 * removes the override so the tier falls back to the base card's value. */
export function setTierUpgradeField(
  draft: CardDesignerDraft,
  tier: NonBronzeTier,
  key: 'speedWeight' | 'cooldownTurns' | 'scope',
  value: unknown,
): CardDesignerDraft {
  const existing = { ...(draft.def.tierUpgrades?.[tier] ?? {}) } as Record<string, unknown>;
  if (value === undefined) delete existing[key]; else existing[key] = value;
  return { ...draft, def: { ...draft.def, tierUpgrades: { ...draft.def.tierUpgrades, [tier]: existing as RawTierUpgrade } } };
}

// ---------------------------------------------------------------------------
// Raw JSON layer editing (the interim per-kind field surface)
// ---------------------------------------------------------------------------

/** The editable object for a tier tab: bronze is the whole base def (minus
 * `tierUpgrades`, which the other tabs own) with `id` folded in so it can be
 * renamed here too; silver/gold/diamond are that tier's `tierUpgrades` entry
 * (or `{}` if unauthored yet). */
export function layerObjectFor(draft: CardDesignerDraft, tier: SkillTier): Record<string, unknown> {
  if (tier === 'bronze') {
    const { tierUpgrades: _tu, ...rest } = draft.def;
    return { id: draft.id, ...rest };
  }
  return { ...(draft.def.tierUpgrades?.[tier as NonBronzeTier] ?? {}) };
}

export function layerObjectText(draft: CardDesignerDraft, tier: SkillTier): string {
  return JSON.stringify(layerObjectFor(draft, tier), null, 2);
}

/** Applies a parsed layer object back onto the draft. Returns the SAME shape
 * `JSON.parse` throws for malformed text — the caller (the scene) catches
 * that and shows it instead of applying anything. */
export function withLayerObject(draft: CardDesignerDraft, tier: SkillTier, parsed: unknown): CardDesignerDraft {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the layer must be a JSON object, e.g. {}');
  }
  const obj = parsed as Record<string, unknown>;
  if (tier === 'bronze') {
    const { id, ...rest } = obj;
    const nextId = typeof id === 'string' && id.trim() !== '' ? distinctDraftId(id) : draft.id;
    return { id: nextId, def: { ...(rest as unknown as CardDesignerDef), tierUpgrades: draft.def.tierUpgrades } };
  }
  const nt = tier as NonBronzeTier;
  return { ...draft, def: { ...draft.def, tierUpgrades: { ...draft.def.tierUpgrades, [nt]: obj as unknown as RawTierUpgrade } } };
}

/** Parses `text` and applies it via `withLayerObject`, surfacing a JSON parse
 * error as a plain string instead of throwing — the scene's one call site for
 * "the user pressed APPLY in the JSON editor". */
export function applyLayerText(
  draft: CardDesignerDraft,
  tier: SkillTier,
  text: string,
): { ok: true; draft: CardDesignerDraft } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    return { ok: true, draft: withLayerObject(draft, tier, parsed) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
