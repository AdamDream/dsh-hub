// @local/dsh-remote-hosts —— WP6 方案 1 客户端插件【代码草案，未安装、未注册进任何组合树】
//
// 目标（D18）：把 0.1.1 的侧栏「分布式节点」树（旧席位 sidebar.workspaces.remoteHosts，
// 已被官方 ui-workspace 在 0.1.7 起删除）用 0.2.0 的**右栏停靠面**
//（@deepseek-ai/dsh-client-ui-sidebar-right）重新实现为一个 tab 类型。
//
// 载入形态与 @local/dsh-ssh-gui/lib/client.js 逐字同构（window.__ModuleLoader__.load
// + factory(require) + exports.apply/inject），因为它已是本机验证过的 @local 插件形态。
//
// 与旧实现的关键差别（数据面，见 WP6-REPORT.md §C）：
//   - ssh-gui 的 CH_DWS = "/dsw" 在 dsh-workspace-enhancement 0.2.2 上已不存在
//     （0.1.2 是 ctx.connection.rpc.handle('/dsw',…)；0.2.2 改成 /api + 命名空间 dsw 的
//       exact Fetch 路由）。本插件按 0.2.2 的真实 wire 身份取 /api + `dsw/<endpoint>`。
//   - 节点表仍走 ssh-gui 自己的 loopback 通道 /ssh-gui（rpc.handle 仍被 profile patch
//     的 `- id: connection / inject: [webRuntime, webServer]` 修好）。

