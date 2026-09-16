// examples/minimal-plugin/lib/client.js —— 最小客户端骨架（**可选**）
//
// 注意：纯 host-only 插件（如 @local/dsh-workerspace）**不需要 client.js** 即可工作——
// 只有需要 UI（settings 页条目、会话头部按钮、侧栏条目等）时才写客户端。
// 若启用本文件，还需在 package.json 加 dsh.client 声明（见 examples/minimal-plugin/README.md §4），
// 且 client 模块 id 必须 == 包名（master-runbook §1 事故 #6：id!=包名会导致注册扫描不匹配）。
//
// 手写 bundle 惯例（@local/dsh-usage、@local/dsh-ssh-gui 先例）：
//   __ModuleLoader__.load({ id, factory }) 自注册；platform 种子词 react / react/jsx-runtime 可用。

__ModuleLoader__.load({
	id: "@local/dsh-minimal-plugin", // 必须 == package.json name
	factory(require) {
		const React = require("react");
		const { createElement: h } = React;

		return {
			// 示例：向 settings 页注册一个条目（settings.section 槽）。
			// 槽位与 id/order 惯例：vision-adam 用 id "@deepseek-ai/dsh-vision-adam"、order 60。
			// 需要把 "@deepseek-ai/dsh-client-runtime" 与 "@deepseek-ai/dsh-client-ui-settings"
			// 加入 package.json 的 dsh.client.inject 后，这里才能拿到 slots / settingsScope。
			apply(ctx) {
				const slots = ctx.get("slots", false);
				if (slots === undefined) return; // 无 UI 槽环境（host-only 场景）优雅降级
				slots.inject("settings.section", () =>
					slots.register({
						name: "minimal-plugin",
						id: "@local/dsh-minimal-plugin",
						order: 90,
						label: () => "minimal-plugin 示例设置",
						inject: () => ({}),
						component: () =>
							h("div", { style: { padding: "12px" } }, "这是 minimal-plugin 脚手架的 settings 条目占位。"),
					}),
				);
			},
		};
	},
});
