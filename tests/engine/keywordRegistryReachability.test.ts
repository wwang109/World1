import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ACTION_KINDS,
  AURA_RULE_ENTRY,
  KEYWORD_TEXT,
  MARKUP_EXEMPT_KINDS,
  STAT_TOKEN as ENGINE_STAT_TOKEN,
  displayTokenOf,
  faceClauseOf,
  ruleEntryOf,
  type RenderCtx,
} from '../../src/engine/keywords/text';
import { KEYWORD_PRICING } from '../../src/engine/balance';
import { renderSkillText } from '../../src/engine/keywords/compose';
import { skillBook } from '../../src/data/skills';
import { applyTier } from '../../src/engine/cards';
import { TIER_ORDER, type Action, type SkillTier } from '../../src/engine/types';
import { KEYWORD_TEXT_COLOR, markedKeywords } from '../../src/game/ui/cardTextMarkup';
import { STAT_TOKEN as UI_STAT_TOKEN } from '../../src/game/ui/statLabels';
import { cardGlossaryEntries, cardHoverEntries } from '../../src/game/ui/cardHoverEntries';
import { skillKeywordEntries } from '../../src/game/ui/cardGlossary';

/**
 * THE BLOCKING PREREQUISITE of the card-text migration (spec §6.0).
 *
 * Removing the rule prose from every card face is only safe if the rule is
 * still REACHABLE and still INVITED. Two different things, and both are pinned
 * here:
 *
 *   REACHABLE — `skillKeywordEntries` walks `skill.effects` DIRECTLY and never
 *   parses markup, and BOTH platforms funnel through it (desktop hover via
 *   `cardHoverEntries`, mobile tap-to-inspect via `cardGlossaryEntries` ->
 *   `renderCardInfoBox`). So an entry cannot exist on one platform and not the
 *   other. Test (B).
 *
 *   INVITED — with the prose gone, a keyword's own COLOURED WORD is the only
 *   thing left on a much shorter face suggesting "there is more here, tap it".
 *   Before this migration `guard` (30 authored actions), `negate` (10) and
 *   `shield` (57) had a colour that NO card ever wrapped, and `taunt` had a
 *   colour its face badge never attached. Test (A) makes wrapping structural:
 *   a kind either always marks its name up or is on a closed, reasoned
 *   exemption list.
 */

const SAMPLE_CTX: RenderCtx = {
  property: 'physical', weapon: 'sword', size: 1,
  speedWeight: undefined, cooldownTurns: undefined, element: undefined,
  aoe: false, gated: false,
};

/** One representative action per kind — plus one per STATUS for the two kinds
 * whose token is a function of the action (`exploit`, `stackBonus`). */
function samplesFor(kind: Action['kind']): Action[] {
  switch (kind) {
    case 'damage': return [{ kind: 'damage', power: 20 }];
    case 'heal': return [{ kind: 'heal', power: 20 }];
    case 'shield': return [{ kind: 'shield', power: 20 }];
    case 'attunedShield': return [{ kind: 'attunedShield', power: 12 }];
    case 'statStrike': return [{ kind: 'statStrike', shareOf: 2, cap: 20, echoHostPower: true }];
    case 'poison': return [{ kind: 'poison', stacks: 5 }];
    case 'burn': return [{ kind: 'burn', stacks: 5 }];
    case 'bleed': return [{ kind: 'bleed', stacks: 5 }];
    case 'stun': return [{ kind: 'stun', turns: 1 }, { kind: 'stun', turns: 2 }];
    case 'thorns': return [{ kind: 'thorns', stacks: 5 }];
    case 'taunt': return [{ kind: 'taunt', amount: 2 }];
    case 'cleanse': return [{ kind: 'cleanse', charges: 2 }];
    case 'ward': return [{ kind: 'ward', charges: 2 }];
    case 'negate': return [{ kind: 'negate', property: 'physical', charges: 1 }];
    case 'guard': return [{ kind: 'guard', property: 'physical', pct: 20, turns: 2 }];
    case 'buffStat': return [{ kind: 'buffStat', stat: 'attack', pct: 20, turns: 2 }];
    case 'debuffStat': return [{ kind: 'debuffStat', stat: 'armor', pct: 20, turns: 2 }];
    case 'expose': return [{ kind: 'expose', pct: 20, turns: 2 }];
    case 'slow': return [{ kind: 'slow', weight: 8 }];
    case 'burden': return [{ kind: 'burden', weight: 8 }];
    case 'curse': return [{ kind: 'curse', amount: 4, turns: 2 }];
    case 'splash': return [{ kind: 'splash' }];
    case 'disrupt': return [{ kind: 'disrupt', amount: 4 }];
    case 'lifesteal': return [{ kind: 'lifesteal', pct: 30 }];
    case 'shieldBreak': return [{ kind: 'shieldBreak', amount: 16 }];
    case 'comboBonus': return [{ kind: 'comboBonus', amount: 8 }];
    case 'chainBonus': return [{ kind: 'chainBonus', after: 'sword', amount: 8 }];
    case 'empowerNext': return [{ kind: 'empowerNext', amount: 8 }];
    case 'exploit': return (['poison', 'burn', 'bleed', 'stun', 'debuff', 'expose'] as const)
      .map((status) => ({ kind: 'exploit' as const, status, amount: 8 }));
    case 'stackBonus': return (['poison', 'burn', 'bleed', 'thorns'] as const)
      .flatMap((status) => ([
        { kind: 'stackBonus' as const, status, of: 'caster' as const, per: 3, cap: 12 },
        { kind: 'stackBonus' as const, status, of: 'target' as const, per: 3, cap: 12 },
      ]));
    case 'taxBonus': return [{ kind: 'taxBonus', per: 4, cap: 16 }];
    case 'shieldBurst': return [{ kind: 'shieldBurst', cap: 12 }];
    case 'wardRelease': return [{ kind: 'wardRelease', per: 8, cap: 24 }];
    case 'desperation': return [{ kind: 'desperation', amount: 12 }];
    case 'overhealShield': return [{ kind: 'overhealShield', cap: 12 }];
    case 'cleanseConvert': return [{ kind: 'cleanseConvert', per: 4, cap: 12 }];
  }
}

