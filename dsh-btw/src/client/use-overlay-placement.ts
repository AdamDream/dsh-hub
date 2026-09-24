import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import {
  computeOverlayPlacement,
  computeOverlaySizeBounds,
  DEFAULT_DESIRED_WIDTH,
  type Insets,
  type OverlayPlacement,
  type OverlayPlacementInput,
  type OverlaySizeBounds,
  type RectLike,
} from './overlay-placement.ts'
import { HANDLE_MIN_VIEWPORT, hasExplicitSize, type DrawerSize, type DrawerSizeRef } from './drawer-size.ts'

export const DEFAULT_AVOID_SELECTORS = [
  '[data-dsh-btw-avoid]',
  '[data-dsh-shutdown-float] button',
  '[data-dsh-better-sidebar] button',
] as const

export interface OverlayPlacementOptions {
  avoidSelectors?: readonly string[]
  desiredWidth?: number
  minWidth?: number
  safeMargin?: number
  enabled?: boolean
  /**
   * Live size preference. Read inside `measure()` only — a ref is a stable
   * identity, so it can never enter the effect dependency list (see the
   * observer-discipline note on {@link useOverlayPlacement}).
   */
  sizeRef?: DrawerSizeRef
  /** Floor for the explicit height (only meaningful with `sizeRef`). */
  minHeight?: number
  /** Soft ceiling for the explicit width (only meaningful with `sizeRef`). */
  maxWidth?: number
}

export interface OverlayGeometry {
  frame: RectLike
  viewport: RectLike
  safeArea: Insets
  occupied: RectLike[]
  compute(): OverlayPlacement
  /** Size envelope enforced for this input (a11y bounds; not a placement). */
  bounds(): OverlaySizeBounds
}

/**
 * Hook result: the placement plus the enforced size envelope and the imperative
 * re-measure entry point a drag uses between pointerdown and pointerup.
 */
export interface OverlayPlacementResult extends OverlayPlacement {
  bounds: OverlaySizeBounds
  remeasure(): void
}

export type OverlayPlacementStyle = CSSProperties & Record<string, string | number | undefined>

declare global {
  interface Window {
    /** Optional best-effort selectors for body portals outside shell.overlay. */
    __DSH_SIDE_CHAT_AVOID_SELECTORS__?: readonly string[]
  }
}

const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }
const FALLBACK_WIDTH = 1280
const FALLBACK_HEIGHT = 800

function toRect(rect: DOMRect | DOMRectReadOnly): RectLike {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function positiveRect(element: Element | null): RectLike | null {
  if (element === null) return null
  const rect = element.getBoundingClientRect()
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)
    || rect.width <= 0 || rect.height <= 0) return null
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null
  return toRect(rect)
}

function isOwnedBySideChat(element: Element, root: HTMLElement): boolean {
  return element === root || root.contains(element) || element.matches('[data-dsh-btw-root]')
}

function pane(frame: HTMLElement, name: 'sidebar' | 'details'): HTMLElement | null {
  const marked = frame.querySelector<HTMLElement>(':scope > [data-pane="' + name + '"]')
  if (marked !== null) return marked
  const byClass = [...frame.children].find(element =>
    element instanceof HTMLElement && element.className.includes(name === 'sidebar' ? 'sidebarCol' : 'detailsCol'),
  )
  if (byClass instanceof HTMLElement) return byClass

  // Core rc.8 has no semantic column markers. Its stable AppFrame order is
  // sidebar, conversation, details, overlay, handles; use this only as a final
  // compatibility fallback and validate that the candidate precedes overlay.
  const overlayIndex = [...frame.children].findIndex(element => element.matches('[data-shell-overlay]'))
  if (overlayIndex < 3) return null
  const candidate = name === 'sidebar' ? frame.children[0] : frame.children[overlayIndex - 1]
  return candidate instanceof HTMLElement ? candidate : null
}

function configuredSelectors(options: OverlayPlacementOptions): string[] {
  const values = [
    ...DEFAULT_AVOID_SELECTORS,
    ...(options.avoidSelectors ?? []),
    ...(typeof window === 'undefined' ? [] : (window.__DSH_SIDE_CHAT_AVOID_SELECTORS__ ?? [])),
  ]
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 32)
}

function safeQueryAll(selector: string): Element[] {
  try {
    return [...document.querySelectorAll(selector)]
  } catch {
    return []
  }
}

