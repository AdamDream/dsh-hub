// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SideChatJumpList } from '../src/client/SideChatJumpList.tsx'
import type { SideChatController } from '../src/client/controller.ts'
import type { SideChatTreeEntry } from '../src/shared/remote.ts'
import { SideChatViewStore } from '../src/client/view-store.ts'

const ENTRIES: readonly SideChatTreeEntry[] = [
  {
    parentSessionId: 'root-1', childSessionId: 'child-1', lastActiveAt: 1_700_000_000,
    title: 'Main session', cwd: '/work/repo', preview: '最新一条消息预览…', running: true,
  },
  {
    parentSessionId: 'sub-1', childSessionId: 'child-2', lastActiveAt: 1_699_000_000,
    title: 'Side subagent', cwd: '/work/repo', preview: '别的侧聊的最后消息',
  },
]

function controllerHarness(entries: readonly SideChatTreeEntry[]) {
  // Stable snapshot reference: useSyncExternalStore requires the getter to
  // return the same object across renders (a fresh literal would re-render
  // forever).
  const snapshot = { parentSessionId: 'root-1' as const }
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    listTree: vi.fn(async () => ({ ok: true as const, entries })),
    listProject: vi.fn(async () => ({ ok: true as const, entries })),
    jumpTo: vi.fn(async () => ({ ok: true as const })),
  } as unknown as SideChatController
}

describe('SideChatJumpList (R0-3/R0-4/R0-5)', () => {
  let mount: HTMLDivElement
  let root: Root
  let viewStore: SideChatViewStore

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mount = document.createElement('div')
    document.body.append(mount)
    viewStore = new SideChatViewStore()
    root = createRoot(mount)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.innerHTML = ''
  })

  function renderList(controller: SideChatController): void {
    // Open the jump strip before the first render (R0-3 collapsible default).
    viewStore.setJumpOpen('root-1', true)
    const t = ((key: string) => key) as never
    act(() => {
      root.render(
        <SideChatJumpList
          parentSessionId={'root-1' as never}
          controller={controller}
          viewStore={viewStore}
          t={t}
        />,
      )
    })
  }

  it('renders collapsible tree/project tabs with the fetched entries', async () => {
    const controller = controllerHarness(ENTRIES)
    renderList(controller)
    expect(mount.textContent).toContain('drawer.jumpTitle')
    expect(mount.textContent).toContain('drawer.jumpTree')
    expect(mount.textContent).toContain('drawer.jumpProject')

    await vi.waitFor(() => {
      expect(mount.textContent).toContain('Main session')
    })
    expect(mount.textContent).toContain('Side subagent')
    expect(mount.textContent).toContain('最新一条消息预览…')
    expect(controller.listTree).toHaveBeenCalled()
  })

  it('marks the current parent and jumps on click', async () => {
    const controller = controllerHarness(ENTRIES)
    renderList(controller)
    await vi.waitFor(() => {
      expect(mount.textContent).toContain('Side subagent')
    })

    // Current entry (root-1) is labelled and highlighted.
    expect(mount.textContent).toContain('drawer.jumpCurrent')
    expect(mount.textContent).toContain('drawer.jumpRunning')

    const subButton = [...mount.querySelectorAll('button')].find(button =>
      button.textContent?.includes('Side subagent'),
    )
    await act(async () => { subButton?.click() })

    expect(controller.jumpTo).toHaveBeenCalledWith('sub-1')
    expect(viewStore.get('sub-1').visible).toBe(true)
  })

  it('switches to the project tab and lists the same-cwd conversations', async () => {
    const controller = controllerHarness(ENTRIES)
    renderList(controller)
    await vi.waitFor(() => {
      expect(mount.textContent).toContain('Main session')
    })

    const projectTab = [...mount.querySelectorAll('button')].find(button =>
      button.textContent === 'drawer.jumpProject',
    )
    act(() => { projectTab?.click() })

    await vi.waitFor(() => { expect(controller.listProject).toHaveBeenCalled() })
    await vi.waitFor(() => {
      expect(mount.textContent).toContain('Side subagent')
    })
  })
})
