export interface DraftRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MobileDraftActionId = 'back' | 'reroll' | 'next' | 'start';

export interface MobileDraftAction {
  id: MobileDraftActionId;
  label: string;
  enabled: boolean;
  primary?: boolean;
  flex?: number;
}

export interface MobileDraftLayout {
  header: { top: number; instructionY: number; descriptionY: number };
  cards: DraftRect[];
  picksTitleY: number;
  picksRoleY: number;
  picks: Array<{ art: DraftRect; name: DraftRect }>;
  footer: DraftRect;
}

/**
 * Geometry for the approved phone-only Draft composition. The scene keeps the
 * shared CardToken renderer; this module only decides where those tokens live.
 */
export function mobileDraftLayout(screenW: number, screenH: number, _runContext = false): MobileDraftLayout {
  const side = 10;
  const headerTop = _runContext ? 100 : 50;
  const cardTop = headerTop + 120;
  const cardGap = 6;
  const footerY = screenH - 68;
  const pickTitleGap = 24;
  const pickRoleGap = 24;
  const pickArtGap = 18;
  const pickArtH = 54;
  const pickNameGap = 4;
  const pickNameH = 24;
  const summaryHeight = pickTitleGap + pickRoleGap + pickArtGap + pickArtH + pickNameGap + pickNameH;
  // Reserve the complete picked-card summary and its footer clearance first;
  // all remaining height belongs to the five equally sized selection rows.
  const cardH = Math.max(48, Math.floor((footerY - 12 - summaryHeight - cardTop - cardGap * 4) / 5));
  const cards = Array.from({ length: 5 }, (_, index) => ({
    x: side,
    y: cardTop + index * (cardH + cardGap),
    w: screenW - side * 2,
    h: cardH,
  }));

  const pickGap = 8;
  const pickW = (screenW - side * 2 - pickGap * 3) / 4;
  const picksTitleY = cards.at(-1)!.y + cards.at(-1)!.h + pickTitleGap;
  const picksRoleY = picksTitleY + pickRoleGap;
  const pickArtY = picksRoleY + pickArtGap;
  const picks = Array.from({ length: 4 }, (_, index) => {
    const x = side + index * (pickW + pickGap);
    return {
      art: { x, y: pickArtY, w: pickW, h: pickArtH },
      name: { x, y: pickArtY + pickArtH + pickNameGap, w: pickW, h: pickNameH },
    };
  });
  return {
    header: { top: headerTop, instructionY: headerTop + 74, descriptionY: headerTop + 96 },
    cards,
    picksTitleY,
    picksRoleY,
    picks,
    footer: { x: side, y: footerY, w: screenW - side * 2, h: 48 },
  };
}

export function mobileDraftActions(setIndex: number, currentPicked: boolean, ready: boolean): MobileDraftAction[] {
  if (setIndex >= 3) {
    return [
      { id: 'back', label: 'BACK', enabled: true },
      { id: 'reroll', label: 'REROLL', enabled: true },
      { id: 'start', label: 'START RUN', enabled: ready, primary: true, flex: 1.35 },
    ];
  }
  return [
    ...(setIndex > 0 ? [{ id: 'back' as const, label: 'BACK', enabled: true }] : []),
    { id: 'next', label: 'NEXT', enabled: currentPicked, primary: true, flex: 1.7 },
  ];
}

export function mobileDraftActionRects(footer: DraftRect, actions: readonly MobileDraftAction[]): DraftRect[] {
  const gap = 8;
  const totalFlex = actions.reduce((sum, action) => sum + (action.flex ?? 1), 0);
  const usable = footer.w - gap * Math.max(0, actions.length - 1);
  let x = footer.x;
  return actions.map((action) => {
    const w = usable * (action.flex ?? 1) / totalFlex;
    const rect = { x, y: footer.y, w, h: footer.h };
    x += w + gap;
    return rect;
  });
}

/** The picked-card badge text — one string, every set, every context. */
export const MOBILE_DRAFT_SELECTED_LABEL = 'SELECTED';

/** The header's set-progress text ("SET n OF total") — identical whether the
 * run banner or the sandbox tab strip sits above it. */
export function mobileDraftSetHeaderLabel(setIndex: number, totalSets: number): string {
  return `SET ${setIndex + 1} OF ${totalSets}`;
}

interface BrowserViewportLike {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: {
    width: number;
    height: number;
    offsetLeft: number;
    offsetTop: number;
  } | null;
}

/** Pure decision seam for the phone browser-chrome fix. */
export function resolveBrowserViewportSize(
  browser: BrowserViewportLike,
  useVisualViewport: boolean,
  safe: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 },
): { width: number; height: number; left: number; top: number } {
  const visual = useVisualViewport ? browser.visualViewport : undefined;
  if (visual && visual.width > 0 && visual.height > 0) {
    return {
      width: Math.max(1, visual.width - safe.left - safe.right),
      height: Math.max(1, visual.height - safe.top - safe.bottom),
      left: Math.max(0, visual.offsetLeft + safe.left),
      top: Math.max(0, visual.offsetTop + safe.top),
    };
  }
  return { width: browser.innerWidth, height: browser.innerHeight, left: 0, top: 0 };
}
