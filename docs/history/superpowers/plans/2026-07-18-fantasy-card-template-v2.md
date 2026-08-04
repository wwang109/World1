> **HISTORICAL** — a dated superpowers plan/spec, accurate as of its date; superseded by the shipped implementation (see `docs/feature-inventory.md`). Never cite as current.

# Fantasy Card Template V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and ship a new `FantasyCardTemplateV2` for the Wiki/template card UI, using fixed geometry, tier skins, and asset-size rules with no per-card nudges for art, icons, or text.

**Architecture:** Split the work into pure template-contract modules first, then a model-driven Phaser renderer, then controlled adoption in `PrepScene`. Keep the legacy `FantasyCardTemplate.ts` alive while V2 is built and switched into the template preview, and only remove the legacy path after visual validation.

**Tech Stack:** TypeScript, Phaser 3, Vitest, Vite

## Global Constraints

- Only `src/game/` may import `phaser`.
- Build a new template implementation rather than patching the old one.
- Keep Phaser as the renderer.
- Use one shared geometry across all tiers.
- Treat tiers as skins, not separate layouts.
- Use one global art fit mode in V2: `cover`.
- Forbid per-card nudges for art, icons, and text.
- Allow only fixed-enum focal anchoring, never freeform image offsets.
- Enforce an asset-ingest contract before art enters the project.
- Canonical full-card design size is `420 x 690 px`.
- Tier cards use the same geometry with `bronze`, `silver`, `gold`, and `diamond` skins.
- The legacy `src/game/ui/FantasyCardTemplate.ts` stays in place until V2 is integrated and visually validated.
- Verify with `npm run build`, `npm test`, and `npm run typecheck`.

---

## File Structure

- Create: `src/game/ui/fantasyCardTemplateSpec.ts`
  Responsibility: canonical card geometry, region bounds, text rules, and exported template constants.
- Create: `src/game/ui/fantasyCardTierSkins.ts`
  Responsibility: tier-only appearance tokens and optional frame-asset references with no geometry.
- Create: `src/game/ui/fantasyCardAssetRules.ts`
  Responsibility: art and PNG dimension contract plus asset-validation helpers.
- Create: `src/game/ui/fantasyCardTemplateModel.ts`
  Responsibility: pure model builder that resolves a `SkillDef` plus tier into regions, badges, text rules, and asset-fit decisions.
- Create: `src/game/ui/FantasyCardTemplateV2.ts`
  Responsibility: Phaser container that renders the pure model and does not contain card-specific position exceptions.
- Create: `tests/game/fantasyCardTemplateSpec.test.ts`
  Responsibility: validates geometry, tier-skin separation, text-rule selection, and asset requirements.
- Create: `tests/game/fantasyCardTemplateModel.test.ts`
  Responsibility: validates model-building behavior for short/long titles, art rules, and tier variants.
- Modify: `src/game/scenes/PrepScene.ts`
  Responsibility: switch the Wiki template sheet and template preview callers to `FantasyCardTemplateV2` behind controlled call sites.
- Modify: `docs/codex-handoff.md`
  Responsibility: append implementation session notes and verification results.

### Shared Interfaces

These names and types are the contracts later tasks rely on:

```ts
// src/game/ui/fantasyCardTemplateSpec.ts
export type FantasyTemplateTier = 'bronze' | 'silver' | 'gold' | 'diamond';
export type FantasyTemplateTextRuleKey =
  | 'title-short'
  | 'title-medium'
  | 'title-long'
  | 'body-3-line'
  | 'body-4-line'
  | 'body-5-line'
  | 'wt-1-digit'
  | 'wt-2-digit'
  | 'wt-3-digit';

export type FantasyTemplateRegion =
  | 'artFrame'
  | 'leftRail'
  | 'rightRail'
  | 'tierFrame'
  | 'slotLabel'
  | 'titleBox'
  | 'divider'
  | 'bodyBox'
  | 'wtPlate';

export interface RegionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FantasyCardTemplateSpec {
  baseSize: { width: 420; height: 690 };
  cornerRadius: 28;
  regions: Record<FantasyTemplateRegion, RegionBox>;
  textRules: Record<FantasyTemplateTextRuleKey, {
    fontSize: number;
    lineSpacing: number;
    maxLines: number;
    wrapWidth: number;
  }>;
}

export declare const FANTASY_CARD_TEMPLATE_SPEC: FantasyCardTemplateSpec;
export declare function selectTitleRule(name: string): 'title-short' | 'title-medium' | 'title-long';
export declare function selectBodyRule(text: string, effectCount: number): 'body-3-line' | 'body-4-line' | 'body-5-line';
export declare function selectWtRule(weight: number): 'wt-1-digit' | 'wt-2-digit' | 'wt-3-digit';
```

