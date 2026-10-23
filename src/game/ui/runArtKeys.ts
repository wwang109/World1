import { artManifest } from '../../data/artManifest';
import type { EventArtId, EventTheme } from '../../data/eventTypes';

/**
 * Pure texture-key catalog + lookups for Run Mode art — split out of
 * `runArt.ts` so the KEY math (`choiceArtKey`/`eventArtKey`/`shopArtKey`/
 * `biomeArtKey`) has no Phaser import and can be consumed by pure view-model modules
 * (`runRewardViewModel.ts`) and unit-tested directly. `runArt.ts` re-exports
 * everything here for backward compatibility — it additionally owns
 * `RUN_ART_ASSETS` (the boot-time load list) and `addRunArt` (the actual
 * Phaser-side renderer), both of which DO need Phaser and so stay there.
 */
export const RUN_ART_KEYS = artManifest.runKeys;

export function eventArtKey(theme: EventTheme, artId?: EventArtId): string {
  return artId === undefined ? artManifest.themes[theme]! : artManifest.events[artId]!;
}

export function enemyPortraitArtKey(enemyId: string): string | undefined {
  return RUN_ART_KEYS.enemy[enemyId as keyof typeof RUN_ART_KEYS.enemy];
}

export function shopArtKey(shopId: string): string {
  return RUN_ART_KEYS.shop[shopId as keyof typeof RUN_ART_KEYS.shop] ?? RUN_ART_KEYS.icon.storefront;
}

/** Biomes are a closed live catalog. Unlike the shop safety icon, an unknown
 * biome must not silently borrow another place's identity art. */
export function biomeArtKey(biomeId: string): string {
  const key = RUN_ART_KEYS.biome[biomeId as keyof typeof RUN_ART_KEYS.biome];
  if (key === undefined) throw new Error(`biomeArtKey: unknown biome "${biomeId}"`);
  return key;
}

export function desktopBiomeArtKey(biomeId: string): string {
  const key = RUN_ART_KEYS.biomeDesktop[biomeId as keyof typeof RUN_ART_KEYS.biomeDesktop];
  if (key === undefined) throw new Error(`desktopBiomeArtKey: unknown biome "${biomeId}"`);
  return key;
}

export function choiceArtKey(kind: string): string {
  switch (kind) {
    case 'grantCard':
    case 'cardGranted':
    case 'cardUpgraded':
    case 'reshapeCard':
    case 'cardReshaped':
    case 'scavengeCard':
    case 'rerollCard':
    case 'cardRerolled':
    case 'bonusDraft':
    case 'upgradeCard':
    case 'upgradeCardTargeted':
    case 'upgradeCardPick':
    case 'awardCardPoint':
    case 'awardCardPointPick':
    // `cardChoice` (2026-08-18 agency pass) is the pre-resolution SPEC kind
    // shown on the event's own choice row (`choiceArtKey(choice.outcome.kind)`
    // in both `RunEventScene`s) — same card icon as its `grantCard`/
    // `bonusDraft` siblings, same idiom as `upgradeCardPick` above reusing
    // `upgradeCard`'s icon for its own deferred-pick shape.
    case 'cardChoice':
    // `mergeCards` is the pre-resolution spec kind on the event's own choice
    // row; `mergeCardsPick` is the deferred-pick `EventOutcome` shape shown
    // while `renderRunMergeCardsPicker` is up (its header icon) — both are
    // about CARDS, same as every sibling above, so they read as the same card
    // icon rather than inventing a merge-specific glyph the asset set does not
    // have. (The trade's destructive half is carried by the picker's own
    // "SPENT" strip and the choice row's "3 CARDS → 1 BETTER" hint, not by the
    // icon.)
    case 'mergeCards':
    case 'mergeCardsPick':
      return RUN_ART_KEYS.icon.choiceCard;
    case 'grantGem':
    // `gemChoice` is the pre-resolution spec kind; `gemChoicePick` is the
    // deferred-pick `EventOutcome` shape shown while `renderRunGemChoicePicker`
    // is up (its header icon) — both read as the same gem icon as the
    // guaranteed `grantGem` grant, same reasoning as `cardChoice` above.
    case 'gemChoice':
    case 'gemChoicePick':
    // `sellGem`/`sellGemPick` (2026-08-20) sell a gem rather than granting
    // one, but it's the same subject on the button/panel — same gem icon.
    case 'sellGem':
    case 'sellGemPick':
    case 'reshapeGem':
    case 'gemReshaped':
    case 'rerollGem':
    case 'gemRerolled':
      return RUN_ART_KEYS.icon.choiceGem;
    case 'grantGold':
    case 'loseGold':
    case 'grantShopRerolls':
      return RUN_ART_KEYS.icon.choiceGold;
    case 'grantLevel':
      return RUN_ART_KEYS.icon.choiceLevel;
    case 'grantMapInfo':
      return RUN_ART_KEYS.icon.choiceNothing;
    case 'nothing':
    default:
      return RUN_ART_KEYS.icon.choiceNothing;
  }
}
