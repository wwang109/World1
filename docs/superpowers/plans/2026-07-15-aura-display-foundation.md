# Aura Display Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make currently active board auras persistently visible, toggleable, source-colored in combat logs, and selectable across player and multi-enemy boards.

**Architecture:** Add a pure presentation helper that converts an authoritative `AuraSource` plus `SkillDef` into label, accent, and polarity. `BattleScene` keeps persistent aura overlays separate from transient hover/selection overlays, derives current printed-board reach through Claude's canonical `auraAffectedTargetSlots`, and renders structured source tokens from existing `play.auras`. The future opponent-placed aura lifecycle remains blocked on Claude Request #8; it will supply active aura instances to the same overlay and log presentation functions rather than introduce a second UI path.

**Tech Stack:** TypeScript 5.8, Phaser 3.90, Vitest 3.2, existing `skillBook`, `AuraSource`, `auraAffectedTargetSlots`, and theme semantic color maps.

## Global Constraints

- Modify only `src/game/` and documentation; never edit `src/engine/`, `src/data/`, or `tests/`.
- Battle remains a dumb playback view. Do not infer placed-aura lifecycle, duration, removal, stacking, or combat math.
- Existing printed board auras are active from battle start and use `auraAffectedTargetSlots` for their current reach.
- `AURA VIEW` defaults on and hides persistent overlays only; hover and selected-log-row inspection can still reveal reach.
- Card accent is element color when present, otherwise property color.
- Positive/negative meaning must also use wording or signs; color is not the only signal.
- Preserve 720x1280 portrait layout and multi-enemy focus keyed by `(side, unit)`.
- Full opponent-placed auras and timed card/unit effects remain blocked until Claude marks Request #8 DONE.

---

### Task 1: Pure Aura Presentation Model

**Files:**
- Create: `src/game/ui/auraPresentation.ts`

**Interfaces:**
- Consumes: `AuraSource`, `SkillBook`, `SkillDef`, `ELEMENT_COLOR`, `PROPERTY_COLOR`, and `formatAuraModifiers`.
- Produces: `AuraTone`, `AuraSourcePresentation`, `skillAccent(skill)`, `auraTone(source)`, and `presentAuraSource(source, skillBook)`.

- [ ] **Step 1: Implement the pure presentation helper**

Create `src/game/ui/auraPresentation.ts`:

```ts
import type { AuraSource } from '../../engine/combat/events';
import type { SkillBook, SkillDef } from '../../engine/types';
import { ELEMENT_COLOR, PROPERTY_COLOR } from '../theme';
import { formatAuraModifiers } from './skillPresentation';

export type AuraTone = 'positive' | 'negative' | 'mixed' | 'neutral';

export interface AuraSourcePresentation {
  slot: number;
  skillId: string;
  label: string;
  modifier: string;
  accent: number;
  tone: AuraTone;
}

export function skillAccent(skill: SkillDef): number {
  return skill.element ? (ELEMENT_COLOR[skill.element] ?? PROPERTY_COLOR[skill.property]) : PROPERTY_COLOR[skill.property];
}

export function auraTone(source: AuraSource): AuraTone {
  const signs = [
    source.damageFlat ?? 0,
    source.healFlat ?? 0,
    -(source.weightDelta ?? 0),
    source.critPctDelta ?? 0,
  ].filter((value) => value !== 0).map(Math.sign);
  if (signs.length === 0) return 'neutral';
  if (signs.every((sign) => sign > 0)) return 'positive';
  if (signs.every((sign) => sign < 0)) return 'negative';
  return 'mixed';
}

export function presentAuraSource(source: AuraSource, book: SkillBook): AuraSourcePresentation {
  const skill = book[source.skillId];
  return {
    slot: source.slot,
    skillId: source.skillId,
    label: skill?.name ?? source.skillId,
    modifier: formatAuraModifiers(source, true),
    accent: skill ? skillAccent(skill) : PROPERTY_COLOR.true,
    tone: auraTone(source),
  };
}
```

- [ ] **Step 2: Run typecheck and the existing suite**

Run: `npm run typecheck`

Expected: clean TypeScript output.

Run: `npm test`

Expected: the boundary checker and existing suite pass. The repository's Vitest
configuration includes only `tests/**/*.test.ts`, while the working agreement
forbids Codex from editing `tests/`, so this pure UI helper is verified through
strict TypeScript plus its BattleScene integration.

- [ ] **Step 3: Commit the helper**

```bash
git add src/game/ui/auraPresentation.ts
git commit -m "feat: add aura presentation model"
```

---

