import { describe, expect, it } from 'vitest';
import { enemies } from '../../src/data/enemies';
import { biomeCatalog as biomes } from '../../src/data/biomes';
import type { EnemyDef, EnemyGrowthCandidate, EnemyGrowthMilestone, GrowthFamily } from '../../src/engine/types';
import { skillBook } from '../../src/data/skills';
import { boardAffinities, cardType } from '../../src/engine/combat/typeIdentity';
import { HERO_BOARD_SLOTS } from '../../src/data/heroes';
import {
  capPackTitle, ELITE_AFFIX_IDS, ENEMY_MODIFIER_IDS, ENEMY_TITLES,
  MODIFIER_PRESETS, resolveEncounterForEnemy, TITLE_RAMP_FULL_FIGHT, titlePresetFor,
  type EnemyTitle,
} from '../../src/run/encounter';
import { fightSpecFor, fightTableEntryForNode } from '../../src/run/runState';
import { BOSS_EVERY } from '../../src/run/runMap';
import {
  affinityMatchesBandAtLevel2,
  earnsAffinityByLevel2,
  everyGatedCardOpenAtLevel2,
  GROWTH_VALIDATION_LEVEL,
  matureAffinityAt,
} from '../../src/run/enemyGrowthValidators';

/**
 * THE THREE GROWTH VALIDATORS (Q3, `docs/superpowers/specs/2026-09-06-
 * enemy-growth-by-level-design.md`) — pure-function unit tests on SYNTHETIC
 * fixtures, plus literal live-roster authoring expectations and a production
 * title/affix/modifier/pack context sweep. Missing content, an unrelated
 * fallback, a swallowed addition, or reconstruction drift must fail here.
 *
 * Fixtures use REAL skill ids from the shipped book (never invented ones —
 * an id that could not be authored for real proves nothing) assembled into
 * `EnemyDef` objects that are not part of the live roster.
 */

const UNIVERSAL_STATLINE = { maxHp: 100, hp: 100, attack: 1, magicPower: 1, armor: 1, magicResist: 1, speed: 10 };

type RosterGrowthExpectation = readonly [
  GrowthFamily['kind'], GrowthFamily['type'], EnemyGrowthMilestone['purpose'],
  readonly EnemyGrowthCandidate[], string,
];

