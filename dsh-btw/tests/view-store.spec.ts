import { describe, expect, it, vi } from 'vitest'
import { SideChatViewStore } from '../src/client/view-store.ts'

describe('SideChatViewStore', () => {
  it('retains independent draft and visibility by parent session', () => {
    const store = new SideChatViewStore()
    store.show('parent-a', 'drawer')
    store.setDraft('parent-a', 'unfinished A')
    store.show('parent-b', 'better-sidebar')
    store.setDraft('parent-b', 'unfinished B')
    store.minimize('parent-a')

    expect(store.get('parent-a')).toEqual({
      visible: false, draft: 'unfinished A', sendError: null, presentation: 'drawer',
      attachments: [], jumpOpen: false,
    })
    expect(store.get('parent-b')).toEqual({
      visible: true, draft: 'unfinished B', sendError: null, presentation: 'better-sidebar',
      attachments: [], jumpOpen: false,
    })
  })

  it('clears only after explicit end', () => {
    const store = new SideChatViewStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.show('parent', 'drawer')
    store.setDraft('parent', 'keep me')
    store.setSendError('parent', 'temporary failure')
    store.clear('parent')

    expect(store.get('parent')).toEqual({
      visible: false, draft: '', sendError: null, presentation: 'drawer',
      attachments: [], jumpOpen: false,
    })
    expect(listener).toHaveBeenCalled()
  })

  it('falls visible Better Sidebar views back to the drawer without data loss', () => {
    const store = new SideChatViewStore()
    store.show('parent-a', 'better-sidebar')
    store.setDraft('parent-a', 'unfinished A')
    store.show('parent-b', 'better-sidebar')
    store.setDraft('parent-b', 'unfinished B')

    store.fallbackVisiblePresentation('better-sidebar', 'drawer')

    expect(store.get('parent-a')).toMatchObject({
      visible: true, presentation: 'drawer', draft: 'unfinished A',
    })
    expect(store.get('parent-b')).toMatchObject({
      visible: true, presentation: 'drawer', draft: 'unfinished B',
    })
  })

  it('appends, removes, and clears composer attachments (R1-1)', () => {
    const store = new SideChatViewStore()
    const listener = vi.fn()
    store.subscribe(listener)
    const first = { mediaType: 'image/png' as const, data: 'AAA', name: 'a.png' }
    const second = { mediaType: 'image/webp' as const, data: 'BBB' }

    store.addAttachment('parent', first)
    store.addAttachment('parent', second)
    expect(store.get('parent').attachments).toEqual([first, second])

    store.removeAttachment('parent', 0)
    expect(store.get('parent').attachments).toEqual([second])
    // Out-of-range removal is a no-op.
    store.removeAttachment('parent', 5)
    expect(store.get('parent').attachments).toEqual([second])

    store.clearAttachments('parent')
    expect(store.get('parent').attachments).toEqual([])
    expect(listener).toHaveBeenCalled()
  })

  it('toggles the jump list expansion per parent', () => {
    const store = new SideChatViewStore()
    expect(store.get('parent').jumpOpen).toBe(false)
    store.setJumpOpen('parent', true)
    expect(store.get('parent').jumpOpen).toBe(true)
    // Same value does not publish again.
    const listener = vi.fn()
    store.subscribe(listener)
    store.setJumpOpen('parent', true)
    expect(listener).not.toHaveBeenCalled()
  })
})