describe('(A) registry self-consistency: every rule-bearing keyword invites its own tap', () => {
  it('defines Aura once outside the Action-only registry', () => {
    expect(AURA_RULE_ENTRY).toEqual({
      title: 'Aura',
      body: 'Provides effects to affected cards within range.',
    });
  });

  it('the registry has a row for every Action kind, and no extras', () => {
    // The mapped type already guarantees this at compile time; the runtime
    // assertion catches the one thing it cannot — a row added for a kind that
    // no longer exists.
    expect([...ACTION_KINDS].sort()).toEqual(Object.keys(KEYWORD_PRICING).sort());
  });

  it('every NON-EXEMPT kind wraps its own name, and that token has a colour', () => {
    const problems: string[] = [];
    for (const kind of ACTION_KINDS) {
      if (MARKUP_EXEMPT_KINDS.includes(kind)) continue;
      for (const sample of samplesFor(kind)) {
        const rendered = faceClauseOf(sample, SAMPLE_CTX);
        // `cardTextMarkup.ts`'s OWN parser — reused, never re-derived.
        const tokens = markedKeywords(rendered);
        const expected = displayTokenOf(sample);
        if (expected === undefined) continue; // `exploit`'s `debuff` arm
        if (!tokens.includes(expected)) {
          problems.push(`${kind}: faceClause "${rendered}" does not mark up its own token {{${expected}}}`);
          continue;
        }
        if (KEYWORD_TEXT_COLOR[expected] === undefined) {
          problems.push(`${kind}: token "${expected}" has no KEYWORD_TEXT_COLOR entry`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every EXEMPT kind marks up nothing at all — the list is closed, not a shrug', () => {
    // Exemption is decided ONCE per kind, in the registry, so "sometimes
    // wrapped, sometimes not" (the live `guard`/`negate`/`shield` gap this
    // migration closes) is not expressible.
    const problems: string[] = [];
    for (const kind of MARKUP_EXEMPT_KINDS) {
      for (const sample of samplesFor(kind)) {
        const tokens = markedKeywords(faceClauseOf(sample, SAMPLE_CTX));
        if (tokens.length > 0) problems.push(`${kind} is exempt but marks up ${tokens.join(', ')}`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    // SEVEN, each with a stated reason on its own row: the two plain sinks
    // (taught unconditionally by the type badge, and carrying no
    // `ruleSentence` at all), the two stat riders (a judgment call — their
    // duration rule and now the stat's own definition are still attached
    // unconditionally), `statStrike` (gem-only, deferred), and the two riders
    // whose face clause names no keyword at all (`taxBonus` reads a STATE
    // assembled from two keywords, `desperation` reads your own HP bar).
    //
    // `shield` LEFT THIS LIST (2026-09-06). It was the one member that
    // carried a real `ruleSentence` a face could not teach — the
    // TRUE-blocks-everything / two-for-one drain rule — while 36 cards printed
    // the word uncoloured, so the most common defensive keyword in the game
    // was the one with no tap cue. Its clause now marks up its own word
    // (lowercase `{{shield}}`, so the printed sentence is byte-identical after
    // `stripCardTextMarkup`).
    expect([...MARKUP_EXEMPT_KINDS].sort()).toEqual([
      'buffStat', 'damage', 'debuffStat', 'desperation', 'heal', 'statStrike', 'taxBonus',
    ]);
  });

  it('NO faceClause smuggles a mechanism word back onto the face', () => {
    // Spec §6.3's regression guard: the words that only ever belong in a
    // `ruleSentence`. `bypasses`, `ticks`, `outright`, `whenever` were each
    // literally present in the authored corpus this migration deleted.
    const BANNED = ['ticks', 'bypass', 'outright', 'whenever', 'instead of', 'never', 'stack count', 'global turn'];
    const problems: string[] = [];
    for (const kind of ACTION_KINDS) {
      for (const sample of samplesFor(kind)) {
        const rendered = faceClauseOf(sample, SAMPLE_CTX).toLowerCase();
        for (const word of BANNED) {
          if (rendered.includes(word)) problems.push(`${kind}: faceClause "${rendered}" contains mechanism word "${word}"`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('EVERY ruleSentence is a DEFINITION — no digit, no percent, no markup', () => {
    // User-locked 2026-09-06: "I dont think you should be explaining the amount
    // of x debuff like poison 8 or thorn 5 as other cards that have other
    // amounts." The card carries the amount; the helper explains the keyword and
    // must read identically on every card that carries it. Typing `ruleSentence`
    // as a plain `string` makes a PARAMETERISED helper a compile error; this
    // makes a card-specific number smuggled in as a literal a test failure.
    const problems: string[] = [];
    for (const kind of ACTION_KINDS) {
      const rule = KEYWORD_TEXT[kind].ruleSentence;
      if (/\d/.test(rule)) problems.push(`${kind}: ruleSentence contains a digit — "${rule}"`);
      if (rule.includes('%')) problems.push(`${kind}: ruleSentence contains a percentage — "${rule}"`);
      if (/\{\{[^{}]+\}\}/.test(rule)) problems.push(`${kind}: ruleSentence contains {{markup}} — "${rule}"`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('the same keyword yields the SAME helper text whatever the card', () => {
    // The direct statement of the rule above: two different cards carrying
    // poison must hand a player the same definition.
    const byTitle = new Map<string, Set<string>>();
    for (const skill of Object.values(skillBook)) {
      for (const action of skill.effects) {
        const entry = ruleEntryOf(action);
        if (!entry) continue;
        if (!byTitle.has(entry.title)) byTitle.set(entry.title, new Set());
        byTitle.get(entry.title)!.add(entry.body);
      }
    }
    const drifted = [...byTitle.entries()]
      .filter(([, bodies]) => bodies.size > 1)
      .map(([title, bodies]) => `${title}: ${bodies.size} different bodies`);
    expect(drifted, drifted.join('\n')).toEqual([]);
    expect(byTitle.size, 'the catalog exercises most of the registry').toBeGreaterThan(20);
  });

  it('the engine-side STAT_TOKEN is byte-identical to the UI-side one', () => {
    // `src/engine` may not import from `src/game`, so the table is duplicated
    // as DATA and pinned here — the same tradeoff `OFFENSIVE_KINDS` takes.
    for (const [stat, token] of Object.entries(ENGINE_STAT_TOKEN)) {
      expect(UI_STAT_TOKEN[stat as keyof typeof UI_STAT_TOKEN], `${stat}`).toBe(token);
    }
  });
});

describe('(B) both-platform reachability: one glossary assembly, not two', () => {
  it('shows the shared Multi-Hit definition on cards with multiple damage hits', () => {
    const entries = skillKeywordEntries(skillBook.twin_slash!);
    expect(entries).toContainEqual({
      title: 'Multi-Hit',
      body: 'This card hits X times. Each hit resolves separately.',
    });
    expect(skillKeywordEntries(skillBook.sword_slash!).some((entry) => entry.title === 'Multi-Hit')).toBe(false);
  });

  it('desktop hover and mobile tap-to-inspect read the SAME function', () => {
    // Not "they produce the same strings today" — the same FUNCTION REFERENCE,
    // so the two call sites cannot evolve into two behaviours. This is the same
    // single-renderer discipline `FIGHT_NARROW` follows by reflowing the wide
    // log rather than formatting in parallel.
    const probe = skillBook.bramble_covenant!;
    const shared = skillKeywordEntries(probe);
    // `cardGlossaryEntries` (mobile detail overlay body, via `cardInfoBox`) ...
    const mobile = cardGlossaryEntries(probe);
    // ... and `cardHoverEntries` (desktop hover) both END with that same list.
    const desktop = cardHoverEntries(probe);

    expect(shared.length, 'the probe must exercise at least one keyword').toBeGreaterThan(0);
    for (const entry of shared) {
      expect(mobile, `mobile is missing "${entry.title}"`).toContainEqual(entry);
      expect(desktop, `desktop must use the canonical body for "${entry.title}"`).toContainEqual(entry);
    }
  });

  it('keeps canonical keyword bodies byte-identical on every reachable card and tier', () => {
    const problems: string[] = [];
    let compared = 0;
    for (const skill of Object.values(skillBook)) {
      for (const tier of TIER_ORDER) {
        if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(skill.tier)) continue;
        const resolved = applyTier(skill, tier as SkillTier);
        const detail = cardGlossaryEntries(resolved);
        const hover = cardHoverEntries(resolved);
        for (const canonical of skillKeywordEntries(resolved)) {
          compared += 1;
          if (!detail.some((entry) => entry.title === canonical.title && entry.body === canonical.body)) {
            problems.push(`${skill.id}@${tier}: detail differs for ${canonical.title}`);
          }
          if (!hover.some((entry) => entry.title === canonical.title && entry.body === canonical.body)) {
            problems.push(`${skill.id}@${tier}: hover differs for ${canonical.title}`);
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(1_000);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('lists keyword rules before generic card metadata', () => {
    for (const skill of Object.values(skillBook)) {
      for (const tier of TIER_ORDER) {
        if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(skill.tier)) continue;
        const resolved = applyTier(skill, tier as SkillTier);
        const keywords = skillKeywordEntries(resolved);
        if (keywords.length === 0) continue;
        const entries = cardGlossaryEntries(resolved);
        expect(entries.slice(0, keywords.length), `${skill.id}@${tier}`).toEqual(keywords);
      }
    }
  });

  it('adds the canonical referenced status after Exploit and Status Bonus', () => {
    const exploit = skillKeywordEntries({
      ...skillBook.fireball!,
      effects: [{ kind: 'exploit', status: 'poison', amount: 8 }],
    });
    expect(exploit.map((entry) => entry.title)).toEqual(['Exploit', 'Poison']);
    expect(exploit[1]).toEqual(ruleEntryOf({ kind: 'poison', stacks: 1 }));

    const stacks = skillKeywordEntries({
      ...skillBook.fireball!,
      effects: [{ kind: 'stackBonus', status: 'thorns', of: 'caster', per: 3, cap: 12 }],
    });
    expect(stacks.map((entry) => entry.title)).toEqual(['Status Bonus', 'Thorns']);
    expect(stacks[1]).toEqual(ruleEntryOf({ kind: 'thorns', stacks: 1 }));
  });

  it('ATK/MATK/DEF/MDEF/best-stat suffixes create no glossary or hover entries', () => {
    const probes = [
      skillBook.sworn_edge!,
      skillBook.ember_lash!,
      skillBook.iron_bulwark!,
      skillBook.annihilation_strike!,
    ];
    for (const probe of probes) {
      for (const entry of [...cardGlossaryEntries(probe), ...cardHoverEntries(probe)]) {
        expect(entry.title, `${probe.id}: unexpected stat-suffix entry "${entry.title}"`)
          .not.toMatch(/^\(\+(?:ATK|MATK|DEF|MDEF|best stat)\) suffix$/);
      }
    }
  });

  it('a keyword entry is attached from `effects`, never from markup', () => {
    // The literal mechanism §1.5 established by code reading, pinned: strip the
    // markup out of a card's face entirely and its glossary entries are
    // unchanged, because nothing parses the face to build them.
    const probe = skillBook.bramble_covenant!;
    const before = skillKeywordEntries(probe);
    const stripped = { ...probe, flavor: undefined };
    expect(skillKeywordEntries(stripped)).toEqual(before);
  });

  it('EVERY keyword any shipped card can carry is reachable on both platforms', () => {
    const unreachable: string[] = [];
    for (const skill of Object.values(skillBook)) {
      for (const tier of TIER_ORDER) {
        if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(skill.tier)) continue;
        const resolved = applyTier(skill, tier as SkillTier);
        const titles = new Set(skillKeywordEntries(resolved).map((e) => e.title));
        for (const action of resolved.effects) {
          const entry = ruleEntryOf(action);
          if (!entry) continue;
          // Affinity is separate; the action keyword keeps its canonical title.
          const found = titles.has(entry.title);
          if (!found) unreachable.push(`${skill.id}@${tier}: ${action.kind} -> "${entry.title}"`);
        }
      }
    }
    expect(unreachable, unreachable.join('\n')).toEqual([]);
  });

  it('every {{token}} the generated catalog prints resolves to a colour', () => {
    // The face is the tap CUE, so an unresolvable token is an invitation the UI
    // cannot honour. Runs over generated output at every reachable tier, which
    // is strictly more than the authored corpus ever covered.
    const missing = new Set<string>();
    for (const skill of Object.values(skillBook)) {
      for (const tier of TIER_ORDER) {
        if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(skill.tier)) continue;
        for (const token of markedKeywords(renderSkillText(applyTier(skill, tier as SkillTier)))) {
          if (KEYWORD_TEXT_COLOR[token] === undefined) missing.add(`${token} (${skill.id}@${tier})`);
        }
      }
    }
    expect([...missing], [...missing].join('\n')).toEqual([]);
  });
});

describe('(B2) keyword definitions use direct game language', () => {
  it('contains no narrative filler or all-caps emphasis', () => {
    const banned = /\b(?:pile|wall|plating|stings?|rides?|front-loaded|cheapest|unpaid|thinner|sooner|tax them)\b|nothing to set up|nothing to keep alive/i;
    const allCaps = /\b(?!TRUE\b|HP\b|DoT\b)[A-Z]{3,}\b/;
    const problems: string[] = [];
    for (const kind of ACTION_KINDS) {
      const body = KEYWORD_TEXT[kind].ruleSentence;
      if (banned.test(body)) problems.push(`${kind}: narrative phrase in "${body}"`);
      if (allCaps.test(body)) problems.push(`${kind}: all-caps emphasis in "${body}"`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('states the TRUE-shield exchange rate in the direction the engine spends it', () => {
    expect(KEYWORD_TEXT.shield.ruleSentence).toBe(
      'Absorbs damage matching its property before HP. Shields stack, persist between turns, and cannot exceed maximum HP. '
      + 'TRUE shields absorb every property. Physical or magical damage spends two TRUE shield points for each damage absorbed.',
    );
  });

  it('limits Shatter to standard shields', () => {
    expect(KEYWORD_TEXT.shieldBreak.ruleSentence).toBe(
      'Removes standard shields from the target before this card deals damage. Does not remove Attuned shields. Excess Shatter does not deal damage.',
    );
  });

  it('limits Attuned shields by damage property before applying type efficiency', () => {
    expect(KEYWORD_TEXT.attunedShield.ruleSentence).toBe(
      'Absorbs damage matching its property before HP. Each point absorbs two damage from the matching card type. '
      + 'Other same-property damage, including damage without a card type, uses one shield point per damage absorbed. '
      + 'Matching-type damage uses Attuned shields first. Other same-property damage uses them last.',
    );
  });
});

describe('(B3) desktop hover keeps keywords before targeting metadata', () => {
  it('places Slow before AoE targeting on Chain Spark', () => {
    const diamond = applyTier(skillBook.chain_spark!, 'diamond');
    expect(cardHoverEntries(diamond).map((entry) => entry.title).slice(0, 4)).toEqual([
      'Chain Spark',
      'Slow',
      'Typed shields',
      'AoE targeting',
    ]);
  });
});

/** Stat suffixes are plain face notation, never glossary keywords. */
describe('(C) stat-scaling suffixes remain plain notation', () => {
  it('no reachable card/tier attaches a glossary entry to a stat suffix', () => {
    const problems: string[] = [];
    for (const skill of Object.values(skillBook)) {
      for (const tier of TIER_ORDER) {
        if (TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(skill.tier)) continue;
        const resolved = applyTier(skill, tier as SkillTier);
        for (const entry of [...cardGlossaryEntries(resolved), ...cardHoverEntries(resolved)]) {
          if (entry.title.endsWith(' suffix')) problems.push(`${skill.id}@${tier}: ${entry.title}`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

/**
 * (D) THE WIKI ROUTE REACHES THE KEYWORD GLOSSARY — SOURCE PIN, BOTH PLATFORMS.
 *
 * Repair for `task-1-review.md`'s Important finding: both Wiki scenes used to
 * draw `stripCardTextMarkup(renderSkillText(shown))` for the card detail body
 * — the markup (the only tap/hover cue) stripped, and neither scene called
 * `cardGlossaryEntries`/`skillKeywordEntries` at all, so the Wiki was the one
 * screen a player opens to LOOK A CARD UP with no route to a keyword's rule.
 *
 * `FantasyCardTemplateV2`/Phaser scenes cannot be imported under vitest's
 * `environment: 'node'` (no `window`/canvas — confirmed by direct import
 * elsewhere in this suite, `scripts/card-face-truncation-audit.ts`'s own doc
 * comment), so this is a SOURCE PIN — the same convention
 * `tests/game/foeDeckEditor.test.ts` uses for scene wiring it cannot exercise
 * live. `renderCardInfoBox`'s own call to `cardGlossaryEntries` (which walks
 * `skill.effects` and returns `skillKeywordEntries` among its entries) is
 * proven by describe (B) above; this pins that BOTH Wiki scenes actually
 * reach that same function, rather than the old stripped bare block.
 */
describe('(D) the Wiki route reaches the keyword glossary, both platforms — source pin', () => {
  const SCENES = join(process.cwd(), 'src', 'game', 'scenes');

  it('DesktopWikiScene renders the card detail through renderCardInfoBox, not a stripped bare block', () => {
    const src = readFileSync(join(SCENES, 'DesktopWikiScene.ts'), 'utf8');
    expect(src).toMatch(/import\s*\{\s*renderCardInfoBox\s*\}\s*from\s*'\.\.\/ui\/cardInfoBox'/);
    // The call itself, OUTSIDE the doc-comment that narrates the old defect
    // (that comment names the same string in prose, so a bare substring check
    // would pass on the comment alone) — require it followed by the scene's
    // own real argument list rather than just appearing anywhere in the file.
    expect(src).toMatch(/renderCardInfoBox\(this, centerX[^)]*shown/);
  });

  it('MobileWikiScene renders the card detail through renderCardInfoBox, not a stripped bare block', () => {
    const src = readFileSync(join(SCENES, 'MobileWikiScene.ts'), 'utf8');
    expect(src).toMatch(/import\s*\{\s*renderCardInfoBox\s*\}\s*from\s*'\.\.\/ui\/cardInfoBox'/);
    expect(src).toMatch(/renderCardInfoBox\(this, centerX[^)]*shown/);
  });

  /**
   * THE SHOP, added 2026-09-06 after the audit caught it. It was the same
   * defect as the Wiki's and a NET LOSS against HEAD: HEAD's pane printed the
   * authored sentence complete with its inlined rule ("Poison 8 (ticks at end
   * of turn; bypasses shields)"), so removing the rule from the face left the
   * screen where GOLD IS SPENT with no way to learn what poison does.
   *
   * FOUR panes, not two — each platform has an OFFER pane and an OWNED
   * (inspect) pane, and the first pass at this finding fixed neither.
   */
  it('both SHOP scenes render both panes through renderCardInfoBox', () => {
    for (const scene of ['DesktopShopScene.ts', 'MobileShopScene.ts']) {
      const src = readFileSync(join(SCENES, scene), 'utf8');
      expect(src, `${scene} imports the box`).toMatch(/import\s*\{\s*renderCardInfoBox\s*\}\s*from\s*'\.\.\/ui\/cardInfoBox'/);
      // Count real CALLS, not mentions: the doc comment at each site names the
      // function in prose, so a bare substring check would pass on comments.
      // Count the CARD route specifically — the calls whose skill argument is
      // the resolved `shown`. A TOTAL count breaks the moment the gem pass adds
      // its own additive `renderCardInfoBox` for a gem surface, which is a
      // legitimate addition and not this invariant's business.
      const cardCalls = src.match(/renderCardInfoBox\(this,[^;]*?\bshown\b/g) ?? [];
      expect(cardCalls.length, `${scene} must call it for BOTH its offer and owned CARD panes`)
        .toBeGreaterThanOrEqual(2);
      // ...and no pane may still be printing the bare stripped block instead.
      expect(src, `${scene} still draws a bare stripped body block`)
        .not.toMatch(/add\.text\([^)]*stripCardTextMarkup\(renderSkillText\(shown\)\)/);
    }
  });

  /**
   * THE `depth` PIN. `renderCardInfoBox` draws at depth 0 by default, and a
   * MODAL caller must raise it: `MobileWikiScene`/`MobileShopScene` mount the
   * box inside a full-screen veil, and without `depth` the whole glossary
   * rendered UNDERNEATH that veil — present in the scene graph, invisible to
   * the player, and its scroll-drag dismissed the overlay instead of
   * scrolling. That bug returned GREEN on every test until this pin existed.
   *
   * Keyed off the VEIL, so it cannot be satisfied by deleting the requirement:
   * a scene that draws a full-screen dismiss veil AND an info box must pass
   * `depth` to the box.
   */
  it('every veil-mounted info box passes a depth', () => {
    for (const scene of ['MobileWikiScene.ts', 'MobileShopScene.ts']) {
      const src = readFileSync(join(SCENES, scene), 'utf8');
      const hasVeil = /const veil = this\.add\.rectangle\(0, 0, this\.W, this\.H/.test(src);
      expect(hasVeil, `${scene} is expected to be a veil-mounted scene`).toBe(true);
      for (const call of src.match(/renderCardInfoBox\(this,[^;]*;/g) ?? []) {
        // NOT `\\d`: `depth: 0` is the DEFAULT, so accepting it would let the
        // under-the-veil bug back in wearing the shape of a fix. Require a
        // raised depth.
        expect(call, `${scene}: an info box inside a veil must pass a RAISED depth, not 0`)
          .toMatch(/depth:\s*[1-9]\d*/);
      }
    }
    // Desktop's panes are NOT modal (they are docked columns in a rebuilt
    // scene), so they correctly pass no depth — asserted so the two cases stay
    // deliberately different rather than accidentally the same.
    const desktop = readFileSync(join(SCENES, 'DesktopShopScene.ts'), 'utf8');
    expect(/const veil = this\.add\.rectangle\(0, 0, this\.W, this\.H/.test(desktop)).toBe(false);
  });
});

/**
 * (E) EVERY CARD-FACE SITE, PER SITE — the audit that kept being wrong.
 *
 * This started life as a scratch script and was failed three times, each time
 * for a DIFFERENT flavour of the same mistake: claiming a route the code did
 * not have.
 *
 *  1. Per-FILE. It credited every `FantasyCardTemplateV2` site in a file if
 *     ANY call anywhere in that file reached the glossary — so
 *     `RunRewardPanel`'s reward face was marked reachable on the strength of a
 *     `cardHoverEntries` call in a DIFFERENT render function (the picker grid),
 *     and the shop's four panes were marked reachable before they were.
 *  2. Route patterns that matched a MENTION. The list carried a bare
 *     `/onInspect/`, which matches the word anywhere — including inside the doc
 *     comment that NARRATES the fix. Deleting the fix's own two code lines
 *     therefore still reported 11 reachable / 1 unreachable: a comment was
 *     satisfying the audit of its own subject.
 *  3. Reachability inferred rather than traced. A picker CELL genuinely has no
 *     route in its own scope (its tap opens a pane that does), so it needs an
 *     exception — but an exception that is guessed is the per-file bug again.
 *
 * So: per SITE, on COMMENT-STRIPPED code, with routes anchored on a call `(`
 * or a wired option `:`, and with the one indirect case named EXPLICITLY with
 * its traced chain. It lives in the suite rather than in `tmp/` because a
 * scratch script cannot fail a build, and every one of the three defects above
 * was a green report.
 *
 * WHAT THIS AUDIT DOES *NOT* PROVE — read this before quoting "12/12".
 * It is a STATIC check that a route is WIRED. It cannot run Phaser (see the
 * describe (D) note below), so it cannot prove the route FIRES. Those came
 * apart on `ui/RunRewardPanel.ts:243`, the reward face, which this audit
 * credits with `attachHoverTip()` + `cardHoverEntries()`:
 *
 *   Desktop hover opens the tip — captured.
 *   A MOBILE TOUCH TAP DOES NOT, and the wiring is why. Phaser sends a tap as
 *   `pointerdown -> pointerover -> pointerup -> pointerout` (traced live at
 *   412x892), and `hoverTip.ts` maps `pointerdown -> toggle` (opens),
 *   `pointerover -> show` (no-op, already open) and `pointerout -> hide`
 *   (closes) — so the tip is destroyed the instant the finger lifts. That file
 *   assumes the opposite ("touch devices don't reliably fire pointerover
 *   before a tap"), and the assumption is false here.
 *
 * That is a defect in the SHARED `attachHoverTip`, not in this migration's
 * line, and it affects every tap-to-inspect surface built on it. Deliberately
 * NOT fixed here: it is a behaviour change to a widely shared UI helper and
 * belongs to whoever owns `src/game/ui/hoverTip.ts`. Recorded here because
 * this is the audit whose green row would otherwise be read as proof that the
 * reward face works on both platforms. The Wiki and Shop routes are NOT
 * affected — they render the glossary inline through `renderCardInfoBox` and
 * never involve a tip.
 */
describe('(E) every card-face site can reach a keyword definition — per site', () => {
  const GAME = join(process.cwd(), 'src', 'game');

  /** Comments and string bodies out: a route must rest on code, not prose. */
  function stripComments(text: string): string {
    let out = '';
    let mode: 'code' | 'line' | 'block' | '"' | '\'' | '`' = 'code';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i] ?? '';
      const two = text.slice(i, i + 2);
      if (mode === 'code') {
        if (two === '//') { mode = 'line'; i += 1; continue; }
        if (two === '/*') { mode = 'block'; i += 1; continue; }
        if (ch === '"' || ch === '\'' || ch === '`') { mode = ch; out += ' '; continue; }
        out += ch;
        continue;
      }
      if (mode === 'line') {
        if (ch === '\n') { mode = 'code'; out += '\n'; }
        continue;
      }
      if (mode === 'block') {
        if (two === '*/') { mode = 'code'; i += 1; continue; }
        if (ch === '\n') out += '\n';
        continue;
      }
      // inside a string literal — keep newlines so line numbers survive
      if (ch === '\\') { i += 1; continue; }
      if (ch === mode) { mode = 'code'; continue; }
      if (ch === '\n') out += '\n';
    }
    return out;
  }

  const ROUTES: ReadonlyArray<readonly [RegExp, string]> = [
    [/\brenderCardInfoBox\s*\(/, 'renderCardInfoBox()'],
    [/\bcardHoverEntries\s*\(/, 'cardHoverEntries()'],
    [/\bcardGlossaryEntries\s*\(/, 'cardGlossaryEntries()'],
    [/\bskillKeywordEntries\s*\(/, 'skillKeywordEntries()'],
    [/\brenderCardDetailOverlay\s*\(/, 'renderCardDetailOverlay()'],
    [/\battachHoverTip\s*\(/, 'attachHoverTip()'],
    [/\bonInspect\s*:/, 'onInspect: wired'],
  ];

  /**
   * The INDIRECT sites: no route in their OWN scope, but the cell they build
   * is a picker whose tap opens a pane that has one. Keyed by
   * `file::owning function` — NOT by line number, which drifts on every
   * unrelated edit above it (the first draft of this list keyed
   * `DesktopWikiScene.ts:352` and named the wrong function, `renderGallery`,
   * which the sweep caught) — and each value states the chain that was
   * actually FOLLOWED in the source, so the exception is auditable rather
   * than asserted.
   */
  const INDIRECT: Record<string, string> = {
    'scenes/DesktopWikiScene.ts::ensureGalleryCard':
      'picker cell (built with `glossary: false` by design) — it also builds the `hit` '
      + 'rectangle whose pointer handler calls this.selectCard(row.skill) -> this.renderDetail() '
      + '-> renderCardInfoBox, all three in this same scene',
  };

  /**
   * NOT a player surface, so it owes the player nothing. `UiKitScene` is the
   * developer component gallery ("FULL-ART CARD TEMPLATE (V2, scale 0.62)",
   * badge rows, a NOTES block): it draws `fireball` as a geometry SPECIMEN and
   * is reachable only by typing `?scene=uikit`. Listed separately from
   * INDIRECT because the justification is a different one — the site has no
   * route and correctly needs none — and pinned below against ever growing a
   * player-facing entry point.
   */
  const DEV_SPECIMEN: Record<string, string> = {
    'scenes/UiKitScene.ts::renderCard':
      'dev component gallery specimen — no player navigation reaches this scene',
  };

  function tsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...tsFiles(full));
      else if (name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  /** The lines of the function enclosing `line` (1-based), found by brace depth. */
  function owningFunction(lines: readonly string[], line: number): { from: number; to: number; name: string } {
    let depth = 0;
    let start = -1;
    for (let i = line - 1; i >= 0; i -= 1) {
      const text = lines[i] ?? '';
      for (let c = text.length - 1; c >= 0; c -= 1) {
        if (text[c] === '}') depth += 1;
        else if (text[c] === '{') depth -= 1;
      }
      if (depth < 0) {
        if (/(function\s|=>\s*\{|\)\s*(:\s*[\w<>[\]|. ]+)?\s*\{)/.test(text)) { start = i; break; }
        depth = 0;
      }
    }
    if (start < 0) return { from: 0, to: lines.length, name: '(file scope)' };
    let d = 0;
    let end = lines.length;
    for (let i = start; i < lines.length; i += 1) {
      for (const ch of lines[i] ?? '') {
        if (ch === '{') d += 1;
        else if (ch === '}') d -= 1;
      }
      if (d <= 0 && i > start) { end = i; break; }
    }
    const nameMatch = /(?:function\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(lines[start] ?? '');
    return { from: start, to: end, name: nameMatch?.[1] ?? '(anonymous)' };
  }

  interface Site {
    key: string; file: string; line: number; fn: string; routes: string[];
    indirect: boolean; devSpecimen: boolean;
  }

  function sweep(): Site[] {
    const sites: Site[] = [];
    for (const full of tsFiles(GAME)) {
      const src = readFileSync(full, 'utf8');
      if (!src.includes('new FantasyCardTemplateV2(')) continue;
      const lines = src.split(/\r?\n/);
      const bare = stripComments(src).split(/\r?\n/);
      for (let i = 0; i < bare.length; i += 1) {
        if (!(bare[i] ?? '').includes('new FantasyCardTemplateV2(')) continue;
        const fn = owningFunction(lines, i + 1);
        const scope = stripComments((lines.slice(fn.from, fn.to + 1)).join('\n'));
        const routes: string[] = [];
        for (const [re, label] of ROUTES) if (re.test(scope)) routes.push(label);
        const rel = relative(GAME, full).split('\\').join('/');
        const key = `${rel}::${fn.name}`;
        const indirect = routes.length === 0 && INDIRECT[key] !== undefined;
        if (indirect) routes.push(`INDIRECT: ${INDIRECT[key]!}`);
        const devSpecimen = routes.length === 0 && DEV_SPECIMEN[key] !== undefined;
        if (devSpecimen) routes.push(`DEV ONLY: ${DEV_SPECIMEN[key]!}`);
        sites.push({ key, file: rel, line: i + 1, fn: fn.name, routes, indirect, devSpecimen });
      }
    }
    return sites.sort((a, b) => (a.file + String(a.line).padStart(5, '0')).localeCompare(b.file + String(b.line).padStart(5, '0')));
  }

  const sites = sweep();

  function table(): string {
    const rows = sites.map((s) => `  ${s.file}:${s.line}  ${s.fn}  ->  ${s.routes.length === 0 ? 'UNREACHABLE' : s.routes.join(', ')}`);
    return rows.join('\n');
  }

  it('found the sites at all — an empty sweep must not read as a pass', () => {
    // The sweep's own failure mode: a renamed class or a moved directory makes
    // it measure nothing, and "0 unreachable of 0" is the greenest possible
    // lie. `card-face-truncation-audit.ts`'s title half shipped in exactly that
    // state, so the floor is pinned.
    expect(sites.length, `sites found:\n${table()}`).toBeGreaterThanOrEqual(10);
  });

  it('every site reaches a keyword definition', () => {
    const unreachable = sites.filter((s) => s.routes.length === 0);
    expect(unreachable.map((s) => `${s.file}:${s.line} (${s.fn})`), `full table:\n${table()}`).toEqual([]);
  });

  it('every exception is actually needed, and stays a hand-traced few', () => {
    // A stale exception is a silent hole: it would keep a site green after the
    // chain it names has been deleted. Each entry must therefore correspond to
    // a real site that really has no route of its own.
    const usedIndirect = sites.filter((s) => s.indirect).map((s) => s.key);
    const usedDev = sites.filter((s) => s.devSpecimen).map((s) => s.key);
    for (const key of Object.keys(INDIRECT)) {
      expect(usedIndirect, `INDIRECT lists ${key}, but no site needs that exception`).toContain(key);
    }
    for (const key of Object.keys(DEV_SPECIMEN)) {
      expect(usedDev, `DEV_SPECIMEN lists ${key}, but no site needs that exception`).toContain(key);
    }
    // ...and both stay SMALL. Every entry is hand-traced; a growing list means
    // card faces are being routed through taps nobody has followed.
    expect(usedIndirect.length + usedDev.length).toBeLessThanOrEqual(3);
  });

  it('the DEV_SPECIMEN excuse holds: UiKitScene has no player navigation', () => {
    // The exception is only honest while the scene stays a URL-only dev kit.
    // If a menu ever links to it, the specimen becomes a card a player can
    // look at, and it owes them the keyword rule like every other surface.
    const start = readFileSync(join(GAME, 'scenes', 'StartScene.ts'), 'utf8');
    expect(stripComments(start)).not.toMatch(/\bUiKit\b/);
    // It is reached by parsing a URL parameter, and nothing else. Read RAW
    // here: `stripComments` blanks string BODIES (a route must not be claimed
    // from a quoted mention either), and the thing being pinned IS a literal.
    const launch = readFileSync(join(GAME, 'devLaunch.ts'), 'utf8');
    expect(launch).toMatch(/value === 'uikit'\) return 'uikit'/);
  });

  it('a route claim cannot be satisfied by a comment', () => {
    // The defect this closes, reproduced directly: prose naming every route
    // must yield no route at all.
    const prose = [
      '/** onInspect: renderCardInfoBox(this, x) cardHoverEntries(skill)',
      ' * attachHoverTip(scene, o) cardGlossaryEntries(skill) */',
      '// renderCardDetailOverlay(scene) skillKeywordEntries(skill)',
      'const card = new FantasyCardTemplateV2(scene, 0, 0, skill, {});',
    ].join('\n');
    const bare = stripComments(prose);
    for (const [re, label] of ROUTES) {
      expect(re.test(bare), `${label} matched a COMMENT`).toBe(false);
    }
    // The code line survives, so the stripper is not just blanking everything.
    expect(bare).toContain('new FantasyCardTemplateV2(');
  });

  it('prints the table when asked (REACH_TABLE=1)', () => {
    // The artefact and the assertion share one owner: no second script to
    // drift out of step with the pins above.
    if (process.env['REACH_TABLE'] === '1') {
      const bad = sites.filter((s) => s.routes.length === 0).length;
      console.log(`\n${table()}\n\nsites: ${sites.length} · reachable: ${sites.length - bad} · UNREACHABLE: ${bad}`);
    }
    expect(sites.every((s) => s.file.endsWith('.ts'))).toBe(true);
  });
});
