import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  it('locks the canonical card size and full-art geometry', () => {
    expect(FANTASY_CARD_TEMPLATE_SPEC.baseSize).toEqual({ width: 420, height: 690 });
    expect(FANTASY_CARD_TEMPLATE_SPEC.regions.artFrame).toEqual({ x: 0, y: 0, w: 420, h: 690 });
    expect(FANTASY_CARD_TEMPLATE_SPEC.regions.bodyBox).toEqual({ x: 40, y: 562, w: 340, h: 76 });
    expect(FANTASY_CARD_TEMPLATE_SPEC.regions.slotLabel).toEqual({ x: 230, y: 644, w: 156, h: 20 });
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
    expect(FANTASY_CARD_TEMPLATE_SPEC.regions.tierFrame).toEqual({ x: 0, y: 440, w: 420, h: 250 });
  });

  it('enforces the minimum art PNG size', () => {
    expect(FANTASY_CARD_ASSET_RULES.artPng.minWidth).toBe(840);
    expect(validateFantasyCardArtSize(839, 1040)).toEqual({
      ok: false,
      reason: 'Card art must be at least 840x1040 for cover-fit cropping.',
    });
    expect(validateFantasyCardArtSize(1024, 1536)).toEqual({ ok: true });
  });

  // Was "moves PrepScene off the legacy fantasy template import". PrepScene and
  // the V1 template were both deleted with the first-generation UI, so the
  // invariant is now stated at its root: V1 is gone and nothing may import it.
  it('keeps the legacy V1 fantasy template deleted and unreferenced', () => {
    expect(existsSync(resolve(process.cwd(), 'src/game/ui/FantasyCardTemplate.ts'))).toBe(false);

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts')) {
          // The V1 import ends in `FantasyCardTemplate'` — V2's ends in `V2'`.
          if (/from\s+'[^']*\/FantasyCardTemplate'/.test(readFileSync(path, 'utf8'))) offenders.push(path);
        }
      }
    };
    walk(resolve(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});
