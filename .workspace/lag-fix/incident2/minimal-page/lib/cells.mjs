/*
 * Cell definitions for the minimal-page judgement matrix.
 *
 * Every cell is a set of URL parameters for minimal.html plus a mouse-path
 * scenario. Nothing here is DSH-specific: the page is a standalone file://
 * document with zero external dependencies.
 *
 * scenario:
 *   none   -> no mouse movement at all (floor: rAF/vsync cadence only)
 *   ripple -> sweep the lower "ripple-only" zone (no hover target underneath)
 *   hover  -> chase card centres in the upper zone (tray open/close churn)
 *   both   -> alternate between the two every 250 ms
 */
export const CELLS = {
  'idle-floor': {
    desc: 'n=0, follower off, always-loop on: pure rAF/vsync floor with zero interaction',
    params: { n: 0, impl: 'dom', follower: 0, alwaysloop: 1, hud: 0 }, scenario: 'none',
  },
  'light-dom': {
    desc: 'n=8 cards, DOM ripples, transform, will-change on',
    params: { n: 8, impl: 'dom', pos: 'transform', willchange: 1, follower: 1, tray: 'height', rate: 1 },
    scenario: 'ripple',
  },
  'dom-transform': {
    desc: 'n=64, DOM ripples animated by transform (compositable), will-change on',
    params: { n: 64, impl: 'dom', pos: 'transform', willchange: 1, follower: 1, tray: 'height', rate: 1 },
    scenario: 'ripple',
  },
  'dom-lefttop': {
    desc: 'n=64, DOM ripples animated by left/top/width/height -> forced Recalc+Layout+Paint',
    params: { n: 64, impl: 'dom', pos: 'lefttop', willchange: 1, follower: 1, tray: 'height', rate: 1 },
    scenario: 'ripple',
  },
  'dom-nowc': {
    desc: 'n=64, DOM transform ripples but will-change REMOVED',
    params: { n: 64, impl: 'dom', pos: 'transform', willchange: 0, follower: 1, tray: 'height', rate: 1 },
    scenario: 'ripple',
  },
  'canvas': {
    desc: 'n=64, canvas ripples, 8 particles/ripple',
    params: { n: 64, impl: 'canvas', particles: 8, follower: 1, tray: 'height', rate: 1 },
    scenario: 'ripple',
  },
  'canvas-heavy': {
    desc: 'n=64, canvas ripples, 32 particles/ripple',
    params: { n: 64, impl: 'canvas', particles: 32, follower: 1, tray: 'height', rate: 1 },
    scenario: 'ripple',
  },
  'hover-tray': {
    desc: 'n=64, hover churn over cards (tray height transition), canvas ripples',
    params: { n: 64, impl: 'canvas', particles: 8, follower: 1, tray: 'height', rate: 1 },
    scenario: 'hover',
  },
  'hover-blur': {
    desc: 'hover-tray + backdrop-filter blur on the tray (frosted glass)',
    params: { n: 64, impl: 'canvas', particles: 8, follower: 1, tray: 'height', blur: 1, rate: 1 },
    scenario: 'hover',
  },
  'hover-tray-transform': {
    desc: 'hover churn but the tray animates transform/opacity only (no layout)',
    params: { n: 64, impl: 'canvas', particles: 8, follower: 1, tray: 'transform', rate: 1 },
    scenario: 'hover',
  },
  'combined': {
    desc: 'n=64, alternating hover churn + ripple sweep, DOM transform ripples',
    params: { n: 64, impl: 'dom', pos: 'transform', willchange: 1, follower: 1, tray: 'height', rate: 1 },
    scenario: 'both',
  },
  'extreme-dom': {
    desc: 'n=200 cards, DOM left/top ripples, no will-change, alternating paths',
    params: { n: 200, impl: 'dom', pos: 'lefttop', willchange: 0, follower: 1, tray: 'height', rate: 1 },
    scenario: 'both',
  },
};

export function cellUrl(base, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) q.set(k, String(v));
  return base + '?' + q.toString();
}
