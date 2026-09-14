import { useState, type ReactNode } from 'react'
import {
  DisclosureRow, IconApiOutline14, IconBrowseOutline16, IconCodeOutline16,
  IconEditOutline16, IconSearchOutline16, IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SideChatToolDigest } from '../shared/remote.ts'
import { NS } from './locales.ts'
import css from './side-chat.module.css'

export type ToolRowLocale = PropsLocale<typeof NS>['t']

/**
 * Simplified variant-leading icon by tool name (approximates the official
 * `VARIANT_ICONS` table; the full per-tool card models are out of scope).
 */
export function toolIconFor(name: string): ReactNode {
  if (name.startsWith('read')) return <IconBrowseOutline16 size={14} />
  if (name.startsWith('search')) return <IconSearchOutline16 size={14} />
  if (name.startsWith('write') || name.startsWith('edit') || name.includes('patch')) {
    return <IconEditOutline16 size={14} />
  }
  if (name === 'bash' || name.startsWith('bash') || name.startsWith('exec') || name.startsWith('run')) {
    return <IconApiOutline14 size={14} />
  }
  if (name.startsWith('code')) return <IconCodeOutline16 size={14} />
  return <IconSparkle16 size={14} />
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/**
 * Layer B ToolRow approximation: a DisclosureRow (official primitive) whose
 * collapsed line shows the tool name + one-line summary, and whose expanded
 * body shows the IN (arguments) / OUT (result) ioCard aligned with the
 * official `GenericToolCard` structure. `data-state` mirrors the official
 * running/error/ok convention (CSS sweep on `running`).
 */
export function SideChatToolRow({ tool, t }: { tool: SideChatToolDigest; t: ToolRowLocale }) {
  const [expanded, setExpanded] = useState(false)
  const state: 'running' | 'error' | 'ok' = tool.running === true
    ? 'running'
    : tool.isError === true ? 'error' : 'ok'
  const summary = state === 'running' ? t('drawer.toolRunning') : truncateText(tool.result ?? '', 160)
  return (
    <div className={css.toolRow} data-variant="generic" data-tool={tool.name} data-state={state}>
      <DisclosureRow
        rowClassName={css.toolRowRow}
        leadingClassName={css.toolRowLeading}
        titleClassName={css.toolRowTitle}
        chevronClassName={css.toolRowChevron}
        icon={toolIconFor(tool.name)}
        title={tool.name}
        open={expanded}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(previous => !previous) }}
        collapsedContent={summary !== '' && (
          <>
            <span className={css.toolRowSep} aria-hidden="true" />
            <span className={state === 'error' ? css.toolRowErrorSummary : css.toolRowSummary}>{summary}</span>
          </>
        )}
      >
        <div className={css.toolRowIoCard}>
          <div className={css.toolRowIoSection}>
            <span className={css.toolRowIoLabel}>IN</span>
            <span className={css.toolRowIoText}>{tool.args}</span>
          </div>
          {tool.result !== undefined && (
            <>
              <span className={css.toolRowIoDivider} aria-hidden="true" />
              <div className={css.toolRowIoSection}>
                <span className={css.toolRowIoLabel}>OUT</span>
                <span className={css.toolRowIoText} data-error={state === 'error' || undefined}>{tool.result}</span>
              </div>
            </>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
