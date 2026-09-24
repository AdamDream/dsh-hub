/**
 * Drawer-size store handle factory.
 *
 * Mirrors the host's own `createLayoutStore` precedent
 * (`@deepseek-ai/dsh-client-ui-layout/lib/client.js`): the module exports the
 * FACTORY only — a module-level handle would pin the store identity in the
 * module cache (a de-facto singleton surviving plugin reloads). The handle is
 * built in apply world and handed to the `shell.overlay` registration's `store`
 * seat; the framework instantiates it per entry/scope and exposes `useStore` /
 * `actions` to the drawer component.
 *
 * Persistence rides the framework's mechanical channel: `persist` names a
 * localStorage key filled by `attachPersistence` (root-scoped keys are never
 * pruned — `dsh-client-runtime` only clears session-scoped records), so a drag
 * survives refresh, plugin reload and host restart within this browser.
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  clampStoredHeight,
  clampStoredWidth,
  type DrawerSize,
} from './drawer-size.ts'

export function createDrawerSizeStore() {
  return defineStore({
    init: (): DrawerSize => ({ width: null, height: null }),
    persist: 'dsh.btw.drawerSize',
    actions: {
      /** `null` restores the automatic placement for this axis. */
      setWidth: (draft: DrawerSize, px: number | null) => {
        draft.width = px === null ? null : clampStoredWidth(px)
      },
      setHeight: (draft: DrawerSize, px: number | null) => {
        draft.height = px === null ? null : clampStoredHeight(px)
      },
      /**
       * Both axes in ONE store update. The corner handle must commit a single
       * gesture as a single write (A3): two separate actions would fire the
       * persistence subscriber twice and write localStorage twice.
       */
      setSize: (draft: DrawerSize, width: number | null, height: number | null) => {
        draft.width = width === null ? null : clampStoredWidth(width)
        draft.height = height === null ? null : clampStoredHeight(height)
      },
      /** Double-click / Enter / Space on any handle restores full auto. */
      reset: (draft: DrawerSize) => {
        draft.width = null
        draft.height = null
      },
    },
  })
}

export type DrawerSizeStoreHandle = ReturnType<typeof createDrawerSizeStore>