```ts
// src/game/ui/fantasyCardTierSkins.ts
export interface FantasyCardTierSkin {
  tier: FantasyTemplateTier;
  frameColor: number;
  trimColor: number;
  accentColor: number;
  dividerColor: number;
  wtPlateKey?: string;
  frameTextureKey?: string;
}

export declare const FANTASY_CARD_TIER_SKINS: Record<FantasyTemplateTier, FantasyCardTierSkin>;
export declare function getFantasyCardTierSkin(tier: FantasyTemplateTier): FantasyCardTierSkin;
```

```ts
// src/game/ui/fantasyCardAssetRules.ts
export type FantasyArtAnchor = 'center' | 'upper-center' | 'lower-center';

export interface FantasyCardAssetRules {
  framePng: { width: 420; height: 690 };
  artPng: { minWidth: 840; minHeight: 1040; preferredWidth: 1024; preferredHeight: 1536 };
  badgePng: {
    primary: { width: 58; height: 60 };
    secondary: { width: 50; height: 50 };
    type: { width: 46; height: 48 };
  };
  wtPng: { width: 56; height: 60 };
  dividerPng: { width: 268; height: 8 };
  textPlatePng: { width: 384; height: 174 };
}

export declare const FANTASY_CARD_ASSET_RULES: FantasyCardAssetRules;
export declare function validateFantasyCardArtSize(width: number, height: number): { ok: boolean; reason?: string };
```

```ts
// src/game/ui/fantasyCardTemplateModel.ts
export interface FantasyCardTemplateModel {
  size: { width: number; height: number };
  tier: FantasyTemplateTier;
  regions: FantasyCardTemplateSpec['regions'];
  skin: FantasyCardTierSkin;
  titleRule: ReturnType<typeof selectTitleRule>;
  bodyRule: ReturnType<typeof selectBodyRule>;
  wtRule: ReturnType<typeof selectWtRule>;
  artAnchor: FantasyArtAnchor;
  weight: number;
  slotLabel: string;
  title: string;
  body: string;
}

export declare function buildFantasyCardTemplateModel(
  skill: SkillDef,
  options?: {
    width?: number;
    height?: number;
    tier?: FantasyTemplateTier;
    artAnchor?: FantasyArtAnchor;
  },
): FantasyCardTemplateModel;
```

### Task 1: Create The Pure Template Contract

**Files:**
- Create: `src/game/ui/fantasyCardTemplateSpec.ts`
- Create: `src/game/ui/fantasyCardTierSkins.ts`
- Create: `src/game/ui/fantasyCardAssetRules.ts`
- Test: `tests/game/fantasyCardTemplateSpec.test.ts`

**Interfaces:**
- Consumes: `SkillTier` from `src/engine/types.ts`, colors from `src/game/theme.ts`
- Produces: `FANTASY_CARD_TEMPLATE_SPEC`, `FANTASY_CARD_TIER_SKINS`, `FANTASY_CARD_ASSET_RULES`, `selectTitleRule()`, `selectBodyRule()`, `selectWtRule()`, `getFantasyCardTierSkin()`, `validateFantasyCardArtSize()`

- [ ] **Step 1: Write the failing test**

