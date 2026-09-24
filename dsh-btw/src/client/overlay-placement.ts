export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface OverlayPlacementInput {
  viewport: RectLike
  frame: RectLike
  desiredWidth: number
  minWidth: number
  safeMargin: number
  safeArea: Insets
  occupied: readonly RectLike[]
  /**
   * Explicit-size mode (all optional; omitted/`false` = today's automatic
   * placement, computed by the same code paths as before this field existed).
   *
   * `desiredWidth` carries the user's width preference in both modes; the
   * automatic 448 baseline is only used for the width of the automatic
   * placement and for the (size-independent) mode label.
   */
  desiredHeight?: number
  /** Floor for the explicit height; ignored unless `explicitSize` is true. */
  minHeight?: number
  /** Soft ceiling for the explicit width — never widen the drawer past this. */
  maxWidth?: number
  /** Single structural guard: every explicit-only branch sits behind this. */
  explicitSize?: boolean
}

/** Size ceilings/floors actually enforced for one input (also feeds a11y bounds). */
export interface OverlaySizeBounds {
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}

export type OverlayPlacementMode = 'right' | 'compact-right' | 'bottom-sheet'
export type OverlayPlacementReason =
  | 'regular-side-fit'
  | 'compact-side-fit'
  | 'clean-bottom-lane'
  | 'minimum-overlap-fallback'
  | 'undersized-emergency'

export interface OverlayPlacement {
  mode: OverlayPlacementMode
  rect: RectLike
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  maxHeight: number
  degraded: boolean
  reason: OverlayPlacementReason
}

interface Edges {
  left: number
  top: number
  right: number
  bottom: number
}

interface Lane { start: number; end: number }

const QUANTUM = 4
const REGULAR_CONTENT_PEEK = 320
const COMPACT_CONTENT_PEEK = 240
/** Automatic-placement baseline width (the default `desiredWidth` of the hook). */
export const DEFAULT_DESIRED_WIDTH = 448
const MODE_RESERVE = 16
const COMPACT_PREFERRED_WIDTH = 400
const BOTTOM_SHEET_RATIO = 0.48
const BOTTOM_SHEET_MIN_HEIGHT = 280
const BOTTOM_SHEET_MAX_HEIGHT = 560
const BOTTOM_SHEET_MAX_WIDTH = 720
const NARROW_SHEET_BREAKPOINT = 480

const toEdges = (rect: RectLike): Edges => ({
  left: rect.left,
  top: rect.top,
  right: rect.left + rect.width,
  bottom: rect.top + rect.height,
})

const fromEdges = (rect: Edges): RectLike => ({
  left: rect.left,
  top: rect.top,
  width: Math.max(0, rect.right - rect.left),
  height: Math.max(0, rect.bottom - rect.top),
})

const ceilQuantum = (value: number): number => Math.ceil(value / QUANTUM) * QUANTUM
const floorQuantum = (value: number): number => Math.floor(value / QUANTUM) * QUANTUM
const roundQuantum = (value: number): number => Math.round(value / QUANTUM) * QUANTUM
const finite = (value: number): boolean => Number.isFinite(value)
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))

function validRect(rect: RectLike): boolean {
  return finite(rect.left) && finite(rect.top) && finite(rect.width) && finite(rect.height)
    && rect.width > 0 && rect.height > 0
}

function intersectEdges(first: Edges, second: Edges): Edges | null {
  const value = {
    left: Math.max(first.left, second.left),
    top: Math.max(first.top, second.top),
    right: Math.min(first.right, second.right),
    bottom: Math.min(first.bottom, second.bottom),
  }
  return value.right > value.left && value.bottom > value.top ? value : null
}

export function rectsIntersect(first: RectLike, second: RectLike): boolean {
  return intersectEdges(toEdges(first), toEdges(second)) !== null
}

function mergeIntervals(intervals: readonly Lane[]): Lane[] {
  const sorted = [...intervals]
    .filter(interval => interval.end > interval.start)
    .sort((first, second) => first.start - second.start || first.end - second.end)
  const merged: Lane[] = []
  for (const interval of sorted) {
    const previous = merged.at(-1)
    if (previous === undefined || interval.start > previous.end) {
      merged.push({ ...interval })
    } else {
      previous.end = Math.max(previous.end, interval.end)
    }
  }
  return merged
}

