// @vitest-environment happy-dom

import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SideChatSurface } from '../src/client/SideChatSurface.tsx'
import type { SideChatController, SideChatClientState } from '../src/client/controller.ts'
import { SideChatViewStore } from '../src/client/view-store.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: ({ children, onClick, disabled }: {
    children?: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
  DisclosureRow: ({ icon, title, open, expandable, onToggle, expandOnRowClick, collapsedContent, children, rowClassName }: {
    icon?: ReactNode
    title?: ReactNode
    open?: boolean
    expandable?: boolean
    onToggle?: () => void
    expandOnRowClick?: boolean
    collapsedContent?: ReactNode
    children?: ReactNode
    rowClassName?: string
  }) => {
    const clickable = expandable === true && expandOnRowClick === true
    return (
      <div data-disclosure-row data-open={open === true || undefined}>
        <div
          className={rowClassName}
          role={clickable ? 'button' : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? onToggle : undefined}
        >
          {icon}{title}{collapsedContent}
        </div>
        {open === true && children}
      </div>
    )
  },
  IconApiOutline14: () => <span />,
  IconBrowseOutline16: () => <span />,
  IconCheckOutline14: () => <span data-icon="check" />,
  IconCloseOutline16: () => <span />,
  IconCodeOutline16: () => <span />,
  IconEditOutline16: () => <span />,
  IconLoadingOutline16: () => <span />,
  IconSearchOutline16: () => <span />,
  IconSendOutline16: () => <span />,
  IconSparkle16: () => <span />,
  IconStopFill16: () => <span />,
  MarkdownText: ({ text }: { text: string }) => <span>{text}</span>,
  Modal: ({ open, onClose, title, children, footer }: {
    open: boolean
    onClose: () => void
    title: string
    children?: ReactNode
    footer?: ReactNode
  }) => {
    useEffect(() => {
      if (!open) return
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') onClose()
      }
      document.addEventListener('keydown', onKeyDown)
      return () => { document.removeEventListener('keydown', onKeyDown) }
    }, [onClose, open])
    return open ? (
      <div role="presentation">
        <button type="button" data-modal-backdrop onClick={onClose} />
        <div role="dialog" aria-label={title}>{children}{footer}</div>
      </div>
    ) : null
  },
}))

const openSnapshot: SideChatClientState = {
  epoch: 1,
  phase: 'open',
  parentSessionId: 'parent' as never,
  seedLength: 0,
  revision: 0,
  messages: [],
  partial: '',
  reasoning: '',
  running: false,
}

let currentSnapshot = openSnapshot

