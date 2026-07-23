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
  font: { tiny: number; small: number; body: number; label: number; name: number; title: number; big: number };
  gap: number;
  /** Minimum comfortable tap target on its short axis. */
  minTap: number;
}

export const MOBILE_PROFILE: LayoutProfile = {
  id: 'mobile',
  canvas: { width: 412, height: 892 },
  safe: { x: 10, top: 8, bottom: 10 },
  font: { tiny: 9, small: 10, body: 12, label: 11, name: 13, title: 16, big: 22 },
  gap: 8,
  minTap: 40,
};

export const DESKTOP_PROFILE: LayoutProfile = {
  id: 'desktop',
  canvas: { width: 720, height: 1280 },
  safe: { x: 28, top: 28, bottom: 28 },
  font: { tiny: 8, small: 9, body: 11, label: 10, name: 13, title: 20, big: 26 },
  gap: 8,
  minTap: 32,
};

export function detectProfile(search?: string): LayoutProfile {
  // No DOM (tests / SSR): default desktop so non-browser imports are stable.
  if (typeof window === 'undefined') return DESKTOP_PROFILE;
  const params = new URLSearchParams(search ?? window.location.search);
  const ui = params.get('ui');
  if (ui === 'mobile') return MOBILE_PROFILE;
  if (ui === 'desktop') return DESKTOP_PROFILE;
  const screen = window.screen;
  const shortEdge = screen ? Math.min(screen.width, screen.height) : 9999;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return shortEdge <= 500 && coarse ? MOBILE_PROFILE : DESKTOP_PROFILE;
}

/** The profile resolved once at module load — the whole app reads this. */
export const ACTIVE_PROFILE: LayoutProfile = detectProfile();