function complement(start: number, end: number, intervals: readonly Lane[]): Lane[] {
  const result: Lane[] = []
  let cursor = start
  for (const interval of mergeIntervals(intervals)) {
    if (interval.end <= start || interval.start >= end) continue
    const clippedStart = Math.max(start, interval.start)
    const clippedEnd = Math.min(end, interval.end)
    if (clippedStart > cursor) result.push({ start: cursor, end: clippedStart })
    cursor = Math.max(cursor, clippedEnd)
  }
  if (cursor < end) result.push({ start: cursor, end })
  return result
}

function safeAxis(start: number, end: number, leadingInset: number, trailingInset: number): Lane {
  const insetStart = ceilQuantum(start + leadingInset)
  const insetEnd = floorQuantum(end - trailingInset)
  if (insetEnd > insetStart) return { start: insetStart, end: insetEnd }

  // An impossible safe area must degrade inside the host frame rather than
  // manufacturing pixels beyond the viewport. Relax the insets first, then
  // quantization only when even the raw frame is smaller than one grid unit.
  const frameStart = ceilQuantum(start)
  const frameEnd = floorQuantum(end)
  if (frameEnd > frameStart) return { start: frameStart, end: frameEnd }
  return { start, end: Math.max(start, end) }
}

function workArea(input: OverlayPlacementInput): Edges {
  const overlap = intersectEdges(toEdges(input.frame), toEdges(input.viewport))
  const base = overlap ?? intersectEdges(toEdges(input.frame), toEdges(input.frame)) ?? toEdges(input.frame)
  const margin = Math.max(12, input.safeMargin)
  const horizontal = safeAxis(
    base.left,
    base.right,
    margin + Math.max(0, input.safeArea.left),
    margin + Math.max(0, input.safeArea.right),
  )
  const vertical = safeAxis(
    base.top,
    base.bottom,
    margin + Math.max(0, input.safeArea.top),
    margin + Math.max(0, input.safeArea.bottom),
  )
  return { left: horizontal.start, top: vertical.start, right: horizontal.end, bottom: vertical.end }
}

/**
 * The size envelope actually enforced for one input. Read-only projection of the
 * same rules the explicit branches apply, so the drag handles can publish honest
 * `aria-valuemin`/`aria-valuemax` values. Purely additive: nothing else in the
 * solver depends on it, and it changes no placement output.
 */
export function computeOverlaySizeBounds(input: OverlayPlacementInput): OverlaySizeBounds {
  const work = workArea(input)
  const availableWidth = work.right - work.left
  const availableHeight = work.bottom - work.top
  // Hard rule (unchanged): the drawer is an overlay, so width is the only lever
  // that keeps the main area usable — at least COMPACT_CONTENT_PEEK px stay free.
  const hardMaximum = Math.max(input.minWidth, availableWidth - COMPACT_CONTENT_PEEK)
  const softMaximum = input.maxWidth ?? Number.POSITIVE_INFINITY
  return {
    minWidth: input.minWidth,
    maxWidth: Math.max(input.minWidth, Math.min(hardMaximum, softMaximum)),
    minHeight: Math.max(0, input.minHeight ?? 0),
    maxHeight: Math.max(0, availableHeight),
  }
}

/** Degenerate work areas keep the pre-existing automatic behavior verbatim. */
function explicitFeasible(input: OverlayPlacementInput, work: Edges): boolean {
  return work.right - work.left >= input.minWidth
    && work.bottom - work.top >= Math.max(0, input.minHeight ?? 0)
}

function normalizedObstacles(input: OverlayPlacementInput, work: Edges): Edges[] {
  const margin = Math.max(12, input.safeMargin)
  const values: Edges[] = []
  for (const rect of input.occupied) {
    if (!validRect(rect)) continue
    // Expand before clipping so a control immediately outside the nominal work
    // area still receives the promised clearance from the drawer edge.
    const source = toEdges(rect)
    const expanded = intersectEdges({
      left: floorQuantum(source.left) - margin,
      top: floorQuantum(source.top) - margin,
      right: ceilQuantum(source.right) + margin,
      bottom: ceilQuantum(source.bottom) + margin,
    }, work)
    if (expanded !== null) values.push(expanded)
  }
  return values.sort((first, second) => first.left - second.left
    || first.top - second.top
    || first.right - second.right
    || first.bottom - second.bottom)
}

function horizontalLanes(work: Edges, obstacles: readonly Edges[]): Lane[] {
  return complement(work.left, work.right, obstacles.map(obstacle => ({
    start: obstacle.left,
    end: obstacle.right,
  })))
}

function verticalLanes(work: Edges, obstacles: readonly Edges[]): Lane[] {
  return complement(work.top, work.bottom, obstacles.map(obstacle => ({
    start: obstacle.top,
    end: obstacle.bottom,
  })))
}

