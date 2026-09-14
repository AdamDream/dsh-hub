import type { Context } from '@deepseek-ai/cordis'
import type { SideChatImageMediaType } from '../shared/remote.ts'

/**
 * btw's vision bridge (U-I).
 *
 * Pasted images never reach the conversation model: before a message is
 * admitted, the host turns every image into text through the configured
 * vision-adam plugin (settings `vision-adam` section; defaults documented in
 * the upgrade plan R1-4/R1-5). This module owns that transformation — the
 * R1-9 template (`wrapImageDescriptions`) and the per-image analysis fan-out
 * (`analyzeImages`).
 *
 * The analysis itself is delegated to the deployed `@deepseek-ai/dsh-vision-adam`
 * plugin copy (single configuration source, exported helpers per the U-H
 * deployment artifact). The import is lazy so an outdated deployment copy can
 * never break plugin loading; calls then throw a readable upgrade error.
 */

/** Options the `vision-adam` settings section may carry (mirrors the plugin Config). */
export interface VisionOptions {
  readonly model?: string
  readonly baseURL?: string
  readonly apiKeyEnv?: string
  readonly apiKey?: string
  readonly maxTokens?: number
  readonly xApiKey?: boolean
  readonly sessionHeader?: boolean
}

/** One image to analyze: media type + canonical base64 payload. */
export interface VisionImageInput {
  readonly mediaType: SideChatImageMediaType
  readonly data: string
}

/** Defaults used when no `vision-adam` settings section is available (R1-4/R1-5). */
export const VISION_DEFAULTS: VisionOptions = Object.freeze({
  model: 'deepseek-v4.1-flash',
  baseURL: 'https://opencode.ai/zen/go/v1',
  apiKeyEnv: 'OPENCODE_GO_API_KEY',
  maxTokens: 2000,
})

/** Default analysis question sent with every pasted image (audit U-I). */
export const VISION_DEFAULT_QUESTION = '请用中文简洁描述这张图片的内容、主体颜色与图中文字。'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The R1-9 template: one heading, one `[图片 N]` segment per description, and
 * the user's own text when present (pure-image messages omit it and leave no
 * trailing blank line).
 */
export function wrapImageDescriptions(descriptions: readonly string[], originalText: string): string {
  const heading = `用户附带了 ${descriptions.length} 张图片，以下为各图片的描述（vision-adam 生成）：`
  const body = descriptions
    .map((description, index) => `[图片 ${index + 1}] ${description.trim()}`)
    .join('\n\n')
  const original = originalText.trim()
  const segments = [heading, body]
  if (original !== '') segments.push(`用户原文：\n${original}`)
  return segments.join('\n\n')
}

type VisionAdamModule = typeof import('@deepseek-ai/dsh-vision-adam')

async function loadVisionAdam(): Promise<VisionAdamModule> {
  const vision = await import('@deepseek-ai/dsh-vision-adam')
  if (typeof vision.analyzeImageBytes !== 'function'
    || typeof vision.resolveOptions !== 'function'
    || typeof vision.resolveApiKey !== 'function') {
    throw new Error('vision-adam 部署副本缺少 analyzeImageBytes/resolveOptions/resolveApiKey 导出，请按部署 Runbook（U-H）升级该插件')
  }
  return vision
}

/** Read the `vision-adam` settings section; any surprise degrades to the defaults. */
function readVisionConfig(ctx: Context): unknown {
  try {
    const settings = ctx.get('settings') as { get?: (namespace: string) => unknown } | undefined
    const section = settings?.get?.('vision-adam')
    if (section !== null && typeof section === 'object') return section
  } catch {
    // settings service missing or the namespace is unregistered — defaults below
  }
  return VISION_DEFAULTS
}

/**
 * Analyze every image synchronously (before the message is admitted) and
 * return one description per image, in order. Configuration comes from the
 * `vision-adam` settings section (defaults when absent); the API key is
 * resolved through the credentials chain. Any failure throws with a readable
 * vision-adam-prefixed message so callers can surface it without sending.
 */
export async function analyzeImages(
  ctx: Context,
  images: readonly VisionImageInput[],
  signal?: AbortSignal,
): Promise<string[]> {
  if (images.length === 0) return []
  const vision = await loadVisionAdam()
  const options = vision.resolveOptions(readVisionConfig(ctx))
  const apiKey = await vision.resolveApiKey(options, ctx, signal).catch((error: unknown) => {
    throw new Error(`vision-adam 凭据不可用: ${errorText(error)}`)
  })
  const descriptions: string[] = []
  for (const image of images) {
    const description = await vision.analyzeImageBytes(
      options,
      apiKey,
      image.mediaType,
      image.data,
      VISION_DEFAULT_QUESTION,
      signal,
    )
    descriptions.push(description)
  }
  return descriptions
}