### Task 2: Persistent Aura View and Multi-Board Overlays

**Files:**
- Modify: `src/game/scenes/BattleScene.ts`

**Interfaces:**
- Consumes: `skillAccent`, `auraAffectedTargetSlots`, each `SideView.pieces`, and card bounds recorded while constructing a board.
- Produces: `auraViewEnabled`, separate persistent/transient overlay collections, `refreshPersistentAuraOverlays()`, and `showAuraReach(side, unit, sourcePiece, persistent)`.

- [ ] **Step 1: Separate persistent and transient overlay state**

Replace the single `auraHighlightObjects` field with:

```ts
private auraViewEnabled = true;
private persistentAuraObjects: ViewObject[] = [];
private transientAuraObjects: ViewObject[] = [];
private auraToggle!: ButtonPair;
```

Add to `SideView`:

```ts
auraBounds: Map<number, { x: number; y: number; width: number; height: number }>;
```

Reset all four fields in `init()`. Record one exact card rectangle in
`auraBounds` for every board piece during `buildSideView`.

- [ ] **Step 2: Centralize reach rendering**

Move the local hover-only `showAuraReach` function out of `buildSideView` and
implement scene methods that:

```ts
private clearAuraObjects(objects: ViewObject[]): void {
  for (const object of objects) object.destroy();
  objects.length = 0;
}

private affectedAuraColor(source: AuraSourcePresentation): number {
  return source.tone === 'negative' ? UI.bad : source.tone === 'mixed' ? UI.waiting : UI.good;
}
```

`showAuraReach(side, unit, sourcePiece, persistent)` must resolve the source
skill, call `auraAffectedTargetSlots`, draw a 2 px source outline using
`skillAccent`, and draw 2 px left-edge markers on every affected card using the
positive/negative/mixed color. Persistent objects go into
`persistentAuraObjects`; hover and selected-row objects go into
`transientAuraObjects`. Every object must be visible only when its `SideView` is
visible, so hidden multi-enemy boards never leak overlays.

- [ ] **Step 3: Render all currently active printed auras**

After `this.views` is built and `focusEnemy(0)` has run, call
`refreshPersistentAuraOverlays()`. The method clears its old collection and,
when `auraViewEnabled`, iterates every player/enemy `SideView`, finds pieces whose
`skillBook[piece.skillId]?.aura` exists, and calls persistent reach rendering.

This task deliberately does not invent opponent-placed aura state. Claude's
future lifecycle events will provide additional active aura instances to this
same refresh path.

- [ ] **Step 4: Add the Aura View toggle without crowding playback controls**

Split the existing right-hand playback-control width into two controls:

```ts
const utilityX = feedX + 116;
const utilityW = feedW - 116;
this.auraToggle = this.makeButton(
  utilityX,
  playbackY,
  Math.floor(utilityW * 0.54),
  30,
  'AURA ON',
  UI.chip,
  '#ffffff',
  () => this.toggleAuraView(),
);
this.makeButton(
  utilityX + Math.floor(utilityW * 0.54) + 6,
  playbackY,
  utilityW - Math.floor(utilityW * 0.54) - 6,
  30,
  'END',
  UI.panelAlt,
  UI.text,
  () => this.finishPlayback(),
);
```

`toggleAuraView()` flips the boolean, updates `AURA ON`/`AURA OFF`, changes the
button fill, and refreshes only persistent overlays. Hover/selection remains
available while off.

- [ ] **Step 5: Preserve hover behavior and selected enemy visibility**

Update card pointer handlers to clear only transient overlays. Update
`focusEnemy()` to call one visibility-sync helper after switching boards, rather
than rebuilding overlays or changing aura state.

- [ ] **Step 6: Verify the scene compiles**

Run: `npm run typecheck`

Expected: clean TypeScript output.

Run: `npm run build`

Expected: Vite production build succeeds.

- [ ] **Step 7: Commit persistent overlays**

```bash
git add src/game/scenes/BattleScene.ts
git commit -m "feat: add persistent aura view"
```

---

### Task 3: Source-Colored Aura Log Terms and Row Highlighting

**Files:**
- Modify: `src/game/scenes/BattleScene.ts`

**Interfaces:**
- Consumes: `presentAuraSource(eventAura, skillBook)` and existing `play.auras`.
- Produces: structured `ActivationRow.auraSources`, tokenized source-colored calculation lines, and selected-row aura source/reach highlighting.

- [ ] **Step 1: Store structured aura sources on activation rows**

Replace `ActivationRow.auraLines: string[]` with:

```ts
auraSources: AuraSourcePresentation[];
```

