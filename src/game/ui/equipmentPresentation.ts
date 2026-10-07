import { equipmentCatalog } from '../../data/equipmentContent';
import { equipmentLootSourcesFromJson } from '../../data/equipmentLootSources';
import { equipmentDetailsModel } from '../../engine/equipment/details';
import { equipmentModifierClauses } from '../../engine/equipment/text';
import type { EquipmentItemPin } from '../../data/equipmentLootSources';
import type { EquipmentResolution } from '../../engine/equipment/types';
import type { RunState } from '../runStore';
import { resolveEquipment } from '../../engine/equipment/resolve';
import { skillBook } from '../../data/skills';
import { snapshotRunProgress } from './RunProgressStrip';
import type { OwnedEquipmentItem } from '../../run/equipmentInventory';

const sources=equipmentLootSourcesFromJson();
export function equipmentItemPresentation(ref:EquipmentItemPin,resolution:EquipmentResolution){
  const details=equipmentDetailsModel(ref,equipmentCatalog,sources);
  const progress=details.set?resolution.sets.find(s=>s.setId===details.set!.id&&s.setVersion===details.set!.version):undefined;
  return { ...details, progress, progressText:progress?`${progress.equippedPieces}/3 pieces · ${progress.matchingCards}/${progress.requiredCards} matching cards`:'No pieces of this set equipped',
    bonusesText:equipmentModifierClauses(resolution.statMods,resolution.effectMods).join(' · ')||'No equipment bonuses' };
}

export function equipmentSelectionPreview(run:RunState,item:OwnedEquipmentItem){
  const definition=equipmentCatalog.item(item.itemId,item.itemVersion);
  const equipped=run.equippedEquipment??[];
  const isEquipped=equipped.some(ref=>ref.instanceId===item.instanceId);
  const refs=equipped.filter(ref=>ref.slot!==definition.slot);
  if(!isEquipped)refs.push({...item,slot:definition.slot});
  const resolution=resolveEquipment(refs,run.pieces.map(piece=>skillBook[piece.skillId]!).filter(Boolean),equipmentCatalog);
  return {isEquipped,resolution,currentStats:snapshotRunProgress(run).heroStats,
    nextStats:snapshotRunProgress({...run,equippedEquipment:refs}).heroStats};
}
