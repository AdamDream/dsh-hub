import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  createPromptImageTransformHandler,
  type PromptImageAnalyzer,
} from '../src/host/prompt-transform.ts'
import {
  modelAcceptsImage,
  resolveAgentRoute,
  wrapImageDescriptions,
} from '../src/host/vision.ts'

/**
 * 能力检测（2026-09-16 改造）：目标模型声明 input modalities 含 'image' 则原图
 * 直传（主会话 waterfall 返回 undefined 不拦截；侧聊内容块直发）；否则走
 * vision-adam 转文本 + R1-9 包装。检测基准 = 模型声明（LLM 注册表
 * `resolveModelInfo().inputModalities`），不是运行时探测；任何无法解析的
 * 声明都保守回退 vision-adam。
 */

/** A fake ctx exposing the services btw reads through `ctx.get`. */
function fakeCtx(options: { llm?: unknown; agentDefaultModel?: unknown } = {}): Context {
  const services = new Map<string, unknown>()
  if (options.llm !== undefined) services.set('llm', options.llm)
  if (options.agentDefaultModel !== undefined) services.set('agentDefaultModel', options.agentDefaultModel)
  return {
    get: (name: string) => services.get(name),
  } as unknown as Context
}

function llmWith(inputModalities: readonly string[] | undefined, failure?: Error) {
  return {
    resolveModelInfo: vi.fn(failure === undefined
      ? async () => ({ inputModalities })
      : async () => { throw failure }),
  }
}

function agentWithHeader(provider: string, model: string) {
  return {
    session: {
      requestHeader: () => ({ config: { provider, model } }),
    },
  }
}

describe('resolveAgentRoute (能力检测 — 目标模型解析)', () => {
  it('reads the logged request-header config first', () => {
    const route = resolveAgentRoute(fakeCtx(), agentWithHeader('adam', 'deepseek-v4-flash'))
    expect(route).toEqual({ provider: 'adam', model: 'deepseek-v4-flash' })
  })

  it('falls back to the agentDefaultModel selection when no header is logged', () => {
    const ctx = fakeCtx({ agentDefaultModel: { currentSelection: () => ({ provider: 'adam', model: 'glm-5.3' }) } })
    const route = resolveAgentRoute(ctx, { session: {} })
    expect(route).toEqual({ provider: 'adam', model: 'glm-5.3' })
  })

  it('returns undefined when neither tier resolves (保守：调用方走 vision-adam)', () => {
    expect(resolveAgentRoute(fakeCtx(), {})).toBeUndefined()
    expect(resolveAgentRoute(fakeCtx(), { session: { requestHeader: () => undefined } })).toBeUndefined()
    expect(resolveAgentRoute(fakeCtx({ agentDefaultModel: { currentSelection: () => undefined } }), {})).toBeUndefined()
    expect(resolveAgentRoute(fakeCtx(), agentWithHeader('', 'model'))).toBeUndefined()
    expect(resolveAgentRoute(fakeCtx(), agentWithHeader('provider', ''))).toBeUndefined()
  })
})

describe('modelAcceptsImage (能力检测 — 声明判断)', () => {
  it('accepts a model whose declared input includes image', async () => {
    const llm = llmWith(['text', 'image'])
    await expect(modelAcceptsImage(fakeCtx({ llm }), { provider: 'adam', model: 'm' })).resolves.toBe(true)
    expect(llm.resolveModelInfo).toHaveBeenCalledWith('adam', 'm', undefined)
  })

  it('rejects a text-only declaration', async () => {
    await expect(modelAcceptsImage(fakeCtx({ llm: llmWith(['text']) }), { provider: 'adam', model: 'm' })).resolves.toBe(false)
  })

  it('rejects a missing modality list (保守：无法解析的声明回退 vision-adam)', async () => {
    await expect(modelAcceptsImage(fakeCtx({ llm: llmWith(undefined) }), { provider: 'adam', model: 'm' })).resolves.toBe(false)
  })

  it('rejects a failed registry lookup (保守回退)', async () => {
    await expect(modelAcceptsImage(fakeCtx({ llm: llmWith(undefined, new Error('unknown model')) }), { provider: 'adam', model: 'm' })).resolves.toBe(false)
  })

  it('rejects when the llm registry is absent (保守回退)', async () => {
    await expect(modelAcceptsImage(fakeCtx(), { provider: 'adam', model: 'm' })).resolves.toBe(false)
  })
})

describe('session/prompt-image-transform 能力检测分支', () => {
  const content = [
    { type: 'image' as const, mediaType: 'image/png', data: 'aGVsbG8=' },
    { type: 'text' as const, text: '看看这个' },
  ]

  it('返回 undefined 不拦截（原图直传）when the decision says the model accepts image', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => ['不应被调用'])
    const handler = createPromptImageTransformHandler(
      {} as unknown as Context,
      analyze,
      async () => true,
    )

    const result = await handler({ agent: {}, content }, async () => undefined)

    expect(result).toBeUndefined()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('走 vision-adam 转文本 when the decision says text-only', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => ['第一张'])
    const handler = createPromptImageTransformHandler(
      {} as unknown as Context,
      analyze,
      async () => false,
    )

    const result = await handler({ agent: {}, content }, async () => undefined)

    expect(result).toEqual([{ type: 'text', text: wrapImageDescriptions(['第一张'], '看看这个') }])
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('默认决策：声明支持 image 的模型 → 直传（不分析）', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => ['不应被调用'])
    const ctx = fakeCtx({ llm: llmWith(['text', 'image']) })
    const handler = createPromptImageTransformHandler(ctx, analyze)

    const result = await handler({ agent: agentWithHeader('adam', 'deepseek-v4-flash'), content }, async () => undefined)

    expect(result).toBeUndefined()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('默认决策：声明无法解析 → 保守回退 vision-adam（文本包装，不直传）', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => ['保守描述'])
    const ctx = fakeCtx({ llm: llmWith(undefined, new Error('no such model in registry')) })
    const handler = createPromptImageTransformHandler(ctx, analyze)

    const result = await handler({ agent: agentWithHeader('adam', 'deepseek-v4-flash'), content }, async () => undefined)

    expect(result).toEqual([{ type: 'text', text: wrapImageDescriptions(['保守描述'], '看看这个') }])
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('默认决策：文本模型 → 走 vision-adam（既有行为不变）', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => ['文本模型描述'])
    const ctx = fakeCtx({ llm: llmWith(['text']) })
    const handler = createPromptImageTransformHandler(ctx, analyze)

    const result = await handler({ agent: agentWithHeader('adam', 'deepseek-v4-flash'), content }, async () => undefined)

    expect(result).toEqual([{ type: 'text', text: wrapImageDescriptions(['文本模型描述'], '看看这个') }])
  })

  it('默认决策：agent 路由不可解析 → 保守回退 vision-adam', async () => {
    const analyze: PromptImageAnalyzer = vi.fn(async () => ['无路由描述'])
    const ctx = fakeCtx({ llm: llmWith(['text', 'image']) })
    const handler = createPromptImageTransformHandler(ctx, analyze)

    const result = await handler({ agent: {}, content }, async () => undefined)

    expect(result).toEqual([{ type: 'text', text: wrapImageDescriptions(['无路由描述'], '看看这个') }])
    expect(analyze).toHaveBeenCalledTimes(1)
  })
})