// Literal content intent, independent of the resolver and the live growth fields.
// One earned addition is sufficient for each kit; the remaining steps buy tiers.
// No tier-only exception: every current kit has an existing fitting family card.
const ROSTER_GROWTH_EXPECTATIONS = {
  arc_adept: ['element', 'lightning', 'complete-affinity', [{ skillId: 'storm_surge' }, { skillId: 'storm_tithe' }], 'Escalate the existing speed and hostile tempo race.'],
  bandit_duelist: ['weapon', 'sword', 'reinforce-family', [{ skillId: 'riposte_guard' }, { skillId: 'iron_riposte' }], 'Deepen the duelist counter and parry plan.'],
  barrow_wight: ['element', 'dark', 'reinforce-family', [{ skillId: 'nullshroud' }], 'Protect the existing true-damage and recovery rotation.'],
  berserker: ['weapon', 'axe', 'reinforce-family', [{ skillId: 'thorn_reckoning' }, { skillId: 'champions_challenge' }], 'Read the existing thorns pile; compact fallback protects the wounded brute.'],
  bleed_reaver: ['weapon', 'axe', 'reinforce-family', [{ skillId: 'bleed_executioner' }], 'Pay off the bleed already applied by both opening attacks.'],
  blight_shambler: ['element', 'nature', 'reinforce-family', [{ skillId: 'bramble_covenant' }], 'Maintain poison for Blight Feast while banking more protection.'],
  blood_duelist: ['weapon', 'axe', 'complete-affinity', [{ skillId: 'gutting_cleave' }, { skillId: 'cleaving_creed' }], 'Add another bleed source for the existing executioner.'],
  bramble_matriarch: ['element', 'nature', 'reinforce-family', [{ skillId: 'heartwood_sanctum' }, { skillId: 'poison_bloom' }], 'Extend the poison and healing siege.'],
  cinder_monarch: ['element', 'fire', 'reinforce-family', [{ skillId: 'burn_detonator' }], 'Cash in the burn already supplied by the full rotation.'],
  cinder_sprite: ['element', 'fire', 'complete-affinity', [{ skillId: 'ember_lash' }], 'Open Kindling Rite and give its charge another light burn attack.'],
  cleric: ['element', 'holy', 'reinforce-family', [{ skillId: 'sanctuary_overflow' }], 'Add a healing and shield conversion to the pure support kit.'],
  cordon_archer: ['weapon', 'bow', 'complete-affinity', [{ skillId: 'steady_draw' }], 'Recover behind the existing ward and charge the next heavy shot.'],
  dawn_arbiter: ['element', 'holy', 'reinforce-family', [{ skillId: 'ward_of_silence' }], 'Add compact magical denial to the existing barrier siege.'],
  deadeye_stalker: ['weapon', 'bow', 'reinforce-family', [{ skillId: 'massed_volley' }, { skillId: 'enfilade_volley' }], 'Add another volley to the existing marked-arrow offense.'],
  ember_imp: ['element', 'fire', 'reinforce-family', [{ skillId: 'wildfire_surge' }, { skillId: 'scorching_brand' }], 'Keep every added card a burn-bearing attack.'],
  frostbound_zealot: ['element', 'frost', 'complete-affinity', [{ skillId: 'hoarfrost_creed' }, { skillId: 'glacial_spike' }], 'Open Deepening Frost and reinforce its offensive frost plan.'],
  furnace_elemental: ['element', 'fire', 'complete-affinity', [{ skillId: 'forgeheart_bastion' }, { skillId: 'cinder_skin' }], 'Open Kindred Flame behind another magical defensive layer.'],
  galewright: ['element', 'lightning', 'reinforce-family', [{ skillId: 'storm_tithe' }], 'Extend the readiness denial after the charged burst.'],
  giant_rat: ['weapon', 'beast', 'complete-affinity', [{ skillId: 'second_bite' }, { skillId: 'packline_flank' }], 'Keep the light poison-chip identity; a compact bite fallback handles the venomous affix duplicate.'],
  glacial_warden: ['element', 'frost', 'reinforce-family', [{ skillId: 'hibernation' }], 'Recover behind the existing magical guard and speed denial.'],
  gorse_hound: ['weapon', 'beast', 'reinforce-family', [{ skillId: 'pack_instinct' }, { skillId: 'packline_flank' }], 'Give the attack-buff board another on-family multi-hit payoff.'],
  grave_acolyte: ['element', 'dark', 'complete-affinity', [{ skillId: 'graveside_rite' }], 'Extend the existing self-sustaining cleanse and lifesteal loop.'],
  greenwood_ranger: ['weapon', 'bow', 'complete-affinity', [{ skillId: 'quiverwardens_call' }], 'Charge the heavy bow rotation without an unreachable stun rider.'],
  greenwood_sovereign: ['weapon', 'bow', 'reinforce-family', [{ skillId: 'quiverwardens_call' }], 'Charge the established volley family.'],
  hedgerow_captain: ['weapon', 'lance', 'complete-affinity', [{ skillId: 'impaling_charge' }, { skillId: 'rearguard_pike' }], 'Support the armored line while opening lance affinity.'],
  hoarfrost_adept: ['element', 'frost', 'reinforce-family', [{ skillId: 'frostbind_litany' }], 'Extend the anti-caster debuff pattern and add cleanup.'],
  hollow_crown: ['element', 'dark', 'reinforce-family', [{ skillId: 'soul_rend' }, { skillId: 'shadow_bolt' }], 'Add another dark finishing attack after the expose rotation.'],
  hunter: ['weapon', 'bow', 'reinforce-family', [{ skillId: 'marksmans_creed' }], 'Maintain the expose window for the volley rotation.'],
  knight: ['weapon', 'sword', 'reinforce-family', [{ skillId: 'standard_of_the_ninth' }, { skillId: 'oathplate' }], 'Deepen the existing attack-buff and defensive sword identity.'],
  mage: ['element', 'lightning', 'complete-affinity', [{ skillId: 'gathering_storm' }, { skillId: 'arcane_bolt', allowDuplicate: true }], 'Pure damage blaster; deliberate repeat preserves identity in compact contexts.'],
  moorfang_alpha: ['weapon', 'beast', 'complete-affinity', [{ skillId: 'leeching_fang' }, { skillId: 'savage_bite' }], 'Open Pack Instinct and deepen the beast attack and recovery rotation.'],
  necromancer: ['element', 'dark', 'reinforce-family', [{ skillId: 'ruinous_hex' }], 'Extend the existing dark debuff and curse pressure.'],
  phalanx_veteran: ['weapon', 'lance', 'reinforce-family', [{ skillId: 'bulwark_of_the_line' }, { skillId: 'rearguard_pike' }], 'Layer lance plating onto the established guard and thorns line.'],
  pike_conscript: ['weapon', 'lance', 'complete-affinity', [{ skillId: 'impaling_charge' }, { skillId: 'rearguard_pike' }], 'Keep the hit-and-hold lance identity.'],
  pyre_acolyte: ['element', 'fire', 'reinforce-family', [{ skillId: 'wildfire_rite' }, { skillId: 'scorching_brand' }], 'Supply more burn to the existing detonator.'],
  reliquary_deacon: ['element', 'holy', 'reinforce-family', [{ skillId: 'mending_light' }, { skillId: 'renewing_wave' }], 'Extend recovery in the existing healing and shield kit.'],
  rime_tyrant: ['element', 'frost', 'reinforce-family', [{ skillId: 'frost_shackle' }], 'Add a compact action-weight tax to the speed-denial plan.'],
  rime_wisp: ['element', 'frost', 'complete-affinity', [{ skillId: 'deep_freeze' }, { skillId: 'frost_shackle' }], 'Complete frost through another direct tempo-denial card.'],
  rogue: ['weapon', 'lance', 'reinforce-family', [{ skillId: 'ironmarch_tithe' }], 'Deepen the reach skirmisher action-tax pattern.'],
  rotwood_ancient: ['element', 'nature', 'complete-affinity', [{ skillId: 'heartwood_sanctum' }, { skillId: 'verdant_rebuke' }], 'Open Grove Lash behind an additional anti-affliction tool.'],
  ruin_warlord: ['weapon', 'axe', 'reinforce-family', [{ skillId: 'bleed_executioner' }], 'Pay off the bleed in Sundering Roar.'],
  rust_marauder: ['weapon', 'axe', 'complete-affinity', [{ skillId: 'cleaving_creed' }], 'Open Rustbind Hex while extending the bleeding attack pattern.'],
  seraph: ['element', 'holy', 'reinforce-family', [{ skillId: 'aegis_of_the_unbroken' }, { skillId: 'warding_prayer' }], 'Protect the existing guardian and healing rotation.'],
  shield_warden: ['weapon', 'sword', 'complete-affinity', [{ skillId: 'riposte_guard' }, { skillId: 'oathplate' }], 'Supply more sword plating for the shield-burst payoff.'],
  squall_binder: ['element', 'lightning', 'complete-affinity', [{ skillId: 'storm_tithe' }], 'Open Gathering Storm and deepen the readiness tax.'],
  stone_beetle: ['weapon', 'beast', 'complete-affinity', [{ skillId: 'ironhide' }], 'Complete its actual beast family while reinforcing the armored shell.'],
  sworn_colossus: ['weapon', 'sword', 'reinforce-family', [{ skillId: 'aegis_charge' }], 'Give the large existing shield reserve a damage payoff.'],
  sworn_recruit: ['weapon', 'sword', 'complete-affinity', [{ skillId: 'sworn_edge' }, { skillId: 'sword_slash' }, { skillId: 'void_pierce' }], 'Keep the simple sword offense behind its plain shield.'],
  tempest_herald: ['element', 'lightning', 'reinforce-family', [{ skillId: 'storm_tithe' }], 'Extend both sides of the existing speed and action-tax race.'],
  thicket_shaman: ['element', 'nature', 'reinforce-family', [{ skillId: 'blightstep_dirge' }], 'Add more poison and tempo denial to the nature caster.'],
  thorn_beast: ['weapon', 'beast', 'complete-affinity', [{ skillId: 'nettle_lash' }], 'Keep the counter-punch identity with another thorns-bearing bite.'],
  thornpike_marshal: ['weapon', 'lance', 'reinforce-family', [{ skillId: 'bramblemend' }], 'Maintain thorns while repairing the existing guarded line.'],
  toxic_druid: ['element', 'nature', 'reinforce-family', [{ skillId: 'blight_feast' }], 'Add an actual payoff for the three existing poison appliers.'],
  umbral_chanter: ['element', 'dark', 'complete-affinity', [{ skillId: 'ruinous_hex' }], 'Open Umbral Choir and add a direct-hit expose setup.'],
  venom_stalker: ['weapon', 'beast', 'complete-affinity', [{ skillId: 'leeching_fang' }, { skillId: 'packline_flank' }], 'Support the repeated poison-bite race with a same-family attack.'],
  vigil_keeper: ['element', 'holy', 'reinforce-family', [{ skillId: 'penitent_mending' }], 'Extend the established ward, cleanse, and recovery plan.'],
  warbreaker: ['weapon', 'axe', 'complete-affinity', [{ skillId: 'deadweight_toll' }], 'Give the existing burden opener its on-family weight-tax payoff.'],
  warded_sentinel: ['weapon', 'sword', 'reinforce-family', [{ skillId: 'sanctum_thorn' }, { skillId: 'oathplate' }], 'Extend the sentinel protection stack with wards and recovery.'],
  wolf_king: ['weapon', 'beast', 'reinforce-family', [{ skillId: 'second_bite' }, { skillId: 'blooded_fang' }], 'Add a poison payoff to the existing venom and lifesteal pack leader.'],
} satisfies Record<string, RosterGrowthExpectation>;

