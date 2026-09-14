/**
 * Ambient types for the deployed `@deepseek-ai/dsh-vision-adam` plugin copy.
 *
 * The package is not installed in this workspace (and cannot be — pnpm is
 * unavailable here), so tsc resolves these declarations instead. The runtime
 * module lives under `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam`
 * and is reached through a lazy dynamic import in `src/host/vision.ts`, so an
 * outdated deployment copy can never break plugin loading — image analysis
 * then throws a readable upgrade error instead.
 *
 * The exact export contract is fixed by the vision-adam deployment artifact
 * (U-H): `analyzeImageBytes` / `resolveOptions` / `resolveApiKey` added on top
 * of the existing plugin exports. `options` mirrors the plugin `Config` plus
 * the two new authentication switches.
 */
declare module '@deepseek-ai/dsh-vision-adam' {
  export interface VisionAdamOptions {
    apiKeyEnv?: string
    apiKey?: string
    baseURL?: string
    model?: string
    maxTokens?: number
    maxBytes?: number
    maxVideoBytes?: number
    xApiKey?: boolean
    sessionHeader?: boolean
  }

  /** Merge one settings section into the resolved request options (defaults applied). */
  export function resolveOptions(config: unknown): VisionAdamOptions

  /** Resolve the API key through the literal setting, credentials service, or launch environment. */
  export function resolveApiKey(options: VisionAdamOptions, ctx: unknown, signal?: AbortSignal): Promise<string>

  /** One OpenAI-compatible chat-completions call carrying a single image content part; returns text. */
  export function analyzeImageBytes(
    options: VisionAdamOptions,
    apiKey: string,
    mediaType: string,
    base64: string,
    question?: string,
    signal?: AbortSignal,
  ): Promise<string>
}
