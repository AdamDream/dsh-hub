import type { Context } from '@deepseek-ai/cordis'
import { SideChatService } from './host/side-chat-service.ts'
import { registerPromptImageTransform } from './host/prompt-transform.ts'

export const name = 'dsh-btw'

export function apply(ctx: Context): void {
  ctx.plugin(SideChatService)
  registerPromptImageTransform(ctx)
}

export { SideChatService, buildProgressDigest, completedTurnSeed } from './host/side-chat-service.ts'
export { BtwRegistry, btwHome, btwIndexPath } from './host/btw-registry.ts'
export { isSideChatToolAllowed, READ_ONLY_TOOL_CANDIDATES, READ_ONLY_TOOL_SET } from './shared/tool-policy.ts'
export type * from './shared/remote.ts'
