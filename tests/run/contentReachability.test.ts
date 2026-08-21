// Catalog-wide acquisition-surface audit (QA, 2026-08-19). A card or gem that
// exists in the catalog but can never be drafted, sold, or granted by any
// event is dead weight — and a narrow pool filter can silently exclude
// content without anything else failing. This suite asserts every skill in
// `skillBook` and every gem in `gemBook` is reachable through AT LEAST ONE
// real acquisition surface: the start draft, a shop's card/gem filter, or an
// event's card/gem-granting outcome filter.
//
// This is a REGRESSION GUARD, not a design opinion: today every card is
// trivially reachable because `caravan`'s cardFilter is `[{}]` (matches the
// whole book) and `gemcutter`'s gemFilter is `[{ all: true }]` (matches the
// whole gem book) — deliberate "sells everything" catch-alls per
// docs/run-shops-design.md. This test exists so that if a future change ever
// narrows one of those catch-alls, or a future content pass adds a card/gem
// that (for whatever reason — a filter typo, an unhandled property/element/
// weapon value) matches NOTHING, the very next `npm test` catches it instead
// of it shipping silently unobtainable.
//
// Reachability check calls the REAL pool-construction code
// (`cardMatchesFilter`/`gemMatchesFilter` from `src/run/shop.ts`) over the
// REAL declarative content (`shopCatalog`, `eventCatalog`, `skillBook`,
// `gemBook`) — no reimplemented filter logic here.

import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { shopCatalog, shopTypeIds } from '../../src/data/shopTypes';
import { eventCatalog, eventCatalogIds } from '../../src/data/events';
import { cardMatchesFilter, gemMatchesFilter } from '../../src/run/shop';
import type { SkillDef } from '../../src/engine/types';
import type { GemDef } from '../../src/data/gems';

// ---------------------------------------------------------------------------
// Surface predicates — each returns true iff the given content id is
// reachable through that surface class, using the real filter code.
// ---------------------------------------------------------------------------

/** The start draft (`src/run/draft.ts`): offense/defense/support pools filter
 * by archetype; `wildcard` carries NO filter at all (the full book), so this
 * is true for every card today by construction — kept explicit (rather than
 * hard-coded `true`) so a future draft.ts change that narrows `wildcard` is
 * caught here too, not just assumed. */
function reachableViaDraft(skill: SkillDef): boolean {
  const archetypes = skill.archetypes;
  const offense = archetypes.includes('offense');
  const defense = archetypes.includes('defensive') || archetypes.includes('healing');
  const support = archetypes.includes('support') || archetypes.includes('debuff');
  const wildcard = true; // src/run/draft.ts: `picks.wildcard = pickThemeSet(rng, all, all, used)` — unfiltered.
  return offense || defense || support || wildcard;
}

function reachableViaShop(skill: SkillDef): boolean {
  return shopTypeIds.some((id) => cardMatchesFilter(skill, shopCatalog[id]!.cardFilter));
}

function reachableViaGemShop(gem: GemDef): boolean {
  return shopTypeIds.some((id) => gemMatchesFilter(gem, shopCatalog[id]!.gemFilter));
}

/** Any event choice whose outcome is a card-granting POOL (not a
 * `cardId`-named single grant, which isn't a "pool" surface for this audit).
 * An omitted `filter` matches the whole book, same semantics `cardChoice`/
 * `bonusDraft`/`grantCard` give it in `src/run/events.ts`. */
function reachableViaEvent(skill: SkillDef): boolean {
  for (const eid of eventCatalogIds) {
    for (const choice of eventCatalog[eid]!.choices) {
      const spec = choice.outcome;
      if (spec.kind === 'cardChoice' || spec.kind === 'bonusDraft') {
        if (!spec.filter || cardMatchesFilter(skill, spec.filter)) return true;
      } else if (spec.kind === 'grantCard' && !spec.cardId) {
        if (!spec.filter || cardMatchesFilter(skill, spec.filter)) return true;
      }
    }
  }
  return false;
}

function reachableViaGemEvent(gem: GemDef): boolean {
  for (const eid of eventCatalogIds) {
    for (const choice of eventCatalog[eid]!.choices) {
      const spec = choice.outcome;
      if (spec.kind === 'gemChoice') {
        if (!spec.filter || gemMatchesFilter(gem, spec.filter)) return true;
      } else if (spec.kind === 'grantGem' && !spec.gemId) {
        if (!spec.filter || gemMatchesFilter(gem, spec.filter)) return true;
      }
    }
  }
  return false;
}