function finish(
  input: OverlayPlacementInput,
  rect: RectLike,
  mode: OverlayPlacementMode,
  degraded: boolean,
  reason: OverlayPlacementReason,
): OverlayPlacement {
  const frame = toEdges(input.frame)
  const right = Math.max(0, frame.right - (rect.left + rect.width))
  const bottom = Math.max(0, frame.bottom - (rect.top + rect.height))
  return {
    mode,
    rect,
    left: rect.left - frame.left,
    top: rect.top - frame.top,
    right,
    bottom,
    width: rect.width,
    height: rect.height,
    maxHeight: rect.height,
    degraded,
    reason,
  }
}

function chooseRight(input: OverlayPlacementInput, work: Edges, obstacles: readonly Edges[]): OverlayPlacement | null {
  return input.explicitSize === true
    ? chooseRightExplicit(input, work, obstacles)
    : chooseRightAutomatic(input, work, obstacles)
}

/**
 * Mode label and family verdict for the explicit path, computed WITHOUT looking
 * at the dragged size: the verdict only depends on lane widths and the fixed
 * automatic baseline. That is what keeps `data-placement-mode` constant for the
 * whole gesture (no rubber-banding, no mid-drag mode switch) and keeps the
 * explicit drawer in the same family the automatic layout would have chosen.
 */
function explicitVerdict(
  input: OverlayPlacementInput,
  lanes: readonly Lane[],
): { mode: OverlayPlacementMode; reason: OverlayPlacementReason } | null {
  const roomy = lanes.some(lane =>
    lane.end - lane.start >= DEFAULT_DESIRED_WIDTH + REGULAR_CONTENT_PEEK + MODE_RESERVE)
  if (roomy) return { mode: 'right', reason: 'regular-side-fit' }
  const compact = lanes.some(lane => {
    const laneWidth = floorQuantum(lane.end - lane.start)
    return Math.min(COMPACT_PREFERRED_WIDTH, floorQuantum(laneWidth - COMPACT_CONTENT_PEEK - MODE_RESERVE))
      >= input.minWidth
  })
  return compact ? { mode: 'compact-right', reason: 'compact-side-fit' } : null
}

function chooseRightExplicit(
  input: OverlayPlacementInput,
  work: Edges,
  obstacles: readonly Edges[],
): OverlayPlacement | null {
  const lanes = horizontalLanes(work, obstacles)
  const verdict = explicitVerdict(input, lanes)
  // No lane can host a side drawer at all: hand over to the sheet family (which
  // honors the explicit height) instead of forcing a mode switch by returning
  // null from the whole computation.
  if (verdict === null) return null
  // The widest free lane, same preference order as the automatic path. The
  // explicit path must always produce a placement: a null here would switch the
  // mode mid-gesture (right column -> bottom sheet).
  const lane = [...lanes].sort((first, second) =>
    second.end - first.end || (second.end - second.start) - (first.end - first.start) || first.start - second.start)[0]
  if (lane === undefined) return null

  const bounds = computeOverlaySizeBounds(input)
  const wantWidth = floorQuantum(clamp(input.desiredWidth, bounds.minWidth, bounds.maxWidth))
  const wantHeight = roundQuantum(clamp(input.desiredHeight ?? bounds.maxHeight, bounds.minHeight, bounds.maxHeight))
  const laneWidth = lane.end - lane.start
  return finish(
    input,
    fromEdges({
      // Right-anchored (same lane edge as the automatic path) and TOP-anchored:
      // changing the height grows the drawer downward and never moves its top.
      left: lane.end - wantWidth,
      top: work.top,
      right: lane.end,
      bottom: work.top + wantHeight,
    }),
    verdict.mode,
    wantWidth > laneWidth - MODE_RESERVE,
    verdict.reason,
  )
}

