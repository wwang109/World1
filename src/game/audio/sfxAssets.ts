import type { SfxKey } from './sfxRecipes';

export const SFX_AUDIO_DIR = 'game-audio';

export const sfxFileStem = (key: SfxKey): string => key.replace(':', '-');

const FILE_BACKED_KEYS: readonly SfxKey[] = [
  'uiClick', 'uiBack',
  'cast:offense', 'cast:defensive', 'cast:healing', 'cast:support', 'cast:debuff',
  'hitPhysical', 'hitMagical',
  'hit:fire', 'hit:frost', 'hit:lightning', 'hit:nature', 'hit:holy',
  'hit:sword', 'hit:axe', 'hit:lance', 'hit:bow', 'hit:beast',
  'heal', 'shieldGain', 'shieldBreak',
  'status:poison', 'status:burn', 'status:buff', 'status:debuff', 'status:guard', 'status:ward',
  'died', 'phase', 'negated', 'warded',
  'dragPick', 'dragDrop', 'sell',
  'goldGain', 'purchase', 'levelUp',
  'victory', 'defeat', 'runWin', 'runLose',
];

export const SFX_FILES: Partial<Record<SfxKey, string>> = Object.fromEntries(
  FILE_BACKED_KEYS.map((key) => [key, `${SFX_AUDIO_DIR}/${sfxFileStem(key)}.ogg`]),
);
