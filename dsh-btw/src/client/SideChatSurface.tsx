import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type KeyboardEvent,
} from 'react'
import type { SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button, IconSendOutline16, IconStopFill16, MarkdownText, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BtwModel, BtwPendingQuestion, SideChatImageRef } from '../shared/remote.ts'
import type { SideChatController } from './controller.ts'
import { NS } from './locales.ts'
import { SideChatSign } from './SideChatSign.tsx'
import { SideChatToolRow } from './SideChatToolRow.tsx'
import type { SideChatDraftImage, SideChatPresentationMode, SideChatViewStore } from './view-store.ts'
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

const PASTED_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function imageTypeOf(type: string): SideChatDraftImage['mediaType'] | undefined {
  return PASTED_IMAGE_TYPES.has(type) ? type as SideChatDraftImage['mediaType'] : undefined
}

/** dataUrl → { mediaType, canonical base64 payload } (slice off the `data:…;base64,` prefix). */
function payloadOfDataUrl(dataUrl: string): { mediaType: SideChatDraftImage['mediaType']; data: string } | undefined {
  const match = /^data:([a-z0-9-]+\/[a-z0-9-+.]+);base64,/u.exec(dataUrl)
  if (match === null) return undefined
  const mediaType = imageTypeOf(match[1] ?? '')
  if (mediaType === undefined) return undefined
  const comma = dataUrl.indexOf(',')
  return { mediaType, data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl }
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
  const attachments = view.attachments
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  /** attachmentId → data URL of the fetched bytes (U-F/U-L rendering cache). */
  const [imageCache, setImageCache] = useState<ReadonlyMap<string, string>>(new Map())
  const [lightbox, setLightbox] = useState<SideChatImageRef | null>(null)
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
    const pending = new Map<string, SideChatImageRef>()
    for (const message of messages) {
      for (const ref of message.images ?? []) {
        if (imageCache.has(ref.attachmentId)) continue
        pending.set(ref.attachmentId, ref)
      }
    }
    if (pending.size === 0) return
    let cancelled = false
    for (const ref of pending.values()) {
      void controller.readImage(ref.attachmentId).then(result => {
        if (cancelled || !result.ok) return
        setImageCache(previous => {
          const next = new Map(previous)
          next.set(ref.attachmentId, `data:${result.mediaType};base64,${result.data}`)
          return next
        })
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [controller, imageCache, messages])

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
  const canSend = interactive && !running && (draft.trim() !== '' || attachments.length > 0)
  const send = async (): Promise<void> => {
    if (!canSend) return
    const text = draft.trim()
    const pendingImages = attachments
    viewStore.setDraft(parentKey, '')
    const result = await controller.send(text, pendingImages)
    if (!result.ok) {
      viewStore.setDraft(parentKey, text)
      viewStore.setSendError(parentKey, result.error)
      return
    }
    // R1-1: a successful admission clears the rail; a failed one keeps it so
    // the user can retry without re-pasting.
    viewStore.clearAttachments(parentKey)
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
  const onComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const pasted = [...(event.clipboardData?.files ?? [])]
      .filter(file => imageTypeOf(file.type) !== undefined)
    if (pasted.length === 0) return
    event.preventDefault()
    for (const file of pasted) {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : ''
        const payload = payloadOfDataUrl(result)
        if (payload === undefined) return
        viewStore.addAttachment(parentKey, {
          mediaType: payload.mediaType,
          data: payload.data,
          ...(file.name === '' ? {} : { name: file.name }),
        })
      }
      reader.onerror = () => { /* unreadable clipboard file — ignore */ }
      reader.readAsDataURL(file)
    }
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
          <select
            className={css.modelSelect}
            value={state.model ?? 'deepseek-v4-flash'}
            disabled={!interactive}
            aria-label={t('drawer.model')}
            title={t('drawer.modelNextTurn')}
            onChange={event => {
              void controller.setModel(event.target.value as BtwModel)
            }}
          >
            <option value="deepseek-v4-flash">deepseek-v4-flash</option>
            <option value="glm-5.3">glm-5.3</option>
            <option value="deepseek-v4-pro">deepseek-v4-pro</option>
          </select>
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
        {running && (
          <div className={css.runningBanner} role="status" aria-live="polite">
            <span className={css.runningBannerText}>
              {state.currentAction?.kind === 'tool'
                ? `${t('drawer.bannerOutputting')} · ${t('drawer.bannerCurrentAction')}: ${state.currentAction.tool}`
                : t('drawer.bannerOutputting')}
            </span>
          </div>
        )}
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
              ? (
                <>
                  <MarkdownText text={message.text} />
                  {message.tools !== undefined && message.tools.length > 0 && (
                    <div className={css.messageTools}>
                      {message.tools.map(tool => (
                        <SideChatToolRow key={tool.callId} tool={tool} t={t} />
                      ))}
                    </div>
                  )}
                </>
              )
              : <p>{message.text}</p>}
            {message.images !== undefined && message.images.length > 0 && (
              <div className={css.messageImages}>
                {message.images.map(ref => {
                  const dataUrl = imageCache.get(ref.attachmentId)
                  if (dataUrl === undefined) {
                    return <span key={ref.attachmentId} className={css.messageImagePlaceholder} aria-hidden="true" />
                  }
                  return (
                    <button
                      key={ref.attachmentId}
                      type="button"
                      className={css.messageImageButton}
                      title={ref.name ?? t('drawer.attachmentOpen')}
                      onClick={() => { setLightbox(ref) }}
                    >
                      <img src={dataUrl} alt={ref.name ?? ''} className={css.messageImage} />
                    </button>
                  )
                })}
              </div>
            )}
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
          {attachments.length > 0 && (
            <div className={css.attachmentRail} role="list" aria-label={t('drawer.attachments')}>
              {attachments.map((image, index) => (
                <div key={`${index}:${image.data.slice(0, 24)}`} className={css.attachmentThumb} role="listitem">
                  <img src={`data:${image.mediaType};base64,${image.data}`} alt={image.name ?? t('drawer.attachments')} />
                  <button
                    type="button"
                    className={css.attachmentRemove}
                    aria-label={t('drawer.attachmentRemove')}
                    title={t('drawer.attachmentRemove')}
                    onClick={() => { viewStore.removeAttachment(parentKey, index) }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className={css.attachmentCount}>{attachments.length}</span>
            </div>
          )}
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
              onPaste={onComposerPaste}
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
        open={lightbox !== null}
        onClose={() => { setLightbox(null) }}
        title={lightbox?.name ?? t('drawer.attachmentOpen')}
        closeLabel={t('drawer.endCancel')}
      >
        {lightbox !== null && imageCache.has(lightbox.attachmentId) && (
          <img
            src={imageCache.get(lightbox.attachmentId)}
            alt={lightbox.name ?? ''}
            className={css.lightboxImage}
          />
        )}
      </Modal>

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