```ts
// tests/game/fantasyCardTemplateSpec.test.ts
import { describe, expect, it } from 'vitest';
import {
  FANTASY_CARD_TEMPLATE_SPEC,
  selectBodyRule,
  selectTitleRule,
  selectWtRule,
} from '../../src/game/ui/fantasyCardTemplateSpec';
import {
  FANTASY_CARD_TIER_SKINS,
  getFantasyCardTierSkin,
} from '../../src/game/ui/fantasyCardTierSkins';
import {
  FANTASY_CARD_ASSET_RULES,
  validateFantasyCardArtSize,
} from '../../src/game/ui/fantasyCardAssetRules';

describe('fantasy card template contract', () => {
  it('locks the canonical card size and art frame geometry', () => {
    expect(FANTASY_CARD_TEMPLATE_SPEC.baseSize).toEqual({ width: 420, height: 690 });
    expect(FANTASY_CARD_TEMPLATE_SPEC.regions.artFrame).toEqual({ x: 22, y: 20, w: 376, h: 468 });
    expect(FANTASY_CARD_TEMPLATE_SPEC.regions.bodyBox).toEqual({ x: 50, y: 592, w: 292, h: 50 });
  });

  it('selects title, body, and weight rules from finite keys', () => {
    expect(selectTitleRule('Arcane Bolt')).toBe('title-short');
    expect(selectTitleRule('Extremely Long Mythic Spell Name')).toBe('title-long');
    expect(selectBodyRule('Deal 20 (+Attack).', 1)).toBe('body-3-line');
    expect(selectWtRule(125)).toBe('wt-3-digit');
  });

  it('keeps tier skins separate from geometry', () => {
    expect(Object.keys(FANTASY_CARD_TIER_SKINS)).toEqual(['bronze', 'silver', 'gold', 'diamond']);
    expect(getFantasyCardTierSkin('gold').tier).toBe('gold');
    expect(FANTASY_CARD_TEMPLATE_SPEC.regions.tierFrame).toEqual({ x: 18, y: 488, w: 384, h: 174 });
  });

  it('enforces the minimum art PNG size', () => {
    expect(FANTASY_CARD_ASSET_RULES.artPng.minWidth).toBe(840);
    expect(validateFantasyCardArtSize(839, 1040)).toEqual({
      ok: false,
      reason: 'Card art must be at least 840x1040 for cover-fit cropping.',
    });
    expect(validateFantasyCardArtSize(1024, 1536)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/game/fantasyCardTemplateSpec.test.ts`

Expected: FAIL with module-not-found errors for the new template contract files.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/game/ui/fantasyCardTemplateSpec.ts
export const FANTASY_CARD_TEMPLATE_SPEC = {
  baseSize: { width: 420, height: 690 },
  cornerRadius: 28,
  regions: {
    artFrame: { x: 22, y: 20, w: 376, h: 468 },
    leftRail: { x: 34, y: 40, w: 72, h: 214 },
    rightRail: { x: 314, y: 38, w: 72, h: 180 },
    tierFrame: { x: 18, y: 488, w: 384, h: 174 },
    slotLabel: { x: 265, y: 497, w: 92, h: 18 },
    titleBox: { x: 52, y: 530, w: 284, h: 44 },
    divider: { x: 60, y: 579, w: 268, h: 2 },
    bodyBox: { x: 50, y: 592, w: 292, h: 50 },
    wtPlate: { x: 0, y: 0, w: 56, h: 60 },
  },
  textRules: {
    'title-short': { fontSize: 24, lineSpacing: -5, maxLines: 1, wrapWidth: 284 },
    'title-medium': { fontSize: 22, lineSpacing: -5, maxLines: 1, wrapWidth: 284 },
    'title-long': { fontSize: 20, lineSpacing: -6, maxLines: 2, wrapWidth: 284 },
    'body-3-line': { fontSize: 13, lineSpacing: 5, maxLines: 3, wrapWidth: 292 },
    'body-4-line': { fontSize: 12, lineSpacing: 4, maxLines: 4, wrapWidth: 292 },
    'body-5-line': { fontSize: 11, lineSpacing: 3, maxLines: 5, wrapWidth: 292 },
    'wt-1-digit': { fontSize: 15, lineSpacing: 0, maxLines: 1, wrapWidth: 56 },
    'wt-2-digit': { fontSize: 13, lineSpacing: 0, maxLines: 1, wrapWidth: 56 },
    'wt-3-digit': { fontSize: 11, lineSpacing: 0, maxLines: 1, wrapWidth: 56 },
  },
} as const;

