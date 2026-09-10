import { describe, expect, it } from 'vitest';
import {
  CARD_MOD_KEYS,
  CARD_MOD_TEXT,
  MOD_RULE,
  HERO_MOD_TEXT,
  ACTION_KINDS,
  KEYWORD_TEXT,
  STAT_KEYS,
  STAT_LABELS,
  STAT_RULE,
  STAT_TOKEN,
  faceClauseOf,
  faceTokenOf,
  ruleEntriesOf,
  ruleEntryOf,
  statRuleByToken,
  type RenderCtx,
  type StatLabelKey,
} from '../../src/engine/keywords/text';
import {
  GEM_OPENER,
  gemCategoryOf,
  gemRuleEntries,
  renderGemClauses,
  renderGemText,
} from '../../src/engine/keywords/gemText';
import { gemBook } from '../../src/data/gems';
import { skillBook } from '../../src/data/skills';
import { categoryOfGem } from '../../src/data/validateGemContent';
import document from '../../src/data/content/gems.v1.json';
import type { Action, BuffableStat, Property, SkillDef } from '../../src/engine/types';
import { applyTier } from '../../src/engine/cards';
import { simulate } from '../../src/engine/combat/simulate';
import type { DamageCalculation } from '../../src/engine/combat/events';
import { cfg, tc, NO_ENDGAME } from '../helpers';
import { formatAuraModifiers } from '../../src/game/ui/skillPresentation';
import { renderSkillText } from '../../src/engine/keywords/compose';
import { KEYWORD_TEXT_COLOR, markedKeywords, stripCardTextMarkup } from '../../src/game/ui/cardTextMarkup';
import { gemChipLines, gemDefinitionsText, gemHoverEntries } from '../../src/game/ui/gemPresentation';
import { statHoverEntry, STAT_TOKEN as UI_STAT_TOKEN } from '../../src/game/ui/statLabels';

/**
 * GEM TEXT COMES FROM THE CARD REGISTRY — the gem half of the card-text
 * migration, and the sibling of `keywordRegistryReachability.test.ts`.
 *
 * The rule the whole change reduces to (user-locked 2026-09-06): *"they should
 * have same text so that there is no new text for stats every description
 * should come from 1 reference i dont even want a gem glossary"*. Four things
 * are held here, and each one is a compile-time or catalog-wide HOLE closed
 * rather than a snapshot:
 *
 *   (A) REACHABILITY — every action kind and every mod key any shipped gem can
 *       carry resolves to a registry row, so a gem with an unrendered payload
 *       is a test failure, exactly as it is for a card.
 *   (B) ONE REFERENCE — the sentence a gem hands a player for Poison, or for
 *       ATK, is byte-identical to the one a CARD hands them, asserted by
 *       comparing the two paths' output rather than by reading both.
 *   (C) HOST-LESS PURITY — a gem's face names no host-owned term (no type
 *       word, no `(+ATK)`, no property word), proven by re-rendering all 53
 *       under every `property` and demanding identical output.
 *   (D) THE GOLDEN SET — a dozen faces covering every structural feature of
 *       the gem grammar once, so a template edit cannot slide through as
 *       "53 snapshots updated".
 */

const GEMS = Object.values(gemBook);

// ---------------------------------------------------------------------------
// (A) REACHABILITY
// ---------------------------------------------------------------------------