function input(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SideChatSurface controls', () => {
  let mount: HTMLDivElement
  let root: Root
  let controller: SideChatController
  let viewStore: SideChatViewStore

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mount = document.createElement('div')
    document.body.append(mount)
    viewStore = new SideChatViewStore()
    viewStore.show('parent', 'drawer')
    currentSnapshot = openSnapshot
    controller = {
      subscribe: () => () => {},
      getSnapshot: () => currentSnapshot,
      binding: () => undefined,
      close: vi.fn(async () => {}),
      send: vi.fn(async () => ({ ok: true as const })),
      cancel: vi.fn(async () => ({ ok: true as const })),
      retry: vi.fn(async () => {}),
    } as unknown as SideChatController
    root = createRoot(mount)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  function renderSurface(onEndOverride?: () => Promise<void>): void {
    const onMinimize = (): void => { viewStore.minimize('parent') }
    const onEnd = onEndOverride ?? (async (): Promise<void> => {
      await controller.close()
      viewStore.clear('parent')
    })
    const t = ((key: string) => key) as never
    act(() => {
      root.render(
        <SideChatSurface
          parentSessionId={'parent' as never}
          controller={controller}
          viewStore={viewStore}
          t={t}
          surfaceMode="drawer"
          onMinimize={onMinimize}
          onEnd={onEnd}
        />,
      )
    })
  }

  it('keeps the composer interactive while opening without context status copy', async () => {
    currentSnapshot = {
      ...openSnapshot,
      phase: 'starting',
      chatToken: '00000000-0000-4000-8000-000000000001',
    }
    renderSurface()

    const textarea = mount.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    expect(mount.textContent).not.toContain('drawer.opening')
    expect(mount.textContent).not.toContain('drawer.reading')

    act(() => { input(textarea, 'Send immediately') })
    await act(async () => {
      mount.querySelector<HTMLElement>('[aria-label="drawer.send"]')?.click()
    })

    expect(controller.send).toHaveBeenCalledWith('Send immediately', [])
  })

  it('keeps normal stop controls without showing a context-reading status', () => {
    currentSnapshot = { ...openSnapshot, running: true }
    renderSurface()

    expect(mount.textContent).not.toContain('drawer.reading')
    expect(mount.querySelector('[aria-label="drawer.stop"]')).not.toBeNull()
  })

  it('minimizes without closing and preserves the draft', () => {
    renderSurface()
    act(() => {
      input(mount.querySelector('textarea') as HTMLTextAreaElement, 'keep this')
      mount.querySelector<HTMLElement>('[aria-label="drawer.minimize"]')?.click()
    })

    expect(viewStore.get('parent').visible).toBe(false)
    expect(viewStore.get('parent').draft).toBe('keep this')
    expect(controller.close).not.toHaveBeenCalled()
  })

  it('requires confirmation before destructive end', async () => {
    renderSurface()
    const endButton = mount.querySelector<HTMLElement>('[aria-label="drawer.end"]')
    act(() => {
      input(mount.querySelector('textarea') as HTMLTextAreaElement, 'remove this')
      endButton?.click()
    })

    expect(controller.close).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    const confirmButton = [...document.querySelectorAll('button')].find(button =>
      button.textContent === 'drawer.endConfirm',
    )
    await act(async () => { confirmButton?.click() })
    expect(controller.close).toHaveBeenCalledTimes(1)
    expect(viewStore.get('parent').draft).toBe('')
    expect(document.activeElement).toBe(endButton)
  })

  it('cancels destructive end on Escape', () => {
    renderSurface()
    const endButton = mount.querySelector<HTMLElement>('[aria-label="drawer.end"]')
    act(() => { endButton?.click() })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(controller.close).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(endButton)
  })

  it('keeps destructive confirmation keyboard-contained', () => {
    renderSurface()
    act(() => { mount.querySelector<HTMLElement>('[aria-label="drawer.end"]')?.click() })
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    const cancelButton = buttons.find(button => button.textContent === 'drawer.endCancel')
    const confirmButton = buttons.find(button => button.textContent === 'drawer.endConfirm')

    expect(document.activeElement).toBe(cancelButton)
    act(() => {
      cancelButton?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', shiftKey: true, bubbles: true, cancelable: true,
      }))
    })
    expect(document.activeElement).toBe(confirmButton)
    act(() => {
      confirmButton?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Tab', bubbles: true, cancelable: true,
      }))
    })
    expect(document.activeElement).toBe(cancelButton)
  })

  it('does not let delayed composer autofocus steal confirmation focus', () => {
    vi.useFakeTimers()
    renderSurface()
    act(() => { mount.querySelector<HTMLElement>('[aria-label="drawer.end"]')?.click() })
    const cancelButton = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find(button => button.textContent === 'drawer.endCancel')

    expect(document.activeElement).toBe(cancelButton)
    act(() => { vi.advanceTimersByTime(120) })
    expect(document.activeElement).toBe(cancelButton)
  })

  it('restores focus to End after the Cancel action', () => {
    renderSurface()
    const endButton = mount.querySelector<HTMLElement>('[aria-label="drawer.end"]')
    act(() => { endButton?.click() })
    const cancelButton = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find(button => button.textContent === 'drawer.endCancel')

    act(() => { cancelButton?.click() })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(endButton)
  })

  it('restores focus to End after backdrop dismissal', () => {
    renderSurface()
    const endButton = mount.querySelector<HTMLElement>('[aria-label="drawer.end"]')
    act(() => { endButton?.click() })

    act(() => { document.querySelector<HTMLElement>('[data-modal-backdrop]')?.click() })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(endButton)
  })

  it('invokes a pending End only once', async () => {
    let resolveEnd: (() => void) | undefined
    const onEnd = vi.fn(() => new Promise<void>(resolve => { resolveEnd = resolve }))
    renderSurface(onEnd)
    act(() => { mount.querySelector<HTMLElement>('[aria-label="drawer.end"]')?.click() })
    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
      .find(button => button.textContent === 'drawer.endConfirm')

    act(() => { confirmButton?.click(); confirmButton?.click() })
    expect(onEnd).toHaveBeenCalledTimes(1)
    await act(async () => { resolveEnd?.() })
  })

  it('uses distinct glyphs for End and Minimize', () => {
    renderSurface()
    const endButton = mount.querySelector('[aria-label="drawer.end"]')
    const minimizeButton = mount.querySelector('[aria-label="drawer.minimize"]')
    expect(endButton?.textContent).toBe('×')
    expect(endButton?.getAttribute('title')).toBe('drawer.end')
    expect(minimizeButton?.textContent).toBe('—')
    expect(minimizeButton?.getAttribute('title')).toBe('drawer.minimize')
  })

  it('ingests pasted images into the rail, removes one, and sends the rest with the draft', async () => {
    renderSurface()
    const textarea = mount.querySelector('textarea') as HTMLTextAreaElement
    const file = new File(['fake-png'], 'shot.png', { type: 'image/png' })
    const clipboardData = { files: [file] }
    // React attaches synthetic listeners at the root: the event must bubble.
    const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(pasteEvent, 'clipboardData', { value: clipboardData })
    act(() => { textarea.dispatchEvent(pasteEvent) })

    await vi.waitFor(() => {
      expect(viewStore.get('parent').attachments).toHaveLength(1)
    })
    const attachment = viewStore.get('parent').attachments[0]!
    expect(attachment.mediaType).toBe('image/png')
    expect(attachment.name).toBe('shot.png')
    // The rail lists the thumbnail with a remove button.
    expect(mount.querySelector('[role="list"]')).not.toBeNull()
    expect(mount.querySelector('[aria-label="drawer.attachmentRemove"]')).not.toBeNull()

    // Remove the pasted image again.
    act(() => { mount.querySelector<HTMLElement>('[aria-label="drawer.attachmentRemove"]')?.click() })
    expect(viewStore.get('parent').attachments).toEqual([])

    // Re-add and send: the send carries the images, success clears the rail.
    act(() => { viewStore.addAttachment('parent', attachment) })
    act(() => { input(textarea, 'Look at this') })
    await act(async () => {
      mount.querySelector<HTMLElement>('[aria-label="drawer.send"]')?.click()
    })
    expect(controller.send).toHaveBeenCalledWith('Look at this', [attachment])
    expect(viewStore.get('parent').attachments).toEqual([])
  })

  it('keeps the rail on a failed send so the user can retry without re-pasting', async () => {
    const failing = vi.fn(async () => ({ ok: false as const, error: 'vision-adam 分析失败: timeout' }))
    controller = {
      ...controller,
      send: failing,
    } as unknown as SideChatController
    renderSurface()
    act(() => { input(mount.querySelector('textarea') as HTMLTextAreaElement, 'Send anyway') })
    act(() => {
      viewStore.addAttachment('parent', { mediaType: 'image/png', data: 'aGVsbG8=' })
    })
    await act(async () => {
      mount.querySelector<HTMLElement>('[aria-label="drawer.send"]')?.click()
    })

    expect(failing).toHaveBeenCalledWith('Send anyway', [{ mediaType: 'image/png', data: 'aGVsbG8=' }])
    expect(viewStore.get('parent').attachments).toHaveLength(1)
    expect(viewStore.get('parent').sendError).toContain('vision-adam 分析失败')
    expect(mount.textContent).toContain('vision-adam 分析失败')
  })

  it('renders transcript image refs via readImage and opens the lightbox', async () => {
    currentSnapshot = {
      ...openSnapshot,
      messages: [{
        id: 'm1', role: 'user' as const, text: '',
        images: [{ attachmentId: 'att-1', mediaType: 'image/png' as const, name: 'shot.png' }],
      }],
    }
    controller = {
      ...controller,
      readImage: vi.fn(async () => ({ ok: true as const, mediaType: 'image/png', data: 'aGVsbG8=' })),
    } as unknown as SideChatController
    renderSurface()

    await vi.waitFor(() => {
      expect(mount.querySelector('img[src="data:image/png;base64,aGVsbG8="]')).not.toBeNull()
    })
    act(() => {
      const image = mount.querySelector('img[src="data:image/png;base64,aGVsbG8="]') as HTMLImageElement
      image.closest('button')?.click()
    })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('shot.png')
  })

  it('numbers multi-image thumbnails with top-left badges', async () => {
    currentSnapshot = {
      ...openSnapshot,
      messages: [{
        id: 'm1', role: 'user' as const, text: '',
        images: [
          { attachmentId: 'att-1', mediaType: 'image/png' as const, name: 'a.png' },
          { attachmentId: 'att-2', mediaType: 'image/png' as const, name: 'b.png' },
        ],
      }],
    }
    controller = {
      ...controller,
      readImage: vi.fn(async (id: string) => ({
        ok: true as const, mediaType: 'image/png', data: `Zm9vLWJhc2U-${id}`,
      })),
    } as unknown as SideChatController
    renderSurface()

    await vi.waitFor(() => {
      expect(mount.querySelectorAll('[class*="messageImageButton"]')).toHaveLength(2)
    })
    const buttons = [...mount.querySelectorAll<HTMLButtonElement>('[class*="messageImageButton"]')]
    // 2026-09-14 btw-ui: white-black digit badge, first child of the button.
    const badges = [...mount.querySelectorAll('[class*="messageImageBadge"]')]
    expect(badges.map(badge => badge.textContent)).toEqual(['1', '2'])
    expect(badges[0]?.getAttribute('aria-hidden')).toBe('true')
    for (let i = 0; i < buttons.length; i += 1) {
      expect(buttons[i]?.firstElementChild?.className.includes('messageImageBadge')).toBe(true)
    }
  })

  it('leaves single-image thumbnails unnumbered', async () => {
    currentSnapshot = {
      ...openSnapshot,
      messages: [{
        id: 'm2', role: 'user' as const, text: '',
        images: [{ attachmentId: 'att-3', mediaType: 'image/png' as const, name: 'c.png' }],
      }],
    }
    controller = {
      ...controller,
      readImage: vi.fn(async () => ({ ok: true as const, mediaType: 'image/png', data: 'Yw==' })),
    } as unknown as SideChatController
    renderSurface()

    await vi.waitFor(() => {
      expect(mount.querySelectorAll('[class*="messageImageButton"]')).toHaveLength(1)
    })
    expect(mount.querySelector('[class*="messageImageBadge"]')).toBeNull()
  })

  it('opens the self-drawn lightbox from a thumbnail and closes via button, Escape, and mask', async () => {
    currentSnapshot = {
      ...openSnapshot,
      messages: [{
        id: 'm1', role: 'user' as const, text: '',
        images: [{ attachmentId: 'att-1', mediaType: 'image/png' as const, name: 'shot.png' }],
      }],
    }
    controller = {
      ...controller,
      readImage: vi.fn(async () => ({ ok: true as const, mediaType: 'image/png', data: 'aGVsbG8=' })),
    } as unknown as SideChatController
    renderSurface()

    await vi.waitFor(() => {
      expect(mount.querySelector('img[src="data:image/png;base64,aGVsbG8="]')).not.toBeNull()
    })
    const thumbnail = mount
      .querySelector<HTMLImageElement>('img[src="data:image/png;base64,aGVsbG8="]')
      ?.closest('button') as HTMLButtonElement

    // The drawer (not rendered here) minimizes on window-level Escape; the
    // lightbox must stop propagation so Escape closes only the preview.
    const onWindowEscape = vi.fn()
    window.addEventListener('keydown', onWindowEscape)
    try {
      act(() => { thumbnail.click() })
      const dialog = document.querySelector('[role="dialog"][aria-label="shot.png"]')
      expect(dialog).not.toBeNull()
      // The preview shows the full image with the large lightbox class.
      const preview = dialog?.querySelector('img[src="data:image/png;base64,aGVsbG8="]')
      expect(preview).not.toBeNull()
      expect(preview?.className.includes('lightboxImage')).toBe(true)
      expect(document.querySelector('[class*="lightboxClose"]')).not.toBeNull()

      // Close button closes and restores focus to the opener thumbnail.
      act(() => {
        document.querySelector('[class*="lightboxClose"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(document.querySelector('[role="dialog"][aria-label="shot.png"]')).toBeNull()
      expect(document.activeElement).toBe(thumbnail)

      // Reopen; Escape closes the preview and does NOT reach the window
      // listener (drawer stays put), then focus returns to the thumbnail.
      act(() => { thumbnail.click() })
      expect(document.querySelector('[role="dialog"][aria-label="shot.png"]')).not.toBeNull()
      onWindowEscape.mockClear()
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
      expect(document.querySelector('[role="dialog"][aria-label="shot.png"]')).toBeNull()
      expect(onWindowEscape).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(thumbnail)

      // Reopen; mask click closes.
      act(() => { thumbnail.click() })
      expect(document.querySelector('[role="dialog"][aria-label="shot.png"]')).not.toBeNull()
      act(() => {
        document.querySelector('[class*="lightboxMask"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(document.querySelector('[role="dialog"][aria-label="shot.png"]')).toBeNull()
    } finally {
      window.removeEventListener('keydown', onWindowEscape)
    }
  })

  it('shows the running banner with the in-flight tool as the current action', () => {
    currentSnapshot = {
      ...openSnapshot,
      running: true,
      currentAction: { kind: 'tool', tool: 'read', turn: 2, step: 1 },
    }
    renderSurface()

    const banner = mount.querySelector('[role="status"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain('drawer.bannerOutputting')
    expect(banner?.textContent).toContain('drawer.bannerCurrentAction')
    expect(banner?.textContent).toContain('read')
  })

  it('shows a plain outputting banner during pure generation', () => {
    currentSnapshot = {
      ...openSnapshot,
      running: true,
      currentAction: { kind: 'generating', turn: 2, step: 1 },
    }
    renderSurface()

    const banner = mount.querySelector('[role="status"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toBe('drawer.bannerOutputting')
  })

  it('hides the running banner once the turn ends', () => {
    currentSnapshot = { ...openSnapshot, running: false }
    renderSurface()
    expect(mount.querySelector('[role="status"]')).toBeNull()
  })

  it('hides the running banner while running when dsh-btw.ui.banner is false (P0-b switch)', () => {
    currentSnapshot = {
      ...openSnapshot,
      running: true,
      currentAction: { kind: 'tool', tool: 'read', turn: 2, step: 1 },
    }
    const snapshot = Object.freeze({ status: 'ready' as const, value: Object.freeze({ ui: Object.freeze({ banner: false }) }), base: undefined, user: undefined, revision: 0, writable: false, mode: 'host' as const })
    const scope = {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    }
    const onMinimize = (): void => { viewStore.minimize('parent') }
    const onEnd = async (): Promise<void> => { await controller.close() }
    const t = ((key: string) => key) as never
    act(() => {
      root.render(
        <SideChatSurface
          parentSessionId={'parent' as never}
          controller={controller}
          viewStore={viewStore}
          t={t}
          surfaceMode="drawer"
          settingsScope={scope as never}
          onMinimize={onMinimize}
          onEnd={onEnd}
        />,
      )
    })

    expect(mount.querySelector('[role="status"]')).toBeNull()
  })

  it('renders tool digests as DisclosureRows with running state and IN/OUT fold', () => {
    currentSnapshot = {
      ...openSnapshot,
      running: true,
      messages: [{
        id: 'a1', role: 'assistant' as const, text: 'Checking…',
        tools: [
          { callId: 'c1', name: 'read', args: '{"path":"a.ts"}', result: 'file body', isError: false },
          { callId: 'c2', name: 'search', args: '{"q":"btw"}', running: true },
        ],
      }],
    }
    renderSurface()

    const rows = mount.querySelectorAll('[data-disclosure-row]')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.closest('[data-state]')?.getAttribute('data-state')).toBe('ok')
    expect(rows[0]?.textContent).toContain('read')
    // Collapsed summary of the running call; expanded body carries IN/OUT.
    expect(rows[1]?.textContent).toContain('drawer.toolRunning')
    expect(rows[1]?.closest('[data-state]')?.getAttribute('data-state')).toBe('running')

    // Expand the settled row: IN + OUT appear.
    act(() => {
      ;(rows[0] as HTMLElement).querySelector<HTMLElement>('[role="button"]')?.click()
    })
    expect(rows[0]?.textContent).toContain('IN')
    expect(rows[0]?.textContent).toContain('OUT')
    expect(rows[0]?.textContent).toContain('{"path":"a.ts"}')
    expect(rows[0]?.textContent).toContain('file body')
  })

  it('marks errored tool digests with an error summary', () => {
    currentSnapshot = {
      ...openSnapshot,
      messages: [{
        id: 'a1', role: 'assistant' as const, text: 'Trying…',
        tools: [{ callId: 'c1', name: 'read', args: '{}', result: 'no such file', isError: true }],
      }],
    }
    renderSurface()

    const row = mount.querySelector('[data-disclosure-row]') as HTMLElement
    expect(row?.closest('[data-state]')?.getAttribute('data-state')).toBe('error')
    expect(row?.textContent).toContain('no such file')
  })

  it('defaults the model selector to deepseek-v4.1-flash with no legacy option', () => {
    renderSurface()

    const select = mount.querySelector<HTMLSelectElement>('[aria-label="drawer.model"]')
    expect(select).not.toBeNull()
    expect(select?.value).toBe('deepseek-v4.1-flash')
    const options = [...(select?.options ?? [])].map(option => option.value)
    expect(options).toEqual(['deepseek-v4.1-flash', 'glm-5.3', 'deepseek-v4-pro'])
    expect(options).not.toContain('deepseek-v4-flash')
  })

  it('follows the host-reported model in the selector', () => {
    currentSnapshot = { ...openSnapshot, model: 'glm-5.3' as const }
    renderSurface()

    const select = mount.querySelector<HTMLSelectElement>('[aria-label="drawer.model"]')
    expect(select?.value).toBe('glm-5.3')
  })

  it('renders settings-driven model options and default (P0-b 热载)', () => {
    const snapshot = Object.freeze({
      status: 'ready' as const,
      value: Object.freeze({
        model: Object.freeze({ default: 'glm-5.3', options: Object.freeze(['glm-5.3', 'deepseek-v4.1-flash']) }),
      }),
      base: undefined, user: undefined, revision: 0, writable: false, mode: 'host' as const,
    })
    const scope = {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    }
    const onMinimize = (): void => { viewStore.minimize('parent') }
    const onEnd = async (): Promise<void> => { await controller.close() }
    const t = ((key: string) => key) as never
    act(() => {
      root.render(
        <SideChatSurface
          parentSessionId={'parent' as never}
          controller={controller}
          viewStore={viewStore}
          t={t}
          surfaceMode="drawer"
          settingsScope={scope as never}
          onMinimize={onMinimize}
          onEnd={onEnd}
        />,
      )
    })

    const select = mount.querySelector<HTMLSelectElement>('[aria-label="drawer.model"]')
    // The settings default applies while the host has not reported a model.
    expect(select?.value).toBe('glm-5.3')
    expect([...(select?.options ?? [])].map(option => option.value))
      .toEqual(['glm-5.3', 'deepseek-v4.1-flash'])
  })

  it('falls back to the constant model list when settings omit model.options', () => {
    const snapshot = Object.freeze({
      status: 'ready' as const,
      value: Object.freeze({ ui: Object.freeze({ banner: true }) }),
      base: undefined, user: undefined, revision: 0, writable: false, mode: 'host' as const,
    })
    const scope = {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    }
    const onMinimize = (): void => { viewStore.minimize('parent') }
    const onEnd = async (): Promise<void> => { await controller.close() }
    const t = ((key: string) => key) as never
    act(() => {
      root.render(
        <SideChatSurface
          parentSessionId={'parent' as never}
          controller={controller}
          viewStore={viewStore}
          t={t}
          surfaceMode="drawer"
          settingsScope={scope as never}
          onMinimize={onMinimize}
          onEnd={onEnd}
        />,
      )
    })

    const select = mount.querySelector<HTMLSelectElement>('[aria-label="drawer.model"]')
    expect(select?.value).toBe('deepseek-v4.1-flash')
    expect([...(select?.options ?? [])].map(option => option.value))
      .toEqual(['deepseek-v4.1-flash', 'glm-5.3', 'deepseek-v4-pro'])
  })
})

/**
 * 2026-09-23 btw-question regression lock.
 *
 * Root cause: QuestionCard reset its drafts from a `useEffect` depending on
 * `pendingQuestion.questions`. That array is rebuilt by every `sideChat/read`
 * (JSON RPC + strict zod codec) and the controller re-publishes a snapshot
 * every 220ms while a question is pending, so the selection was wiped ~4.5x/s.
 * These cases re-render with a *content-identical but brand-new* object graph
 * to emulate one such poll (C1 is the direct regression lock).
 */
describe('QuestionCard option rows', () => {
  const QUESTION_ID = '11111111-1111-4111-8111-111111111111'

  interface QuestionSpec {
    id: string
    question: string
    options: { label: string, description?: string }[]
    multi_select?: boolean
  }

  /** Builds a fresh pendingQuestion object graph on every call (new arrays/objects). */
  function pending(questionId: string, questions: QuestionSpec[]): Record<string, unknown> {
    return { questionId, questions: questions.map(question => ({ ...question, options: question.options.map(option => ({ ...option })) })) }
  }

  const SINGLE: QuestionSpec[] = [{
    id: 'q1',
    question: '是否继续？',
    options: [{ label: '继续' }, { label: '停止' }],
  }]

  let mount: HTMLDivElement
  let root: Root
  let controller: SideChatController
  let viewStore: SideChatViewStore

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    mount = document.createElement('div')
    document.body.append(mount)
    viewStore = new SideChatViewStore()
    viewStore.show('parent', 'drawer')
    currentSnapshot = openSnapshot
    controller = {
      subscribe: () => () => {},
      getSnapshot: () => currentSnapshot,
      binding: () => undefined,
      close: vi.fn(async () => {}),
      send: vi.fn(async () => ({ ok: true as const })),
      cancel: vi.fn(async () => ({ ok: true as const })),
      retry: vi.fn(async () => {}),
      answer: vi.fn(async () => ({ ok: true as const })),
    } as unknown as SideChatController
    root = createRoot(mount)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    document.body.innerHTML = ''
  })

  function renderSurface(): void {
    const t = ((key: string) => key) as never
    act(() => {
      root.render(
        <SideChatSurface
          parentSessionId={'parent' as never}
          controller={controller}
          viewStore={viewStore}
          t={t}
          surfaceMode="drawer"
          onMinimize={() => { viewStore.minimize('parent') }}
          onEnd={async (): Promise<void> => { await controller.close() }}
        />,
      )
    })
  }

  function optionRows(): HTMLElement[] {
    return [...mount.querySelectorAll<HTMLElement>('[class*="questionOptions"] > button')]
  }

  function checked(): (string | null)[] {
    return optionRows().map(row => row.getAttribute('aria-checked'))
  }

  function clickOption(index: number): void {
    act(() => { optionRows()[index]?.click() })
  }

  it('C1 keeps the selection when the same questionId arrives with a new questions array identity', () => {
    currentSnapshot = { ...openSnapshot, pendingQuestion: pending(QUESTION_ID, SINGLE) } as never
    renderSurface()

    clickOption(0)
    expect(optionRows()[0]?.getAttribute('aria-checked')).toBe('true')
    expect(optionRows()[0]?.className).toContain('questionOptionSelected')

    // Same content, brand-new arrays/objects: exactly what one 220ms poll does.
    currentSnapshot = { ...openSnapshot, pendingQuestion: pending(QUESTION_ID, SINGLE) } as never
    renderSurface()

    expect(optionRows()[0]?.getAttribute('aria-checked')).toBe('true')
    expect(optionRows()[0]?.className).toContain('questionOptionSelected')
    expect(optionRows()[1]?.getAttribute('aria-checked')).toBe('false')
  })

  it('C2 resets the drafts when the questionId changes', () => {
    currentSnapshot = { ...openSnapshot, pendingQuestion: pending(QUESTION_ID, SINGLE) } as never
    renderSurface()
    clickOption(0)
    expect(checked()).toEqual(['true', 'false'])

    currentSnapshot = {
      ...openSnapshot,
      pendingQuestion: pending('22222222-2222-4222-8222-222222222222', SINGLE),
    } as never
    renderSurface()

    expect(checked()).toEqual(['false', 'false'])
  })

  it('C3 keeps single-select exclusive and multi-select additive', () => {
    currentSnapshot = { ...openSnapshot, pendingQuestion: pending(QUESTION_ID, SINGLE) } as never
    renderSurface()
    clickOption(0)
    clickOption(1)
    expect(checked()).toEqual(['false', 'true'])

    // A new questionId remounts the card, so this starts from clean drafts.
    currentSnapshot = {
      ...openSnapshot,
      pendingQuestion: pending('33333333-3333-4333-8333-333333333333', [
        { ...SINGLE[0] as QuestionSpec, multi_select: true },
      ]),
    } as never
    renderSurface()
    expect(checked()).toEqual(['false', 'false'])
    clickOption(0)
    clickOption(1)
    expect(checked()).toEqual(['true', 'true'])
  })

  it('C4 exposes legal radio/checkbox ARIA without aria-pressed', () => {
    currentSnapshot = { ...openSnapshot, pendingQuestion: pending(QUESTION_ID, SINGLE) } as never
    renderSurface()

    const singleGroup = mount.querySelector('[class*="questionOptions"]')
    expect(singleGroup?.getAttribute('role')).toBe('radiogroup')
    expect(optionRows().map(row => row.getAttribute('role'))).toEqual(['radio', 'radio'])
    expect(mount.querySelectorAll('[aria-pressed]')).toHaveLength(0)

    currentSnapshot = {
      ...openSnapshot,
      pendingQuestion: pending('44444444-4444-4444-8444-444444444444', [
        { ...SINGLE[0] as QuestionSpec, multi_select: true },
      ]),
    } as never
    renderSurface()

    expect(mount.querySelector('[class*="questionOptions"]')?.getAttribute('role')).toBe('group')
    expect(optionRows().map(row => row.getAttribute('role'))).toEqual(['checkbox', 'checkbox'])
    expect(mount.querySelectorAll('[aria-pressed]')).toHaveLength(0)
  })

  it('C5 renders the index badge for single select and the checkbox for multi select', () => {
    currentSnapshot = { ...openSnapshot, pendingQuestion: pending(QUESTION_ID, SINGLE) } as never
    renderSurface()

    const indices = [...mount.querySelectorAll<HTMLElement>('[class*="questionOptionIndex"]')]
    expect(indices.map(node => node.textContent)).toEqual(['1', '2'])
    expect(mount.querySelectorAll('[class*="questionOptionCheck"]')).toHaveLength(0)

    currentSnapshot = {
      ...openSnapshot,
      pendingQuestion: pending('55555555-5555-4555-8555-555555555555', [
        { ...SINGLE[0] as QuestionSpec, multi_select: true },
      ]),
    } as never
    renderSurface()

    const checks = [...mount.querySelectorAll<HTMLElement>('[class*="questionOptionCheck"]')]
    expect(checks).toHaveLength(2)
    expect(mount.querySelectorAll('[data-icon="check"]')).toHaveLength(0)

    clickOption(0)
    expect(mount.querySelectorAll('[data-icon="check"]')).toHaveLength(1)
    expect(optionRows()[0]?.className).not.toContain('questionOptionCheckChecked')
    expect(checks[0]?.className).toContain('questionOptionCheckChecked')
  })

  it('renders the frozen-snapshot notice without taking over the panel', () => {
    renderSurface()
    expect(mount.textContent).not.toContain('drawer.readRetrying')

    currentSnapshot = { ...openSnapshot, readError: 'result-invalid' }
    renderSurface()

    // Localized copy plus the raw reason as hover detail only.
    expect(mount.textContent).toContain('drawer.readRetrying')
    expect(mount.querySelector('[title="result-invalid"]')).not.toBeNull()
    // Non-blocking: the notice does not replace the composer or the controls.
    expect(mount.querySelector('textarea')).not.toBeNull()
    expect(mount.querySelector('[aria-label="drawer.end"]')).not.toBeNull()
    expect(mount.textContent).not.toContain('drawer.error')

    // The terminal error phase keeps its own block; a stale flag cannot double up.
    currentSnapshot = { ...openSnapshot, phase: 'error', error: 'result-invalid', readError: 'result-invalid' }
    renderSurface()
    expect(mount.textContent).toContain('drawer.error')
    expect(mount.textContent).not.toContain('drawer.readRetrying')
  })
})
