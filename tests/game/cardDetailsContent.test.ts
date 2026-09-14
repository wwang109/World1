import { describe, expect, it } from 'vitest';
import { skillBook } from '../../src/data/skills';
import { gemBook } from '../../src/data/gems';
import { applyTier, resolveDisplaySkill } from '../../src/engine/cards';
import { TIER_ORDER, type SkillDef } from '../../src/engine/types';
import { buildCardDetailsContent, cardDetailsPreviewTiers, resolveCardDetailsPreview } from '../../src/game/ui/cardDetailsContent';

describe('specific card inspector content', () => {
  it('shows Slow once: as the heading plus its concrete rule', () => {
    const skill: SkillDef = { ...skillBook.sword_slash!, effects: [{ kind: 'slow', weight: 8 }] };
    expect(buildCardDetailsContent(skill).entries).toContainEqual({
      title: 'Slow',
      body: 'Add 8 Weight to the next card this turn.',
    });
  });

  it('includes the owned lightweight gem exactly once in weight and readiness', () => {
    const gem = gemBook.lightweight_core!;
    const base = skillBook.rapid_volley!;
    const shown = resolveDisplaySkill(base, { skillId: base.id, slot: 0, gem });
    const content = buildCardDetailsContent(shown, { gem });
    expect(content.weight).toBe(14);
    expect(content.entries.some(entry => /^(Weight|Size)\b/.test(entry.title))).toBe(false);
    expect(buildCardDetailsContent({ ...shown, speedWeight: 1 }, { gem }).weight).toBe(1);
    const echo = gemBook.resonant_echo!;
    const echoShown = resolveDisplaySkill(base, { skillId: base.id, slot: 0, gem: echo });
    expect(buildCardDetailsContent(echoShown, { gem: echo }).weight).toBe(20);
  });
  it('explains this copy’s Exploit amount and status, without balance metadata', () => {
    const content = buildCardDetailsContent(skillBook.control_opportunist!);
    expect(content.roles).toContain('Offense');
    expect(content.entries).toContainEqual({ title: 'Exploit — Stun', body: 'Deal 8 additional damage against stunned targets.' });
    const output = JSON.stringify(content);
    expect(output).not.toMatch(/readiness to play|board slots/);
    expect(output).toContain('+50% damage against Beast Affinity.');
    expect(output).not.toMatch(/\bX\b|Rank|Power Level|no other weapon matchup/);
  });
  it('keeps canonical multi-hit, affinity conditions and duration clauses intact', () => {
    const volley = buildCardDetailsContent(skillBook.rapid_volley!);
    expect(JSON.stringify(volley.entries)).toMatch(/2|twice/);
    const card = applyTier(skillBook.kindred_flame!, 'diamond');
    expect(JSON.stringify(buildCardDetailsContent(card).entries)).toContain('Affinity');
    expect(JSON.stringify(buildCardDetailsContent(card).entries)).toContain('Requires 3');
  });
  it('browses all tiers and back from the authored card with one gem fold, without mutation', () => {
    const gem = gemBook.empowering_core!;
    const base = skillBook.rapid_volley!;
    const resolved = resolveDisplaySkill(base, { skillId: base.id, slot: 0, gem });
    const before = JSON.stringify(resolved);
    expect(cardDetailsPreviewTiers(resolved)).toEqual(['bronze', 'silver', 'gold', 'diamond']);
    for (const [tier, powers] of [['silver', [22, 20]], ['gold', [26, 26]], ['diamond', [32, 30]], ['bronze', [16, 16]]] as const) {
      const preview = resolveCardDetailsPreview(resolved, tier, gem);
      expect(preview.effects.filter(action => action.kind === 'damage').map(action => action.power)).toEqual(powers);
      expect(buildCardDetailsContent(preview, { gem }).gem?.body).toContain(gem.name);
    }
    expect(resolveCardDetailsPreview(resolved, 'bronze', gem)).toBe(resolved);
    expect(JSON.stringify(resolved)).toBe(before);
  });
  it('never fabricates a tier for a non-catalog card', () => {
    const unknown = { ...skillBook.sword_slash!, id: 'not-in-catalog' };
    expect(cardDetailsPreviewTiers(unknown)).toEqual(['bronze']);
    expect(resolveCardDetailsPreview(unknown, 'diamond')).toBe(unknown);
  });
  it('renders every catalog tier with actual clauses and no generic placeholders', () => {
    for (const base of Object.values(skillBook)) for (const tier of TIER_ORDER) {
      const content = buildCardDetailsContent(applyTier(base, tier));
      expect(JSON.stringify(content), `${base.id}@${tier}`).not.toMatch(/\bX\b|2X|1\/X|Power Level|Rank |What It Does|FULL CARD TEXT/);
      expect(content.entries.length, `${base.id}@${tier}`).toBeGreaterThan(0);
    }
  });
  it('does not turn an identical affinity-gated Exploit into guaranteed damage', () => {
    const skill: SkillDef = { ...skillBook.control_opportunist!, effects: [
      { kind: 'exploit', status: 'stun', amount: 8 },
      { kind: 'exploit', status: 'stun', amount: 8, affinity: true },
    ] };
    const rows = buildCardDetailsContent(skill).entries.filter(entry => entry.title === 'Exploit — Stun');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.body).toBe('Deal 8 additional damage against stunned targets.');
    expect(rows[1]!.body).toBe('Requires 3 Bow cards on your board. Deal 8 additional damage against stunned targets.');
  });
  it('preserves merged piles, durations, cooldown, aura and true-damage identity', () => {
    const skill: SkillDef = { ...skillBook.sword_slash!, cooldownTurns: 5, effects: [
      { kind: 'poison', stacks: 2 }, { kind: 'poison', stacks: 3 },
      { kind: 'poison', stacks: 4, affinity: true },
      { kind: 'debuffStat', stat: 'attack', pct: 20, turns: 3 },
    ] };
    const output = JSON.stringify(buildCardDetailsContent(skill).entries);
    expect(output).toContain('Poison 5');
    expect(output).toContain('damage equal to current Poison stacks');
    expect(output).toContain('Poison 4');
    expect(output).not.toMatch(/Deal [45] damage at the end of each turn/);
    expect(output).toContain('20%');
    expect(output).toContain('3t');
    expect(output).toContain('Cooldown 5');
    expect(JSON.stringify(buildCardDetailsContent(skillBook.war_banner!).entries)).toContain('Passive:');
    expect(JSON.stringify(buildCardDetailsContent(skillBook.annihilation_strike!).entries)).not.toContain('+50%');
  });
  it('attributes every gem using its exact generated effect without generic X helpers', () => {
    for (const gem of Object.values(gemBook)) {
      const output = buildCardDetailsContent(skillBook.sword_slash!, { gem }).gem!;
      expect(output.body).toContain(gem.name);
      expect(output.body).not.toMatch(/\bX\b|2X|1\/X/);
    }
  });
});
