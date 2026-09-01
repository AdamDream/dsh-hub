/**
 * dsh-session-board · lib/index.js —— 装配入口（CONTRACT.md §3「index.js 装配清单」）
 *
 * 只装配，不重写任何模块逻辑（§8-1/§8-3）：分组键（grouping.js）、存储（storage.js）、
 * 渲染（board.js）、捕获（capture.js）、注入（inject.js）、工具（tool.js）均经契约接口调用。
 *
 * 装配步骤顺序（§3，不得颠倒）：
 *   0. 动态配置（settingsNamespace + installSettingsSection → current() 约定）
 *   1. 工厂装配（lastTurn 幂等表 + 六模块工厂；projections 经 ctx.get 单独取用，M2）
 *   2. 镜像初始化（ctx.agents.roots() 仅顶层，F21）
 *   3. session/event 订阅（tool/call 跟踪 + turn/end 发布，lastTurn 幂等守卫，发布失败 warn 不抛 §6-2）
 *   4. 注入注册（Channel B + Channel A 常驻，按 current().injection 二选一，§1.5 register()）
 *   5. query_peers 工具注册（F16）
 *   6. 镜像周期刷新 + agent/session-start 新会话刷新（F20/F25）
 *
 * M2 语义（§3）：板注入仅依赖 systemPrompt（inject.js 内 ctx.inject(["systemPrompt"], ...)，
 * cordis inject all-or-nothing，F19）；goal/todos 依赖的 sessionProjections 用 ctx.get（F18）
 * 在 apply 顶部取值一次、经 createCapture 传入——服务缺席时 captureStatus 内判空归 null，
 * 其余字段与板照常注入；绝不与 systemPrompt 组合 inject。
 *
 * 对 §3 骨架的两处装配级适配（不改任何模块文件）：
 * 1. `isSubagent` 从 "./capture.js" 具名导入，而非从 createCapture 返回值解构——§1.4
 *    （模块接口权威）规定工厂仅返回 { trackRecent, captureStatus }，isSubagent 是独立具名导出；
 *    §3 骨架解构了工厂未提供的键，照抄必然 undefined。
 * 2. 发布失败日志用 `ctx.logger?.warn?.(...)`：logger 在位时与骨架逐字一致；缺席时静默，
 *    与 §6-2「发布失败绝不阻塞/抛向会话主流程」同义加固（catch 内再抛会逃逸进事件派发）。
 */

import z from "@deepseek-ai/schemastery"; // F29：default export Schema（dsh-goal/dsh-tool-todo 同款 import；.step()/.min()/.default() 均在 prototype）
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"; // F17：dsh-settings/lib/index.js:618-636 / 87-90
import { createGrouping } from "./grouping.js"; // §1.1
import { createStorage, peerFile } from "./storage.js"; // §1.2（peerFile 为纯函数具名导出）
import { createCapture, isSubagent } from "./capture.js"; // §1.4（适配注记 1）
import { createInjector } from "./inject.js"; // §1.5
import { createQueryPeersTool } from "./tool.js"; // §1.6

/**
 * 插件名。照契约 §3 / PROPOSAL §9.2 用 "session-status-board"，与 install.sh / README 的
 * 挂载 id 一致（settingsNamespace 的 kebab-case 校验 ^[a-z][a-z0-9-]*$ 合法）。
 * @type {"session-status-board"}
 */
export const name = "session-status-board";

/**
 * 能力注入声明（§3/§9.2）：apply 直接使用 ctx.tools.register（步骤 5）与 ctx.agents.roots()
 * （步骤 2/6），故两者必须常驻；systemPrompt 走 ctx.inject 可选装配（M2，不进此清单）。
 * @type {string[]}
 */
export const inject = ["tools", "agents"];

/**
 * Config 最终形状（§4 逐字段照抄；默认值：maxBoardTokens=500 / activeWindowMinutes=30 /
 * queryLimit=5 / queryDetailBytes=2048 / queryTotalBytes=8192 / maxPeerEntries=8）。
 * maxBoardBytes = maxBoardTokens×3 − PREFIX_RESERVE 为注入侧运行时派生，不入 Config（§4）。
 */
export const Config = z.object({
	enabled: z.boolean().default(true),
	maxBoardTokens: z.number().step(1).min(1).default(500), // → maxBoardBytes = ×3 − 128（默认 1372）
	injection: z.union([z.const("runtime-context"), z.const("pre-step")]).default("runtime-context"),
	activeWindowMinutes: z.number().step(1).min(1).default(30), // → activeWindowMs = ×60×1000
	refreshIntervalSeconds: z.number().step(1).min(1).default(10),
	queryLimit: z.number().step(1).min(1).default(5),
	queryDetailBytes: z.number().step(1).min(1).default(2048),
	queryTotalBytes: z.number().step(1).min(1).default(8192),
	maxPeerEntries: z.number().step(1).min(1).default(8)
});

