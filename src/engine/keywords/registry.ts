import {
  CardEffect,
  ChargedHitBonus,
  Charges,
  Hit,
  HitBonus,
  HitCharges,
  HitStatus,
  OverTime,
  SpendingHitBonus,
  Status,
  Sustain,
  SustainBonus,
  Tempo,
} from './families';
import type { Keyword, KeywordFamilyId, KeywordKind } from './keyword';

export type KeywordTable = { readonly [K in KeywordKind]: Keyword<K> };

export const KEYWORDS: KeywordTable = {
  damage: new Hit('damage', { reach: 'foe', events: ['damage'] }),
  statStrike: new Hit('statStrike', { reach: 'foe', events: ['damage'] }),
  shieldBreak: new Hit('shieldBreak', { reach: 'foe', unit: 'shield', events: ['shieldBroken'] }),

  comboBonus: new HitBonus('comboBonus', { reach: 'foe', gate: 'lastCastArchetype', events: [] }),
  chainBonus: new HitBonus('chainBonus', { reach: 'foe', gate: 'lastCastType', events: [] }),
  exploit: new HitBonus('exploit', { reach: 'foe', gate: 'foeHasStatus', events: [] }),
  stackBonus: new HitBonus('stackBonus', { reach: 'foe', gate: 'stackCount', events: [] }),
  execute: new HitBonus('execute', { reach: 'foe', gate: 'foeHalfHp', events: [] }),
  desperation: new HitBonus('desperation', { reach: 'foe', gate: 'selfHalfHp', events: [] }),
  dormant: new HitBonus('dormant', { reach: 'foe', gate: 'fightTurn', events: [] }),
  buildUp: new HitBonus('buildUp', { reach: 'foe', gate: 'ownCastCount', events: [] }),
  opener: new HitBonus('opener', { reach: 'foe', gate: 'ownCastCount', events: [] }),
  fleeting: new HitBonus('fleeting', { reach: 'foe', gate: 'fightTurn', events: [] }),
  crescendo: new HitBonus('crescendo', { reach: 'foe', gate: 'ownCastCount', events: [] }),
  isolate: new HitBonus('isolate', { reach: 'foe', gate: 'foeAlone', events: [] }),
  firstBlood: new HitBonus('firstBlood', { reach: 'foe', gate: 'foeFullHp', events: [] }),
  empowerNext: new ChargedHitBonus('empowerNext', { reach: 'self', events: [] }),
  shieldBurst: new SpendingHitBonus('shieldBurst', { reach: 'self', gate: 'ownShield', unit: 'shield', events: ['shieldBroken'] }),
  wardRelease: new SpendingHitBonus('wardRelease', { reach: 'self', gate: 'ownWard', unit: 'charges', events: ['wardReleased', 'statusExpired'] }),

  poison: new OverTime('poison', { reach: 'foe', later: 'eachTurn', unit: 'stacks', events: ['statusApplied', 'damage', 'statusExpired'] }),
  burn: new OverTime('burn', { reach: 'foe', later: 'eachTurn', unit: 'stacks', events: ['statusApplied', 'damage', 'statusExpired'] }),
  bleed: new OverTime('bleed', { reach: 'foe', later: 'whenActing', gate: 'foeUnshielded', unit: 'stacks', events: ['statusApplied', 'damage', 'statusExpired'] }),
  fuse: new OverTime('fuse', { reach: 'foe', later: 'eachTurn', unit: 'damage', events: ['statusApplied', 'damage', 'statusExpired'] }),
  regen: new OverTime('regen', { reach: 'ally', later: 'eachTurn', unit: 'stacks', events: ['statusApplied', 'heal', 'statusExpired'] }),

  stun: new Status('stun', { reach: 'foe', later: 'whenActing', unit: 'turns', events: ['statusApplied', 'performSkipped', 'statusExpired'] }),
  buffStat: new Status('buffStat', { reach: 'ally', unit: '%', events: ['statusApplied', 'statusExpired'] }),
  debuffStat: new Status('debuffStat', { reach: 'foe', unit: '%', events: ['statusApplied', 'statusExpired'] }),
  taunt: new Status('taunt', { reach: 'self', unit: 'aggro', events: ['aggroChanged'] }),
  guard: new HitStatus('guard', { reach: 'self', later: 'whenTargeted', unit: '%', events: ['statusApplied', 'statusExpired'] }),
  expose: new HitStatus('expose', { reach: 'foe', later: 'whenTargeted', unit: '%', events: ['statusApplied', 'statusExpired'] }),

  ward: new Charges('ward', { reach: 'self', later: 'whenTargeted', unit: 'charges', events: ['statusApplied', 'warded', 'statusExpired'] }),
  thorns: new Charges('thorns', { reach: 'self', later: 'whenTargeted', unit: 'stacks', events: ['statusApplied', 'damage', 'statusExpired'] }),
  negate: new HitCharges('negate', { reach: 'self', later: 'whenTargeted', unit: 'charges', events: ['statusApplied', 'negated'] }),

  burden: new CardEffect('burden', { reach: 'foe', later: 'whenActing', unit: 'weight', events: ['burdened'] }),
  curse: new CardEffect('curse', { reach: 'foe', later: 'whenActing', unit: 'damage', events: ['cursed', 'curseExpired'] }),
  splash: new CardEffect('splash', { reach: 'foe', events: [] }),

  slow: new Tempo('slow', { reach: 'foe', later: 'whenActing', unit: 'weight', events: ['slowed'] }),
  disrupt: new Tempo('disrupt', { reach: 'foe', unit: 'readiness', events: ['disrupted'] }),
  haste: new Tempo('haste', { reach: 'self', unit: 'readiness', events: ['hastened'] }),

  heal: new Sustain('heal', { reach: 'ally', unit: 'HP', events: ['heal'] }),
  shield: new Sustain('shield', { reach: 'self', unit: 'shield', events: ['shieldGain'] }),
  attunedShield: new Sustain('attunedShield', { reach: 'self', later: 'whenTargeted', unit: 'shield', events: ['shieldGain'] }),
  lifesteal: new Sustain('lifesteal', { reach: 'self', gate: 'damageDealt', unit: 'HP', events: ['heal'] }),
  cleanse: new Sustain('cleanse', { reach: 'ally', unit: 'effects', events: ['cleansed'] }),
  overhealShield: new Sustain('overhealShield', { reach: 'ally', gate: 'healOverflow', unit: 'shield', events: ['shieldGain'] }),
  cleanseConvert: new SustainBonus('cleanseConvert', { reach: 'ally', gate: 'cleansedStacks', events: [] }),
};

export function keywordOf<K extends KeywordKind>(kind: K): Keyword<K> {
  return KEYWORDS[kind] as Keyword<K>;
}

export function keywordsIn(family: KeywordFamilyId): Keyword[] {
  const out: Keyword[] = [];
  for (const kind of Object.keys(KEYWORDS) as KeywordKind[]) {
    const keyword = KEYWORDS[kind] as Keyword;
    if (keyword.family === family) out.push(keyword);
  }
  return out;
}
