import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  Button, IconCloseOutline16, IconSendOutline16, IconStopFill16, MarkdownText, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BtwModel, BtwPendingQuestion, SideChatImageRef } from '../shared/remote.ts'
import type { SideChatController } from './controller.ts'
import { NS } from './locales.ts'
import { SideChatSign } from './SideChatSign.tsx'
import { SideChatToolRow } from './SideChatToolRow.tsx'
import type { SideChatDraftImage, SideChatPresentationMode, SideChatViewStore } from './view-store.ts'
import type { BtwSettingsSection, SettingsScope } from './btw-settings.ts'
import { BTW_DEFAULT_MODEL, BTW_FALLBACK_MODEL_OPTIONS, useBtwSettings } from './btw-settings.ts'
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
  /** P0-b: bound `dsh-btw` settings scope; undefined keeps the defaults. */
  settingsScope?: SettingsScope<BtwSettingsSection> | undefined
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

/**
 * Self-drawn image preview (2026-09-14 btw-ui). The official ImageLightbox is
 * not exported from dsh-client-ui-attachment and the primitives Modal dialog
 * is width-capped (380px), which read as "clicking a thumbnail does not
 * enlarge" — so the preview is a body-portal overlay following the official
 * ImageLightbox interaction: full mask (click to close), Escape to close,
 * close button, focus returns to the opener, large image.
 */
function ImageLightbox({
  image,
  dataUrl,
  dialogLabel,
  closeLabel,
  onClose,
}: {
  image: SideChatImageRef
  dataUrl: string | undefined
  dialogLabel: string
  closeLabel: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // stopPropagation keeps the drawer-level Escape handler (window,
      // SideChatDrawer minimizes on Escape) from closing the whole panel
      // while the preview is open.
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  return createPortal(
    <div className={css.lightboxRoot} role="presentation">
      <div className={css.lightboxMask} aria-hidden="true" onClick={onClose} />
      <div className={css.lightboxDialog} role="dialog" aria-modal="true" aria-label={dialogLabel}>
        <button type="button" className={css.lightboxClose} aria-label={closeLabel} title={closeLabel} onClick={onClose}>
          <IconCloseOutline16 />
        </button>
        {dataUrl === undefined
          ? <span className={css.lightboxPlaceholder} aria-hidden="true" />
          : <img src={dataUrl} alt={image.name ?? ''} className={css.lightboxImage} />}
      </div>
    </div>,
    document.body,
  )
}

export function SideChatSurface({
  controller,
  parentSessionId,
  viewStore,
  t,
  surfaceMode,
  settingsScope,
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
  // P0-b: reactive settings (banner / modelSelect / imageBadge switches);
  // a missing scope keeps BTW_SETTINGS_DEFAULTS = current behavior.
  const settings = useBtwSettings(settingsScope)
  const draft = view.draft
  const sendError = view.sendError
  const attachments = view.attachments
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  /** attachmentId → data URL of the fetched bytes (U-F/U-L rendering cache). */
  const [imageCache, setImageCache] = useState<ReadonlyMap<string, string>>(new Map())
  const [lightbox, setLightbox] = useState<SideChatImageRef | null>(null)
  /** Thumbnail button that opened the preview; focus returns here on close
      (2026-09-14 btw-ui, official ImageLightbox focus-restore pattern). */
  const lightboxOpenerRef = useRef<HTMLElement | null>(null)
  /** attachmentId → 'loading' while a fetch is in flight; 'failed' after a
      failed attempt so the next effect run retries once the conversation is
      ready (2026-09-14 btw-ui: fixes thumbnails stuck as non-interactive
      placeholders when a read was issued before the conversation was open). */
  const fetchStateRef = useRef<Map<string, 'loading' | 'failed'>>(new Map())
  const disposedRef = useRef(false)
  useEffect(() => {
    return () => { disposedRef.current = true }
  }, [])
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
        if (fetchStateRef.current.get(ref.attachmentId) === 'loading') continue
        pending.set(ref.attachmentId, ref)
      }
    }
    if (pending.size === 0) return
    // 2026-09-14 btw-ui: no cleanup-cancel — previously every cache/message
    // identity change cancelled in-flight reads (and reads issued before the
    // conversation was open failed forever), leaving placeholders that were
    // not clickable. Reads now settle into the cache; failures retry on the
    // next effect run (e.g. once phase turns open or the next poll arrives).
    for (const ref of pending.values()) {
      fetchStateRef.current.set(ref.attachmentId, 'loading')
      void controller.readImage(ref.attachmentId).then(result => {
        if (disposedRef.current) return
        if (result.ok) {
          fetchStateRef.current.delete(ref.attachmentId)
          setImageCache(previous => {
            const next = new Map(previous)
            next.set(ref.attachmentId, `data:${result.mediaType};base64,${result.data}`)
            return next
          })
        } else {
          fetchStateRef.current.set(ref.attachmentId, 'failed')
        }
      }).catch(() => {
        if (disposedRef.current) return
        fetchStateRef.current.set(ref.attachmentId, 'failed')
      })
    }
  }, [controller, imageCache, messages, state.phase, state.chatToken])

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
  // 2026-09-14 btw-ui: closing the image preview also restores focus to the
  // thumbnail that opened it (official ImageLightbox focus-restore pattern).
  const closeLightbox = useCallback((): void => {
    setLightbox(null)
    lightboxOpenerRef.current?.focus()
  }, [])
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
          {settings.ui?.modelSelect !== false && (
            <select
              className={css.modelSelect}
              value={state.model ?? settings.model?.default ?? BTW_DEFAULT_MODEL}
              disabled={!interactive}
              aria-label={t('drawer.model')}
              title={t('drawer.modelNextTurn')}
              onChange={event => {
                void controller.setModel(event.target.value as BtwModel)
              }}
            >
              {(settings.model?.options ?? BTW_FALLBACK_MODEL_OPTIONS).map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          )}
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
        {running && settings.ui?.banner !== false && (
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
        {messages.map(message => {
          const images = message.images ?? []
          return (
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
            {images.length > 0 && (
              <div className={css.messageImages}>
                {images.map((ref, index) => {
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
                      onClick={event => {
                        // 2026-09-14 btw-ui: remember the opener so the
                        // preview restores focus here when it closes.
                        lightboxOpenerRef.current = event.currentTarget
                        setLightbox(ref)
                      }}
                    >
                      {/* 2026-09-14 btw-ui: sequence badge (top-left, white
                          pill, black digits); only for multi-image messages
                          to avoid single-thumbnail noise. */}
                      {images.length > 1 && settings.ui?.imageBadge !== false && (
                        <span className={css.messageImageBadge} aria-hidden="true">{index + 1}</span>
                      )}
                      <img src={dataUrl} alt={ref.name ?? ''} className={css.messageImage} />
                    </button>
                  )
                })}
              </div>
            )}
          </article>
          )
        })}
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

      {/* 2026-09-14 btw-ui: self-drawn lightbox aligned with the official
          ImageLightbox interaction (mask + Escape + close + large image);
          replaces the width-capped primitives Modal whose 380px dialog read
          as "clicking a thumbnail does not enlarge". */}
      {lightbox !== null && (
        <ImageLightbox
          image={lightbox}
          dataUrl={imageCache.get(lightbox.attachmentId)}
          dialogLabel={lightbox.name ?? t('drawer.attachmentOpen')}
          closeLabel={t('drawer.lightboxClose')}
          onClose={closeLightbox}
        />
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