/**
 * 装配（§3 步骤 0-6 严格照此顺序）。
 * @param {object} ctx - cordis 插件上下文（inject/on/effect/get/logger/tools/agents）
 * @param {object} config - cordis 传入的组合 entry 配置（installSettingsSection 的 base 层）
 * @returns {void}
 */
export function apply(ctx, config) {
	/* 0. 动态配置读取（§4 current() 约定）：注册后 current() 返回合并后的动态配置，
	 *    运行时一切读取一律 current().<field>，禁止缓存 config 字段。 */
	let current = () => config;
	const NS = settingsNamespace("session-status-board"); // F17：kebab-case 校验通过
	installSettingsSection(ctx, NS, Config, config, {
		setSource: (thunk) => { current = thunk; }, // thunk = () => scope.get()
		onChange: () => {}
	});

	/* 1. 工厂装配（每-apply 一份；跨模块只经契约接口，§8-3） */
	const lastTurn = new Map(); // sessionId -> turn（发布幂等守卫，仅 index.js 持有，§1.4 职责边界）
	const { groupKeyFor, groupKeySync } = createGrouping(); // §1.1：异步解析缓存 + 同步读
	const { readPeerFile, upsertPeer, mirrorSet, mirrorLoad, mirrorRead } = createStorage(); // §1.2
	// M2：projections 经 ctx.get（F18）取值一次，可能 undefined（headless）；不进 inject 组合（§3）
	const projections = ctx.get("sessionProjections");
	const { trackRecent, captureStatus } = createCapture({
		projections, // 缺席 → captureStatus 内 goal/todos 归 null，其余字段照常（M2）
		maxPeerEntries: current().maxPeerEntries,
		queryDetailBytes: current().queryDetailBytes
	}); // §1.4（isSubagent 为独立具名导出，见文件头适配注记 1）
	const { register } = createInjector({ ctx, current, groupKeySync, mirrorRead }); // §1.5
	const queryPeersTool = createQueryPeersTool({ current, groupKeyFor, peerFile, readPeerFile }); // §1.6

	/* 2. 镜像初始化：ctx.agents.roots()（仅顶层，非 list()，F21） */
	for (const agent of ctx.agents.roots()) void refreshGroup(agent.session);

	/* 3. 事件订阅：session/event（F4：回调 (session, event)，事件已入 log 再派发） */
	ctx.on("session/event", (session, event) => {
		if (event.type === "tool/call") trackRecent(session, event.data); // F2：持续采 recentFiles
		if (event.type !== "turn/end") return; // F1：data={turn, reason:{kind}}
		void (async () => {
			try {
				if (!current().enabled || isSubagent(session)) return; // §10.6：发布侧排除 subagent
				if (event.data.turn <= (lastTurn.get(session.id) ?? 0)) return; // lastTurn 幂等守卫
				lastTurn.set(session.id, event.data.turn);
				const gk = await groupKeyFor(session); // 分组键解析一次（grouping.js 缓存去重）
				const st = captureStatus(session, event.data, gk); // 同步（A4：groupKey 入参）
				await upsertPeer(gk, session.id, st); // 锁内落盘（失败抛出 → 下方吞掉，§6-2）
				mirrorSet(gk, session.id, st); // 本进程自见（同步）
			} catch (e) {
				ctx.logger?.warn?.(`session-board publish failed: ${String(e)}`); // §6-2（适配注记 2）
			}
		})();
	});

	/* 4. 注入注册：Channel B + Channel A（常驻，按 current().injection 二选一，§1.5） */
	register();

	/* 5. 工具注册：query_peers（F16：ctx.tools.register(definition)） */
	ctx.tools.register(queryPeersTool);

	/* 6. 镜像周期刷新 + 新会话刷新（F20/F25） */
	ctx.effect(() => {
		const t = setInterval(refreshLiveGroups, current().refreshIntervalSeconds * 1000);
		t.unref?.();
		return () => clearInterval(t);
	});
	ctx.on("agent/session-start", ({ agent }) => { void refreshGroup(agent.session); });

	/* —— apply 内部辅助（函数声明提升，可在上面先调用；不外泄，§3） —— */

	/**
	 * 拉取某会话所在组的完整组文件并整体替换镜像（避免残留过期 peer）。
	 * 整体 try/catch：读失败保留旧镜像（本进程自见），下个周期重试；绝不 reject
	 * （timer/session-start 回调路径无发布侧 catch，防 unhandled rejection）。
	 * @param {object} session - dsh-session 实例
	 * @returns {Promise<void>}
	 */
	async function refreshGroup(session) {
		try {
			const gk = await groupKeyFor(session);
			if (gk === "no-cwd") return;
			const file = await readPeerFile(peerFile(gk));
			mirrorLoad(gk, file.peers);
		} catch { /* 读失败：保留旧镜像，下个周期重试（§3 骨架同义） */ }
	}

	/** 对全部存活顶层 agent 重刷镜像（组键缓存使重复调用去重，§1.1）。 */
	function refreshLiveGroups() {
		for (const agent of ctx.agents.roots()) void refreshGroup(agent.session);
	}
}
