import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { SideChatController } from './controller.ts'
import { NS } from './locales.ts'
import { SideChatJumpList } from './SideChatJumpList.tsx'
import { SideChatSurface } from './SideChatSurface.tsx'
import type { SideChatViewStore } from './view-store.ts'
import type { BtwSettingsSection, SettingsScope } from './btw-settings.ts'
import type { DrawerSizeStoreHandle } from './drawer-size-store.ts'
import { MIN_HEIGHT, MIN_WIDTH, MAX_WIDTH_SOFT, type DrawerSize } from './drawer-size.ts'
import { SideChatResizeHandle } from './SideChatResizeHandle.tsx'
import { overlayPlacementStyle, useOverlayPlacement } from './use-overlay-placement.ts'
import css from './side-chat.module.css'

export interface SideChatDrawerInjected {
  controller: SideChatController
  viewStore: SideChatViewStore
  parentSessionId: SessionId
  /** P0-b: bound `dsh-btw` settings scope; undefined keeps the defaults. */
  settingsScope?: SettingsScope<BtwSettingsSection> | undefined
  onMinimize: () => void
  onEnd: () => Promise<void>
}
/**
 * The store seat is optional on the TYPE only so the component stays renderable
 * with hand-built props (the jsdom specs mount it directly). The registration
 * always declares the store, so production always receives the seat; a missing
 * seat degrades to auto placement without persistence and warns once.
 */
export type SideChatDrawerProps = SideChatDrawerInjected
  & Partial<PropsStore<DrawerSizeStoreHandle>>
  & PropsLocale<typeof NS>

const NOOP_SIZE_ACTIONS = {
  setWidth: (_px: number | null): void => {},
  setHeight: (_px: number | null): void => {},
  setSize: (_width: number | null, _height: number | null): void => {},
  reset: (): void => {},
}


