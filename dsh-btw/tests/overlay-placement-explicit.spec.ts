import { describe, expect, it } from 'vitest'
import {
  computeOverlayPlacement,
  computeOverlaySizeBounds,
  DEFAULT_DESIRED_WIDTH,
  type OverlayPlacement,
  type OverlayPlacementInput,
  type RectLike,
} from '../src/client/overlay-placement.ts'

/**
 * Explicit-size mode: the drawer the user dragged to a size.
 *
 * This file is additive — `overlay-placement.spec.ts` (the automatic-placement
 * contract) is untouched and must stay green; the parity harness that proves the
 * non-explicit path is byte-equivalent lives outside this package.
 */

const rect = (left: number, top: number, width: number, height: number): RectLike => ({
  left, top, width, height,
})

const SOFT_MAX = 960
const MIN_WIDTH = 360
const MIN_HEIGHT = 240
const PEEK_MIN = 240

function input(
  width: number,
  height: number,
  occupied: readonly RectLike[] = [],
  safeArea: OverlayPlacementInput['safeArea'] = { top: 0, right: 0, bottom: 0, left: 0 },
): OverlayPlacementInput {
  return {
    viewport: rect(0, 0, width, height),
    frame: rect(0, 0, width, height),
    desiredWidth: DEFAULT_DESIRED_WIDTH,
    minWidth: MIN_WIDTH,
    safeMargin: 12,
    safeArea,
    occupied,
  }
}

