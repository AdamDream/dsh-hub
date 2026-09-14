import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent,
} from 'react'
import type { SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button, IconSendOutline16, IconStopFill16, MarkdownText, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BtwPendingQuestion } from '../shared/remote.ts'
import type { SideChatController } from './controller.ts'
import { NS } from './locales.ts'
import { SideChatSign } from './SideChatSign.tsx'
import type { SideChatPresentationMode, SideChatViewStore } from './view-store.ts'
import css from './side-chat.module.css'

type Snapshot = ReturnType<SessionFace['getSnapshot']>

function useSessionSnapshot(face: SessionFace | undefined): Snapshot | null {
  const subscribe = useCallback((listener: () => void) => face?.subscribe(listener) ?? (() => {}), [face])
  const getSnapshot = useCallback(() => face?.getSnapshot() ?? null, [face])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

interface QuestionDraft {
  readonly selected: ReadonlySet<string>
  custom: string
}

export interface SideChatSurfaceProps extends PropsLocale<typeof NS> {
  controller: SideChatController
  parentSessionId: SessionId
  viewStore: SideChatViewStore
  surfaceMode: SideChatPresentationMode
  onMinimize: () => void
  onEnd: () => Promise<void>
}

function QuestionCard({
  pendingQuestion,
  controller,
  t,
}: {
  pendingQuestion: BtwPendingQuestion
  controller: SideChatController
  t: PropsLocale<typeof NS>['t']
}) {
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>(() => Object.fromEntries(
    pendingQuestion.questions.map(question => [question.id, { selected: new Set<string>(), custom: '' }]),
  ))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDrafts(Object.fromEntries(
      pendingQuestion.questions.map(question => [question.id, { selected: new Set<string>(), custom: '' }]),
    ))
    setError(null)
  }, [pendingQuestion.questionId, pendingQuestion.questions])

  const toggle = (questionId: string, label: string, multiSelect: boolean): void => {
    setDrafts(previous => {
      const draft = previous[questionId] ?? { selected: new Set<string>(), custom: '' }
      const selected = new Set(draft.selected)
      if (!multiSelect) selected.clear()
      if (selected.has(label)) selected.delete(label)
      else selected.add(label)
      return { ...previous, [questionId]: { selected, custom: draft.custom } }
    })
  }

  const submit = async (): Promise<void> => {
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const result = await controller.answer(pendingQuestion.questions.map((question): { id: string, selected: string[], custom?: string } => {
        const draft = drafts[question.id] ?? { selected: new Set<string>(), custom: '' }
        const custom = draft.custom.trim()
        return custom === ''
          ? { id: question.id, selected: [...draft.selected] }
          : { id: question.id, selected: [...draft.selected], custom }
      }))
      if (!result.ok) setError(result.error)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className={css.questionCard} aria-label={t('drawer.questionTitle')}>
      <div className={css.questionHead}>
        <span className={css.questionDot} aria-hidden="true" />
        <strong>{t('drawer.questionTitle')}</strong>
      </div>
      {pendingQuestion.questions.map(question => {
        const draft = drafts[question.id] ?? { selected: new Set<string>(), custom: '' }
        return (
          <div key={question.id} className={css.questionItem}>
            {question.header !== undefined && <div className={css.questionHeader}>{question.header}</div>}
            <p className={css.questionText}>{question.question}</p>
            {question.options !== undefined && question.options.length > 0 && (
              <div className={css.questionOptions} role={question.multi_select === true ? 'group' : 'radiogroup'}>
                {question.options.map(option => {
                  const active = draft.selected.has(option.label)
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={active ? css.questionOptionActive : css.questionOption}
                      aria-pressed={active}
                      onClick={() => { toggle(question.id, option.label, question.multi_select === true) }}
                    >
                      <span className={css.questionOptionLabel}>{option.label}</span>
                      {option.description !== undefined && (
                        <span className={css.questionOptionDescription}>{option.description}</span>
                      )}
                    </button>
                  )
                })}
                {question.multi_select === true && <span className={css.questionHint}>{t('drawer.multiHint')}</span>}
              </div>
            )}
            <input
              className={css.questionInput}
              type="text"
              value={draft.custom}
              placeholder={t('drawer.questionCustomPlaceholder')}
              aria-label={t('drawer.questionCustom')}
              onChange={event => {
                const value = event.target.value
                setDrafts(previous => ({
                  ...previous,
                  [question.id]: { selected: previous[question.id]?.selected ?? new Set<string>(), custom: value },
                }))
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
          </div>
        )
      })}
      {error !== null && <div className={css.questionError}>{error}</div>}
      <Button size="sm" variant="primary" disabled={sending} onClick={() => { void submit() }}>
        {sending ? t('drawer.answering') : t('drawer.answer')}
      </Button>
    </section>
  )
}