function expectedMilestone(row: RosterGrowthExpectation): EnemyGrowthMilestone {
  return { family: { kind: row[0], type: row[1] } as GrowthFamily, purpose: row[2], candidates: row[3] };
}

interface GrowthContext {
  title: EnemyTitle;
  fightNumber: number;
  modifiers: string[];
  affix: string | null;
  pack: boolean;
}

function growthContexts(): GrowthContext[] {
  const stacks: string[][] = [[]];
  // Walk the production generator through saturation and a whole final cadence.
  let lastFight = 1;
  while (fightSpecFor(lastFight).modifiers.length < ENEMY_MODIFIER_IDS.length) {
    if (lastFight > 1000) throw new Error('modifier generator never saturates');
    lastFight += 1;
  }
  for (let n = 1; n <= lastFight + BOSS_EVERY; n += 1) {
    const stack = fightSpecFor(n).modifiers;
    if (!stacks.some((known) => JSON.stringify(known) === JSON.stringify(stack))) stacks.push(stack);
  }
  const contexts: GrowthContext[] = [];
  for (const title of ENEMY_TITLES) {
    const packages = new Set<string>();
    for (let fightNumber = 1; fightNumber <= TITLE_RAMP_FULL_FIGHT; fightNumber += 1) {
      const key = JSON.stringify(titlePresetFor(title, fightNumber));
      if (packages.has(key)) continue;
      packages.add(key);
      for (const modifiers of stacks) {
        for (const affix of title === 'elite' ? [null, ...ELITE_AFFIX_IDS] : [null]) {
          contexts.push({ title, fightNumber, modifiers, affix, pack: false });
        }
      }
    }
  }
  const packTitles = [...new Set(ENEMY_TITLES.map(capPackTitle))];
  for (const title of packTitles) {
    for (const modifiers of stacks) contexts.push({ title, fightNumber: TITLE_RAMP_FULL_FIGHT, modifiers, affix: null, pack: true });
  }
  return contexts;
}

