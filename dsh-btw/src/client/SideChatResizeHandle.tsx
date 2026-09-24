/**
 * Drag handles for the btw drawer.
 *
 * Shapes the audit asked for (and that the two in-repo precedents provide
 * between them, see `ui-trajectory`'s details handle and `ui-layout`'s
 * `DragHandle`):
 *   - left edge  -> width      (`role="separator"`, vertical, arrow left = wider)
 *   - far edge   -> height     (`role="separator"`, horizontal; bottom edge in
 *                              `right`/`compact-right`, top edge in `bottom-sheet`)
 *   - corner     -> both axes  (pointer-only convenience: both axes stay
 *                              reachable from the keyboard through the two
 *                              separators, so it is hidden from the a11y tree)
 *
 * Two invariants this component exists to protect:
 *  1. the live size goes into `sizeRef.current` + `remeasure()` — never into
 *     React state, never into a `useOverlayPlacement` dependency (a size in the
 *     dep list would rebuild five observers per frame);
 *  2. the store is committed exactly once, on `pointerup` (keyboard steps and
 *     reset commit immediately, one action call each).
 */
import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { DrawerSize } from './drawer-size.ts'
import { RESIZE_STEP, RESIZE_STEP_COARSE } from './drawer-size.ts'
import type { OverlayPlacementMode } from './overlay-placement.ts'
import css from './side-chat.module.css'

export type ResizeHandleKind = 'width' | 'height' | 'corner'

export interface SideChatResizeHandleProps {
  kind: ResizeHandleKind
  /** Which vertical edge carries the height gesture (follows `placement.mode`). */
  heightEdge: 'top' | 'bottom'
  mode: OverlayPlacementMode
  /** Sizes currently rendered (already clamped by the solver). */
  width: number
  height: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  /** Live size sink read by `useOverlayPlacement` at measure time. */
  sizeRef: { current: DrawerSize }
  remeasure: () => void
  /** Persist the final size (called once per gesture). */
  commit: (size: DrawerSize) => void
  /** Restore full automatic placement (double-click, Enter, Space). */
  reset: () => void
  label: string
  hint: string
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  /** Snapshot for `pointercancel` / `Escape` rollback. */
  before: DrawerSize
  detachEscape: () => void
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value))

