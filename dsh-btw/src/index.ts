import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: pulls in the `ctx.settings` Context augmentation from the
// settings service definition (runtime use stays `ctx.inject(['settings'], …)`).
import type {} from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SideChatService } from './host/side-chat-service.ts'
import { registerPromptImageTransform } from './host/prompt-transform.ts'

export const name = 'dsh-btw'

/** Settings namespace brand for the `dsh-btw` section. */
export const BTW_SETTINGS_NS = settingsNamespace('dsh-btw')

/**
 * `dsh-btw` settings namespace (P0-b settings 行为开关试点). Values hot-reload:
 * editing `~/.dsh/settings.yaml` `dsh-btw:` section republishes and the host
 * re-reads on the next call while the client re-renders via settingsScope —
 * no restart. Keys are pure behavior switches; defaults equal the pre-P0-b
 * behavior (absent section = defaults = 现状). Schema grows only-additively.
 */
export const BTW_SETTINGS_SCHEMA = z.object({
	ui: z
		.object({
			// 侧聊运行横幅（SideChatSurface running banner）。
			banner: z.boolean().default(true),
			// 头部模型选择器可见性。
			modelSelect: z.boolean().default(true),
			// 消息图片序号徽标（多图消息的左上角白底黑字序号）。
			imageBadge: z.boolean().default(true),
		})
		.default({ banner: true, modelSelect: true, imageBadge: true }),
	vision: z
		.object({
			// 图片自动转文本（vision-adam）：true = 模型不声明图片输入时自动
			// 转文本（现状）；false = 不自动转文本，模型不支持图片时拒绝发送。
			autoTransform: z.boolean().default(true),
		})
		.default({ autoTransform: true }),
}).default({ ui: { banner: true, modelSelect: true, imageBadge: true }, vision: { autoTransform: true } })

export function apply(ctx: Context): void {
	ctx.inject(['settings'], settingsCtx => {
		settingsCtx.settings.register(BTW_SETTINGS_NS, BTW_SETTINGS_SCHEMA)
	})
	ctx.plugin(SideChatService)
	registerPromptImageTransform(ctx)
}

export { SideChatService, buildProgressDigest, completedTurnSeed } from './host/side-chat-service.ts'
export { BtwRegistry, btwHome, btwIndexPath } from './host/btw-registry.ts'
export { isSideChatToolAllowed, READ_ONLY_TOOL_CANDIDATES, READ_ONLY_TOOL_SET } from './shared/tool-policy.ts'
export type * from './shared/remote.ts'