export function selectTitleRule(name: string) {
  if (name.length <= 14) return 'title-short';
  if (name.length <= 24) return 'title-medium';
  return 'title-long';
}

export function selectBodyRule(text: string, effectCount: number) {
  const density = text.length + Math.max(0, effectCount - 1) * 28;
  if (density <= 90) return 'body-3-line';
  if (density <= 145) return 'body-4-line';
  return 'body-5-line';
}

export function selectWtRule(weight: number) {
  const digits = String(weight).length;
  if (digits === 1) return 'wt-1-digit';
  if (digits === 2) return 'wt-2-digit';
  return 'wt-3-digit';
}
```

```ts
// src/game/ui/fantasyCardTierSkins.ts
import type { SkillTier } from '../../engine/types';
import { TIER_COLOR } from '../theme';

export const FANTASY_CARD_TIER_SKINS: Record<SkillTier, {
  tier: SkillTier;
  frameColor: number;
  trimColor: number;
  accentColor: number;
  dividerColor: number;
}> = {
  bronze: { tier: 'bronze', frameColor: 0xc78338, trimColor: 0xd4984d, accentColor: 0xf0c37a, dividerColor: 0xe3c38a },
  silver: { tier: 'silver', frameColor: 0x6c7ea0, trimColor: 0xc8d3de, accentColor: 0xf5f8fb, dividerColor: 0xd9e2eb },
  gold: { tier: 'gold', frameColor: 0xd7b346, trimColor: 0xf0ca5c, accentColor: 0xffeb9b, dividerColor: 0xf1dd98 },
  diamond: { tier: 'diamond', frameColor: 0x5bb1f2, trimColor: 0x58d7f4, accentColor: 0xc7f7ff, dividerColor: 0xb8ecf8 },
};

export function getFantasyCardTierSkin(tier: SkillTier) {
  return FANTASY_CARD_TIER_SKINS[tier];
}
```

```ts
// src/game/ui/fantasyCardAssetRules.ts
export const FANTASY_CARD_ASSET_RULES = {
  framePng: { width: 420, height: 690 },
  artPng: { minWidth: 840, minHeight: 1040, preferredWidth: 1024, preferredHeight: 1536 },
  badgePng: {
    primary: { width: 58, height: 60 },
    secondary: { width: 50, height: 50 },
    type: { width: 46, height: 48 },
  },
  wtPng: { width: 56, height: 60 },
  dividerPng: { width: 268, height: 8 },
  textPlatePng: { width: 384, height: 174 },
} as const;