describe('(A) every gem payload resolves to a registry row', () => {
  it('the book is the shipped size (this suite must not be vacuous)', () => {
    expect(GEMS.length).toBe(53);
    expect(document.gems.length).toBe(53);
  });

  it('every action kind any gem carries has a registry row that renders a non-empty clause', () => {
    const kinds = new Set<Action['kind']>();
    for (const gem of GEMS) {
      if (gem.kind !== 'effect') continue;
      for (const action of gem.actions) kinds.add(action.kind);
    }
    // The measurement the spec's gem deferral recorded: 23 kinds, all already
    // in the table. If a new gem introduces a 24th, this number moves and the
    // clause check below is what proves the new kind actually renders.
    expect(kinds.size).toBe(23);
    const problems: string[] = [];
    for (const kind of kinds) {
      if (KEYWORD_TEXT[kind] === undefined) problems.push(`${kind}: no registry row`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every mod key any stat gem carries has a stat-table row', () => {
    const problems: string[] = [];
    let heroKeys = 0;
    let cardKeys = 0;
    for (const gem of GEMS) {
      if (gem.kind !== 'stat') continue;
      for (const key of Object.keys(gem.mods.hero ?? {})) {
        heroKeys += 1;
        if (HERO_MOD_TEXT[key as BuffableStat] === undefined) problems.push(`${gem.id}: hero mod ${key} has no row`);
      }
      for (const key of Object.keys(gem.mods.card ?? {})) {
        cardKeys += 1;
        if (CARD_MOD_TEXT[key as 'damageFlat'] === undefined) problems.push(`${gem.id}: card mod ${key} has no row`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    // 9 stat gems, one mod each today — 4 Charms (hero scope) and 5 Cores
    // (card scope). If a gem grows a second mod, this moves deliberately.
    expect({ heroKeys, cardKeys }).toEqual({ heroKeys: 4, cardKeys: 5 });
  });

  it('every stat key has a token AND a definition — no half-covered stat', () => {
    for (const key of STAT_KEYS) {
      expect(STAT_TOKEN[key], `${key} token`).toBeTruthy();
      expect(STAT_RULE[key].title, `${key} title`).toBeTruthy();
      expect(STAT_RULE[key].body.length, `${key} body`).toBeGreaterThan(20);
    }
    expect(STAT_LABELS).toEqual(STAT_KEYS.map((k) => STAT_TOKEN[k]));
  });

  it('every gem renders a non-empty, fully-formed face', () => {
    const problems: string[] = [];
    for (const gem of GEMS) {
      const face = renderGemText(gem);
      if (face.trim() === '') problems.push(`${gem.id}: empty face`);
      if (!face.endsWith('.')) problems.push(`${gem.id}: face does not end in a full stop — "${face}"`);
      if (renderGemClauses(gem).length === 0) problems.push(`${gem.id}: payload produced no clause`);
      if (/ {2}| · \.|· $/.test(face)) problems.push(`${gem.id}: malformed spacing — "${face}"`);
      if (face === 'No effect.') problems.push(`${gem.id}: fell through to the empty-payload fallback`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('no gem carries two actions of the same kind (the card merge pass has no gem twin)', () => {
    // `compose.ts` merges same-kind DoT piles on a CARD because the engine
    // merges them on the victim. `renderGemClauses` deliberately has no merge
    // pass; this is what makes that safe rather than lucky.
    for (const gem of GEMS) {
      if (gem.kind !== 'effect') continue;
      const kinds = gem.actions.map((a) => a.kind);
      expect(new Set(kinds).size, `${gem.id} repeats a kind: ${kinds.join(',')}`).toBe(kinds.length);
    }
  });

  it('every {{token}} a gem face prints resolves to a colour', () => {
    const missing = new Set<string>();
    for (const gem of GEMS) {
      for (const token of markedKeywords(renderGemText(gem))) {
        if (KEYWORD_TEXT_COLOR[token] === undefined) missing.add(`${token} (${gem.id})`);
      }
    }
    expect([...missing], [...missing].join('\n')).toEqual([]);
  });

  it('the generated opener agrees with the payload category, on every gem', () => {
    // The structural replacement for the validator's deleted opener check
    // (gem ruleset R1.1's second half) — see `validateGemContent.ts`.
    const problems: string[] = [];
    for (const gem of GEMS) {
      const category = gemCategoryOf(gem);
      const opener = GEM_OPENER[category];
      const face = renderGemText(gem);
      if (opener !== '' && !face.startsWith(`${opener} `)) {
        problems.push(`${gem.id}: a ${category} must open "${opener}", got "${face}"`);
      }
      if (opener === '') {
        for (const other of ['This card:', 'Hero:']) {
          if (face.startsWith(other)) problems.push(`${gem.id}: a ${category} borrows the "${other}" opener`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
    expect(GEM_OPENER.Core).toBe('This card:');
    expect(GEM_OPENER.Charm).toBe('Hero:');
  });

  it('the engine-side gem category agrees with the loader-side one, on every gem', () => {
    // Two classifiers exist because one reads an UNVALIDATED JSON record and
    // the other a typed `Gem`; this is the pin that keeps them one rule.
    for (const entry of document.gems) {
      const current = entry.versions.reduce((a, b) => (b.version > a.version ? b : a));
      const raw = current.def as unknown as Record<string, unknown>;
      expect(categoryOfGem(raw), entry.id).toBe(gemCategoryOf(gemBook[entry.id]!));
    }
  });
});

// ---------------------------------------------------------------------------
// (B) ONE REFERENCE
// ---------------------------------------------------------------------------

describe('(B) one reference: a gem explains a keyword with the CARD\'s sentence', () => {
  it('a gem\'s keyword entry is byte-identical to the card path\'s entry', () => {
    const problems: string[] = [];
    for (const gem of GEMS) {
      if (gem.kind !== 'effect') continue;
      for (const action of gem.actions) {
        const fromCardPath = ruleEntryOf(action);
        if (!fromCardPath) continue;
        const fromGemPath = gemRuleEntries(gem).find((e) => e.title === fromCardPath.title);
        if (!fromGemPath) { problems.push(`${gem.id}: ${action.kind} -> "${fromCardPath.title}" not reachable from the gem`); continue; }
        if (fromGemPath.body !== fromCardPath.body) problems.push(`${gem.id}: ${action.kind} body differs between the card and gem paths`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('a stat gem\'s helper is the SAME sentence a statline hover shows', () => {
    // `Hero: +8 MATK` and the battle statline's `MATK 14` open one definition.
    const charm = gemBook.archmages_core!;
    expect(gemRuleEntries(charm)).toEqual([STAT_RULE.magicPower]);
    expect(statHoverEntry('MATK')).toEqual(STAT_RULE.magicPower);
    expect(statRuleByToken('matk')).toEqual(STAT_RULE.magicPower);
  });

  it('a card\'s buff/debuff clause names the stat, and the stat has one definition', () => {
    // `ruleEntriesOf` is the seam that lets a card's `+20% ATK (2t)` open the
    // ATK definition as well as the duration rule — the same pair a Charm's
    // `Hero: +4 ATK` opens.
    const action: Action = { kind: 'buffStat', stat: 'attack', pct: 20, turns: 2 };
    const entries = ruleEntriesOf(action);
    expect(entries.map((e) => e.title)).toEqual(['Stat buff', STAT_RULE.attack.title]);
    expect(entries[1]).toEqual(STAT_RULE.attack);
  });

  it('the UI stat token table IS the registry table (one object, not two)', () => {
    // Stronger than the old value-by-value pin: the same reference.
    expect(UI_STAT_TOKEN).toBe(STAT_TOKEN);
  });

  it('EVERY stat definition is number-free — no exceptions', () => {
    // The keyword `ruleSentence` ban, applied to the stat table. STRONGER than
    // before: the HP body used to end "0 HP is a loss" and needed a carve-out.
    // The 2026-09-07 user-approved rewrite ("shorter atk information") removed
    // that digit, so every stat body is now checked with no exception.
    for (const key of STAT_KEYS) {
      const body = STAT_RULE[key].body;
      expect(body.includes('%'), `${key} names a percentage`).toBe(false);
      expect(/\{\{[^{}]+\}\}/.test(body), `${key} carries markup`).toBe(false);
      expect(/\d/.test(body), `${key} contains a digit — "${body}"`).toBe(false);
    }
  });

  it('the six stat definitions are pinned literally — no re-authoring without approval', () => {
    // Originally these pinned `statGlossary.ts`'s bodies verbatim ("move,
    // don't author"). The user approved a rewrite on 2026-09-07 — shorter, and
    // naming stats by the token the COMBAT LOG prints (DEF/MDEF, never "Armor"
    // or "Magic Resist"; no "banked readiness"). The pin stays a literal so the
    // next unapproved edit still fails here.
    expect(STAT_RULE.maxHp.body).toBe('Hit points. Reaching zero is a loss.');
    expect(STAT_RULE.attack.body).toBe('Scales physical damage.');
    expect(STAT_RULE.magicPower.body).toBe('Scales magical damage.');
    expect(STAT_RULE.armor.body).toBe('Scales physical healing and Shield. Reduces physical damage taken.');
    expect(STAT_RULE.magicResist.body).toBe('Scales magical healing and Shield. Reduces magical damage taken.');
    expect(STAT_RULE.armor.body).toBe('Reduces incoming physical damage.');
    expect(STAT_RULE.magicResist.body).toBe('Reduces incoming magical damage.');
    expect(STAT_RULE.speed.body).toBe('Adds readiness each turn. Playing a card costs weight.');
    expect(statRuleByToken('WEIRD')).toEqual({ title: 'WEIRD', body: 'A combat stat.' });
  });

  it('no stat definition uses a word the combat log never prints', () => {
    // The 2026-09-07 rule: helpers speak the log's vocabulary. `fight.ts` prints
    // "readiness", "weight" and the STAT_TOKEN forms; it never prints "Armor",
    // "Magic Resist" or "banked".
    for (const key of STAT_KEYS) {
      const body = STAT_RULE[key].body;
      for (const banned of ['Armor', 'Magic Resist', 'banked']) {
        expect(body.includes(banned), `${key} says "${banned}" — use the log's token`).toBe(false);
      }
    }
  });

  it('no gem-only prose exists: every hover entry under the header is a registry entry', () => {
    const registryBodies = new Set<string>();
    for (const key of STAT_KEYS) registryBodies.add(STAT_RULE[key].body);
    for (const key of CARD_MOD_KEYS) registryBodies.add(MOD_RULE[key].body);
    for (const skill of Object.values(skillBook)) {
      for (const action of skill.effects) for (const e of ruleEntriesOf(action)) registryBodies.add(e.body);
    }
    for (const kind of Object.keys(KEYWORD_TEXT) as Action['kind'][]) {
      if (KEYWORD_TEXT[kind].ruleSentence !== '') registryBodies.add(KEYWORD_TEXT[kind].ruleSentence);
    }
    const strangers: string[] = [];
    for (const gem of GEMS) {
      for (const entry of gemHoverEntries(gem).slice(1)) {
        if (!registryBodies.has(entry.body)) strangers.push(`${gem.id}: "${entry.title}" body is not a registry sentence`);
      }
    }
    expect(strangers, strangers.join('\n')).toEqual([]);
  });

  it('the hover header says WHOSE lines these are, and the chip agrees with it', () => {
    const gem = gemBook.venom_fang_echo!;
    const [header] = gemHoverEntries(gem);
    expect(header?.title).toBe('Gem effect');
    expect(header?.body).toContain(gemChipLines(gem).effect);
  });
});

// ---------------------------------------------------------------------------
// (C) HOST-LESS PURITY
// ---------------------------------------------------------------------------

describe('(C) host-less: a gem face never names a host-owned term', () => {
  const PROPERTIES: readonly Property[] = ['physical', 'magical', 'true'];

  it('the placeholder property in the gem context is genuinely never read', () => {
    // `GEM_CTX.property` has to be SOMETHING (a card always has one). This is
    // the assertion that makes it a placeholder rather than a decision: every
    // gem renders identically under all three properties.
    const problems: string[] = [];
    for (const gem of GEMS) {
      if (gem.kind !== 'effect') continue;
      const rendered = PROPERTIES.map((property) => gem.actions
        .map((action) => faceClauseOf(action, { ...GEM_CTX_PROBE, property }))
        .join(' · '));
      if (new Set(rendered).size !== 1) problems.push(`${gem.id}: property changes the face — ${rendered.join(' || ')}`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('no gem face carries a type word, a stat suffix or a property word', () => {
    const BANNED = [
      '(+ATK)', '(+MATK)', '(+DEF)', '(+MDEF)', '(+best stat)',
      'physical shield', 'magical shield', 'TRUE shield',
      'Sword', 'Axe', 'Lance', 'Bow', 'Beast', 'Fire', 'Frost', 'Lightning', 'Nature', 'Holy', 'Dark',
    ];
    const problems: string[] = [];
    for (const gem of GEMS) {
      const face = renderGemText(gem);
      for (const term of BANNED) {
        if (face.includes(term)) problems.push(`${gem.id}: face names the host's ${term} — "${face}"`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('a gem reads the same standalone as it does socketed', () => {
    // One gem, one sentence: `renderGemText` takes no host argument at all, so
    // the pouch, the socket panel, the shop shelf and the wiki cannot differ.
    expect(renderGemText.length).toBe(1);
    for (const gem of GEMS) expect(renderGemText(gem)).toBe(renderGemText(gem));
  });

  it('no gem face contains a mechanism word — the definitions carry those', () => {
    // The same regression guard the card faces carry (spec §6.3). Every one of
    // these words was literally present in the 53 authored gem strings this
    // change deleted.
    const BANNED = ['ticks', 'bypass', 'outright', 'whenever', 'instead of', 'never', 'stack count', 'default target', 'separate hit', 'paid once'];
    const problems: string[] = [];
    for (const gem of GEMS) {
      const face = stripCardTextMarkup(renderGemText(gem)).toLowerCase();
      for (const word of BANNED) {
        if (face.includes(word)) problems.push(`${gem.id}: face contains mechanism word "${word}" — "${face}"`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

/** The gem render context, re-declared here as a PROBE so the test can vary
 * one field. Kept structurally identical to `gemText.ts`'s own `GEM_CTX`; the
 * test above is what proves the field it varies is inert. */
const GEM_CTX_PROBE: RenderCtx = {
  property: 'physical',
  element: undefined,
  weapon: undefined,
  size: 1,
  speedWeight: undefined,
  cooldownTurns: undefined,
  aoe: false,
  gated: false,
  host: 'gem',
};

// ---------------------------------------------------------------------------
// (D) THE GOLDEN SET
// ---------------------------------------------------------------------------

/**
 * Thirteen faces covering every structural feature of the gem grammar exactly
 * once: each of the four categories, both scope openers, a two-action gem in
 * registry (not authored) order, the two stat-mod tables, the Echo's dial, a
 * host-less shield and heal, and a rider that marks up another keyword's
 * status.
 */
const GOLDEN: Record<string, string> = {
  // Charm — hero scope, the stat token and nothing else.
  archmages_core: 'Hero: +8 MATK.',
  swift_charm: 'Hero: +4 SPD.',
  // Core — card scope, the aura's own three words for the same three mods.
  war_banner_echo: 'This card: +4 damage.',
  restorative_core: 'This card: +8 healing.',
  lightweight_core: 'This card: -2 weight.',
  // Echo — the one gem with a hit, plus its tempo dial. No "Echo:" opener: the
  // clause already reads "Echo".
  resonant_echo: 'Echo 1/2 · +25% weight.',
  // Host-less headline sinks: no property word, no stat suffix.
  iron_bulwark_echo: 'Gain 4 {{shield}}.',
  mending_light_echo: 'Restore 4 HP.',
  // Two actions, ordered by the registry's groups (headline before selfGrant)
  // rather than by authoring order.
  renewal_sliver: 'Restore 3 HP · {{Cleanse}} 1.',
  sanctuary_sliver: '{{Ward}} 1 · +5% DEF (2t).',
  // A rider that marks up ANOTHER keyword's status.
  festering_sliver: '+8 vs {{Poison}}.',
  // The mechanism-heaviest authored strings in the old catalog, now parameters.
  ballast_sliver: '{{Burden}} +8wt.',
  provoker_sliver: '{{Taunt}} +2.',
};

describe('(D) the gem golden set', () => {
  for (const [id, expected] of Object.entries(GOLDEN)) {
    it(id, () => {
      const gem = gemBook[id];
      expect(gem, `${id} left the catalog`).toBeDefined();
      expect(renderGemText(gem!)).toBe(expected);
    });
  }

  it('the card-mod words are the aura\'s words', () => {
    // `StatGemMods.card` is AuraMods-shaped, so a Core prints what an aura
    // prints for the same mod. One vocabulary, stated in `CARD_MOD_TEXT`.
    expect(CARD_MOD_KEYS.map((k) => CARD_MOD_TEXT[k].faceClause(4))).toEqual(['+4 damage', '+4 healing', '+4 weight']);
    expect(CARD_MOD_TEXT.weightDelta.faceClause(-2)).toBe('-2 weight');
  });

  it('every hero mod prints its stat token, signed', () => {
    const keys: readonly StatLabelKey[] = STAT_KEYS;
    for (const key of keys) {
      if (key === 'maxHp') continue;
      expect(HERO_MOD_TEXT[key].faceClause(6)).toBe(`+6 ${STAT_TOKEN[key]}`);
    }
  });
});

// ---------------------------------------------------------------------------
// (E) THE FIX ROUND — every finding of the 2026-09-07 review, pinned
// ---------------------------------------------------------------------------

describe('(E) the three card-scope mods carry their own mechanic', () => {
  it('a damageFlat gem HANDS THE PLAYER the per-hit rule, and its face still does not', () => {
    // The review's Important: `This card: +6 damage.` is worth +12 on a
    // two-hit card, because `mods.damageFlat` applies PER HIT
    // (`balance.ts#extraHitPremium`, `interpreter.ts`'s per-target
    // `flatBonus`) — and `gemRuleEntries` returned [] so nothing said so
    // anywhere. Face unchanged (the amount is a parameter); the mechanic is a
    // definition now.
    const gem = gemBook.empowering_core!;
    expect(renderGemText(gem)).toBe('This card: +6 damage.');
    const entries = gemRuleEntries(gem);
    expect(entries.map((e) => e.title)).toEqual(['Damage bonus']);
    expect(entries[0]!.body).toBe('Add X damage to each hit from this card.');
    // ...and the same is true of the other card-scope Core gems.
    expect(gemRuleEntries(gemBook.war_banner_echo!).map((e) => e.title)).toEqual(['Damage bonus']);
    expect(gemRuleEntries(gemBook.restorative_core!).map((e) => e.title)).toEqual(['Flat healing']);
    expect(gemRuleEntries(gemBook.lightweight_core!).map((e) => e.title)).toEqual(['Weight change']);
  });

  it('the gems that open NO definition are exactly the two plain heals', () => {
    // Five gems opened nothing before the fix round. Three of them were the
    // flat damage/healing Cores and they are fixed above. The two that remain
    // are `heal`-only Slivers, and that is NOT a gem decision to make: the
    // card registry gives `heal` an empty `ruleSentence` on purpose ("no rule
    // of their own beyond what the type badge already teaches"), so giving one
    // to these two would add a Heal entry to every healing CARD in the game.
    // Pinned BY NAME so the set cannot grow quietly while that decision waits.
    const silent = GEMS.filter((g) => gemRuleEntries(g).length === 0).map((g) => g.id).sort();
    expect(silent).toEqual(['mending_light_echo', 'second_wind_echo']);
    for (const id of silent) {
      const gem = gemBook[id]!;
      expect(gem.kind).toBe('effect');
      // ...and their whole payload really is one plain heal, so the face is a
      // complete statement of what they do.
      expect((gem as { actions: Action[] }).actions.map((a) => a.kind)).toEqual(['heal']);
      expect(KEYWORD_TEXT.heal.ruleSentence).toBe('');
    }
  });

  it('the three MOD_RULE bodies are definitions — no digit, no percent, no markup', () => {
    for (const key of CARD_MOD_KEYS) {
      const body = MOD_RULE[key].body;
      expect(/\d/.test(body), `${key} contains a digit — "${body}"`).toBe(false);
      expect(body.includes('%'), `${key} names a percentage`).toBe(false);
      expect(/\{\{[^{}]+\}\}/.test(body), `${key} carries markup`).toBe(false);
      expect(body.length, `${key} body`).toBeGreaterThan(40);
    }
    // The floor in the weight rule is spelled as a word for exactly that reason.
    expect(MOD_RULE.weightDelta.body).toContain('below a weight of one');
  });

  it('the healFlat rule states the TRUE exception the engine actually applies', () => {
    // `interpreter.ts`'s heal case skips `mods` entirely for a TRUE heal
    // ("flat by identity"), and `resolveDisplaySkill` mirrors it. A definition
    // that omitted this would be wrong on every TRUE healing card.
    expect(MOD_RULE.healFlat.body).toContain('never to a TRUE heal');
  });
});

describe('(E) one wording for the aura mods — face, chip and badge', () => {
  it('the card FACE and the compact chip print the same words for the same mod', () => {
    // The review's Important: `auraClause` said `deal +6` / `heal +10` on the
    // face while `formatAuraModifiers` said `+6 damage` / `+10 healing` for the
    // identical mod. Both now read `CARD_MOD_TEXT`, so this compares the two
    // real renderers rather than two copies of a string.
    const aura = { damageFlat: 6, healFlat: 10, weightDelta: -2 };
    const chip = formatAuraModifiers(aura);
    for (const key of CARD_MOD_KEYS) {
      const word = CARD_MOD_TEXT[key].faceClause(aura[key]);
      expect(chip, `chip is missing "${word}"`).toContain(word);
    }
    expect(renderSkillText(skillBook.enfilade_volley!)).toContain(CARD_MOD_TEXT.damageFlat.faceClause(3));
    // And the OLD wordings are gone from every generated face in the catalog.
    for (const skill of Object.values(skillBook)) {
      const text = renderSkillText(skill);
      expect(text.includes('deal +'), `${skill.id} still says "deal +"`).toBe(false);
      expect(text.includes('heal +'), `${skill.id} still says "heal +"`).toBe(false);
    }
  });

  it('an aura clause opens the same definition a Core gem does', () => {
    // Same mod, same mechanic, same sentence — whether it arrives from a
    // neighbour's aura or from a gem in this card's socket.
    expect(CARD_MOD_TEXT.damageFlat.rule).toBe(MOD_RULE.damageFlat);
    expect(gemRuleEntries(gemBook.empowering_core!)[0]).toBe(MOD_RULE.damageFlat);
  });
});

describe('(E) one name per keyword: the tapped word appears in its heading', () => {
  it('every keyword whose face wraps a word is explained under THAT word', () => {
    // The review's Minor: 8 kinds where the tapped word and the panel heading
    // differed. The invariant is CONTAINMENT, not equality, because six of
    // those headings are a PHRASE BUILT ON the tapped word ("Attuned shield"
    // for `{{Attuned}}`, "Ward release" for `{{Ward}}`) — which is one name,
    // not two. The two that were genuinely a SECOND name are fixed:
    // `shieldBreak` was headed "Shield break" for a face that says
    // `{{Shatter}}`, and `disrupt` was headed "Stagger" for a face that says
    // `{{Disrupt}}`.
    const problems: string[] = [];
    for (const kind of ACTION_KINDS) {
      const row = KEYWORD_TEXT[kind];
      const token = row.displayToken;
      // Nothing to tap, or a token that deliberately names ANOTHER keyword
      // (`exploit`/`stackBonus` borrow the status they read, and its colour).
      if (typeof token !== 'string') continue;
      if (row.ruleTitle === '') { problems.push(`${kind}: wraps {{${token}}} but has no heading`); continue; }
      if (!row.ruleTitle.toLowerCase().includes(token.toLowerCase())) {
        problems.push(`${kind}: face wraps "${token}" but the heading is "${row.ruleTitle}"`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('the two renamed keywords agree across face, badge and heading', () => {
    const shatter: Action = { kind: 'shieldBreak', amount: 16 };
    expect(KEYWORD_TEXT.shieldBreak.ruleTitle).toBe('Shatter');
    expect(faceClauseOf(shatter, GEM_CTX_PROBE)).toContain('{{Shatter}}');
    expect(faceTokenOf(shatter, GEM_CTX_PROBE).text).toContain('SHATTER');
    const disrupt: Action = { kind: 'disrupt', amount: 4 };
    expect(KEYWORD_TEXT.disrupt.ruleTitle).toBe('Disrupt');
    expect(faceClauseOf(disrupt, GEM_CTX_PROBE)).toContain('{{Disrupt}}');
    // The badge said STAG — an abbreviation of a word nothing else in the game
    // used. Every surface says Disrupt now.
    expect(faceTokenOf(disrupt, GEM_CTX_PROBE).text).toBe('DISRUPT 4');
  });

  it('the Echo share notation is explained in words, not left as "1/2"', () => {
    // `resonant_echo` is the notation's only reader in the game, and the
    // authored text ("repeats at half strength") is what the migration dropped.
    expect(renderGemText(gemBook.resonant_echo!)).toBe('Echo 1/2 · +25% weight.');
    const echo = KEYWORD_TEXT.statStrike.ruleSentence;
    expect(echo).toContain('one over two');
    expect(/\d/.test(echo), 'the definition stays number-free').toBe(false);
  });
});

describe('(E) a repeated headline says "again" / "more"', () => {
  it('a gated hit that repeats the headline says AGAIN, with the authored words', () => {
    // 20 authored faces said "hit again for 28" for this exact shape; the
    // first generated pass said "Deal 28 (+ATK)", which reads as an unrelated
    // second attack. Two real cards, through the one renderer both platforms use.
    expect(renderSkillText(skillBook.sworn_edge!))
      .toBe('Deal 34 (+ATK) Sword damage · {{Affinity}} Sword — Hit again for 28 (+ATK).');
    expect(renderSkillText(applyTier(skillBook.arcane_bolt!, 'diamond')))
      .toBe('Deal 24 (+MATK) Lightning damage · {{Affinity}} Lightning — Hit again for 48 (+MATK).');
  });

  it('a gated heal that repeats the headline says MORE', () => {
    expect(renderSkillText(skillBook.gravelight_choir!)).toContain('Restore 12 (+MDEF) more HP');
  });

  it('a gated clause of a DIFFERENT kind does NOT say again or more', () => {
    // The control: `grove_communion` is a DAMAGE headline with a gated HEAL,
    // and `oathplate` is a SHIELD headline with gated PLATING. Neither is a
    // repeat, so neither may borrow the word.
    const communion = renderSkillText(skillBook.grove_communion!);
    expect(communion).toContain('Restore 64 (+MDEF) HP');
    expect(communion.includes('more'), communion).toBe(false);
    expect(communion.includes('again'), communion).toBe(false);
    const oath = renderSkillText(skillBook.oathplate!);
    expect(oath.includes('more'), oath).toBe(false);
    expect(oath.includes('again'), oath).toBe(false);
  });

  it('authoring order cannot change the face — for ALL THREE sinks', () => {
    // THE PREVIOUS VERSION OF THIS TEST WAS VACUOUS and the review caught it:
    // it reversed `sworn_edge`, whose ungated DAMAGE clause is accumulated and
    // pushed before the per-action loop, so it could not have failed under any
    // implementation. `heal` and `shield` emitted in AUTHORING order, and a
    // reversed heal card really did lead with the repeat ("Restore 12 (+MDEF)
    // more HP" before the 6 it repeats). Fixed structurally in `compose.ts`
    // (ungated pass, then gated pass) and pinned here on all three kinds — a
    // real heal card, a real damage card, and a synthetic shield pair, because
    // no shipped card has two shield lines.
    const cards: SkillDef[] = [
      skillBook.gravelight_choir!, // ungated heal + gated heal (the real failure)
      skillBook.sworn_edge!,       // ungated damage + gated damage
      {
        ...skillBook.aegis_wall!,
        effects: [{ kind: 'shield', power: 20 }, { kind: 'shield', power: 8, affinity: true }],
      },
    ];
    for (const card of cards) {
      const flipped = { ...card, effects: [...card.effects].reverse() };
      expect(renderSkillText(flipped), `${card.id} reads differently when authored in reverse`)
        .toBe(renderSkillText(card));
    }
    // ...and the ORDER is headline-then-repeat, not merely stable: the repeat
    // must come SECOND, which is the fact `repeatsHeadline` depends on.
    const heal = renderSkillText(skillBook.gravelight_choir!);
    expect(heal.indexOf('Restore 6 (+MDEF) HP')).toBeLessThan(heal.indexOf('more HP'));
  });

  it('a shield repeat says MORE too (no shipped card has the shape yet)', () => {
    // Pinned on a synthetic because the catalog has no gated shield after an
    // ungated one — so the arm is covered before content reaches it.
    const probe: SkillDef = {
      ...skillBook.aegis_wall!,
      effects: [
        { kind: 'shield', power: 20 },
        { kind: 'shield', power: 8, affinity: true },
      ],
    };
    expect(renderSkillText(probe)).toContain('Gain 8 (+DEF) more physical {{shield}}');
  });
});

// ---------------------------------------------------------------------------
// (F) THE DEFINITIONS ARE CHECKED AGAINST THE ENGINE, not against themselves
// ---------------------------------------------------------------------------

/**
 * `MOD_RULE.damageFlat` SAID A DEFENSE RULE THE ENGINE BREAKS (found by review 2,
 * 2026-09-07). Its first wording was "the target's Armor or Magic Resist still
 * applies to the total", which is true of a physical/magical host and FALSE of a
 * TRUE one: `applyStrike` computes
 *
 *   defense = property === 'true'
 *     ? Math.min(effectiveStat, effStat(enemy, armor|magicResist))   // stat only
 *     : mitigation(enemy, property);                                  // whole hit
 *
 * so on a TRUE card the flat add passes WHOLE however armoured the target is —
 * the engine's own comment says "defense can eat up to the stat add, never the
 * flat base or bonuses". Five shipped TRUE cards can host one.
 *
 * A wording test alone would not have caught this and would not catch the next
 * one, so these tests run the REAL SIM on the two real cards from the review's
 * fight log and read the numbers off the event. If `applyStrike`'s branch ever
 * changes, the sentence fails here rather than quietly becoming wrong again.
 */
function hitCalc(hostSkillId: string): DamageCalculation {
  // `standard_of_the_ninth` is an ALL-BOARD +6 damageFlat aura, so the host's
  // hit carries `mods.damageFlat = 6` — the same board the fight log used.
  const hero = tc('Hero', [], { attack: 1, magicPower: 1 }, {
    boardSize: 10,
    pieces: [
      { skillId: 'standard_of_the_ninth', slot: 0 },
      { skillId: hostSkillId, slot: 2 },
    ],
  });
  const foe = tc('Foe', [], { maxHp: 30000, attack: 1, armor: 40, magicResist: 40 });
  const { events } = simulate(cfg(hero, foe, NO_ENDGAME), 5);
  const hit = events.find((e): e is Extract<typeof e, { kind: 'damage' }> => e.kind === 'damage'
    && e.side === 'enemy'
    && (e as { calculation?: DamageCalculation }).calculation !== undefined
    && ((e as { calculation: DamageCalculation }).calculation.effectBonusDamage > 0));
  expect(hit, `${hostSkillId} never landed a bonus-carrying hit on the foe`).toBeDefined();
  return (hit as unknown as { calculation: DamageCalculation }).calculation;
}

describe('(F) MOD_RULE.damageFlat matches applyStrike, on both branches', () => {
  it('on a TRUE host the flat add is NOT mitigable — defense is capped at the stat', () => {
    const c = hitCalc('void_pierce');
    expect(c.effectBonusDamage, 'the aura add reached the hit').toBe(6);
    // THE TRUE BRANCH: defense can never exceed this hit's stat share, so a
    // 40-Armor foe removes 1, not 40 — and the whole +6 lands.
    expect(c.defense).toBeLessThanOrEqual(c.effectiveStat);
    expect(c.hpDamage).toBeGreaterThanOrEqual(c.effectBonusDamage);
    // The fight log this mirrors: `11 +BONUS6 -DEF1 = 16 HP`.
    expect(c.hpDamage).toBe(c.power + c.effectiveStat + c.effectBonusDamage - c.defense);
  });

  it('on a PHYSICAL host the same aura add IS eaten by Armor', () => {
    const c = hitCalc('sword_slash');
    expect(c.effectBonusDamage, 'the aura add reached the hit').toBe(6);
    // THE OTHER BRANCH: full mitigation, which here exceeds base + stat + add.
    expect(c.defense).toBeGreaterThan(c.effectiveStat);
    expect(c.defense).toBeGreaterThan(c.effectBonusDamage);
    // The control from the same fight log: `21 +BONUS6 -DEF27 +MIN1 ...`.
    expect(c.power + c.effectiveStat + c.effectBonusDamage).toBeLessThanOrEqual(c.defense);
  });

  it('the SENTENCE names both branches, in words', () => {
    const body = MOD_RULE.damageFlat.body;
    expect(body).toContain('physical or magical');
    expect(body).toContain('TRUE');
    expect(body).toContain('untouched');
    // ...and it no longer claims mitigation applies unconditionally.
    expect(body.includes('still applies to the total')).toBe(false);
    expect(/\d/.test(body), 'still number-free').toBe(false);
  });

  it('the healFlat sentence no longer denies a TRUE heal its rider bonus', () => {
    // `interpreter.ts`'s TRUE heal arm is `amount = action.power + bonus`, where
    // `bonus` is `cast.healBonusFlat` (the `cleanseConvert` rider) — added on
    // purpose ("a TRUE heal is irreducible, not unbuffable"). The first wording
    // said a TRUE heal "takes no stat or bonus term at all".
    const body = MOD_RULE.healFlat.body;
    expect(body).toContain('no stat term and no aura or gem term');
    expect(body).toContain('rider');
    expect(body.includes('no stat or bonus term at all')).toBe(false);
    expect(/\d/.test(body), 'still number-free').toBe(false);
  });
});

describe('(G) the per-hit rule reaches a HOST-LESS gem panel too', () => {
  it('gemDefinitionsText carries the same entries the hover header carries', () => {
    // The shop's gem BUY dock and both Wiki GEMS detail panes show a gem with
    // NO host card, so `renderCardInfoBox` (which needs a `SkillDef`) cannot
    // serve them — they print this instead. It must be the SAME entries, or
    // the six surfaces drift again.
    const gem = gemBook.empowering_core!;
    const fromHover = gemHoverEntries(gem).slice(1);
    const printed = gemDefinitionsText(gem);
    expect(fromHover.length).toBeGreaterThan(0);
    for (const entry of fromHover) {
      expect(printed, `missing "${entry.title}"`).toContain(entry.title.toUpperCase());
      expect(printed, `missing the body of "${entry.title}"`).toContain(entry.body);
    }
    // The review's bar, literally: from a shop shelf alone a player can learn
    // that this gem's +6 lands on every hit.
    expect(printed).toContain('EVERY hit');
  });

  it('it is EMPTY only for the two gems that open no definition', () => {
    // So a caller can skip the row instead of drawing an empty box, and so the
    // set of silent gems cannot grow unnoticed.
    const empty = GEMS.filter((g) => gemDefinitionsText(g) === '').map((g) => g.id).sort();
    expect(empty).toEqual(['mending_light_echo', 'second_wind_echo']);
  });

  it('it prints NO gem-specific prose — every body is a registry sentence', () => {
    const registryBodies = new Set<string>();
    for (const key of STAT_KEYS) registryBodies.add(STAT_RULE[key].body);
    for (const key of CARD_MOD_KEYS) registryBodies.add(MOD_RULE[key].body);
    for (const kind of ACTION_KINDS) {
      if (KEYWORD_TEXT[kind].ruleSentence !== '') registryBodies.add(KEYWORD_TEXT[kind].ruleSentence);
    }
    const strangers: string[] = [];
    for (const gem of GEMS) {
      for (const entry of gemHoverEntries(gem).slice(1)) {
        if (!registryBodies.has(entry.body)) strangers.push(`${gem.id}: "${entry.title}"`);
      }
    }
    expect(strangers, strangers.join('\n')).toEqual([]);
  });
});
