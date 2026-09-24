import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from 'dsh-better-sidebar'
import type {
  BetterSidebarService, SessionScope, TabComponentProps, TabDescriptor,
} from 'dsh-better-sidebar/client/service'
import type { SideChatController } from './controller.ts'
import { NS } from './locales.ts'
import { SideChatSign } from './SideChatSign.tsx'
import { SideChatSurface } from './SideChatSurface.tsx'
import type { SideChatViewState, SideChatViewStore } from './view-store.ts'
import type { BtwSettingsSection, SettingsScope } from './btw-settings.ts'

export const SIDE_CHAT_TAB_TYPE = 'dsh-btw:conversation'

type BetterSidebarRuntime = Pick<BetterSidebarService,
  'registerTab' | 'isTabEnabled' | 'openTab' | 'closeTab' | 'features'>

interface Attachment {
  readonly service: BetterSidebarRuntime
  dispose(): void
}

function supportsBetterSidebar(value: unknown): value is BetterSidebarRuntime {
  if (value === null || typeof value !== 'object') return false
  const service = value as Partial<BetterSidebarRuntime>
  return typeof service.registerTab === 'function'
    && typeof service.isTabEnabled === 'function'
    && typeof service.openTab === 'function'
    && typeof service.closeTab === 'function'
    && Array.isArray(service.features)
    && service.features.includes('targetedOpen')
}

interface BetterSidebarSideChatProps extends TabComponentProps {
  hostContext: ClientContext
  controller: SideChatController
  viewStore: SideChatViewStore
  presentation: SideChatPresentation
  settingsScope: SettingsScope<BtwSettingsSection> | undefined
}

function BetterSidebarSideChat({
  hostContext,
  controller,
  viewStore,
  presentation,
  settingsScope,
  scope,
  visible,
}: BetterSidebarSideChatProps) {
  const parentSessionId = scope.sessionId
  const subscribeLocale = useCallback(
    (listener: () => void) => hostContext.locale.subscribe(listener),
    [hostContext],
  )
  const getLocaleSnapshot = useCallback(() => hostContext.locale.getSnapshot(), [hostContext])
  useSyncExternalStore(subscribeLocale, getLocaleSnapshot, getLocaleSnapshot)
  const t = hostContext.locale.bind(NS)

  useEffect(() => {
    if (!visible) {
      viewStore.minimize(parentSessionId)
      return
    }
    viewStore.show(parentSessionId, 'better-sidebar')
    if (!controller.hasConversation(parentSessionId as SessionId)) {
      void controller.open(parentSessionId as SessionId)
    }
  }, [controller, parentSessionId, viewStore, visible])

  const minimize = useCallback(
    () => { presentation.minimize(parentSessionId) },
    [parentSessionId, presentation],
  )
  const end = useCallback(
    () => presentation.end(parentSessionId),
    [parentSessionId, presentation],
  )

  return (
    <SideChatSurface
      parentSessionId={parentSessionId as SessionId}
      controller={controller}
      viewStore={viewStore}
      t={t}
      surfaceMode="better-sidebar"
      settingsScope={settingsScope}
      onMinimize={minimize}
      onEnd={end}
    />
  )
}

export class SideChatPresentation {
  private attachment: Attachment | undefined

  constructor(
    private readonly ctx: ClientContext,
    private readonly controller: SideChatController,
    private readonly viewStore: SideChatViewStore,
    private readonly settingsScope?: SettingsScope<BtwSettingsSection> | undefined,
  ) {}

  subscribe(listener: () => void): () => void {
    return this.viewStore.subscribe(listener)
  }

  getSnapshot(parentSessionId: string): SideChatViewState {
    return this.viewStore.get(parentSessionId)
  }

  show(parentSessionId: string): void {
    const service = this.attachment?.service
    const native = service !== undefined && service.isTabEnabled(SIDE_CHAT_TAB_TYPE)
    this.viewStore.show(parentSessionId, native ? 'better-sidebar' : 'drawer')
    void this.controller.open(parentSessionId as SessionId)
    if (native) {
      service.openTab(
        {
          type: SIDE_CHAT_TAB_TYPE,
          id: SIDE_CHAT_TAB_TYPE,
          path: `side-chat:${parentSessionId}`,
        },
        { sessionId: parentSessionId },
      )
    }
  }

  toggle(parentSessionId: string): void {
    if (this.viewStore.get(parentSessionId).visible) {
      this.minimize(parentSessionId)
      return
    }
    this.show(parentSessionId)
  }

  minimize(parentSessionId: string): void {
    const mode = this.viewStore.get(parentSessionId).presentation
    this.viewStore.minimize(parentSessionId)
    if (mode === 'better-sidebar') {
      this.attachment?.service.closeTab(SIDE_CHAT_TAB_TYPE, { sessionId: parentSessionId })
    }
  }

  async end(parentSessionId: string): Promise<void> {
    // w28 F2/P3: clear the drawer's view state *before* awaiting the host close
    // RPC. Drawer visibility requires `view.visible`, so clearing first removes the
    // panel in the same commit and keeps it hidden even while a still-in-flight
    // start/restore continuation publishes `open` (measured once in six: the panel
    // left, came back +32 ms later, and only stayed away when the close RPC landed —
    // up to 2661 ms of a panel that would not close).
    this.viewStore.clear(parentSessionId)
    await this.controller.close()
    this.attachment?.service.closeTab(SIDE_CHAT_TAB_TYPE, { sessionId: parentSessionId })
  }

  attachBetterSidebar(candidate: BetterSidebarService): () => void {
    this.attachment?.dispose()
    if (!supportsBetterSidebar(candidate)) {
      this.warnFallback('required capabilities are unavailable')
      return () => {}
    }

    let unregister: (() => void) | undefined
    try {
      unregister = candidate.registerTab(this.createDescriptor(candidate))
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      this.warnFallback(detail)
      return () => {}
    }

    let disposed = false
    const attachment: Attachment = {
      service: candidate,
      dispose: () => {
        if (disposed) return
        disposed = true
        unregister?.()
        if (this.attachment !== attachment) return
        this.attachment = undefined
        this.viewStore.fallbackVisiblePresentation('better-sidebar', 'drawer')
      },
    }
    this.attachment = attachment
    return attachment.dispose
  }

  private createDescriptor(service: BetterSidebarRuntime): TabDescriptor {
    const descriptor: TabDescriptor = {
      id: SIDE_CHAT_TAB_TYPE,
      title: () => this.ctx.locale.bind(NS)('drawer.title'),
      icon: size => <SideChatSign size={size} />,
      single: true,
      hidden: false,
      onClose: (_tab, scope: SessionScope) => {
        this.viewStore.minimize(scope.sessionId)
      },
      component: (props: TabComponentProps) => (
        <BetterSidebarSideChat
          {...props}
          hostContext={this.ctx}
          controller={this.controller}
          viewStore={this.viewStore}
          presentation={this}
          settingsScope={this.settingsScope}
        />
      ),
    }
    if (service.features.includes('badge')) {
      descriptor.badge = () => {
        const snapshot = this.controller.getSnapshot()
        if (snapshot.phase === 'error') return '!'
        return snapshot.running ? '…' : null
      }
    }
    return descriptor
  }

  private warnFallback(detail: string): void {
    console.warn(`[dsh-btw] Better Sidebar unavailable; using drawer: ${detail}`)
  }
}