export function SideChatDrawer({
  controller,
  viewStore,
  parentSessionId,
  settingsScope,
  useStore,
  actions,
  t,
  onMinimize,
  onEnd,
}: SideChatDrawerProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const activeParentSessionId = state.parentSessionId ?? parentSessionId
  const parentKey = String(activeParentSessionId)
  const subscribeView = useCallback((listener: () => void) => viewStore.subscribe(listener), [viewStore])
  const getView = useCallback(() => viewStore.get(parentKey), [parentKey, viewStore])
  const view = useSyncExternalStore(subscribeView, getView, getView)
  const placementRootRef = useRef<HTMLDivElement>(null)
  const visible = state.phase !== 'closed'
    && state.parentSessionId !== undefined
    && String(state.parentSessionId) === parentKey
    && view.visible
    && view.presentation === 'drawer'
  // Latched at first render: keeps the hook count stable even if a seat is
  // ever added or removed between renders of the same instance.
  const seatRef = useRef({ useStore, actions })
  const seat = seatRef.current
  const storedWidth = seat.useStore === undefined ? null : seat.useStore(state => state.width)
  const storedHeight = seat.useStore === undefined ? null : seat.useStore(state => state.height)
  const sizeActions = seat.actions ?? NOOP_SIZE_ACTIONS
  useEffect(() => {
    if (seat.useStore === undefined) {
      // Only reachable when the drawer is mounted with hand-built props (jsdom
      // specs). The shell.overlay registration declares the store, so the shell
      // always supplies the seat.
      console.warn('[dsh-btw] drawer mounted without the drawer-size store seat: sizing stays automatic')
    }
  }, [seat])
  // Live size source: written by the drag handles between pointerdown and
  // pointerup, read by the hook at measure time. Deliberately a ref — putting
  // the size into `useOverlayPlacement`'s options object identity would re-run
  // its layout effect and rebuild five observers per frame.
  const sizeRef = useRef<DrawerSize>({ width: storedWidth, height: storedHeight })
  const { remeasure, bounds, ...placement } = useOverlayPlacement(placementRootRef, {
    enabled: visible,
    sizeRef,
    minHeight: MIN_HEIGHT,
    maxWidth: MAX_WIDTH_SOFT,
  })

  // Store -> live ref. Only fires when the store actually changes (drag commit,
  // reset, or the initial rehydration), never per drag frame.
  useEffect(() => {
    sizeRef.current = { width: storedWidth, height: storedHeight }
    remeasure()
  }, [remeasure, storedHeight, storedWidth])

  const commitSize = useCallback((size: DrawerSize) => {
    // One action call per gesture => one store update => one localStorage write.
    sizeActions.setSize(size.width, size.height)
  }, [sizeActions])

  const resetSize = useCallback(() => { sizeActions.reset() }, [sizeActions])

  useEffect(() => {
    if (!visible) return
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onMinimize()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [onMinimize, visible])

  if (!visible) return null

  return (
    <div
      ref={placementRootRef}
      className={css.placementRoot}
      data-dsh-btw-root
      data-placement-mode={placement.mode}
      data-placement-degraded={placement.degraded || undefined}
      style={overlayPlacementStyle(placement)}
    >
      <span className={css.safeAreaProbe} data-dsh-btw-safe-area aria-hidden="true" />
      <button
        className={css.mobileScrim}
        data-dsh-btw-scrim
        aria-label={t('drawer.minimize')}
        onClick={onMinimize}
      />
      <aside
        id="dsh-btw-drawer"
        className={css.drawer}
        data-dsh-btw-drawer
        role="complementary"
        aria-label={t('drawer.title')}
      >
        <SideChatResizeHandle
          kind="width"
          heightEdge={placement.mode === 'bottom-sheet' ? 'top' : 'bottom'}
          mode={placement.mode}
          width={placement.width}
          height={placement.height}
          minWidth={MIN_WIDTH}
          maxWidth={bounds.maxWidth}
          minHeight={MIN_HEIGHT}
          maxHeight={bounds.maxHeight}
          sizeRef={sizeRef}
          remeasure={remeasure}
          commit={commitSize}
          reset={resetSize}
          label={t('drawer.resizeWidth')}
          hint={t('drawer.resizeHint')}
        />
        <SideChatResizeHandle
          kind="height"
          heightEdge={placement.mode === 'bottom-sheet' ? 'top' : 'bottom'}
          mode={placement.mode}
          width={placement.width}
          height={placement.height}
          minWidth={MIN_WIDTH}
          maxWidth={bounds.maxWidth}
          minHeight={MIN_HEIGHT}
          maxHeight={bounds.maxHeight}
          sizeRef={sizeRef}
          remeasure={remeasure}
          commit={commitSize}
          reset={resetSize}
          label={t('drawer.resizeHeight')}
          hint={t('drawer.resizeHint')}
        />
        <SideChatResizeHandle
          kind="corner"
          heightEdge={placement.mode === 'bottom-sheet' ? 'top' : 'bottom'}
          mode={placement.mode}
          width={placement.width}
          height={placement.height}
          minWidth={MIN_WIDTH}
          maxWidth={bounds.maxWidth}
          minHeight={MIN_HEIGHT}
          maxHeight={bounds.maxHeight}
          sizeRef={sizeRef}
          remeasure={remeasure}
          commit={commitSize}
          reset={resetSize}
          label={t('drawer.resizeCorner')}
          hint={t('drawer.resizeHint')}
        />
        <SideChatJumpList
          parentSessionId={activeParentSessionId}
          controller={controller}
          viewStore={viewStore}
          t={t}
        />
        <SideChatSurface
          parentSessionId={activeParentSessionId}
          controller={controller}
          viewStore={viewStore}
          t={t}
          surfaceMode="drawer"
          settingsScope={settingsScope}
          onMinimize={onMinimize}
          onEnd={onEnd}
        />
      </aside>
    </div>
  )
}
