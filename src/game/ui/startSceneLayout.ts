export type StartSceneProfile = 'mobile' | 'desktop';

export interface CenteredRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StartSceneLayout {
  centerX: number;
  eyebrowY: number;
  title: { x: number; y: number; fontSize: number };
  ruleY: number;
  primary: CenteredRect;
  sandbox: CenteredRect;
  lifetimeY: number;
  lowerRuleY: number;
  seed: CenteredRect;
  vignette: CenteredRect;
}

export interface StartScenePrimaryPresentation {
  label: string;
  detail: string;
  labelFontSize: number;
}

export interface StartScenePrimaryVisualLayout {
  frameY: number;
  frameWidth: number;
  frameHeight: number;
  innerTop: number;
  innerBottom: number;
  labelY: number;
  labelHalfHeight: number;
  detailY: number;
  detailHalfHeight: number;
}

/** Visual frame/text geometry; the larger interaction rect remains independent. */
export function startScenePrimaryVisualLayout(
  profile: StartSceneProfile,
  rect: CenteredRect,
): StartScenePrimaryVisualLayout {
  if (profile === 'mobile') {
    return {
      frameY: rect.y,
      frameWidth: 286,
      frameHeight: 72,
      innerTop: rect.y - 25,
      innerBottom: rect.y + 25,
      labelY: rect.y - 9,
      labelHalfHeight: 9,
      detailY: rect.y + 14,
      detailHalfHeight: 5,
    };
  }
  return {
    frameY: rect.y,
    frameWidth: rect.width + 18,
    frameHeight: rect.height + 18,
    innerTop: rect.y - 36,
    innerBottom: rect.y + 36,
    labelY: rect.y - 12,
    labelHalfHeight: 17,
    detailY: rect.y + 23,
    detailHalfHeight: 7,
  };
}

export function startSceneAssetPaths(profile: StartSceneProfile): {
  background: string;
  ctaFrame: string;
  icons: string;
} {
  return {
    background: `/game-art/placeholders/start-background-${profile}.webp`,
    ctaFrame: '/game-art/placeholders/start-cta-frame.webp',
    icons: '/game-art/placeholders/start-icons.webp',
  };
}

export function startSceneLifetimeOffsets(profile: StartSceneProfile): {
  unit: number;
  icons: [number, number, number];
  text: [number, number, number];
  separators: [number, number];
} {
  const unit = profile === 'mobile' ? 0.76 : 1;
  return {
    unit,
    icons: [-185 * unit, -45 * unit, 102 * unit],
    text: [-158 * unit, -18 * unit, 132 * unit],
    separators: [-82 * unit, 70 * unit],
  };
}

/** State-specific front-door copy and the one narrower mobile Resume label. */
export function startScenePrimaryPresentation(
  activeRun: boolean,
  profile: StartSceneProfile,
): StartScenePrimaryPresentation {
  return {
    label: activeRun ? 'RESUME THE JOURNEY ›' : 'BEGIN THE JOURNEY ›',
    detail: activeRun
      ? 'Return to the map · continue your climb'
      : 'Draft your board · climb the endless ladder',
    labelFontSize: profile === 'mobile' ? 16 : 32,
  };
}

/** Pure geometry traced from the user-approved desktop and mobile mockups. */
export function startSceneLayout(
  profile: StartSceneProfile,
  width: number,
  height: number,
): StartSceneLayout {
  const centerX = Math.round(width / 2);
  if (profile === 'mobile') {
    const offsetY = Math.round((height - 892) / 2);
    return {
      centerX,
      eyebrowY: 390 + offsetY,
      title: { x: centerX, y: 435 + offsetY, fontSize: 56 },
      ruleY: 477 + offsetY,
      primary: { x: centerX, y: 520 + offsetY, width: 310, height: 82 },
      sandbox: { x: centerX, y: 586 + offsetY, width: 210, height: 48 },
      lifetimeY: 630 + offsetY,
      lowerRuleY: 650 + offsetY,
      seed: { x: centerX, y: 682 + offsetY, width: 248, height: 46 },
      vignette: { x: centerX, y: 526 + offsetY, width: 542, height: 500 },
    };
  }

  const offsetY = Math.round((height - 900) / 2);
  return {
    centerX,
    eyebrowY: 243 + offsetY,
    title: { x: centerX, y: 318 + offsetY, fontSize: 96 },
    ruleY: 380 + offsetY,
    primary: { x: centerX, y: 463 + offsetY, width: 500, height: 94 },
    sandbox: { x: centerX, y: 580 + offsetY, width: 260, height: 54 },
    lifetimeY: 665 + offsetY,
    lowerRuleY: 705 + offsetY,
    seed: { x: centerX, y: 755 + offsetY, width: 282, height: 48 },
    vignette: { x: centerX, y: 477 + offsetY, width: 900, height: 720 },
  };
}
