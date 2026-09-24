import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SideChatController } from './controller.ts'
import type { SideChatTreeEntry } from '../shared/remote.ts'
import { NS } from './locales.ts'
import type { SideChatViewStore } from './view-store.ts'
import css from './side-chat.module.css'

/**
 * Drawer jump list (R0-3/R0-4/R0-5): a collapsible strip listing other side
 * conversations — the current session's tree (main session + subagents below
 * it) and every side chat grouped by the current working directory ("项目全
 * 部"). One click jumps the main conversation to that parent and switches the
 * side conversation to it.
 */

export interface SideChatJumpListProps extends PropsLocale<typeof NS> {
  controller: SideChatController
  viewStore: SideChatViewStore
  /** The parent session the hosting drawer currently serves. */
  parentSessionId: SessionId
}

type JumpTab = 'tree' | 'project'

function entryTitle(entry: SideChatTreeEntry): string {
  const title = entry.title?.trim()
  if (title !== undefined && title !== '') return title
  const cwd = entry.cwd
  if (cwd !== undefined && cwd !== '') {
    return cwd.split(/[\\/]/).filter(segment => segment !== '').at(-1) ?? cwd
  }
  return entry.parentSessionId
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit) + ' …'
}

export function SideChatJumpList({
  controller,
  viewStore,
  parentSessionId,
  t,
}: SideChatJumpListProps) {
  const parentKey = String(parentSessionId)
  const subscribeView = useCallback((listener: () => void) => viewStore.subscribe(listener), [viewStore])
  const getView = useCallback(() => viewStore.get(parentKey), [parentKey, viewStore])
  const view = useSyncExternalStore(subscribeView, getView, getView)
  const currentParent = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot).parentSessionId
  const [tab, setTab] = useState<JumpTab>('tree')
  const [entries, setEntries] = useState<readonly SideChatTreeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const now = useMemo(() => Date.now(), [entries])

  useEffect(() => {
    // w28 F3/P4: this component stays mounted while the drawer is collapsed, so an
    // ungated fetch also fires on the re-render the close path triggers — measured
    // one `sideChat/listTree` 10–31 ms after End that took 27–59 s and whose result
    // nobody could see. Only fetch while the jump list is actually expanded.
    if (!view.jumpOpen) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const request = tab === 'tree' ? controller.listTree() : controller.listProject()
    void request.then(result => {
      if (cancelled) return
      if (result.ok) {
        setEntries(result.entries)
      } else {
        setEntries([])
        setError(result.error)
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [controller, parentSessionId, tab, view.jumpOpen])

  const jump = async (entry: SideChatTreeEntry): Promise<void> => {
    const result = await controller.jumpTo(entry.parentSessionId as SessionId)
    if (!result.ok) {
      setError(result.error)
      return
    }
    viewStore.show(String(entry.parentSessionId), 'drawer')
  }

  const relativeTime = (lastActiveAt: number): string => {
    const deltaSeconds = Math.max(0, Math.floor((now - lastActiveAt) / 1000))
    if (deltaSeconds < 60) return t('drawer.jumpJustNow')
    const minutes = Math.floor(deltaSeconds / 60)
    if (minutes < 60) return `${minutes}${t('drawer.jumpMinutesSuffix')}`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}${t('drawer.jumpHoursSuffix')}`
    return `${Math.floor(hours / 24)}${t('drawer.jumpDaysSuffix')}`
  }

  return (
    <section className={css.jumpList} aria-label={t('drawer.jumpTitle')}>
      <button
        type="button"
        className={css.jumpToggle}
        aria-expanded={view.jumpOpen}
        onClick={() => { viewStore.setJumpOpen(parentKey, !view.jumpOpen) }}
      >
        <span className={css.jumpCaret} aria-hidden="true">{view.jumpOpen ? '▾' : '▸'}</span>
        <span>{t('drawer.jumpTitle')}</span>
      </button>
      {view.jumpOpen && (
        <div className={css.jumpBody}>
          <div className={css.jumpTabs} role="tablist" aria-label={t('drawer.jumpTitle')}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'tree'}
              className={tab === 'tree' ? css.jumpTabActive : css.jumpTab}
              onClick={() => { setTab('tree') }}
            >
              {t('drawer.jumpTree')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'project'}
              className={tab === 'project' ? css.jumpTabActive : css.jumpTab}
              onClick={() => { setTab('project') }}
            >
              {t('drawer.jumpProject')}
            </button>
          </div>
          {loading
            ? <div className={css.jumpHint}>{t('drawer.jumpLoading')}</div>
            : error !== null
              ? <div className={css.jumpHint}>{error}</div>
              : entries.length === 0
                ? <div className={css.jumpHint}>{t('drawer.jumpEmpty')}</div>
                : (
                  <ul className={css.jumpEntries}>
                    {entries.map(entry => {
                      const current = currentParent !== undefined && String(currentParent) === entry.parentSessionId
                      return (
                        <li key={entry.parentSessionId}>
                          <button
                            type="button"
                            className={current ? css.jumpEntryActive : css.jumpEntry}
                            onClick={() => { void jump(entry) }}
                          >
                            <span className={css.jumpEntryTitle}>
                              {entryTitle(entry)}
                              {current ? ` · ${t('drawer.jumpCurrent')}` : ''}
                            </span>
                            <span className={css.jumpEntryMeta}>
                              {relativeTime(entry.lastActiveAt)}
                              {entry.running === true ? ` · ${t('drawer.jumpRunning')}` : ''}
                            </span>
                            {entry.preview !== undefined && entry.preview !== '' && (
                              <span className={css.jumpEntryPreview}>{truncate(entry.preview, 80)}</span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
        </div>
      )}
    </section>
  )
}