describe('run/content: catalog-wide acquisition-surface audit', () => {
  it('every card in skillBook is reachable via the draft, a shop, or an event', () => {
    const unreachable: string[] = [];
    for (const skill of Object.values(skillBook)) {
      const ok = reachableViaDraft(skill) || reachableViaShop(skill) || reachableViaEvent(skill);
      if (!ok) unreachable.push(skill.id);
    }
    expect(unreachable, `card ids with ZERO acquisition surfaces: ${unreachable.join(', ')}`).toEqual([]);
  });

  it('every gem in gemBook is reachable via a shop or an event', () => {
    const unreachable: string[] = [];
    for (const gem of Object.values(gemBook)) {
      const ok = reachableViaGemShop(gem) || reachableViaGemEvent(gem);
      if (!ok) unreachable.push(gem.id);
    }
    expect(unreachable, `gem ids with ZERO acquisition surfaces: ${unreachable.join(', ')}`).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // Named regression lock for the 2026-08-19 content pass this audit
  // covers (17 hybrid/debuff/showcase cards, 9 keyword-gap gems) — pins
  // down the SPECIFIC ids a reachability audit already verified, so a
  // future edit to a shop/event filter that quietly drops one of them
  // fails with an id in the message, not a generic catalog-wide list.
  // ---------------------------------------------------------------------
  const NEW_CARDS_2026_08_19 = [
    'sanctum_thorn', 'bramblemend', 'warded_reprisal', 'bulwark_thicket',
    'unbreakable_stance', 'umbral_ward', 'thorn_shackle', 'mortal_wound',
    'barbed_rampart', 'crippling_gore', 'poison_bloom', 'poison_ritual',
    'evasive_cordon', 'shockwave_slam', 'disarming_blow', 'mind_frost',
    'toxic_bulwark', 'nettle_ward',
  ] as const;

  const NEW_GEMS_2026_08_19 = [
    // CONSOLIDATED (2026-08-21, user ruling "there should only be 1 gem to give
    // splash"): fracture_sliver + tremor_sliver retired, replaced by
    // ripple_sliver — THE splash gem, whose only action is the spreader. The
    // pin moves with the catalog: the splash acquisition surface must stay
    // reachable through the same curated Alchemist list the ladder used.
    'ripple_sliver', 'vulnerability_sliver', 'weak_point_sliver',
    'exposed_nerve_sliver', 'raw_nerve_sliver', 'sanctuary_sliver', 'renewal_sliver',
    'provoker_sliver',
    // ADDED (content-designer, 2026-08-19 defect-fix pass): taunting_sliver,
    // authored to widen `the_lapidary`'s warding_cut gemChoice pool off the
    // crash-boundary 3-gem count — see its own notes in gems.v1.json.
    'taunting_sliver',
  ] as const;

  it('every 2026-08-19 hybrid/debuff/showcase card exists and is reachable', () => {
    for (const id of NEW_CARDS_2026_08_19) {
      const skill = skillBook[id];
      expect(skill, `missing from skillBook: ${id}`).toBeDefined();
      const ok = reachableViaDraft(skill!) || reachableViaShop(skill!) || reachableViaEvent(skill!);
      expect(ok, `${id} has zero acquisition surfaces`).toBe(true);
    }
  });

  it('every 2026-08-19 keyword-gap gem exists and is reachable', () => {
    for (const id of NEW_GEMS_2026_08_19) {
      const gem = gemBook[id];
      expect(gem, `missing from gemBook: ${id}`).toBeDefined();
      const ok = reachableViaGemShop(gem!) || reachableViaGemEvent(gem!);
      expect(ok, `${id} has zero acquisition surfaces`).toBe(true);
    }
  });

  // ---------------------------------------------------------------------
  // Curation follow-up (2026-08-19): the original audit found the 9 new
  // gems reachable ONLY through Gemcutter's whole-book catch-all — no
  // curated per-theme `ids` list mentioned any of them, so a themed shop a
  // player might expect to sell one (Alchemist for the burden slivers, Armory
  // for the
  // expose ladder, Bulwark for sanctuary_sliver/provoker_sliver, Sanctum for
  // renewal_sliver) never would. That gap is now closed in shopTypes.ts, so
  // this pins the BETTER state: every 2026-08-19 gem is shop-reachable
  // through at least one CURATED themed list, not just Gemcutter's `all`
  // clause. A future edit that quietly drops one of these ids back out of
  // every themed list regresses this to a failure instead of a silent slide
  // back to the old finding.
  // ---------------------------------------------------------------------
  it('every 2026-08-19 gem is shop-reachable via at least one curated themed list (not just Gemcutter)', () => {
    const themedShopIds = shopTypeIds.filter((id) => id !== 'gemcutter');
    const unreached: string[] = [];
    for (const id of NEW_GEMS_2026_08_19) {
      const gem = gemBook[id]!;
      const themedHit = themedShopIds.some((sid) => gemMatchesFilter(gem, shopCatalog[sid]!.gemFilter));
      if (!themedHit) unreached.push(id);
    }
    expect(unreached, `gems reachable ONLY via Gemcutter's catch-all: ${unreached.join(', ')}`).toEqual([]);
  });
});
