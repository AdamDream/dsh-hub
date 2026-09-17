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

  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== 'Period') return
      event.preventDefault()
      const current = controller.currentSessionId()
      if (current !== undefined) presentation.toggle(String(current))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, 'btw: keyboard shortcut')
}