When processing `event.kind === 'play'`, map every `event.auras` entry through
`presentAuraSource`. Formatting functions derive plain fallback text as:

```ts
const auraText = row.auraSources
  .map((source) => `AURA ${source.label}${source.modifier ? ` ${source.modifier}` : ''}`)
  .join(' + ');
```

- [ ] **Step 2: Tokenize the feed calculation line**

Extend `FeedCard` with `calculationTokens: Phaser.GameObjects.Text[]`. Before
refreshing a feed card, destroy its old tokens. For a row with aura sources,
render `AURA`, each source label, and each modifier as adjacent Text objects:

```ts
private renderFeedAuraTokens(card: FeedCard, row: ActivationRow): void {
  for (const token of card.calculationTokens) token.destroy();
  card.calculationTokens = [];
  let x = card.bg.x + 12;
  const y = card.calculation.y;
  const add = (text: string, color: string, bold = false): void => {
    const token = this.add.text(x, y, text, {
      fontSize: '8px', color, fontFamily: FONT.body,
      fontStyle: bold ? 'bold' : '',
    });
    card.container.add(token);
    card.calculationTokens.push(token);
    x += token.width + 4;
  };
  add('AURA', UI.textDim, true);
  for (const source of row.auraSources) {
    add(source.label, this.hexColor(source.accent), true);
    if (source.modifier) add(source.modifier, this.hexColor(source.accent));
  }
}
```

Crop the final token at the card's right inset. Keep the existing plain
`calculation` Text for damage formulas and rows without structured sources.

- [ ] **Step 3: Color selected-row source terms**

Replace the selected detail's plain first aura line with the same token pattern,
using `turnCalculationTokens`. Render signs and labels at readable sizes while
keeping the source name/modifier in `source.accent`. Do not tint the entire
calculation panel.

- [ ] **Step 4: Highlight contributing aura cards and their reach**

In `selectTurn(row)`, after the normal cast-card highlight, iterate
`row.auraSources`. Each source belongs to the casting `(side, unit)` under the
current `play.auras` contract. Highlight the source card in its accent and call
transient reach rendering for its board. Preserve persistent borders underneath;
selection overlays clear only when another row is selected.

- [ ] **Step 5: Verify source color and multi-enemy focus**

Run: `npm run typecheck`

Expected: clean TypeScript output.

Run: `npm run build`

Expected: Vite production build succeeds.

- [ ] **Step 6: Commit source-colored logs**

```bash
git add src/game/scenes/BattleScene.ts
git commit -m "feat: color aura sources in combat logs"
```

---

### Task 4: Mobile Visual Verification and Handoff

**Files:**
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`
- Create: `docs/screenshots/battle-aura-view.png`
- Create: `docs/screenshots/battle-aura-log-source.png`

**Interfaces:**
- Consumes: the completed persistent overlays and structured log rendering.
- Produces: verified screenshots and an accurate Claude handoff entry that keeps Request #8 pending.

- [ ] **Step 1: Run all automated gates**

Run: `npm run typecheck`

Expected: clean.

Run: `npm run build`

Expected: pass.

Run: `npm test`

Expected: boundary checker passes and all tests pass, including the new UI helper tests.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 2: Exercise portrait combat states**

Open `http://127.0.0.1:4174/?scene=battle&enemy=bandit_duelist&seed=1` and
`http://127.0.0.1:4174/?scene=multi`. Confirm at 720x1280:

- Aura borders are visible from battle start.
- `AURA OFF` removes persistent borders but hover/selected-row inspection works.
- Selecting a buffed play highlights the cast card, aura source, and reached cards.
- Source labels and modifiers match the source card accent without coloring the whole row.
- Switching focused enemies never leaves overlays over the hidden board.
- Playback `1x`, `2x`, and `END` remain usable with no clipped labels.
- No runtime, layout-audit, or overflow errors occur.

- [ ] **Step 3: Capture reference screenshots**

Save the visible battle state with Aura View on and a selected aura-contributed
play to the two screenshot paths listed above.

- [ ] **Step 4: Update documentation and handoff**

Document `AURA VIEW`, source-colored terms, current printed-board coverage, and
the explicit limitation that placed-aura lifecycle/timed effects await Claude
Request #8. Add verification commands, counts, routes, and screenshots to the
newest handoff entry.

- [ ] **Step 5: Commit documentation and screenshots**

```bash
git add docs/codex-ui-guide.md docs/codex-handoff.md docs/screenshots/battle-aura-view.png docs/screenshots/battle-aura-log-source.png
git commit -m "docs: record aura display verification"
```