window.__ModuleLoader__.load({
	id: "@local/dsh-remote-hosts",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const h = react.createElement;

		/** tab 类型 id。同时是 `sidebar.right.pane.tab` 的注册 key（契约要求 §B）。 */
		const ID = "@local/dsh-remote-hosts";
		/** 页类型 kind：`ctx.sidebarRight.openTab(kind)` / guide 入口胶囊用它开页。 */
		const KIND = "remote-hosts";
		/** ssh-gui 私有 loopback 通道（0.2.0 上仍被 rpc.handle 挂载）。 */
		const CH_SSH = "/ssh-gui";
		/** dsh-workspace-enhancement 0.2.2 的共享通道（web-channel.js:26 API_CHANNEL）。 */
		const CH_DWS = "/api";
		/** /api 通道下的命名空间（web-channel.js:28 CHANNEL_NAMESPACE）。 */
		const DWS_NS = "dsw";
		/** wire endpoint 拼法（web-channel.js:30-32 channelEndpointOf）。 */
		const dws = (endpoint) => `${DWS_NS}/${endpoint}`;
		const NS = "remoteHosts";

		//#region 文案（locale key-set 以 zh 为准，与官方 sidebarRight 命名空间并列注册自己的 NS）
		const zh = {
			"type.label": "分布式节点",
			"guide.title": "分布式节点",
			"guide.description": "查看/切换远程主机与串口节点",
			"state.loading": "正在读取节点表…",
			"state.empty": "暂无节点——在设置页「分布式控制 · dsh-ssh-gui」添加",
			"state.error": "读取失败：{message}",
			"node.count": "{count} 个节点",
			"node.ssh": "SSH 主机",
			"node.serial": "本地串口",
			"node.serialTcp": "TCP 串口服务器",
			"action.test": "测试",
			"action.setCurrent": "设为当前",
			"rpc.unavailable": "连接通道不可用",
		};
		const en = {
			"type.label": "Distributed nodes",
			"guide.title": "Distributed nodes",
			"guide.description": "Browse and switch remote hosts and serial nodes",
			"state.loading": "Reading the node table…",
			"state.empty": "No nodes yet — add one in Settings › Distributed control · dsh-ssh-gui",
			"state.error": "Read failed: {message}",
			"node.count": "{count} node(s)",
			"node.ssh": "SSH host",
			"node.serial": "Local serial",
			"node.serialTcp": "TCP serial server",
			"action.test": "Test",
			"action.setCurrent": "Set current",
			"rpc.unavailable": "Connection transport unavailable",
		};
		//#endregion

		//#region 纯函数（可离线单测；harness 直接断言）
		/** 三类 transport 的显示名。未知 transport 原样返回，不吞信息。 */
		function transportLabel(transport) {
			if (transport === "ssh://") return "node.ssh";
			if (transport === "serial://") return "node.serial";
			if (transport === "serial-tcp://") return "node.serialTcp";
			return String(transport);
		}
		/**
		 * 把 `nodes.list` 的返回整形为 UI 用的最小记录。
		 * 只保留渲染需要的字段；**绝不**拷贝 password/keyRef 等秘密字段
		 * （ssh-gui core.js:849 的契约是「ssh target 只含引用/地址，绝无秘密」，
		 * 这里在客户端再加一道白名单）。
		 */
		function normalizeNodes(value) {
			const list = value && Array.isArray(value.nodes) ? value.nodes : [];
			return list
				.filter((node) => node && typeof node === "object" && typeof node.id === "string")
				.map((node) => ({
					id: node.id,
					name: typeof node.name === "string" && node.name !== "" ? node.name : node.id,
					transport: typeof node.transport === "string" ? node.transport : "",
					isCurrent: node.current === true,
				}));
		}
		/** 一行摘要：`<n> 个节点`，只看 id 去重后的条数。 */
		function nodeSummary(nodes) {
			return { count: Array.isArray(nodes) ? nodes.length : 0 };
		}
		//#endregion

		//#region RPC 垫片（与 ssh-gui 同一写法：连接服务可能尚未就绪）
		function makeRpc(ctx) {
			return (channel, endpoint, payload, signal) => {
				const connection = ctx.get ? ctx.get("connection") : ctx.connection;
				if (!connection || !connection.rpc || typeof connection.rpc.call !== "function") {
					return Promise.resolve({ ok: false, error: { code: "internal", message: "connection transport unavailable" } });
				}
				return connection.rpc.call(channel, endpoint, payload ?? {}, signal);
			};
		}
		function unwrap(result, fallback) {
			if (result && result.ok === true) return result.value;
			const message = result && result.error && result.error.message ? result.error.message : fallback;
			throw new Error(message);
		}
		//#endregion

		//#region tab 正文 / 标题
		/**
		 * tab 正文。框架通过 slot 工厂注入 `useTabInfo`（slots.d.ts:198-202
		 * SidebarRightTabInjected），拿到 `{sidebar, panel, tab}`。
		 */
		function RemoteHostsBody({ useTabInfo, rpc }) {
			const { tab } = useTabInfo();
			const [state, setState] = react.useState({ status: "loading", nodes: [], error: "" });
			react.useEffect(() => {
				const signal = tab.signal;
				setState({ status: "loading", nodes: [], error: "" });
				// 端点与旧侧栏树同源：nodes.list（节点表）+ config.get（执行安全开关）。
				rpc(CH_SSH, "nodes.list", {}, signal)
					.then((value) => unwrap(value, "nodes.list failed"))
					.then((value) => {
						if (signal.aborted) return;
						setState({ status: "ready", nodes: normalizeNodes(value), error: "" });
					})
					.catch((cause) => {
						if (signal.aborted) return;
						setState({ status: "error", nodes: [], error: cause instanceof Error ? cause.message : String(cause) });
					});
			}, [tab.navigation.revision]);
			const summary = nodeSummary(state.nodes);
			return h("div", { className: "rh_root", "data-remote-hosts": true },
				h("div", { className: "rh_head" },
					h("span", { className: "rh_title" }, "分布式节点"),
					h("span", { className: "rh_meta" }, state.status === "ready" ? String(summary.count) : "")),
				state.status === "loading" ? h("div", { className: "rh_note" }, "正在读取节点表…") : null,
				state.status === "error" ? h("div", { className: "rh_error" }, state.error) : null,
				state.status === "ready" && summary.count === 0
					? h("div", { className: "rh_note" }, "暂无节点——在设置页「分布式控制 · dsh-ssh-gui」添加")
					: null,
				state.nodes.map((node) => h("div", { key: node.id, className: "rh_row", "data-transport": node.transport },
					h("span", { className: "rh_name", title: node.id }, node.name),
					h("span", { className: "rh_meta" }, node.transport),
					node.isCurrent ? h("span", { className: "rh_badge" }, "当前") : null)));
		}

		/** chip / 浮窗标题。无 live 标题需求时其实可以不注册（slots.d.ts:59-72）。 */
		function RemoteHostsTitle({ useTabInfo }) {
			const { tab } = useTabInfo();
			return h(react.Fragment, null, "🖧 ", tab.title);
		}
		//#endregion

		//#region 类型定义（sidebarRightTabs.register 的入参形状）
		/**
		 * 契约（README.zh.md:83）：`{ id, kind, patterns?, priority?, canOpen?, title,
		 * guide?, keepMounted? }`，一份**没有运行时钩子的静态声明**。
		 * 这里是「页」类型（按 kind 打开），故不给 `patterns`。
		 * `priority: "extension"` 是产品外类型的最高档，也是默认档。
		 */
		function definition(t) {
			return {
				id: ID,
				kind: KIND,
				priority: "extension",
				title: () => t("type.label"),
				guide: [{
					id: "remote-hosts",
					order: 30,
					title: () => t("guide.title"),
					description: () => t("guide.description"),
				}],
			};
		}
		//#endregion

		const inject = ["slots", "connection", "locale"];

		function apply(ctx) {
			const rpc = makeRpc(ctx);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "remote-hosts: dictionaries");
			const t = ctx.locale.bind(NS);
			// 1) 类型：静态声明，与插件同生共死。
			ctx.effect(() => ctx.sidebarRightTabs.register(definition(t)), "remote-hosts: tab type");
			// 2) 正文：keyed 槽，key = 类型的 id（不是 kind）。
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: ID,
				locale: NS,
				inject: () => ({ rpc }),
			}, RemoteHostsBody)), "remote-hosts: tab body");
			// 3) 标题：可选席位。
			ctx.effect(() => ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
				name: "sidebar.right.pane.tab.title",
				key: ID,
				locale: NS,
			}, RemoteHostsTitle)), "remote-hosts: tab title");
		}

		exports.apply = apply;
		exports.inject = inject;
		// 供离线 harness / 单测使用（官方包不导出内部件；这里是 @local 草案，导出只为验证）
		exports.__internals = { ID, KIND, CH_SSH, CH_DWS, DWS_NS, dws, transportLabel, normalizeNodes, nodeSummary, definition };
		return module.exports;
	},
});