export function SideChatSurface({
  controller,
  parentSessionId,
  viewStore,
  t,
  surfaceMode,
  onMinimize,
  onEnd,
}: SideChatSurfaceProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const parent = controller.binding(parentSessionId)?.session
  const parentSnapshot = useSessionSnapshot(parent)
  const parentKey = String(parentSessionId)
  const subscribeView = useCallback((listener: () => void) => viewStore.subscribe(listener), [viewStore])
  const getView = useCallback(() => viewStore.get(parentKey), [parentKey, viewStore])
  const view = useSyncExternalStore(subscribeView, getView, getView)
  const draft = view.draft
  const sendError = view.sendError
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const confirmationFooterRef = useRef<HTMLDivElement>(null)
  const endButtonRef = useRef<HTMLButtonElement>(null)
  const composerFocusTimerRef = useRef<number | undefined>(undefined)
  const confirmEndRef = useRef(confirmEnd)
  const restoreEndFocusRef = useRef(false)
  const endingRef = useRef(false)
  confirmEndRef.current = confirmEnd

  const messages = state.messages
  const partial = state.partial
  const reasoning = state.reasoning

  useEffect(() => {
    if ((state.phase !== 'starting' && state.phase !== 'open') || confirmEndRef.current) return
    const timer = window.setTimeout(() => {
      if (composerFocusTimerRef.current !== timer) return
      composerFocusTimerRef.current = undefined
      if (confirmEndRef.current) return
      inputRef.current?.focus()
    }, 120)
    composerFocusTimerRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (composerFocusTimerRef.current === timer) composerFocusTimerRef.current = undefined
    }
  }, [state.phase])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, partial, reasoning])
  useEffect(() => {
    if (!confirmEnd) {
      if (restoreEndFocusRef.current) {
        restoreEndFocusRef.current = false
        endButtonRef.current?.focus()
      }
      return
    }
    if (composerFocusTimerRef.current !== undefined) {
      window.clearTimeout(composerFocusTimerRef.current)
      composerFocusTimerRef.current = undefined
    }
    confirmationFooterRef.current?.querySelector('button')?.focus()
    const containEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') event.stopPropagation()
    }
    document.addEventListener('keydown', containEscape)
    return () => { document.removeEventListener('keydown', containEscape) }
  }, [confirmEnd])

  const running = state.running
  const interactive = state.phase === 'starting' || state.phase === 'open'
  const canSend = interactive && !running && draft.trim() !== ''
  const send = async (): Promise<void> => {
    if (!canSend) return
    const text = draft.trim()
    viewStore.setDraft(parentKey, '')
    const result = await controller.send(text)
    if (!result.ok) {
      viewStore.setDraft(parentKey, text)
      viewStore.setSendError(parentKey, result.error)
    }
  }
  const end = async (): Promise<void> => {
    if (endingRef.current) return
    endingRef.current = true
    setEnding(true)
    try {
      await onEnd()
      restoreEndFocusRef.current = true
      setConfirmEnd(false)
    } finally {
      endingRef.current = false
      setEnding(false)
    }
  }
  const dismissEnd = (): void => {
    if (endingRef.current) return
    restoreEndFocusRef.current = true
    setConfirmEnd(false)
  }
  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void send()
  }
  const onConfirmationKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab') return
    const [cancel, confirm] = confirmationFooterRef.current?.querySelectorAll('button') ?? []
    if (cancel === undefined || confirm === undefined) return
    if (event.shiftKey && document.activeElement === cancel) {
      event.preventDefault()
      confirm.focus()
    } else if (!event.shiftKey && document.activeElement === confirm) {
      event.preventDefault()
      cancel.focus()
    }
  }
  return (
    <div className={css.surface} data-side-chat-surface-mode={surfaceMode}>
      <header className={css.drawerHeader}>
        <div className={css.titleCluster}>
          <SideChatSign className={css.railMark} />
          <div>
            <div className={css.titleLine}>
              <strong>{t('drawer.title')}</strong>
              <span className={css.readOnlyBadge}>{t('drawer.readOnly')}</span>
            </div>
            <p>{t('drawer.subtitle')}</p>
          </div>
        </div>
        <div className={css.headerActions}>
          <button
            ref={endButtonRef}
            className={css.endButton}
            type="button"
            aria-label={t('drawer.end')}
            title={t('drawer.end')}
            onClick={() => { setConfirmEnd(true) }}
          >
            <span className={css.headerGlyph} aria-hidden="true">×</span>
          </button>
          <button
            className={css.iconButton}
            type="button"
            aria-label={t('drawer.minimize')}
            title={t('drawer.minimize')}
            onClick={onMinimize}
          >
            <span className={css.headerGlyph} aria-hidden="true">—</span>
          </button>
        </div>
      </header>

      <div className={css.parentStatus}>
        <span className={parentSnapshot?.running ? css.statusDotRunning : css.statusDot} />
        <span>{parentSnapshot?.running ? t('drawer.mainRunning') : t('drawer.mainReady')}</span>
        <span className={css.contextNote}>{t('drawer.contextNote')}</span>
      </div>

      <div className={css.transcript} ref={scrollRef} aria-live="polite">
        {state.phase === 'error' && (
          <div className={css.errorState}>
            <span className={css.errorRule} />
            <strong>{t('drawer.error')}</strong>
            <p>{state.error}</p>
            <Button size="sm" variant="outline" onClick={() => { void controller.retry() }}>
              {t('drawer.retry')}
            </Button>
          </div>
        )}
        {interactive && messages.length === 0 && partial === '' && !running && (
          <div className={css.emptyState}>
            <SideChatSign className={css.railMark} />
            <strong>{t('drawer.emptyTitle')}</strong>
            <p>{t('drawer.emptyBody')}</p>
          </div>
        )}
        {messages.map(message => (
          <article key={message.id} className={message.role === 'user' ? css.userMessage : css.assistantMessage}>
            <div className={css.messageMeta}>{message.role === 'user' ? t('drawer.you') : t('drawer.assistant')}</div>
            {message.role === 'assistant'
              ? <MarkdownText text={message.text} />
              : <p>{message.text}</p>}
          </article>
        ))}
        {reasoning !== '' && (
          <article className={css.assistantMessage}>
            <div className={css.messageMeta}>{t('drawer.thinking')}</div>
            <p>{reasoning}</p>
          </article>
        )}
        {partial !== '' && (
          <article className={css.assistantMessage}>
            <div className={css.messageMeta}>{t('drawer.assistant')}</div>
            <MarkdownText text={partial} streaming />
          </article>
        )}
      </div>

      {interactive && state.pendingQuestion !== undefined && (
        <QuestionCard pendingQuestion={state.pendingQuestion} controller={controller} t={t} />
      )}

      {interactive && (
        <footer className={css.composerArea}>
          {sendError !== null && <div className={css.sendError}>{sendError}</div>}
          <div className={css.composer}>
            <textarea
              ref={inputRef}
              value={draft}
              rows={2}
              placeholder={t('drawer.placeholder')}
              aria-label={t('drawer.placeholder')}
              disabled={running}
              onChange={event => { viewStore.setDraft(parentKey, event.target.value) }}
              onKeyDown={onComposerKeyDown}
            />
            {running ? (
              <button
                className={css.sendButton}
                type="button"
                aria-label={t('drawer.stop')}
                title={t('drawer.stop')}
                onClick={() => {
                  void controller.cancel().then(result => {
                    if (!result.ok) viewStore.setSendError(parentKey, result.error)
                  })
                }}
              >
                <IconStopFill16 />
              </button>
            ) : (
              <button
                className={css.sendButton}
                type="button"
                aria-label={t('drawer.send')}
                title={t('drawer.send')}
                disabled={!canSend}
                onClick={() => { void send() }}
              >
                <IconSendOutline16 />
              </button>
            )}
          </div>
          <div className={css.composerFoot}>
            <span>Shift + Enter</span>
            <span>{t('drawer.discard')}</span>
          </div>
        </footer>
      )}

      <Modal
        open={confirmEnd}
        onClose={dismissEnd}
        title={t('drawer.endTitle')}
        closeLabel={t('drawer.endCancel')}
        description={t('drawer.endBody')}
        footer={(
          <div ref={confirmationFooterRef} className={css.confirmationFooter} onKeyDown={onConfirmationKeyDown}>
            <Button
              size="sm"
              variant="outline"
              disabled={ending}
              onClick={dismissEnd}
            >
              {t('drawer.endCancel')}
            </Button>
            <Button
              className={css.destructiveButton}
              size="sm"
              variant="primary"
              disabled={ending}
              onClick={() => { void end() }}
            >
              {ending ? t('drawer.ending') : t('drawer.endConfirm')}
            </Button>
          </div>
        )}
      />
    </div>
  )
}