function explicit(
  base: OverlayPlacementInput,
  size: { width?: number | null; height?: number | null },
): OverlayPlacementInput {
  return {
    ...base,
    desiredWidth: size.width ?? base.desiredWidth,
    ...(size.height === undefined || size.height === null ? {} : { desiredHeight: size.height }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    maxWidth: SOFT_MAX,
    explicitSize: true,
  }
}

/** Work area of a full-frame input: frame inset by max(12, safeMargin) and quantized. */
function workArea(width: number, height: number): { width: number; height: number; left: number; top: number; right: number; bottom: number } {
  const left = Math.ceil(12 / 4) * 4
  const top = left
  const right = Math.floor((width - 12) / 4) * 4
  const bottom = Math.floor((height - 12) / 4) * 4
  return { width: right - left, height: bottom - top, left, top, right, bottom }
}

const fields = (placement: OverlayPlacement): Record<string, unknown> => ({
  mode: placement.mode,
  rect: placement.rect,
  left: placement.left,
  top: placement.top,
  right: placement.right,
  bottom: placement.bottom,
  width: placement.width,
  height: placement.height,
  maxHeight: placement.maxHeight,
  degraded: placement.degraded,
  reason: placement.reason,
})

describe('explicit drawer size', () => {
  it('honors an explicit width on the right edge and leaves the height automatic', () => {
    const work = workArea(1600, 900)
    const result = computeOverlayPlacement(explicit(input(1600, 900), { width: 500 }))

    expect(result.mode).toBe('right')
    expect(result.width).toBe(500)
    // Right-anchored, top-anchored, height = full work area (unchanged default).
    expect(result.left).toBe(work.right - 500)
    expect(result.top).toBe(work.top)
    expect(result.height).toBe(work.height)
    expect(result.rect).toEqual(rect(work.right - 500, work.top, 500, work.height))
  })

  it('grows downward on an explicit height: the top edge never moves', () => {
    const automatic = computeOverlayPlacement(input(1600, 900))
    const tall = computeOverlayPlacement(explicit(input(1600, 900), { height: 400 }))
    const taller = computeOverlayPlacement(explicit(input(1600, 900), { height: 700 }))

    expect(tall.top).toBe(automatic.top)
    expect(taller.top).toBe(automatic.top)
    expect(tall.height).toBe(400)
    expect(taller.height).toBe(700)
    expect(tall.rect.top).toBe(automatic.rect.top)
  })

  it('clamps the width to the soft cap (960) even when the work area is much wider', () => {
    const bounds = computeOverlaySizeBounds(explicit(input(2560, 1440), { width: 2000 }))
    expect(bounds.maxWidth).toBe(SOFT_MAX)

    const result = computeOverlayPlacement(explicit(input(2560, 1440), { width: 2000 }))
    expect(result.width).toBe(SOFT_MAX)
  })

  it('clamps the width to the hard cap (workWidth - 240) when that is the smaller one', () => {
    const work = workArea(900, 900)
    const hardMaximum = work.width - PEEK_MIN
    expect(hardMaximum).toBeLessThan(SOFT_MAX)

    const result = computeOverlayPlacement(explicit(input(900, 900), { width: 900 }))
    expect(result.width).toBe(hardMaximum)
    // The drawer is right-anchored, so the promised 240px of free width for the
    // main area is the gap on its left.
    expect(result.rect.left - work.left).toBeGreaterThanOrEqual(PEEK_MIN - 4)
  })

  it('clamps to MIN_WIDTH / MIN_HEIGHT instead of collapsing the drawer', () => {
    const narrow = computeOverlayPlacement(explicit(input(1600, 900), { width: 40, height: 10 }))
    expect(narrow.width).toBe(MIN_WIDTH)
    expect(narrow.height).toBe(MIN_HEIGHT)
  })

  it('keeps the mode label of the automatic placement for every dragged size (no rubber-banding)', () => {
    const base = input(1600, 900)
    const automatic = computeOverlayPlacement(base)
    const modes = new Set<string>()
    let previous = 0
    for (const width of [360, 400, 448, 600, 800, 960, 1200, 1600]) {
      const result = computeOverlayPlacement(explicit(base, { width }))
      modes.add(result.mode)
      expect(result.reason).toBe(automatic.reason)
      // A4: width is monotonic non-decreasing as the preference grows.
      expect(result.width).toBeGreaterThanOrEqual(previous)
      previous = result.width
      expect(result.left).toBeGreaterThanOrEqual(base.frame.left)
    }
    expect([...modes]).toEqual([automatic.mode])
    expect(modes.size).toBe(1)
  })

  it('never widens past the work area even with an absurd preference', () => {
    const work = workArea(1600, 900)
    const result = computeOverlayPlacement(explicit(input(1600, 900), { width: 99_999 }))
    expect(result.width).toBe(SOFT_MAX)
    expect(result.rect.left).toBeGreaterThanOrEqual(work.left)
    expect(result.rect.left + result.rect.width).toBeLessThanOrEqual(work.right)
  })

  it('falls back to the untouched automatic placement when the work area is degenerate', () => {
    const base = input(320, 200)
    const automatic = computeOverlayPlacement(base)
    const withExplicit = computeOverlayPlacement(explicit(base, { width: 900, height: 900 }))
    expect(fields(withExplicit)).toEqual(fields(automatic))
  })

  it('ignores every new field unless explicitSize is true (structural guard)', () => {
    const base = input(1600, 900, [rect(1200, 0, 400, 900)])
    const automatic = computeOverlayPlacement(base)
    const polluted: OverlayPlacementInput = {
      ...base,
      desiredHeight: 100,
      minHeight: 900,
      maxWidth: 100,
    }
    expect(fields(computeOverlayPlacement(polluted))).toEqual(fields(automatic))
    expect(fields(computeOverlayPlacement({ ...polluted, explicitSize: false }))).toEqual(fields(automatic))
  })

  it('moves the drawer inside the widest free lane when a details panel occupies the right edge', () => {
    const details = rect(1200, 0, 400, 900)
    const base = input(1600, 900, [details])
    const result = computeOverlayPlacement(explicit(base, { width: 700 }))
    expect(result.width).toBe(700)
    // lane = [12, 1188] (details rect expanded by the 12px margin, quantized)
    expect(result.rect.left + result.rect.width).toBeLessThanOrEqual(1188)
    expect(result.rect.left + result.rect.width).toBe(1188)
  })

  it('uses the explicit height for a bottom sheet when no side lane can host a drawer', () => {
    // Obstacles on both edges leave no 616px-wide lane: the automatic placement
    // itself becomes a sheet, and the explicit height must be honored there too.
    const base = input(900, 700, [rect(0, 0, 300, 700), rect(620, 0, 280, 700)])
    const automatic = computeOverlayPlacement(base)
    expect(automatic.mode).toBe('bottom-sheet')

    const result = computeOverlayPlacement(explicit(base, { height: 420 }))
    expect(result.mode).toBe('bottom-sheet')
    expect(result.height).toBe(420)
  })

  it('reports an honest a11y envelope through computeOverlaySizeBounds', () => {
    const bounds = computeOverlaySizeBounds(explicit(input(1600, 900), { width: 500 }))
    const work = workArea(1600, 900)
    expect(bounds.minWidth).toBe(MIN_WIDTH)
    expect(bounds.maxWidth).toBe(SOFT_MAX)
    expect(bounds.minHeight).toBe(MIN_HEIGHT)
    expect(bounds.maxHeight).toBe(work.height)
  })
})
