// examples/minimal-plugin/lib/index.js —— 最小 @local host 插件（以 @local/dsh-workerspace 薄插件为范本）
//
// 契约（宿主 cordis 插件必需导出）：name / inject / apply / Config（可选）。
//   - name：插件 id，用于 cordis.patch.yml 的 insert 条目；
//   - inject：本插件需要的宿主服务名（声明后 cordis 保证就绪后再 apply）；
//   - apply(ctx, config)：启动入口；卸载清理用 ctx.effect；
//   - Config：settings 命名空间的 schemastery schema（可选；不写 = 无设置项）。
//
// 若要做纯 host-only 插件（无 UI），可以不写 lib/client.js（见同目录 client.js 头部注释）。

import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { defineTool } from "@deepseek-ai/dsh-tools";

const name = "minimal-plugin";

/** 需要的宿主服务：tools（注册工具）。settings 经 installSettingsSection 内部取用。 */
const inject = ["tools"];

/** settings 命名空间（可选段）：`dsh-minimal-plugin.greeting`。改 settings.yaml 值级热载（P0-b 模式）。 */
const MINIMAL_SETTINGS_NS = settingsNamespace("dsh-minimal-plugin");

const Config = z
	.object({
		greeting: z.string().default("你好，DSH！"),
	})
	.default({});

function apply(ctx, config) {
	// settings 挂载（可选；注释掉本段 + Config 即变成最简「零配置」插件）
	let current = () => config;
	installSettingsSection(ctx, MINIMAL_SETTINGS_NS, Config, config, {
		setSource: (source) => {
			current = source;
		},
		onChange: () => {},
	});

	// 卸载清理：ctx.effect 注册的副作用随插件 dispose 反注册（cordis 生命周期）
	ctx.effect(
		() => () => {
			// 在这里关掉插件持有的句柄/会话（串口会话、定时器、子进程等）
		},
		"dsh-minimal-plugin: cleanup",
	);

	// 示例工具：模型在会话里可调用的 defineTool。
	// 命名建议带插件前缀（ws_/minimal_）避免与官方/其它插件重名（workerspace 惯例）。
	ctx.tools.register(
		defineTool({
			name: "minimal_hello",
			description: "Minimal-plugin scaffold example: returns a greeting from settings.",
			parameters: {
				name: {
					type: "string",
					description: "Optional name to greet.",
				},
			},
			output: {
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						message: { type: "string", required: true },
						greetingFromSettings: { type: "string", required: true },
					},
				},
				render: (_args, value) => [{ type: "text", text: value.message }],
			},
			isConcurrencySafe: () => true,
			async execute(args) {
				const who = (args.name ?? "").trim() || "world";
				const greeting = current().greeting;
				return { message: `${greeting} Hello, ${who}!`, greetingFromSettings: greeting };
			},
		}),
	);
}

export { Config, MINIMAL_SETTINGS_NS, apply, inject, name };