export function SideChatResizeHandle(props: SideChatResizeHandleProps) {
  const {
    kind, heightEdge, mode, width, height, minWidth, maxWidth, minHeight, maxHeight,
    sizeRef, remeasure, commit, reset, label, hint,
  } = props
  const elementRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const frameRef = useRef<number | null>(null)
  const pendingRef = useRef<{ x: number; y: number } | null>(null)
  // Read at gesture time so the handlers keep a stable identity.
  const liveRef = useRef({ width, height, minWidth, maxWidth, minHeight, maxHeight, sizeRef, remeasure, commit })
  liveRef.current = { width, height, minWidth, maxWidth, minHeight, maxHeight, sizeRef, remeasure, commit }

  const resolve = useCallback((startX: number, startY: number, startWidth: number, startHeight: number, x: number, y: number): DrawerSize => {
    const live = liveRef.current
    let nextWidth = startWidth
    let nextHeight = startHeight
    if (kind !== 'height') {
      // Right-anchored panel: dragging the left edge further left widens it
      // (same formula as the trajectory details handle).
      nextWidth = clamp(startWidth + (startX - x), live.minWidth, live.maxWidth)
    }
    if (kind !== 'width') {
      // Far edge moves outward => bigger; the anchor edge is fixed, so the
      // sign flips between the right modes (bottom edge) and the sheet (top edge).
      const outward = heightEdge === 'top' ? (startY - y) : (y - startY)
      nextHeight = clamp(startHeight + outward, live.minHeight, live.maxHeight)
    }
    return {
      width: kind === 'height' ? live.sizeRef.current.width : Math.round(nextWidth),
      height: kind === 'width' ? live.sizeRef.current.height : Math.round(nextHeight),
    }
  }, [heightEdge, kind])

  const apply = useCallback((x: number, y: number): void => {
    const drag = dragRef.current
    if (drag === null) return
    const next = resolve(drag.startX, drag.startY, drag.startWidth, drag.startHeight, x, y)
    if (sizeRef.current.width === next.width && sizeRef.current.height === next.height) return
    sizeRef.current = next
    remeasure()
  }, [remeasure, resolve, sizeRef])

  const flush = useCallback((): void => {
    frameRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending !== null) apply(pending.x, pending.y)
  }, [apply])

  const finish = useCallback((rollback: boolean): void => {
    const drag = dragRef.current
    if (drag === null) return
    dragRef.current = null
    drag.detachEscape()
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    pendingRef.current = null
    if (elementRef.current !== null) delete elementRef.current.dataset.dragging
    if (rollback) {
      sizeRef.current = drag.before
      remeasure()
      return
    }
    // Single commit per gesture: one store write, one localStorage write.
    const final = sizeRef.current
    commit({ width: kind === 'height' ? drag.before.width : final.width, height: kind === 'width' ? drag.before.height : final.height })
  }, [commit, kind, remeasure, sizeRef])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const live = liveRef.current
    // Escape cancel must beat the drawer's own window-level Escape->minimize
    // listener (SideChatDrawer), which is registered on the bubble phase.
    // A CAPTURE-phase listener that stops propagation halts the whole dispatch,
    // so the drawer never sees this key.
    const onEscape = (key: KeyboardEvent): void => {
      if (key.key !== 'Escape') return
      key.preventDefault()
      key.stopPropagation()
      finish(true)
    }
    window.addEventListener('keydown', onEscape, true)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: live.width,
      startHeight: live.height,
      before: { ...live.sizeRef.current },
      detachEscape: () => { window.removeEventListener('keydown', onEscape, true) },
    }
    if (elementRef.current !== null) elementRef.current.dataset.dragging = 'true'
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* capture is best-effort */ }
    event.preventDefault()
  }, [finish])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    pendingRef.current = { x: event.clientX, y: event.clientY }
    // rAF throttle: at most one geometry write per animation frame.
    frameRef.current ??= requestAnimationFrame(flush)
  }, [flush])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    // Fold the final pointer position in before committing (the last move may
    // still be waiting on its animation frame).
    pendingRef.current = { x: event.clientX, y: event.clientY }
    frameRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending !== null) apply(pending.x, pending.y)
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* already released */ }
    finish(false)
  }, [apply, finish])

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    finish(true)
  }, [finish])

  useEffect(() => () => {
    // Unmount mid-drag: never leave a capture-phase listener behind.
    dragRef.current?.detachEscape()
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    dragRef.current = null
  }, [])

  /** Write + render + persist one keyboard step (one action call per key press). */
  const push = useCallback((nextWidth: number | null, nextHeight: number | null): void => {
    const live = liveRef.current
    const current = live.sizeRef.current
    const next: DrawerSize = {
      width: kind === 'height' ? current.width : clamp(Math.round(nextWidth ?? current.width ?? live.width), live.minWidth, live.maxWidth),
      height: kind === 'width' ? current.height : clamp(Math.round(nextHeight ?? current.height ?? live.height), live.minHeight, live.maxHeight),
    }
    live.sizeRef.current = next
    live.remeasure()
    live.commit(next)
  }, [kind])

  const step = useCallback((deltaWidth: number, deltaHeight: number, coarse: boolean): void => {
    const live = liveRef.current
    const current = live.sizeRef.current
    const amount = coarse ? RESIZE_STEP_COARSE : RESIZE_STEP
    push(
      kind === 'height' ? null : (current.width ?? live.width) + deltaWidth * amount,
      kind === 'width' ? null : (current.height ?? live.height) + deltaHeight * amount,
    )
  }, [kind, push])

  const goTo = useCallback((extreme: 'min' | 'max'): void => {
    const live = liveRef.current
    push(
      kind === 'height' ? null : (extreme === 'min' ? live.minWidth : live.maxWidth),
      kind === 'width' ? null : (extreme === 'min' ? live.minHeight : live.maxHeight),
    )
  }, [kind, push])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const coarse = event.shiftKey
    const goWidth = kind !== 'height'
    const goHeight = kind !== 'width'
    // `right`/`compact-right` grow downward; the sheet grows upward from the top
    // edge, so "ArrowUp = smaller" and "ArrowUp = bigger" as well.
    const heightSign = heightEdge === 'top' ? -1 : 1
    switch (event.key) {
      case 'ArrowLeft':
        if (!goWidth) return
        event.preventDefault()
        // Direction only: `step` owns the 16px / 64px multiplier.
        step(1, 0, coarse)
        return
      case 'ArrowRight':
        if (!goWidth) return
        event.preventDefault()
        step(-1, 0, coarse)
        return
      case 'ArrowUp':
        if (!goHeight) return
        event.preventDefault()
        step(0, -heightSign, coarse)
        return
      case 'ArrowDown':
        if (!goHeight) return
        event.preventDefault()
        step(0, heightSign, coarse)
        return
      case 'Home':
        event.preventDefault()
        goTo('min')
        return
      case 'End':
        event.preventDefault()
        goTo('max')
        return
      case 'Enter':
      case ' ':
      case 'Spacebar':
        event.preventDefault()
        reset()
        return
      default:
    }
  }, [goTo, heightEdge, kind, reset, step])

  const shownWidth = Math.round(width)
  const shownHeight = Math.round(height)
  const className = [
    css.resizeHandle,
    kind === 'width' ? css.resizeWidth : '',
    kind === 'height' ? (heightEdge === 'top' ? css.resizeHeightTop : css.resizeHeightBottom) : '',
    kind === 'corner' ? css.resizeCorner : '',
  ].filter(Boolean).join(' ')

  if (kind === 'corner') {
    return (
      <div
        ref={elementRef}
        className={className}
        data-dsh-btw-handle="corner"
        aria-hidden="true"
        title={hint}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={reset}
      />
    )
  }

  const isWidth = kind === 'width'
  return (
    <div
      ref={elementRef}
      className={className}
      data-dsh-btw-handle={kind}
      data-placement-mode={mode}
      data-height-edge={heightEdge}
      role="separator"
      tabIndex={0}
      aria-orientation={isWidth ? 'vertical' : 'horizontal'}
      aria-controls="dsh-btw-drawer"
      aria-label={label}
      aria-valuenow={isWidth ? shownWidth : shownHeight}
      aria-valuemin={isWidth ? Math.round(minWidth) : Math.round(minHeight)}
      aria-valuemax={isWidth ? Math.round(maxWidth) : Math.round(maxHeight)}
      aria-valuetext={`${isWidth ? shownWidth : shownHeight}px`}
      title={hint}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
    />
  )
}