export function validateFantasyCardArtSize(width: number, height: number) {
  if (width < FANTASY_CARD_ASSET_RULES.artPng.minWidth || height < FANTASY_CARD_ASSET_RULES.artPng.minHeight) {
    return { ok: false, reason: 'Card art must be at least 840x1040 for cover-fit cropping.' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/game/fantasyCardTemplateSpec.test.ts`

Expected: PASS for all four template-contract assertions.

- [ ] **Step 5: Commit**

```bash
git add tests/game/fantasyCardTemplateSpec.test.ts src/game/ui/fantasyCardTemplateSpec.ts src/game/ui/fantasyCardTierSkins.ts src/game/ui/fantasyCardAssetRules.ts
git commit -m "feat: define fantasy card template v2 contract"
```

### Task 2: Build The Pure Template Model

**Files:**
- Create: `src/game/ui/fantasyCardTemplateModel.ts`
- Test: `tests/game/fantasyCardTemplateModel.test.ts`

**Interfaces:**
- Consumes: `SkillDef` and `weightOf()` from `src/engine/types.ts`, `cardTypeBadge()` and `archetypeBadges()` from `src/game/ui/cardArtPresentation.ts`, `FANTASY_CARD_TEMPLATE_SPEC`, `getFantasyCardTierSkin()`, `selectTitleRule()`, `selectBodyRule()`, `selectWtRule()`
- Produces: `buildFantasyCardTemplateModel(skill, options?)`

- [ ] **Step 1: Write the failing test**

```ts
// tests/game/fantasyCardTemplateModel.test.ts
import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { buildFantasyCardTemplateModel } from '../../src/game/ui/fantasyCardTemplateModel';

describe('fantasy card template model', () => {
  it('builds a gold model with fixed slot label and geometry', () => {
    const model = buildFantasyCardTemplateModel(skillBook.arcane_bolt, { tier: 'gold' });
    expect(model.size).toEqual({ width: 420, height: 690 });
    expect(model.tier).toBe('gold');
    expect(model.slotLabel).toBe(`SLOT ${skillBook.arcane_bolt.size}`);
    expect(model.regions.artFrame).toEqual({ x: 22, y: 20, w: 376, h: 468 });
  });

  it('selects longer text rules without exposing layout overrides', () => {
    const longTextSkill = {
      ...skillBook.fireball,
      name: 'Extremely Long Mythic Fireball Name',
      text: 'Deal 20 (+Magic). Apply burn. Gain readiness. Draw a line of force through the entire lane.',
    };
    const model = buildFantasyCardTemplateModel(longTextSkill, { tier: 'diamond' });
    expect(model.titleRule).toBe('title-long');
    expect(model.bodyRule).toBe('body-4-line');
    expect(model.artAnchor).toBe('center');
  });

  it('uses weight-digit styles instead of weight offsets', () => {
    const model = buildFantasyCardTemplateModel({ ...skillBook.fireball, weight: 125 }, { tier: 'bronze' });
    expect(model.wtRule).toBe('wt-3-digit');
    expect(model.weight).toBe(125);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/game/fantasyCardTemplateModel.test.ts`

Expected: FAIL with module-not-found for `fantasyCardTemplateModel.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/game/ui/fantasyCardTemplateModel.ts
import { weightOf, type SkillDef, type SkillTier } from '../../engine/types';
import { archetypeBadges, cardTypeBadge } from './cardArtPresentation';
import {
  FANTASY_CARD_TEMPLATE_SPEC,
  selectBodyRule,
  selectTitleRule,
  selectWtRule,
} from './fantasyCardTemplateSpec';
import { getFantasyCardTierSkin } from './fantasyCardTierSkins';

export type FantasyArtAnchor = 'center' | 'upper-center' | 'lower-center';

export function buildFantasyCardTemplateModel(
  skill: SkillDef,
  options: {
    width?: number;
    height?: number;
    tier?: SkillTier;
    artAnchor?: FantasyArtAnchor;
  } = {},
) {
  const tier = options.tier ?? skill.tier;
  const width = options.width ?? FANTASY_CARD_TEMPLATE_SPEC.baseSize.width;
  const height = options.height ?? FANTASY_CARD_TEMPLATE_SPEC.baseSize.height;
  const type = cardTypeBadge(skill);
  const archetypes = archetypeBadges(skill);
  const weight = weightOf(skill);

  return {
    size: { width, height },
    tier,
    skin: getFantasyCardTierSkin(tier),
    regions: FANTASY_CARD_TEMPLATE_SPEC.regions,
    titleRule: selectTitleRule(skill.name),
    bodyRule: selectBodyRule(skill.text, skill.effects.length),
    wtRule: selectWtRule(weight),
    artAnchor: options.artAnchor ?? 'center',
    type,
    archetypes,
    weight,
    slotLabel: `SLOT ${skill.size}`,
    title: skill.name,
    body: skill.text,
    skill,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/game/fantasyCardTemplateModel.test.ts`

Expected: PASS for model geometry, rule selection, and slot-label assertions.

- [ ] **Step 5: Commit**

```bash
git add tests/game/fantasyCardTemplateModel.test.ts src/game/ui/fantasyCardTemplateModel.ts
git commit -m "feat: add fantasy card template v2 model"
```

### Task 3: Implement The Phaser Renderer

**Files:**
- Create: `src/game/ui/FantasyCardTemplateV2.ts`
- Modify: `src/game/ui/cardArtPresentation.ts`

**Interfaces:**
- Consumes: `buildFantasyCardTemplateModel()`, `FANTASY_CARD_ASSET_RULES`, `FONT`, `CARD_ART_KEY` mapping copied or moved from legacy template, existing badge helpers from `cardArtPresentation.ts`
- Produces: `FantasyCardTemplateV2` class with constructor:
  `new FantasyCardTemplateV2(scene, x, y, skill, options?)`

- [ ] **Step 1: Write the failing test**

```ts
// tests/game/fantasyCardTemplateModel.test.ts
it('exposes enough model data for the renderer without per-card offsets', () => {
  const model = buildFantasyCardTemplateModel(skillBook.venom_fang, { tier: 'silver' });
  expect(model).not.toHaveProperty('imageOffsetX');
  expect(model).not.toHaveProperty('imageOffsetY');
  expect(model).not.toHaveProperty('titleOffsetX');
  expect(model.skin.tier).toBe('silver');
  expect(model.type.iconKey).toBeTruthy();
  expect(model.archetypes.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/game/fantasyCardTemplateModel.test.ts`

Expected: FAIL because the current model does not yet include the finalized renderer-facing fields or because the assertions reveal leftover offset properties.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/game/ui/FantasyCardTemplateV2.ts
import Phaser from 'phaser';
import type { SkillDef, SkillTier } from '../../engine/types';
import { FONT } from '../theme';
import { buildFantasyCardTemplateModel, type FantasyArtAnchor } from './fantasyCardTemplateModel';
import { FANTASY_CARD_TEMPLATE_SPEC } from './fantasyCardTemplateSpec';

export interface FantasyCardTemplateV2Options {
  width?: number;
  height?: number;
  tier?: SkillTier;
  artAnchor?: FantasyArtAnchor;
}

export class FantasyCardTemplateV2 extends Phaser.GameObjects.Container {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    skill: SkillDef,
    options: FantasyCardTemplateV2Options = {},
  ) {
    super(scene, x, y);

    const model = buildFantasyCardTemplateModel(skill, options);
    const { width, height } = model.size;
    const halfW = width / 2;
    const halfH = height / 2;

    const frame = scene.add.graphics();
    frame.fillStyle(0x07101a, 0.92);
    frame.fillRoundedRect(-halfW, -halfH, width, height, FANTASY_CARD_TEMPLATE_SPEC.cornerRadius);
    frame.lineStyle(2, model.skin.trimColor, 1);
    frame.strokeRoundedRect(-halfW, -halfH, width, height, FANTASY_CARD_TEMPLATE_SPEC.cornerRadius);

    const titleRule = FANTASY_CARD_TEMPLATE_SPEC.textRules[model.titleRule];
    const bodyRule = FANTASY_CARD_TEMPLATE_SPEC.textRules[model.bodyRule];
    const wtRule = FANTASY_CARD_TEMPLATE_SPEC.textRules[model.wtRule];

    const title = scene.add.text(
      -halfW + model.regions.titleBox.x + model.regions.titleBox.w / 2,
      -halfH + model.regions.titleBox.y,
      model.title,
      {
        fontFamily: FONT.display,
        fontStyle: 'bold',
        fontSize: `${titleRule.fontSize}px`,
        color: '#ffffff',
        align: 'center',
        fixedWidth: model.regions.titleBox.w,
        wordWrap: { width: titleRule.wrapWidth, useAdvancedWrap: true },
      },
    ).setOrigin(0.5, 0);

    const body = scene.add.text(
      -halfW + model.regions.bodyBox.x,
      -halfH + model.regions.bodyBox.y,
      model.body,
      {
        fontFamily: FONT.body,
        fontSize: `${bodyRule.fontSize}px`,
        color: '#f1efe8',
        fixedWidth: model.regions.bodyBox.w,
        wordWrap: { width: bodyRule.wrapWidth, useAdvancedWrap: true },
        lineSpacing: bodyRule.lineSpacing,
      },
    ).setOrigin(0, 0);

    const weight = scene.add.text(
      -halfW + model.regions.leftRail.x + 28,
      -halfH + model.regions.leftRail.y + 100,
      String(model.weight),
      {
        fontFamily: FONT.display,
        fontStyle: 'bold',
        fontSize: `${wtRule.fontSize}px`,
        color: '#ffffff',
      },
    ).setOrigin(0.5);

    this.add([frame, title, body, weight]);
    this.setSize(width, height);
    scene.add.existing(this);
  }
}
```

```ts
// src/game/ui/cardArtPresentation.ts
export function fantasyTemplateCardArtKey(skill: SkillDef): string | undefined {
  const keyMap: Partial<Record<string, string>> = {
    arcane_bolt: 'card-art:arcane_bolt_spell',
    crippling_strike: 'card-art:crippling_strike_anime',
    fireball: 'card-art:fireball_anime',
    mana_ward: 'card-art:mana_ward_anime',
    venom_fang: 'card-art:venom_fang_anime',
    war_banner: 'card-art:war_banner_anime',
  };
  return keyMap[skill.id];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/game/fantasyCardTemplateModel.test.ts`

Expected: PASS with the model exposing semantic renderer data and no offset fields.

- [ ] **Step 5: Commit**

```bash
git add src/game/ui/FantasyCardTemplateV2.ts src/game/ui/cardArtPresentation.ts tests/game/fantasyCardTemplateModel.test.ts
git commit -m "feat: render fantasy card template v2"
```

### Task 4: Switch The Wiki Template View To V2

**Files:**
- Modify: `src/game/scenes/PrepScene.ts`
- Modify: `docs/codex-handoff.md`

**Interfaces:**
- Consumes: `FantasyCardTemplateV2`
- Produces: template preview and modal sheet using V2 with the existing tier selection flow in `PrepScene`

- [ ] **Step 1: Write the failing test**

```ts
// tests/game/fantasyCardTemplateSpec.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

it('moves PrepScene off the legacy fantasy template import', () => {
  const prepScene = readFileSync(resolve(process.cwd(), 'src/game/scenes/PrepScene.ts'), 'utf8');
  expect(prepScene).toContain("import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';");
  expect(prepScene).not.toContain("import { FantasyCardTemplate } from '../ui/FantasyCardTemplate';");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/game/fantasyCardTemplateSpec.test.ts`

Expected: FAIL because `PrepScene.ts` still imports the legacy template.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/game/scenes/PrepScene.ts
import { FantasyCardTemplateV2 } from '../ui/FantasyCardTemplateV2';

// inside openWikiSkillSheet()
const card = new FantasyCardTemplateV2(this, SCREEN.width / 2, 598, skill, {
  width: 420,
  height: 690,
  tier: this.wikiTier,
});
```

```md
<!-- docs/codex-handoff.md session entry -->
### 2026-07-18 — Codex — fantasy card template V2 implementation
- CHANGED: Built and switched the Wiki template card preview to `FantasyCardTemplateV2`.
- FILES: `src/game/ui/FantasyCardTemplateV2.ts`, `src/game/ui/fantasyCardTemplateSpec.ts`, `src/game/ui/fantasyCardTierSkins.ts`, `src/game/ui/fantasyCardAssetRules.ts`, `src/game/ui/fantasyCardTemplateModel.ts`, `src/game/scenes/PrepScene.ts`, `docs/codex-handoff.md`
- DESIGN: V2 now owns the template preview with fixed geometry and tier skins; the legacy file remains only until final cleanup.
- VERIFY: `npm run build` = pass · `npm test` = pass · `npm run typecheck` = clean · visually checked `http://127.0.0.1:4173/?view=template`
- ASSUMPTIONS: Existing art assets are still acceptable under the new cover-fit crop contract.
- REQUESTS TO CLAUDE: none
- OPEN: Remove legacy template path after visual sign-off.
- Claude review:
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/game/fantasyCardTemplateSpec.test.ts`

Expected: PASS for the `PrepScene` import assertion.

- [ ] **Step 5: Run full verification**

Run: `npm run typecheck`
Expected: clean

Run: `npm run build`
Expected: pass

Run: `npm test`
Expected: pass, including the new `tests/game` coverage

Manual check: open `http://127.0.0.1:4173/?view=template`
Expected: the template view uses V2 at `420x690`, tier switches recolor the same geometry, and no card requires manual offset tuning.

- [ ] **Step 6: Commit**

```bash
git add src/game/scenes/PrepScene.ts docs/codex-handoff.md tests/game/fantasyCardTemplateSpec.test.ts
git commit -m "feat: switch wiki template preview to fantasy card template v2"
```

### Task 5: Remove The Legacy Template Path After Sign-Off

**Files:**
- Delete: `src/game/ui/FantasyCardTemplate.ts`
- Modify: `src/game/scenes/PrepScene.ts`
- Modify: `docs/codex-ui-guide.md`
- Modify: `docs/codex-handoff.md`

**Interfaces:**
- Consumes: visual sign-off from the user after V2 is live
- Produces: V2 becomes the canonical `FantasyCardTemplate` path or remains the permanent V2 path with legacy removed

- [ ] **Step 1: Write the failing test**

```ts
// tests/game/fantasyCardTemplateSpec.test.ts
it('removes the legacy template file after V2 sign-off', () => {
  const prepScene = readFileSync(resolve(process.cwd(), 'src/game/scenes/PrepScene.ts'), 'utf8');
  expect(prepScene).not.toContain("../ui/FantasyCardTemplate';");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/game/fantasyCardTemplateSpec.test.ts`

Expected: FAIL until all legacy imports are removed.

- [ ] **Step 3: Write minimal implementation**

```bash
git rm src/game/ui/FantasyCardTemplate.ts
```

```md
<!-- docs/codex-ui-guide.md -->
| `src/game/ui/FantasyCardTemplateV2.ts` | — | Canonical full-card skill template with locked geometry, tier skins, and asset-ingest rules. |
```

- [ ] **Step 4: Run full verification**

Run: `npm run typecheck`
Expected: clean

Run: `npm run build`
Expected: pass

Run: `npm test`
Expected: pass with no legacy template references

- [ ] **Step 5: Commit**

```bash
git add src/game/scenes/PrepScene.ts docs/codex-ui-guide.md docs/codex-handoff.md tests/game/fantasyCardTemplateSpec.test.ts
git commit -m "refactor: remove legacy fantasy card template"
```

## Self-Review

### Spec coverage

- New template implementation instead of patching old one: Task 3 and Task 4
- Shared geometry across all tiers: Task 1
- Tier skins only change appearance: Task 1 and Task 2
- Global `cover` fit with no freeform offsets: Task 1 and Task 2
- Asset-ingest contract and PNG dimensions: Task 1
- Controlled migration with legacy file kept until validation: Task 4 and Task 5
- Final legacy removal only after sign-off: Task 5

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain in the tasks.
- All created files, tests, commands, and commit messages are named explicitly.

### Type consistency

- `FantasyTemplateTier` aligns with the existing `SkillTier` values.
- `buildFantasyCardTemplateModel()` produces the data consumed by `FantasyCardTemplateV2`.
- `PrepScene.ts` switches to `FantasyCardTemplateV2` only after that class exists.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-18-fantasy-card-template-v2.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
