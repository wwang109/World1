import type { RunTravelChoiceViewModel } from './runTravelChoiceViewModel';

// Must stay Phaser-free — `RunTravelChoiceCard.ts` imports this, not the reverse.
export function runTravelChoiceCardCopy(model: RunTravelChoiceViewModel, pending = false) {
  const chain = model.kind === 'event' && model.event?.chainUnlocked === true;
  const kind = model.kind.toUpperCase();
  const identity = model.title.replace(/^(?:EVENT|SHOP) · /, '');
  const encounterName = model.detail.replace(/^(?:EASY|MEDIUM|HARD) · /, '').split(' · ')[0];
  const title = model.kind === 'fight' || model.kind === 'boss' ? encounterName || kind : identity;
  const detail = model.kind === 'fight' || model.kind === 'boss'
    ? model.detail.replace(/^(?:EASY|MEDIUM|HARD) · /, '').split(' · ').slice(1).join(' · ') || model.detail
    : model.detail;
  const eyebrow = model.dossier && model.title === 'MINIBOSS ENCOUNTER'
    ? `${model.title}${model.dossier.difficulty ? ` · ${model.dossier.difficulty}` : ''}`
    : chain ? 'CHAIN EVENT · UNLOCKED'
    : model.kind === 'fight' ? model.title.replace(/^FIGHT/, 'COMBAT')
      : model.kind === 'boss' ? model.title : kind;
  const action = !model.enabled ? 'LOCKED'
    : model.kind === 'fight' ? 'FIGHT ›'
      : pending ? `RETURN TO ${kind} ›`
      : model.kind === 'event' ? chain ? 'TRAVEL HERE ›' : 'CHOOSE EVENT ›'
        : model.kind === 'shop' ? 'VISIT SHOP ›'
          : 'CONTINUE ›';
  return {
    eyebrow,
    title: pending ? `RETURN TO ${kind} · ${title}` : title,
    detail,
    action,
    requirementHeading: chain ? 'MET REQUIREMENTS' : '',
    requirementLines: chain ? model.event!.requirementLines.map((line) => `✓ ${line}`) : [],
  };
}
