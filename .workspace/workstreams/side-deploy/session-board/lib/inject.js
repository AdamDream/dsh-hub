/**
 * dsh-session-board · lib/inject.js
 *
 * 注入模块：Channel B（runtime-context 快照，默认）+ Channel A（pre-step 字面每轮追加，可选降级）
 * + 同步板渲染入口 `renderBoardFor`（注入侧唯一入口）。
 *
 * 设计依据：CONTRACT.md §1.5；PROPOSAL.md §3.2 / §7.4。
 * 错误约定：注入路径任何失败返回 ""（CONTRACT §6.1）；本模块不做落盘/镜像写、不做捕获、不做工具注册。
 */

import { createUserMessage } from "@deepseek-ai/dsh-llm"; // F22: dsh-llm/lib/index.js:176-181，仅 Channel A 用
import { activePeers, renderBoard, truncateBoard, PREFIX_RESERVE } from "./board.js"; // 跨模块仅经契约接口（CONTRACT §8-3）

/**
 * @typedef {string} GroupKey    // repo 级归一路径（CONTRACT §2）
 */

/**
 * @typedef {Object} PeerStatus  // 结构即契约，见 CONTRACT §2（不跨模块 import 类型）
 * @property {1} schemaVersion
 * @property {string} sessionId
 * @property {string} label
 * @property {string} cwd
 * @property {GroupKey} groupKey
 * @property {boolean} isSubagent
 * @property {number} publishedAt
 * @property {number} lastActivityAt
 * @property {number} turn
 * @property {("completed"|"max-tokens"|"aborted"|"error"|"blocked")|undefined} lastTurnReason
 * @property {{objective: string, phase: string, roundsStarted: number}|null} goal
 * @property {{pending: number, inProgress: number, completed: number, items: string[]}|null} todos
 * @property {string[]} recentFiles
 * @property {string} recentAssistantTail
 */

/**
 * @typedef {Object} Config   // 形状见 CONTRACT §4（全部运行时读取一律经 current()，禁止缓存字段）
 * @property {boolean} enabled
 * @property {number} maxBoardTokens          // → maxBoardBytes = ×3 − PREFIX_RESERVE（§4）
 * @property {"runtime-context"|"pre-step"} injection
 * @property {number} activeWindowMinutes     // → activeWindowMs = ×60×1000（§5）
 * @property {number} refreshIntervalSeconds
 * @property {number} queryLimit
 * @property {number} queryDetailBytes
 * @property {number} queryTotalBytes
 * @property {number} maxPeerEntries
 */

/**
 * 创建注入器工厂（每-apply 一份）。
 * @param {{
 *   ctx: object,                                // 插件 ctx（ctx.inject / ctx.on）
 *   current: () => Config,                      // 动态配置读取（CONTRACT §4 current() 约定）
 *   groupKeySync: (sessionId: string) => (GroupKey | undefined),
 *   mirrorRead: (groupKey: GroupKey) => Record<string, PeerStatus>
 * }} deps
 * @returns {{ renderBoardFor: Function, register: Function }}
 */
export function createInjector(deps) {
	const { ctx, current, groupKeySync, mirrorRead } = deps;

	/** Channel A per-turn 幂等记录：sessionId -> 已注入的 turn（V5；CONTRACT §1.5，M3） @type {Map<string, number>} */
	const injectedTurn = new Map();

	/**
	 * 同步渲染某 agent 的板（注入侧唯一入口，永不 throw，任何失败返回 ""）。
	 * 步骤严格按 CONTRACT §1.5 / §9.2：enabled → groupKeySync → mirrorRead → activePeers → render+truncate。
	 * @param {{ session: { id: string } }} agent
	 * @returns {string} 空板（enabled=false / groupKey 未解析 / 无活跃 peer）返回 ""
	 */
	function renderBoardFor(agent) {
		try {
			if (!current().enabled) return ""; // §4：enabled 动态读取
			const gk = groupKeySync(agent.session.id); // grouping.js：只读 resolved，绝不同步触发异步解析（A3）
			if (gk === undefined) return "";
			const peers = activePeers(
				Object.values(mirrorRead(gk)),
				agent.session.id,
				current().activeWindowMinutes * 60 * 1000 // §5：activeWindowMs 运行时派生
			); // board.js：过滤 active + 排除自己 + 降序
			if (peers.length === 0) return "";
			return truncateBoard(
				renderBoard(peers, gk), // board.js：空板/渲染失败均由下方 catch 兜底为 ""
				current().maxBoardTokens * 3 - PREFIX_RESERVE // M1 预算公式：500×3−128=1372B（§5）
			);
		} catch {
			return ""; // §6.1：注入路径永不 throw、永不落到进程顶层
		}
	}

	/**
	 * 在 ctx 上注册 Channel B 与 Channel A，两者常驻、按 current().injection 二选一（CONTRACT §1.5）。
	 * @returns {void}
	 */
	function register() {
		// —— Channel B（默认 injection="runtime-context"，M2/§3.2）：板注入仅依赖 systemPrompt，
		//    不与 sessionProjections 组合（cordis inject all-or-nothing：cordis/lib/index.js:1098, 1316-1328）。
		ctx.inject(["systemPrompt"], (pctx) => {
			pctx.systemPrompt.context({
				name: "session-board:peers",
				order: 200,
				// text 同步求值（F7: dsh-system-prompt/lib/index.js:196-199, 276-279）；返回 "" 被
				// renderContextSections 过滤（F8: 84-88, 98-102），零字节注入；retained 去重见 F9
				// （dsh-agent-loop/lib/index.js:26-83，去重 66，source 自动 kind:"plugin" 72-80）。
				text: ({ agent }) => (current().injection === "runtime-context" ? renderBoardFor(agent) : "")
			});
		}); // ctx.inject：cordis/lib/index.js:1599-1605（F19）

		// —— Channel A（injection="pre-step"，字面每轮追加，M3/§7.4）：waterfall 后置 sourced UserMessage。
		ctx.on("agent/pre-step", async ({ agent, turn, signal }, next) => {
			if (current().injection !== "pre-step") return next(); // 非 pre-step 模式：原样续接，零干预
			const decision = await next(); // waterfall 默认续接 {kind:"enter", messages:[...]}（F10: dsh-agent-loop/lib/index.js:501-508）
			if (decision.kind === "reject") return decision; // reject 直通，不注入
			const board = renderBoardFor(agent); // 永不 throw；空板不追加（§6.1）
			if (board === "") return decision;
			if (injectedTurn.get(agent.session.id) === turn) return decision; // V5 per-turn 幂等：turn 变更才 append
			injectedTurn.set(agent.session.id, turn);
			const message = createUserMessage({
				// F22: dsh-llm/lib/index.js:176-181（role 固定 "user"）
				content: [{ type: "text", text: board }],
				// source.kind:"plugin" 满足防递归过滤（F27: dsh-session-reference/lib/index.js:42-47），
				// 也不会被 recentAssistantTail 误采（PROPOSAL §3.3：user/message 进不了助手尾采集）
				source: { kind: "plugin", plugin: "dsh-session-board", form: "peer-board" }
			});
			return { kind: "enter", messages: [...decision.messages, message] }; // {prepend:true} 范式（F26: dsh-session-reference/lib/index.js:359-366）
		}, { prepend: true }); // ctx.on(name, listener, options)：cordis/lib/index.js:371-380（F20）
	}

	return { renderBoardFor, register };
}