function chooseRightAutomatic(
  input: OverlayPlacementInput,
  work: Edges,
  obstacles: readonly Edges[],
): OverlayPlacement | null {
  const lanes = horizontalLanes(work, obstacles)
  const availableHeight = work.bottom - work.top
  const desiredWidth = floorQuantum(input.desiredWidth)
  const regular = lanes
    .filter(lane => lane.end - lane.start >= desiredWidth + REGULAR_CONTENT_PEEK + MODE_RESERVE)
    .map(lane => ({
      lane,
      rect: fromEdges({
        left: lane.end - desiredWidth,
        top: work.top,
        right: lane.end,
        bottom: work.bottom,
      }),
    }))
    .sort((first, second) => (second.rect.left + second.rect.width) - (first.rect.left + first.rect.width)
      || second.rect.width - first.rect.width
      || first.rect.left - second.rect.left)
  if (regular[0] !== undefined) {
    return finish(input, regular[0].rect, 'right', false, 'regular-side-fit')
  }

  const compact = lanes.flatMap(lane => {
    const laneWidth = floorQuantum(lane.end - lane.start)
    const maximum = floorQuantum(laneWidth - COMPACT_CONTENT_PEEK - MODE_RESERVE)
    const width = Math.min(COMPACT_PREFERRED_WIDTH, maximum)
    if (width < input.minWidth || availableHeight <= 0) return []
    return [{
      rect: fromEdges({
        left: lane.end - width,
        top: work.top,
        right: lane.end,
        bottom: work.bottom,
      }),
    }]
  }).sort((first, second) => (second.rect.left + second.rect.width) - (first.rect.left + first.rect.width)
    || second.rect.width - first.rect.width
    || first.rect.left - second.rect.left)
  return compact[0] === undefined
    ? null
    : finish(input, compact[0].rect, 'compact-right', false, 'compact-side-fit')
}

function sheetHeight(work: Edges, input: OverlayPlacementInput): number {
  const available = work.bottom - work.top
  if (input.explicitSize === true) {
    const minimum = Math.min(Math.max(0, input.minHeight ?? 0), available)
    return roundQuantum(clamp(input.desiredHeight ?? available, minimum, available))
  }
  return Math.min(available, clamp(
    roundQuantum(available * BOTTOM_SHEET_RATIO),
    Math.min(BOTTOM_SHEET_MIN_HEIGHT, available),
    BOTTOM_SHEET_MAX_HEIGHT,
  ))
}

/** Sheet width: the explicit preference when dragging, the sheet contract otherwise. */
function sheetWidth(laneWidth: number, input: OverlayPlacementInput, bounds: OverlaySizeBounds): number {
  const maximum = floorQuantum(laneWidth)
  if (input.explicitSize === true) return Math.min(maximum, floorQuantum(bounds.maxWidth))
  return Math.min(BOTTOM_SHEET_MAX_WIDTH, maximum)
}

function panelLanes(work: Edges, obstacles: readonly Edges[]): Lane[] {
  const workHeight = work.bottom - work.top
  const panels = obstacles.filter(obstacle => obstacle.bottom - obstacle.top >= workHeight * 0.7)
  return horizontalLanes(work, panels)
}

function overlapArea(rect: RectLike, obstacles: readonly Edges[]): number {
  const edges = toEdges(rect)
  return obstacles.reduce((sum, obstacle) => {
    const overlap = intersectEdges(edges, obstacle)
    return sum + (overlap === null ? 0 : (overlap.right - overlap.left) * (overlap.bottom - overlap.top))
  }, 0)
}

function candidateSheetTops(work: Edges, height: number, obstacles: readonly Edges[]): number[] {
  const minimum = work.top
  const maximum = Math.max(minimum, work.bottom - height)
  const values = [
    maximum,
    ...obstacles.flatMap(obstacle => [obstacle.top - height, obstacle.bottom]),
  ]
  return [...new Set(values.map(value =>
    clamp(roundQuantum(value), minimum, maximum),
  ))].sort((first, second) => first - second)
}

function sheetOrder(work: Edges, first: RectLike, second: RectLike): number {
  const firstLift = work.bottom - (first.top + first.height)
  const secondLift = work.bottom - (second.top + second.height)
  return firstLift - secondLift
    || second.width - first.width
    || second.height - first.height
    || (second.left + second.width) - (first.left + first.width)
    || first.left - second.left
    || first.top - second.top
}