describe('authored growth covers the entire live roster', () => {
  it('covers every current enemy exactly once, with no inferred tier-only exception', () => {
    expect(Object.keys(ROSTER_GROWTH_EXPECTATIONS).sort()).toEqual(Object.keys(enemies).sort());
  });

  for (const [id, row] of Object.entries(ROSTER_GROWTH_EXPECTATIONS)) {
    it(`${id}: earns the literal family milestone before later tier steps`, () => {
      const enemy = enemies[id]!;
      expect(enemy.growth, row[4]).toEqual([expectedMilestone(row)]);
      const base = enemy.pieces.map((piece) => skillBook[piece.skillId]!);
      const counts = base.reduce<Record<string, number>>((out, card) => {
        const family = cardType(card)!;
        const key = `${family.kind}:${family.type}`;
        out[key] = (out[key] ?? 0) + 1;
        return out;
      }, {});
      const pending = Object.entries(counts).filter(([, count]) => count === 2).map(([key]) => key);
      if (pending.length > 0) {
        expect(row[2]).toBe('complete-affinity');
        expect(pending).toContain(`${row[0]}:${row[1]}`);
      } else expect(row[2]).toBe('reinforce-family');
      for (const candidate of row[3]) {
        expect(cardType(skillBook[candidate.skillId]!)).toEqual({ kind: row[0], type: row[1] });
      }
    });
  }
});

