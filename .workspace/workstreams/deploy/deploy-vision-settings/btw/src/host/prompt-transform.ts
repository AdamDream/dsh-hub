import type { Context } from '@deepseek-ai/cordis'
import { sideChatImageMediaTypeSchema } from '../shared/remote.ts'
import { analyzeImages, modelAcceptsImage, resolveAgentRoute, wrapImageDescriptions, type VisionImageInput } from './vision.ts'

/**
 * Main-session image transform (U-G-1, 能力检测改造).
 *
 * The host (patched `dsh-host-apiproxy`) runs the `session/prompt-image-transform`
 * waterfall in front of its model image gate whenever a browser prompt
 * carries image parts. This handler decides per target model:
 *
 *   - the model DECLARES image input (`inputModalities` contains 'image',
 *     resolved through the LLM registry) → return `undefined` (不拦截), so the
 *     original image parts pass straight to the model — no vision-adam call,
 *     no text wrapping; the host gate then confirms the declared modality and
 *     sends the raw images;
 *   - otherwise (text-only model, or any unresolved/unknown declaration —
 *     保守回退) → every image part becomes the R1-9 text template produced by
 *     vision-adam, so the conversation model only ever receives text.
 *
 * Contract: `(payload, next)` waterfall listener. `next()` first so another
 * plugin's earlier transform wins; only `type: 'image'` parts are analyzed and
 * text parts become the template's `用户原文`. A failed analysis throws (the
 * host surfaces it as `agent-busy` + reason) and the message is never sent.
 */

/** The wire content part shape the patched host passes (host-apiproxy `PromptContentPart`). */
export interface PromptContentPart {
  readonly type: 'text' | 'image'
  readonly text?: string
  readonly mediaType?: string
  readonly data?: string
  readonly name?: string
}

export interface PromptImageTransformPayload {
  readonly agent: unknown
  readonly content: readonly PromptContentPart[]
}

export type PromptImageAnalyzer = (
  ctx: Context,
  images: readonly VisionImageInput[],
  signal?: AbortSignal,
) => Promise<string[]>

/**
 * Decide whether the target agent's model may receive raw image parts. `true`
 * = declared image input → pass through unchanged; `false` = text-only or
 * unknown → vision-adam text transform (conservative).
 */
export type PromptImageDecision = (ctx: Context, agent: unknown) => Promise<boolean>

/**
 * Default decision: resolve the agent's route (logged request header, then
 * the agent-default selection) and ask the LLM registry for its DECLARED
 * input modalities. Unknown/absent declarations are false — the caller then
 * keeps the vision-adam text path.
 */
export function defaultPromptImageDecision(ctx: Context, agent: unknown): Promise<boolean> {
  const route = resolveAgentRoute(ctx, agent)
  if (route === undefined) return Promise.resolve(false)
  return modelAcceptsImage(ctx, route)
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Waterfall fired by the patched host in front of the model image gate. */
    'session/prompt-image-transform': (
      payload: PromptImageTransformPayload,
      next: () => Promise<unknown>,
    ) => unknown
  }
}

/** Keep only wire parts whose media type the attachment/vision chain accepts. */
function toVisionInputs(parts: readonly PromptContentPart[]): VisionImageInput[] {
  const inputs: VisionImageInput[] = []
  for (const part of parts) {
    if (typeof part.mediaType !== 'string' || typeof part.data !== 'string') continue
    const mediaType = sideChatImageMediaTypeSchema.safeParse(part.mediaType)
    if (!mediaType.success) continue
    inputs.push({ mediaType: mediaType.data, data: part.data })
  }
  return inputs
}

/**
 * Build the waterfall handler. The analyzer and the direct-pass decision are
 * injectable for tests; the defaults run the vision-adam fan-out from
 * `vision.ts` and the declared-modality check.
 */
export function createPromptImageTransformHandler(
  ctx: Context,
  analyze: PromptImageAnalyzer = analyzeImages,
  passDirect: PromptImageDecision = defaultPromptImageDecision,
) {
  return async (
    payload: PromptImageTransformPayload,
    next: () => Promise<unknown>,
  ): Promise<unknown> => {
    const resolved = await next()
    const effective = (resolved === undefined ? payload.content : resolved) as readonly PromptContentPart[]
    const imageParts = effective.filter(part => part.type === 'image')
    if (imageParts.length === 0) return undefined
    const inputs = toVisionInputs(imageParts)
    if (inputs.length === 0) return undefined
    // 能力检测：目标模型声明支持 image → 不拦截，原图直传（宿主闸门随后按
    // 声明模态放行）；否则（文本模型或声明不可解析 → 保守）走 vision-adam 转文本。
    if (await passDirect(ctx, payload.agent)) return undefined
    const originalText = effective
      .filter(part => part.type === 'text')
      .map(part => (typeof part.text === 'string' ? part.text : ''))
      .join('\n')
    const descriptions = await analyze(ctx, inputs)
    return [{ type: 'text', text: wrapImageDescriptions(descriptions, originalText) }]
  }
}

/** Register the transform on the plugin context; `ctx.on` scopes it to the fiber. */
export function registerPromptImageTransform(ctx: Context): void {
  ctx.on('session/prompt-image-transform', createPromptImageTransformHandler(ctx))
}
