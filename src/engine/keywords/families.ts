import { Keyword, type KeywordFamilyId, type KeywordKind, type KeywordMoment, type KeywordTarget, type KeywordValue, type MomentTargets } from './keyword';

export class Hit<K extends KeywordKind> extends Keyword<K> {
  readonly family: KeywordFamilyId = 'hit';
  readonly moments: MomentTargets = { applied: 'unit' };
}

export class HitBonus<K extends KeywordKind> extends Keyword<K> {
  readonly family: KeywordFamilyId = 'hitBonus';
  readonly moments: MomentTargets = { added: 'hit' };
  protected override readonly signed: boolean = true;
}

export class ChargedHitBonus<K extends KeywordKind> extends HitBonus<K> {
  override readonly moments: MomentTargets = { armed: 'nextCast', added: 'hit' };
}

export class SpendingHitBonus<K extends KeywordKind> extends HitBonus<K> {
  override readonly moments: MomentTargets = { spent: 'unit', added: 'hit' };
  protected override readonly signed: boolean = false;
}

export class OverTime<K extends KeywordKind> extends Keyword<K> {
  readonly family: KeywordFamilyId = 'overTime';
  readonly moments: MomentTargets = { applied: 'unit', triggered: 'unit', expired: 'unit' };
}

export class Status<K extends KeywordKind> extends Keyword<K> {
  readonly family: KeywordFamilyId = 'status';
  readonly moments: MomentTargets = { applied: 'unit', triggered: 'unit', expired: 'unit' };
}

export class HitStatus<K extends KeywordKind> extends Status<K> {
  override readonly moments: MomentTargets = { applied: 'unit', triggered: 'hit', expired: 'unit' };
}

export class Charges<K extends KeywordKind> extends Keyword<K> {
  readonly family: KeywordFamilyId = 'charges';
  readonly moments: MomentTargets = { applied: 'unit', triggered: 'unit', expired: 'unit' };

  protected override text(moment: KeywordMoment, target: KeywordTarget, value: KeywordValue | undefined): string {
    if (moment === 'triggered' && value !== undefined) return `${this.title} (${value.amount} left)`;
    return super.text(moment, target, value);
  }
}

export class HitCharges<K extends KeywordKind> extends Charges<K> {
  override readonly moments: MomentTargets = { applied: 'unit', triggered: 'hit', expired: 'unit' };
}

export class CardEffect<K extends KeywordKind> extends Keyword<K> {
  readonly family: KeywordFamilyId = 'cardEffect';
  readonly moments: MomentTargets = { applied: 'cards', triggered: 'cards', expired: 'cards' };
  protected override readonly signed: boolean = true;
}

export class Tempo<K extends KeywordKind> extends Keyword<K> {
  readonly family: KeywordFamilyId = 'tempo';
  readonly moments: MomentTargets = { applied: 'unit', triggered: 'cards' };
  protected override readonly signed: boolean = true;
}

export class Sustain<K extends KeywordKind> extends Keyword<K> {
  readonly family: KeywordFamilyId = 'sustain';
  readonly moments: MomentTargets = { applied: 'unit', triggered: 'hit' };
}

export class SustainBonus<K extends KeywordKind> extends Sustain<K> {
  override readonly moments: MomentTargets = { added: 'heal' };
}