function chooseSheet(input: OverlayPlacementInput, work: Edges, obstacles: readonly Edges[]): OverlayPlacement {
  const targetHeight = sheetHeight(work, input)
  const bounds = computeOverlaySizeBounds(input)
  const availableHeight = Math.max(0, work.bottom - work.top)
  const minimumHeight = Math.min(BOTTOM_SHEET_MIN_HEIGHT, availableHeight)
  const narrowViewport = Math.min(input.viewport.width, input.frame.width) <= NARROW_SHEET_BREAKPOINT
  const sheetObstacles = narrowViewport
    ? obstacles.filter(obstacle => {
        const width = obstacle.right - obstacle.left
        const height = obstacle.bottom - obstacle.top
        const collapsedLeftRail = obstacle.left <= work.left
          && width <= 64
          && height >= availableHeight * 0.7
        return !collapsedLeftRail
      })
    : obstacles
  const sideSafeLanes = panelLanes(work, sheetObstacles)
  const clean: RectLike[] = []
  const tops = candidateSheetTops(work, targetHeight, sheetObstacles)

  // Evaluate horizontal lanes separately at each meaningful vertical boundary.
  // This finds diagonal clear space that global x/y projections miss. Keeping
  // bottom-aligned candidates first preserves horizontal avoidance for small
  // bottom-right controls.
  for (const safeLane of sideSafeLanes) {
    for (const top of tops) {
      const bottom = top + targetHeight
      const overlappingY = sheetObstacles.filter(obstacle => obstacle.bottom > top && obstacle.top < bottom)
      const freeAtThisHeight = complement(
        safeLane.start,
        safeLane.end,
        overlappingY.map(obstacle => ({ start: obstacle.left, end: obstacle.right })),
      )
      for (const freeLane of freeAtThisHeight) {
        const width = sheetWidth(freeLane.end - freeLane.start, input, bounds)
        if (width < input.minWidth) continue
        const rect = fromEdges({
          left: freeLane.end - width,
          top,
          right: freeLane.end,
          bottom,
        })
        if (overlapArea(rect, sheetObstacles) === 0) clean.push(rect)
      }
    }
  }

  // A clean but shorter sheet is preferable to overlap when the requested
  // height cannot fit. Check vertical lanes for each maximum-width safe lane.
  for (const lane of sideSafeLanes) {
    const width = sheetWidth(lane.end - lane.start, input, bounds)
    if (width < input.minWidth) continue
    const right = lane.end
    const left = right - width
    const overlappingX = sheetObstacles.filter(obstacle => obstacle.right > left && obstacle.left < right)
    for (const vertical of verticalLanes(work, overlappingX)) {
      const height = Math.min(targetHeight, floorQuantum(vertical.end - vertical.start))
      if (height < minimumHeight) continue
      const rect = fromEdges({ left, top: vertical.end - height, right, bottom: vertical.end })
      if (overlapArea(rect, obstacles) === 0) clean.push(rect)
    }
  }

  clean.sort((first, second) => sheetOrder(work, first, second))
  if (clean[0] !== undefined) {
    return finish(input, clean[0], 'bottom-sheet', false, 'clean-bottom-lane')
  }

  // Geometrically constrained fallback: search meaningful x/y boundaries and
  // minimize actual overlap while remaining inside a panel-safe lane.
  const fallbackCandidates: RectLike[] = []
  for (const lane of sideSafeLanes.length === 0 ? [{ start: work.left, end: work.right }] : sideSafeLanes) {
    const laneWidth = Math.max(0, lane.end - lane.start)
    const widths = [...new Set([
      sheetWidth(laneWidth, input, bounds),
      Math.min(floorQuantum(laneWidth), input.minWidth),
    ].filter(width => width > 0))]
    for (const width of widths) {
      const xValues = [
        lane.start,
        lane.end - width,
        ...sheetObstacles.flatMap(obstacle => [obstacle.left - width, obstacle.right]),
      ]
      const lefts = [...new Set(xValues.map(value =>
        clamp(roundQuantum(value), lane.start, Math.max(lane.start, lane.end - width)),
      ))]
      for (const left of lefts) {
        for (const top of tops) {
          fallbackCandidates.push({ left, top, width, height: targetHeight })
        }
      }
    }
  }
  fallbackCandidates.sort((first, second) =>
    overlapArea(first, sheetObstacles) - overlapArea(second, sheetObstacles)
      || sheetOrder(work, first, second),
  )
  const fallback = fallbackCandidates[0] ?? {
    left: work.left,
    top: work.top,
    width: Math.max(0, work.right - work.left),
    height: Math.max(0, work.bottom - work.top),
  }
  const undersized = fallback.width < input.minWidth || fallback.height < minimumHeight
  return finish(
    input,
    fallback,
    'bottom-sheet',
    true,
    undersized ? 'undersized-emergency' : 'minimum-overlap-fallback',
  )
}

export function computeOverlayPlacement(input: OverlayPlacementInput): OverlayPlacement {
  const work = workArea(input)
  const obstacles = normalizedObstacles(input, work)
  // Extreme narrow/degenerate work areas: fall back to the untouched automatic
  // placement (the explicit wants cannot be honored there, and pretending
  // otherwise would park the drawer off-screen).
  if (input.explicitSize === true && !explicitFeasible(input, work)) {
    return computeOverlayPlacement({ ...input, explicitSize: false })
  }
  return chooseRight(input, work, obstacles) ?? chooseSheet(input, work, obstacles)
}