describe('every authored candidate sequence resolves in production contexts', () => {
  const contexts = growthContexts();

  it('includes every title, affix, generated modifier stack, forced tier and pack title', () => {
    expect([...new Set(contexts.map((c) => c.title))].sort()).toEqual([...ENEMY_TITLES].sort());
    expect([...new Set(contexts.flatMap((c) => c.affix ? [c.affix] : []))].sort()).toEqual([...ELITE_AFFIX_IDS].sort());
    expect(contexts.some((c) => c.modifiers.some((id) => MODIFIER_PRESETS[id]!.forceTier))).toBe(true);
    expect([...new Set(contexts.filter((c) => c.pack).map((c) => c.title))].sort()).toEqual([...new Set(ENEMY_TITLES.map(capPackTitle))].sort());
    for (let fightNumber = 1; fightNumber <= TITLE_RAMP_FULL_FIGHT; fightNumber += 1) {
      for (const fightOption of ['easy', 'standard', 'hard'] as const) {
        const spec = fightTableEntryForNode({ fightNumber, fightOption });
        expect(contexts.some((c) => c.title === spec.title
          && JSON.stringify(titlePresetFor(c.title, c.fightNumber)) === JSON.stringify(titlePresetFor(spec.title, fightNumber)))).toBe(true);
      }
    }
  });

  for (const [id, row] of Object.entries(ROSTER_GROWTH_EXPECTATIONS)) {
    it(`${id}: never skips an earned milestone across solo and pack recipes`, () => {
      // Resolve the literal proposal before shipping it. The preceding roster
      // test separately requires the live content to be exactly this proposal.
      const proposed = { ...enemies[id]!, growth: [expectedMilestone(row)] };
      const problems: string[] = [];
      for (const context of contexts) {
        const { title, fightNumber, modifiers, affix } = context;
        for (const growthLevel of [2, 4, 6, 100]) {
          const inputLevel = context.pack ? growthLevel - titlePresetFor(title, fightNumber).levelDelta : growthLevel;
          const label = `${title}/${fightNumber}/${affix ?? 'none'}/${modifiers.join('+') || 'none'}/${context.pack ? 'pack' : 'solo'}/L${growthLevel}`;
          try {
            const before = resolveEncounterForEnemy(proposed, inputLevel, title, undefined, modifiers, affix, fightNumber, null, 1);
            const grown = resolveEncounterForEnemy(proposed, inputLevel, title, undefined, modifiers, affix, fightNumber, null, growthLevel);
            const rebuilt = resolveEncounterForEnemy(proposed, inputLevel, title, grown.baseRank, modifiers, affix, fightNumber, null, grown.growthLevel);
            expect(JSON.stringify(rebuilt), label).toBe(JSON.stringify(grown));
            expect(grown.setup.pieces.length, label).toBe(before.setup.pieces.length + 1);
            const added = grown.setup.pieces[before.setup.pieces.length]!;
            expect(row[3].some((candidate) => candidate.skillId === added.skillId), label).toBe(true);
            expect(added.slot + skillBook[added.skillId]!.size, label).toBeLessThanOrEqual(HERO_BOARD_SLOTS);
            expect(cardType(skillBook[added.skillId]!)).toEqual({ kind: row[0], type: row[1] });
            const affinity = boardAffinities(grown.setup.pieces.map((piece) => skillBook[piece.skillId]!));
            expect(affinity[row[0]], label).toBe(row[1]);
            if (context.pack) expect(grown.effectiveLevel, label).toBe(growthLevel);
          } catch (error) {
            problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      expect(problems, `${id}: ${problems.length} failed legal-context resolutions`).toEqual([]);
    });
  }
});

function fixture(overrides: Partial<EnemyDef> & Pick<EnemyDef, 'id' | 'pieces' | 'boardSize'>): EnemyDef {
  return {
    name: overrides.id,
    baseDepth: 1,
    stats: UNIVERSAL_STATLINE,
    goldReward: 1,
    xpReward: 1,
    ...overrides,
  };
}

describe('run/enemyGrowthValidators: synthetic fixtures', () => {
  it('validator 1 (earnsAffinityByLevel2): a 2-card board with NO growth list never earns an affinity — rank-only steps do not change card types', () => {
    const noGrowth = fixture({
      id: 'fixture_no_growth',
      boardSize: 2,
      pieces: [
        { skillId: 'cinder_dart', slot: 0 },
        { skillId: 'scorching_brand', slot: 1 },
      ],
      // no `growth` field — "this thing only gets sharper" (Q2)
    });
    expect(earnsAffinityByLevel2(noGrowth)).toBe(false);
    expect(matureAffinityAt(noGrowth, GROWTH_VALIDATION_LEVEL)).toEqual({});
  });

  it('validator 1 + 3: a 2-card board with a 1-card growth list earns its affinity, and the growth card\'s own gate is OPEN, exactly at level 2', () => {
    const growsIntoIt = fixture({
      id: 'fixture_growth_add',
      boardSize: 2,
      pieces: [
        { skillId: 'cinder_dart', slot: 0 },
        { skillId: 'scorching_brand', slot: 1 },
      ],
      growth: [{ family: { kind: 'element', type: 'fire' }, purpose: 'complete-affinity', candidates: [{ skillId: 'kindling_rite' }] }],
    });
    // Level 1: the authored baseline, no growth spent yet (Q1) — 2 fire cards,
    // below IDENTITY_THRESHOLD (3), earns nothing.
    expect(matureAffinityAt(growsIntoIt, 1)).toEqual({});
    // Level 2: growthStepsAt(2) === 1, the list has exactly 1 unused entry —
    // it lands, the board is now 3-of-fire, and the earned axis is exactly
    // what the CARD needs, so its own gate is open too.
    expect(earnsAffinityByLevel2(growsIntoIt)).toBe(true);
    expect(matureAffinityAt(growsIntoIt, GROWTH_VALIDATION_LEVEL)).toEqual({ elementAffinity: 'fire' });
    expect(everyGatedCardOpenAtLevel2(growsIntoIt)).toBe(true);
    // Its fire affinity matches fire bands, never a lightning band's lean.
    expect(affinityMatchesBandAtLevel2(growsIntoIt, { kind: 'element', type: 'fire' })).toBe(true);
    expect(affinityMatchesBandAtLevel2(growsIntoIt, { kind: 'element', type: 'lightning' })).toBe(false);
  });

  it('validator 3: a gated card whose OWN type never reaches IDENTITY_THRESHOLD keeps its gate CLOSED, even though the board earns a DIFFERENT affinity', () => {
    const mismatch = fixture({
      id: 'fixture_gate_mismatch',
      boardSize: 4,
      pieces: [
        { skillId: 'cinder_dart', slot: 0 },
        { skillId: 'scorching_brand', slot: 1 },
        { skillId: 'kindling_rite', slot: 2 },
        { skillId: 'sword_slash', slot: 3 },
      ],
      // `whetstone_vow` is a SWORD card with its own affinity-gated line —
      // the grown board is 3-of-fire + 2-of-sword, so `weapon:sword` never reaches
      // IDENTITY_THRESHOLD and this card's gate stays dead, exactly the "an
      // inert gated line" shape Q7 accepts at level 1 but forbids past it.
      growth: [{ family: { kind: 'weapon', type: 'sword' }, purpose: 'reinforce-family', candidates: [{ skillId: 'whetstone_vow' }] }],
    });
    expect(earnsAffinityByLevel2(mismatch)).toBe(true); // earns element:fire
    expect(matureAffinityAt(mismatch, GROWTH_VALIDATION_LEVEL)).toEqual({ elementAffinity: 'fire' });
    expect(everyGatedCardOpenAtLevel2(mismatch)).toBe(false); // whetstone_vow's own gate is dead
  });

  it('validator 2: a bow board matches a bow band', () => {
    const bowBoard = fixture({
      id: 'fixture_bow_trap',
      boardSize: 3,
      pieces: [
        { skillId: 'piercing_arrow', slot: 0 },
        { skillId: 'rapid_volley', slot: 1 },
        { skillId: 'hunter_shot', slot: 2 },
      ],
    });
    expect(earnsAffinityByLevel2(bowBoard)).toBe(true);
    expect(matureAffinityAt(bowBoard, GROWTH_VALIDATION_LEVEL)).toEqual({ weaponAffinity: 'bow' });
    expect(affinityMatchesBandAtLevel2(bowBoard, { kind: 'weapon', type: 'bow' })).toBe(true);
    // hunter_shot's own gate is also open because the board earns bow affinity.
    expect(everyGatedCardOpenAtLevel2(bowBoard)).toBe(true);
  });

  it('validator 2 reports false, not vacuously true, when the board earns nothing at all', () => {
    const noGrowth = fixture({
      id: 'fixture_no_growth_2',
      boardSize: 2,
      pieces: [
        { skillId: 'cinder_dart', slot: 0 },
        { skillId: 'scorching_brand', slot: 1 },
      ],
    });
    expect(affinityMatchesBandAtLevel2(noGrowth, { kind: 'element', type: 'fire' })).toBe(false);
  });
});

/** Full roster requirements; biome membership keeps its existing exact-gap
 * ratchet because thematic memberships are not an authored affinity override. */
describe('run/enemyGrowthValidators: live roster requirements', () => {
  const ids = Object.keys(enemies);

  it('validator 1 — earns an affinity by level 2', () => {
    const failing = ids.filter((id) => !earnsAffinityByLevel2(enemies[id]!));
    expect(failing.sort()).toEqual([]);
  });

  it('validator 2 — only the two intentional Thornwild thematic memberships differ from the band lean', () => {
    const failing: string[] = [];
    for (const biome of Object.values(biomes)) {
      for (const kind of ['mobs', 'bosses'] as const) {
        for (const id of biome[kind]) {
          expect(enemies[id], id).toBeDefined();
          if (!affinityMatchesBandAtLevel2(enemies[id]!, biome.lean)) failing.push(`${biome.id}/${kind}/${id}`);
        }
      }
    }
    // src/data/biomes.ts explicitly retains these memberships for theme.
    // Their established beast/bow boards must never acquire invented nature
    // affinity merely to match the band. Preserve the pre-existing exact-gap
    // validator test; the new blanket zero-gap assertion was rejected.
    expect(failing.sort()).toEqual([
      'thornwild/bosses/greenwood_sovereign',
      'thornwild/mobs/stone_beetle',
    ]);
  });

  it('validator 3 — every affinity-gated card on the board has its gate open by level 2', () => {
    const failing = ids.filter((id) => !everyGatedCardOpenAtLevel2(enemies[id]!));
    expect(failing.sort()).toEqual([]);
  });
});
