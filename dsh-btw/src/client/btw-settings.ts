import { useCallback, useSyncExternalStore } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

export type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * Client-side `dsh-btw` settings section (P0-b settings 行为开关试点).
 *
 * Mirrors the host `BTW_SETTINGS_SCHEMA` (src/index.ts) so the surface can
 * gate pure behavior switches without a restart: editing
 * `~/.dsh/settings.yaml` `dsh-btw:` section republishes → the client
 * settingsScope snapshot changes → `useBtwSettings` re-renders the surface.
 *
 * Every read is defensive: missing keys / absent section / unavailable scope
 * all fall back to the defaults below, which equal the pre-P0-b behavior
 * (无键=现状, old config compatible).
 */
export interface BtwSettingsSection {
  readonly ui?: {
    readonly banner?: boolean
    readonly modelSelect?: boolean
    readonly imageBadge?: boolean
  }
  readonly vision?: {
    readonly autoTransform?: boolean
  }
}

export const BTW_SETTINGS_DEFAULTS: BtwSettingsSection = Object.freeze({
  ui: Object.freeze({ banner: true, modelSelect: true, imageBadge: true }),
  vision: Object.freeze({ autoTransform: true }),
})

/** Narrow one raw settings section (wire value) to the surface's reads. */
export function decodeBtwSettings(section: unknown): BtwSettingsSection {
  const value = section !== null && typeof section === 'object' ? section as BtwSettingsSection : {}
  const ui = value.ui !== null && typeof value.ui === 'object' ? value.ui : {}
  const vision = value.vision !== null && typeof value.vision === 'object' ? value.vision : {}
  return {
    ui: {
      banner: ui.banner !== false,
      modelSelect: ui.modelSelect !== false,
      imageBadge: ui.imageBadge !== false,
    },
    vision: {
      autoTransform: vision.autoTransform !== false,
    },
  }
}

/** Narrow a settingsScope snapshot to the section the surface reads. */
export function btwSettingsOf(snapshot: SettingsScopeSnapshot<BtwSettingsSection> | undefined): BtwSettingsSection {
  if (snapshot === undefined) return BTW_SETTINGS_DEFAULTS
  return decodeBtwSettings(snapshot.value)
}

/**
 * Bind the `dsh-btw` namespace scope on the calling fiber, degrading to
 * `undefined` when the settingsScope service or the namespace is unavailable
 * (the surface then keeps BTW_SETTINGS_DEFAULTS = current behavior).
 */
export function bindBtwSettings(binder: {
  bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): SettingsScope<T>
} | undefined): SettingsScope<BtwSettingsSection> | undefined {
  if (binder === undefined || typeof binder.bind !== 'function') return undefined
  try {
    return binder.bind<BtwSettingsSection>({ namespace: 'dsh-btw', decode: decodeBtwSettings })
  } catch {
    return undefined
  }
}

/**
 * Reactive settings snapshot for the surface (P0-b). Subscribes to the bound
 * scope so settings.yaml edits re-render the surface without a restart; a
 * missing scope degrades to BTW_SETTINGS_DEFAULTS (现状).
 *
 * getSnapshot returns the scope's OWN decoded `value` (a stable reference
 * until the next change — required by useSyncExternalStore) or the frozen
 * DEFAULTS; it never synthesizes a fresh object per call.
 */
export function useBtwSettings(scope: SettingsScope<BtwSettingsSection> | undefined): BtwSettingsSection {
  const subscribe = useCallback(
    (listener: () => void) => (scope === undefined ? () => {} : scope.subscribe(listener)),
    [scope],
  )
  const getSnapshot = useCallback(
    () => (scope === undefined ? BTW_SETTINGS_DEFAULTS : (scope.getSnapshot().value ?? BTW_SETTINGS_DEFAULTS)),
    [scope],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
