import type { EventTheme } from '../../data/events';

/**
 * Pure texture-key catalog + lookups for Run Mode art — split out of
 * `runArt.ts` so the KEY math (`choiceArtKey`/`eventArtKey`/`shopArtKey`) has
 * no Phaser import and can be consumed by pure view-model modules
 * (`runRewardViewModel.ts`) and unit-tested directly. `runArt.ts` re-exports
 * everything here for backward compatibility — it additionally owns
 * `RUN_ART_ASSETS` (the boot-time load list) and `addRunArt` (the actual
 * Phaser-side renderer), both of which DO need Phaser and so stay there.
 */
export const RUN_ART_KEYS = {
  shopBanner: 'run-art-shop-banner',
  runMap: 'run-art-run-map',
  icon: {
    choiceCard: 'run-art-icon-choice-card',
    choiceGamble: 'run-art-icon-choice-gamble',
    choiceGem: 'run-art-icon-choice-gem',
    choiceGold: 'run-art-icon-choice-gold',
    choiceLevel: 'run-art-icon-choice-level',
    choiceNothing: 'run-art-icon-choice-nothing',
    coin: 'run-art-icon-coin',
    lifeHeart: 'run-art-icon-life-heart',
    bossSkull: 'run-art-icon-boss-skull',
    storefront: 'run-art-icon-storefront',
  } as const,
  shop: {
    armory: 'run-art-shop-armory',
    wildworks: 'run-art-shop-wildworks',
    arcanum: 'run-art-shop-arcanum',
    sanctum: 'run-art-shop-sanctum',
    alchemist: 'run-art-shop-alchemist',
    gemcutter: 'run-art-shop-gemcutter',
    caravan: 'run-art-shop-caravan',
    bulwark: 'run-art-shop-bulwark',
    assassins_den: 'run-art-shop-assassins-den',
    relic_vault: 'run-art-shop-relic-vault',
    emberworks: 'run-art-shop-emberworks',
    frosthold: 'run-art-shop-frosthold',
    stormspire: 'run-art-shop-stormspire',
    grovekeep: 'run-art-shop-grovekeep',
    reliquary: 'run-art-shop-reliquary',
    umbral_stall: 'run-art-shop-umbral-stall',
  } as const,
  event: {
    training: 'run-art-event-training',
    cache: 'run-art-event-cache',
    recruit: 'run-art-event-recruit',
    forge: 'run-art-event-forge',
    market: 'run-art-event-market',
    omen: 'run-art-event-omen',
  } satisfies Record<EventTheme, string>,
} as const;

export function eventArtKey(theme: EventTheme): string {
  return RUN_ART_KEYS.event[theme];
}

export function shopArtKey(shopId: string): string {
  return RUN_ART_KEYS.shop[shopId as keyof typeof RUN_ART_KEYS.shop] ?? RUN_ART_KEYS.icon.storefront;
}

export function choiceArtKey(kind: string): string {
  switch (kind) {
    case 'grantCard':
    case 'bonusDraft':
    case 'upgradeCard':
    case 'upgradeCardPick':
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
      return RUN_ART_KEYS.icon.choiceGem;
    case 'grantGold':
    case 'loseGold':
      return RUN_ART_KEYS.icon.choiceGold;
    case 'grantLevel':
      return RUN_ART_KEYS.icon.choiceLevel;
    case 'nothing':
    default:
      return RUN_ART_KEYS.icon.choiceNothing;
  }
}
