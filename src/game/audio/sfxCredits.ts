/** Derived from `audio-src/CREDITS.md`. No Phaser import. */

export interface SfxCreditEntry {
  attribution: string;
  detail: string;
}

export const CC_BY_LICENSE_URL = 'https://creativecommons.org/licenses/by/3.0/';

export const SFX_CC_BY_CREDITS: readonly SfxCreditEntry[] = [
  {
    attribution: 'spookymodem — CC-BY 3.0',
    detail: 'Magic Smite, Magic Shield, Crossbow Shot, Bubbling Acid',
  },
  {
    attribution: 'Little Robot Sound Factory — www.littlerobotsoundfactory.com — CC-BY 3.0',
    detail: 'Fantasy Sound Effects Library',
  },
];

export const SFX_CC0_THANKS: readonly string[] = [
  'Kenney', 'Lentikula', 'rubberduck', 'artisticdude', 'JaggedStone', 'wobbleboxx', 'StarNinjas',
];

export const SFX_CC0_SOURCE_NOTE = 'OpenGameArt / itch.io';
