import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from 'dsh-better-sidebar'
import { SideChatController } from './controller.ts'
import { SideChatPresentation } from './presentation.tsx'
import { SideChatButton } from './SideChatButton.tsx'
import { SideChatDrawer } from './SideChatDrawer.tsx'
import { SideChatViewStore } from './view-store.ts'
import { en, NS, zh } from './locales.ts'
import remoteContribution from './remote.ts'
import { bindBtwSettings } from './btw-settings.ts'
import { createDrawerSizeStore } from './drawer-size-store.ts'

export const name = 'dsh-btw/client'
export const inject = ['slots', 'sessions', 'remote', 'locale', 'settingsScope']

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(remoteContribution)
  ctx.inject(['remote.sideChat'], (remoteCtx: ClientContext) => { installSideChat(remoteCtx) })
  return disposeRemote
}

function installSideChat(ctx: ClientContext): void {
  const controller = new SideChatController(ctx, ctx.remote.sideChat)
  const viewStore = new SideChatViewStore()
  // P0-b: bind the `dsh-btw` settings namespace scope on this fiber; when the
  // settingsScope service is unavailable the surface keeps BTW_SETTINGS_DEFAULTS
  // (= current behavior). Read structurally: the service type augmentation
  // lives in dsh-client-ui-settings (not a btw dependency at type level).
  const settingsScope = bindBtwSettings((ctx as unknown as {
    settingsScope?: { bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): SettingsScope<T> }
  }).settingsScope)
  const presentation = new SideChatPresentation(ctx, controller, viewStore, settingsScope)
  // Shared (apply-world) store handle: drawer width/height preference, persisted
  // under the root scoped localStorage key `dsh.btw.drawerSize`. Root-scoped
  // records are never pruned by the runtime, so the preference survives plugin
  // reloads and host restarts within this browser.
  const drawerSize = createDrawerSizeStore()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'btw: client dictionaries')
  ctx.effect(() => () => { void controller.dispose() }, 'btw: controller lifecycle')

  ctx.inject(['betterSidebar'], betterSidebarCtx => {
    betterSidebarCtx.effect(
      () => presentation.attachBetterSidebar(betterSidebarCtx.betterSidebar),
      'btw: Better Sidebar adapter',
    )
  })

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'dsh-btw.action',
      order: 40,
      locale: NS,
      inject: (_sessionId: SessionId) => ({ controller, viewStore, presentation }),
    }, SideChatButton),
  )

  ctx.slots.inject(
    'shell.overlay',
    () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'dsh-btw.drawer',
      order: 100,
      locale: NS,
      store: drawerSize,
      inject: () => {
        const parentSessionId = controller.getSnapshot().parentSessionId ?? controller.currentSessionId()!
        const activeParent = () => controller.getSnapshot().parentSessionId
        return {
          controller,
          viewStore,
          presentation,
          settingsScope,
          parentSessionId,
          onMinimize: () => {
            const current = activeParent()
            if (current !== undefined) presentation.minimize(String(current))
          },
          onEnd: async () => {
            const current = activeParent()
            if (current !== undefined) await presentation.end(String(current))
          },
        }
      },
    }, SideChatDrawer),
  )

  /*<<dsh-exec-a11y:U-A11Y3:v1*/
  // 可观测钩子（供真机 A/B 断言"候选确实被加载"）
  ;(window as unknown as Record<string, unknown>).__dshA11yBtwChord = 'U-A11Y3:v1'
  /** true when the chord must stay native because the user is typing in a field. */
  function isEditableTarget(target: EventTarget | null): boolean {
    if (target === null || !(target instanceof HTMLElement)) return false
    if (target.isContentEditable) return true
    const tag = target.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }
  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== 'Period') return
      // editable target: the key belongs to the field — never swallow it
      if (isEditableTarget(event.target)) return
      const current = controller.currentSessionId()
      // no session: semantic no-op — do not swallow the chord either
      if (current === undefined) return
      event.preventDefault()
      presentation.toggle(String(current))
    }
  /*>>dsh-exec-a11y:U-A11Y3:v1*/
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, 'btw: keyboard shortcut')
}
