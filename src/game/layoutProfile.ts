/**
 * Layout profile — the single source of truth for canvas size and the mobile
 * type/spacing ladder. Mobile-first (user, 2026-07-22): the game renders at
 * the MOBILE canvas so "12px" is truly 12 CSS px on a phone — no scale-factor
 * mental math. A desktop profile is kept for a future dedicated desktop build.
 *
 * Selection (once, at boot, before the Phaser.Game is created): `?ui=mobile|
 * desktop` wins; else mobile ⇔ shorter screen edge ≤ 500 CSS px AND a coarse
 * (touch) pointer. Phones are 320-430; smallest tablets ≈ 600 — the cutoff
 * sits in the gap, and the touch guard keeps a narrow desktop window on
 * desktop. No live switching — a per-device fact.
 */
export interface LayoutProfile {
  id: 'mobile' | 'desktop';
  canvas: { width: number; height: number };
  safe: { x: number; top: number; bottom: number };
  /** Type ladder — real CSS px on this profile's canvas. */
  font: {
    tiny: number; small: number; body: number; label: number; name: number; title: number; big: number;
    /** Extra steps between `name` and `title` / `title` and `big` — added for the
     * mobile-scene theme migration; kept out of order in the source object below
     * only where noted, values are unchanged from their prior literal px. */
    lead: number; heading: number; subtitle: number; xlarge: number;
  };
  gap: number;
  /** Minimum comfortable tap target on its short axis. */
  minTap: number;
}

export const MOBILE_PROFILE: LayoutProfile = {
  id: 'mobile',
  canvas: { width: 412, height: 892 },
  safe: { x: 10, top: 8, bottom: 10 },
  font: { tiny: 9, small: 10, body: 12, label: 11, name: 13, title: 16, big: 22, lead: 14, heading: 15, subtitle: 17, xlarge: 18 },
  gap: 8,
  minTap: 40,
};

export const DESKTOP_PROFILE: LayoutProfile = {
  id: 'desktop',
  canvas: { width: 1440, height: 900 },
  safe: { x: 32, top: 24, bottom: 24 },
  font: { tiny: 10, small: 11, body: 14, label: 12, name: 16, title: 26, big: 36, lead: 17, heading: 19, subtitle: 22, xlarge: 24 },
  gap: 12,
  minTap: 40,
};

export function detectProfile(search?: string): LayoutProfile {
  // No DOM (tests / SSR): default desktop so non-browser imports are stable.
  if (typeof window === 'undefined') return DESKTOP_PROFILE;
  const params = new URLSearchParams(search ?? window.location.search);
  const ui = params.get('ui');
  if (ui === 'mobile') return MOBILE_PROFILE;
  if (ui === 'desktop') return DESKTOP_PROFILE;
  if (['desktop-wiki', 'desktop-prep', 'desktop-deck', 'desktop-battle', 'desktop-shop', 'desktop-draft', 'desktop-runmap', 'desktop-runprep', 'desktop-runevent'].includes(params.get('scene') ?? '')) return DESKTOP_PROFILE;
  if (['mprep', 'mdeck', 'mbattle', 'mwiki', 'mobile-shop', 'mobile-draft', 'mrunmap', 'mrunprep', 'mrunevent'].includes(params.get('scene') ?? '')) return MOBILE_PROFILE;
  const screen = window.screen;
  const shortEdge = screen ? Math.min(screen.width, screen.height) : 9999;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return shortEdge <= 500 && coarse ? MOBILE_PROFILE : DESKTOP_PROFILE;
}

/** The profile resolved once at module load — the whole app reads this. */
export const ACTIVE_PROFILE: LayoutProfile = detectProfile();
