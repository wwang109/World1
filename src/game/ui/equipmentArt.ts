import { equipmentDocument } from '../../data/equipmentContent';

const TEMPORARY_ART_ALIASES: Readonly<Record<string, string>> = {
  huntsman_coat: 'duelist_coat', huntsman_crest: 'ravager_crest', huntsman_feather: 'wind_charm',
  tactician_coat: 'restorer_vestments', tactician_brooch: 'restorer_pendant', tactician_knot: 'duelist_knot',
  hexweaver_robe: 'arcanist_robe', hexweaver_pendant: 'spellguard_pendant', hexweaver_seal: 'stormcaller_focus',
};

export const EQUIPMENT_ART_ASSETS = equipmentDocument.items.map(({ id }) => ({
  key: `equipment-${id}`,
  path: `/game-art/equipment/${TEMPORARY_ART_ALIASES[id] ?? id}.webp`,
}));

export function equipmentArtKey(itemId: string): string {
  return `equipment-${itemId}`;
}