function safeInsets(root: HTMLElement): Insets {
  const probe = root.querySelector<HTMLElement>('[data-dsh-btw-safe-area]')
  if (probe === null) return ZERO_INSETS
  const style = getComputedStyle(probe)
  const parse = (value: string): number => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
  }
  return {
    top: parse(style.paddingTop),
    right: parse(style.paddingRight),
    bottom: parse(style.paddingBottom),
    left: parse(style.paddingLeft),
  }
}

function visualViewportRect(): RectLike {
  const visual = window.visualViewport
  if (visual != null) {
    return {
      left: visual.offsetLeft,
      top: visual.offsetTop,
      width: visual.width,
      height: visual.height,
    }
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

function geometryElements(root: HTMLElement, options: OverlayPlacementOptions): {
  overlay: HTMLElement | null
  frame: HTMLElement | null
  nativePanes: HTMLElement[]
  siblingEntries: HTMLElement[]
  explicitAvoid: Element[]
  slotHost: HTMLElement | null
} {
  const overlay = root.closest<HTMLElement>('[data-shell-overlay]')
  const frame = overlay?.parentElement ?? null
  const nativePanes = frame === null
    ? []
    : [pane(frame, 'sidebar'), pane(frame, 'details')].filter((value): value is HTMLElement => value !== null)
  const slotHost = root.closest<HTMLElement>('[data-slot="shell.overlay"]')
  const siblingEntries = slotHost === null
    ? []
    : [...slotHost.children].filter((element): element is HTMLElement =>
      element instanceof HTMLElement && !isOwnedBySideChat(element, root),
    )
  const explicitAvoid = configuredSelectors(options)
    .flatMap(safeQueryAll)
    .filter(element => !isOwnedBySideChat(element, root))
  return { overlay, frame, nativePanes, siblingEntries, explicitAvoid, slotHost }
}

function isFullFrameClickThrough(element: HTMLElement, rect: RectLike, frame: RectLike): boolean {
  if (getComputedStyle(element).pointerEvents !== 'none') return false
  const tolerance = 4
  return rect.left <= frame.left + tolerance
    && rect.top <= frame.top + tolerance
    && rect.left + rect.width >= frame.left + frame.width - tolerance
    && rect.top + rect.height >= frame.top + frame.height - tolerance
}

function dedupeRects(rects: readonly RectLike[]): RectLike[] {
  const seen = new Set<string>()
  const result: RectLike[] = []
  for (const rect of rects) {
    const key = [rect.left, rect.top, rect.width, rect.height].map(value => value.toFixed(2)).join(':')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(rect)
  }
  return result
}

export function collectOverlayGeometry(
  root: HTMLElement,
  options: OverlayPlacementOptions = {},
): OverlayGeometry {
  const elements = geometryElements(root, options)
  const overlayRect = positiveRect(elements.overlay)
  const frameRect = overlayRect ?? positiveRect(elements.frame) ?? visualViewportRect()
  const measured = (element: Element): RectLike[] => {
    const rect = positiveRect(element)
    return rect === null ? [] : [rect]
  }
  const siblingRects = elements.siblingEntries.flatMap(element => {
    const rect = positiveRect(element)
    if (rect === null || isFullFrameClickThrough(element, rect, frameRect)) return []
    return [rect]
  })
  const occupied = dedupeRects([
    ...elements.nativePanes.flatMap(measured),
    ...siblingRects,
    ...elements.explicitAvoid.flatMap(measured),
  ])
  const viewport = visualViewportRect()
  const safeArea = safeInsets(root)
  const minWidth = options.minWidth ?? 360
  const safeMargin = options.safeMargin ?? 12
  const { desiredWidth, desiredHeight, explicitSize } = explicitSizeInput(options)

  const placementInput = (): OverlayPlacementInput => ({
    frame: frameRect,
    viewport,
    desiredWidth,
    minWidth,
    safeMargin,
    safeArea,
    occupied,
    ...(desiredHeight === undefined ? {} : { desiredHeight }),
    ...(options.minHeight === undefined ? {} : { minHeight: options.minHeight }),
    ...(options.maxWidth === undefined ? {} : { maxWidth: options.maxWidth }),
    ...(explicitSize ? { explicitSize: true } : {}),
  })

  return {
    frame: frameRect,
    viewport,
    safeArea,
    occupied,
    compute: () => computeOverlayPlacement(placementInput()),
    bounds: () => computeOverlaySizeBounds(placementInput()),
  }
}

/**
 * Resolve the explicit-size input from the live size ref.
 *
 * Two guards, both deliberate:
 *  1. `null` on BOTH axes = untouched automatic placement (the solver's
 *     non-explicit path, byte-for-byte today's behavior);
 *  2. below `HANDLE_MIN_VIEWPORT` the explicit preference is not rendered at
 *     all, so a narrow window keeps the bottom-sheet + scrim behavior it has
 *     today. The stored preference is NOT rewritten (INV-2) — widening the
 *     window brings the user's size straight back.
 */
function explicitSizeInput(options: OverlayPlacementOptions): {
  desiredWidth: number
  desiredHeight: number | undefined
  explicitSize: boolean
} {
  const base = options.desiredWidth ?? DEFAULT_DESIRED_WIDTH
  const size: DrawerSize | undefined = options.sizeRef?.current
  const wideEnough = typeof window === 'undefined'
    || window.innerWidth >= HANDLE_MIN_VIEWPORT
  if (!hasExplicitSize(size) || !wideEnough) {
    return { desiredWidth: base, desiredHeight: undefined, explicitSize: false }
  }
  return {
    desiredWidth: size?.width ?? base,
    desiredHeight: size?.height ?? undefined,
    explicitSize: true,
  }
}

/** Synthetic full-window input used before the first real measurement. */
function fallbackInput(options: OverlayPlacementOptions): OverlayPlacementInput {
  const width = typeof window === 'undefined' ? FALLBACK_WIDTH : Math.max(1, window.innerWidth)
  const height = typeof window === 'undefined' ? FALLBACK_HEIGHT : Math.max(1, window.innerHeight)
  const frame = { left: 0, top: 0, width, height }
  const { desiredWidth, desiredHeight, explicitSize } = explicitSizeInput(options)
  return {
    frame,
    viewport: frame,
    desiredWidth,
    minWidth: options.minWidth ?? 360,
    safeMargin: options.safeMargin ?? 12,
    safeArea: ZERO_INSETS,
    occupied: [],
    ...(desiredHeight === undefined ? {} : { desiredHeight }),
    ...(options.minHeight === undefined ? {} : { minHeight: options.minHeight }),
    ...(options.maxWidth === undefined ? {} : { maxWidth: options.maxWidth }),
    ...(explicitSize ? { explicitSize: true } : {}),
  }
}

function fallbackPlacement(options: OverlayPlacementOptions): OverlayPlacement {
  return computeOverlayPlacement(fallbackInput(options))
}

function samePlacement(first: OverlayPlacement, second: OverlayPlacement): boolean {
  return first.mode === second.mode
    && first.left === second.left
    && first.top === second.top
    && first.right === second.right
    && first.bottom === second.bottom
    && first.width === second.width
    && first.height === second.height
    && first.degraded === second.degraded
    && first.reason === second.reason
}

/**
 * Measure the overlay placement for `rootRef`.
 *
 * OBSERVER DISCIPLINE (load-bearing): the layout effect below constructs a
 * ResizeObserver, a MutationObserver and three visual-viewport/window listeners
 * and observes `document.body`. Because the whole observer set is rebuilt on
 * every effect run, the live size preference must NOT enter the dependency
 * list: a drag would otherwise tear down and rebuild five observers per frame.
 * The size therefore travels through `options.sizeRef` (a stable identity, read
 * inside `measure()`) and the caller asks for a re-measure through the returned
 * imperative `remeasure()`. The store is only committed on `pointerup`.
 */
function sameBounds(first: OverlaySizeBounds, second: OverlaySizeBounds): boolean {
  return first.minWidth === second.minWidth
    && first.maxWidth === second.maxWidth
    && first.minHeight === second.minHeight
    && first.maxHeight === second.maxHeight
}

export function useOverlayPlacement(
  rootRef: RefObject<HTMLElement | null>,
  options: OverlayPlacementOptions = {},
): OverlayPlacementResult {
  const [placement, setPlacement] = useState(() => fallbackPlacement(options))
  const [bounds, setBounds] = useState<OverlaySizeBounds>(() => computeOverlaySizeBounds(fallbackInput(options)))
  const selectorKey = options.avoidSelectors?.join('\n') ?? ''
  const desiredWidth = options.desiredWidth ?? DEFAULT_DESIRED_WIDTH
  const minWidth = options.minWidth ?? 360
  const minHeight = options.minHeight
  const maxWidth = options.maxWidth
  const safeMargin = options.safeMargin ?? 12
  const enabled = options.enabled ?? true
  const sizeRef = options.sizeRef
  // Stable live views: read at measure time, never an effect dependency.
  const desiredWidthRef = useRef(desiredWidth)
  desiredWidthRef.current = desiredWidth
  const sizeRefLive = useRef(sizeRef)
  sizeRefLive.current = sizeRef

  const remeasureRef = useRef<() => void>(() => { /* replaced by the effect */ })
  const remeasure = useCallback(() => { remeasureRef.current() }, [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!enabled || root === null) return

    const liveOptions = (): OverlayPlacementOptions => ({
      desiredWidth: desiredWidthRef.current,
      minWidth,
      safeMargin,
      ...(sizeRefLive.current === undefined ? {} : { sizeRef: sizeRefLive.current }),
      ...(minHeight === undefined ? {} : { minHeight }),
      ...(maxWidth === undefined ? {} : { maxWidth }),
      avoidSelectors: selectorKey === '' ? [] : selectorKey.split('\n'),
    })
    const stableOptions = liveOptions()
    let frameRequest: number | null = null
    let disposed = false
    const observed = new Set<Element>()
    const resizeObserver = new ResizeObserver(() => { schedule() })

    const observeCurrentElements = (): ReturnType<typeof geometryElements> => {
      const elements = geometryElements(root, stableOptions)
      const targets: Element[] = [
        elements.overlay,
        elements.frame,
        ...elements.nativePanes,
        ...elements.siblingEntries,
        ...elements.explicitAvoid,
      ].filter((value): value is Element => value !== null && !isOwnedBySideChat(value, root))
      for (const target of targets) {
        if (observed.has(target)) continue
        observed.add(target)
        resizeObserver.observe(target)
      }
      return elements
    }

    const measure = (): void => {
      frameRequest = null
      if (disposed) return
      observeCurrentElements()
      const geometry = collectOverlayGeometry(root, liveOptions())
      const next = geometry.compute()
      const nextBounds = geometry.bounds()
      setPlacement(current => samePlacement(current, next) ? current : next)
      setBounds(current => sameBounds(current, nextBounds) ? current : nextBounds)
    }
    function schedule(): void {
      if (disposed || frameRequest !== null) return
      frameRequest = requestAnimationFrame(measure)
    }
    remeasureRef.current = schedule

    const initial = observeCurrentElements()
    const mutationObserver = new MutationObserver(records => {
      const externalChange = records.some(record => {
        if (!(record.target instanceof Node) || !root.contains(record.target)) return true
        return [...record.addedNodes, ...record.removedNodes].some(node =>
          !(node instanceof Node) || !root.contains(node),
        )
      })
      if (externalChange) schedule()
    })
    if (initial.frame !== null) {
      mutationObserver.observe(initial.frame, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-sidebar-collapsed', 'data-details-collapsed', 'data-dragging'],
        childList: true,
      })
    }
    if (initial.slotHost !== null) {
      mutationObserver.observe(initial.slotHost, { childList: true, subtree: true })
    }
    // Portals are normally direct body children. Avoid observing the complete
    // document subtree: conversation streaming should not trigger layout work.
    mutationObserver.observe(document.body, { childList: true })
    for (const target of initial.explicitAvoid) {
      mutationObserver.observe(target, { attributes: true, childList: true, subtree: true })
    }

    const visual = window.visualViewport
    window.addEventListener('resize', schedule, { passive: true })
    visual?.addEventListener('resize', schedule, { passive: true })
    visual?.addEventListener('scroll', schedule, { passive: true })
    schedule()

    return () => {
      disposed = true
      if (frameRequest !== null) cancelAnimationFrame(frameRequest)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', schedule)
      visual?.removeEventListener('resize', schedule)
      visual?.removeEventListener('scroll', schedule)
    }
    // NOTE: `desiredWidth` and the live size are deliberately NOT dependencies —
    // see the observer-discipline note above (D1/D2 acceptance criterion).
  }, [enabled, minWidth, minHeight, maxWidth, rootRef, safeMargin, selectorKey])

  return { ...placement, bounds, remeasure }
}

export function overlayPlacementStyle(placement: OverlayPlacement): OverlayPlacementStyle {
  return {
    '--side-chat-left': String(placement.left) + 'px',
    '--side-chat-top': String(placement.top) + 'px',
    '--side-chat-right': String(placement.right) + 'px',
    '--side-chat-bottom': String(placement.bottom) + 'px',
    '--side-chat-width': String(placement.width) + 'px',
    '--side-chat-height': String(placement.height) + 'px',
    '--side-chat-max-height': String(placement.maxHeight) + 'px',
  }
}
