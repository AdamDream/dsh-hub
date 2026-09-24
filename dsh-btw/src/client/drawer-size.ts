/**
 * Drawer size contract (pure, framework-free).
 *
 * Kept in its own module — not in the store module — so the geometry hook and
 * the pure-geometry specs never pull `@deepseek-ai/dsh-client-runtime/client`
 * (the store handle needs it; the tests must not).
 *
 * `null` is the auto sentinel: it means "no explicit size for this axis", i.e.
 * the drawer keeps the automatic collision-aware placement it has today. Only
 * non-null values open the explicit-size branch of the solver.
 */

/** Preference state persisted by the drawer-size store. `null` = auto. */
export interface DrawerSize {
  width: number | null
  height: number | null
}

/** Mutable size source handed to `useOverlayPlacement` (never in an effect dep list). */
export interface DrawerSizeRef {
  current: DrawerSize
}

/** Smallest width the drawer may be dragged to (existing `minWidth` default). */
export const MIN_WIDTH = 360
/** Smallest height: header 68 + parent status 36 + composer 74 ≈ 178px is incompressible. */
export const MIN_HEIGHT = 240
/**
 * Soft ceiling on width (product decision): above the hard "leave 240px of main
 * area" rule, a 4K-wide work area would otherwise allow a near-full-page drawer.
 * The effective ceiling is `min(workWidth - 240, MAX_WIDTH_SOFT)`.
 */
export const MAX_WIDTH_SOFT = 960
/** Storage-only sanity ceiling; the real clamp happens at render time (INV-2). */
export const MAX_WIDTH_ABS = 10_000
export const MAX_HEIGHT_ABS = 10_000
/** Keyboard step (mirrors the trajectory details handle). */
export const RESIZE_STEP = 16
/** Coarse step with Shift held. */
export const RESIZE_STEP_COARSE = 64
/**
 * Below this window width the drag handles are removed (product decision 3) and
 * the explicit size is not applied at render time, so narrow windows keep
 * exactly today's bottom-sheet + scrim behavior. Mirrored in the stylesheet.
 */
export const HANDLE_MIN_VIEWPORT = 720

/** Clamp a persisted width to a sane absolute range (never trusts storage). */
export function clampStoredWidth(px: number): number {
  return Math.round(Math.min(MAX_WIDTH_ABS, Math.max(MIN_WIDTH, px)))
}

/** Clamp a persisted height to a sane absolute range (never trusts storage). */
export function clampStoredHeight(px: number): number {
  return Math.round(Math.min(MAX_HEIGHT_ABS, Math.max(MIN_HEIGHT, px)))
}

/** Whether any axis carries an explicit preference. */
export function hasExplicitSize(size: DrawerSize | undefined): boolean {
  return size !== undefined && (size.width !== null || size.height !== null)
}
