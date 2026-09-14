/**
 * dsh-session-board · lib/capture.js
 *
 * 状态捕获 + recentFiles 跟踪 + isSubagent（CONTRACT.md §1.4）。
 * 全部机械提取、零 LLM（PROPOSAL v2 §3.3 / §8 硬规则 5）。
 *
 * 职责边界（不做）：分组键解析（groupKey 由入参传入）、落盘/镜像（storage.js）、
 * 渲染（board.js）、发布编排与幂等（index.js 持有 lastTurn）。
 *
 * 允许 import：仅 node:path（CONTRACT §1.4）；projections 经工厂入参传入，
 * 不 import @deepseek-ai/dsh-session-projection（M2：服务可能缺席，缺席时 goal/todos 为 null）。
 */

import { basename, isAbsolute, resolve } from "node:path";

/**
 * @typedef {string} GroupKey  repo 级归一路径（CONTRACT §2）
 * @typedef {string} SessionId session.id 原样（CONTRACT §2）
 */

/**
 * @typedef {Object} PeerGoal
 * @property {string} objective   头截 ≤ queryDetailBytes（捕获层预算，PROPOSAL §5）
 * @property {"active"|"paused"|"blocked"|"complete"} phase
 * @property {number} roundsStarted
 */

/**
 * @typedef {Object} PeerTodos
 * @property {number} pending
 * @property {number} inProgress
 * @property {number} completed
 * @property {string[]} items  content，in_progress 优先，≤ maxPeerEntries 条，每条头截
 */

/**
 * @typedef {Object} PeerStatus
 * @property {1} schemaVersion
 * @property {SessionId} sessionId
 * @property {string} label
 * @property {string} cwd
 * @property {GroupKey} groupKey
 * @property {boolean} isSubagent
 * @property {number} publishedAt   epoch ms
 * @property {number} lastActivityAt epoch ms，= turn/end 时刻（活跃判定主信号）
 * @property {number} turn          仅信息性（CONTRACT §2 语义强调）
 * @property {("completed"|"max-tokens"|"aborted"|"error"|"blocked")|undefined} lastTurnReason
 * @property {PeerGoal|null} goal
 * @property {PeerTodos|null} todos
 * @property {string[]} recentFiles 绝对路径，去重，≤ maxPeerEntries
 * @property {string} recentAssistantTail 尾截 ≤ queryDetailBytes
 */

/** label 存储级头截预算（字节）；与 board.js 的 LABEL_BYTES=48 同值（CONTRACT §1.4/§5）。 */
const LABEL_BYTES = 48;

/**
 * 判定是否子代理会话（F24）。
 * 依据：@deepseek-ai/dsh-subagent/lib/index.js:536-537, 1715-1717（parentSession!=null || origin==="subagent"）；
 * header 字段定义：@deepseek-ai/dsh-session/lib/types/index.js:41-57（F6：parentSession 48-50、origin 55-57 仅 "subagent"）。
 * @param {{ header?: { origin?: "subagent", parentSession?: string } }} session
 * @returns {boolean} header.origin === "subagent" || header.parentSession != null
 */
export function isSubagent(session) {
	return (
		session?.header?.origin === "subagent" || // F6/F24：origin 仅 "subagent"
		session?.header?.parentSession != null // F24：parentSession!=null（dsh-subagent/lib/index.js:536-537）
	);
}

/**
 * 从 tool/call 参数中按白名单提取文件/目录路径（PROPOSAL §3.3 L2 修复）。
 * 白名单两档：
 * - {edit, write, read, read_image, analyze_image} → arguments.file_path ?? arguments.path；
 * - {glob, grep} → 仅 arguments.path（目录字段），绝不取 arguments.pattern（glob 模式/正则非路径）；
 * - bash 不采（噪声大）；白名单外工具一律 null。
 * 事件 data 形状 {name, arguments}：@deepseek-ai/dsh-agent-loop/lib/index.js:292-300（F2）。
 * @param {string} name - tool/call 的 event.data.name
 * @param {Record<string, unknown> | undefined} args - tool/call 的 event.data.arguments
 * @returns {string | null} 原始路径（未解析 cwd）；非字符串/缺失/空串 → null
 */
function extractPath(name, args) {
	if (args == null || typeof args !== "object") return null;
	if (name === "edit" || name === "write" || name === "read" || name === "read_image" || name === "analyze_image") {
		const p = args.file_path ?? args.path;
		return typeof p === "string" && p.length > 0 ? p : null;
	}
	if (name === "glob" || name === "grep") {
		const p = args.path; // 仅目录字段；绝不取 args.pattern（PROPOSAL §3.3 白名单注释）
		return typeof p === "string" && p.length > 0 ? p : null;
	}
	return null; // bash 及白名单外工具不采
}

/**
 * UTF-8 字节头截：超限截断并回退到不劈开多字节序列的边界。
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateHead(text, maxBytes) {
	const buf = Buffer.from(text, "utf8");
	if (buf.length <= maxBytes) return text;
	let end = maxBytes;
	while (end > 0 && (buf[end] & 0xc0) === 0x80) end--; // 跳过 UTF-8 连续字节，落在 lead byte
	return buf.subarray(0, end).toString("utf8");
}

/**
 * UTF-8 字节尾截：保留末尾 maxBytes 字节，起点回退到不劈开多字节序列的边界。
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateTail(text, maxBytes) {
	const buf = Buffer.from(text, "utf8");
	if (buf.length <= maxBytes) return text;
	let start = buf.length - maxBytes;
	while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++; // 起点落在 lead byte
	return buf.subarray(start).toString("utf8");
}

/**
 * 创建捕获工厂（每-apply 一份，持有 recentFiles 环形缓冲，CONTRACT §1.4）。
 * @param {{
 *   projections: object | undefined,   // ctx.get("sessionProjections")，可能 undefined（headless，M2）；服务名见 dsh-session-projection/lib/index.js:46
 *   maxPeerEntries: number,            // config.maxPeerEntries（默认 8，CONTRACT §4）
 *   queryDetailBytes: number           // config.queryDetailBytes（默认 2048，CONTRACT §4）
 * }} deps
 * @returns {{ trackRecent: Function, captureStatus: Function }}
 */
export function createCapture(deps) {
	const maxPeerEntries = deps.maxPeerEntries;
	const queryDetailBytes = deps.queryDetailBytes;
	/** @type {Map<SessionId, string[]>} 最近触碰文件，most-recent-first，容量 maxPeerEntries，去重 */
	const recentFiles = new Map();

	/**
	 * 持续跟踪某会话最近的工具触碰文件（去重环缓冲；subagent 直接 return，L6 修复）。
	 * recentFiles 是尽力而为的展示提示，非正确性依赖（PROPOSAL §3.3 说明）——
	 * 本函数吞掉一切异常，绝不向 session/event 派发流程抛错（CONTRACT §6 错误约定精神）。
	 * 仅处理 tool/call 的 event.data（调用方 index.js 已按 event.type === "tool/call" 过滤，CONTRACT §3 步骤 3）。
	 * @param {{ id: string, header?: { origin?: string, parentSession?: string, cwd?: string } }} session
	 * @param {{ name: string, arguments: object }} toolCall - event.data of "tool/call"（F2：dsh-agent-loop/lib/index.js:292-300）
	 * @returns {void}
	 */
	function trackRecent(session, toolCall) {
		if (isSubagent(session)) return; // L6：防 subagent 会话内存残留（PROPOSAL §3.3；CONTRACT §1.4 首行要求）
		try {
			const name = toolCall?.name;
			if (typeof name !== "string") return;
			const raw = extractPath(name, toolCall?.arguments);
			if (raw == null) return;
			// 相对路径用 session.header.cwd 解析为绝对；绝对路径原样；无 cwd 且相对 → 放弃（PROPOSAL §3.3）
			let abs;
			if (isAbsolute(raw)) {
				abs = raw;
			} else if (typeof session?.header?.cwd === "string" && session.header.cwd.length > 0) {
				abs = resolve(session.header.cwd, raw);
			} else {
				return;
			}
			const list = recentFiles.get(session.id) ?? [];
			const at = list.indexOf(abs);
			if (at !== -1) list.splice(at, 1); // 去重：已存在则移到最前（CONTRACT §1.4）
			list.unshift(abs);
			while (list.length > maxPeerEntries) list.pop(); // 环形缓冲容量 maxPeerEntries（A1 裁决：捕获层用 maxPeerEntries=8）
			recentFiles.set(session.id, list);
		} catch {
			/* 尽力而为：提取失败不影响其余字段与整体功能（PROPOSAL §3.3 说明） */
		}
	}

	/**
	 * 倒扫 session.events 取首个（即最近一条）assistant/message 的 text 块拼接。
	 * 事件日志快照：@deepseek-ai/dsh-session/lib/index.js:1401-1404（F5 events getter，深冻结只读）；
	 * assistant/message data={turn,step,message,usage?}：@deepseek-ai/dsh-agent-loop/lib/index.js:673-681（F3）；
	 * text 块形状 {type:"text", text:string}：@deepseek-ai/dsh-llm/lib/types/types.d.ts:39-42。
	 * 不会误采注入的 board：board 经 Channel A/B 均为 user/message，进不了 assistant/message 采集（PROPOSAL §3.3）。
	 * @param {object} session - dsh-session 实例（用 events getter）
	 * @returns {string} 无 assistant/message 返回 ""
	 */
	function lastAssistantText(session) {
		const events = session?.events; // F5：dsh-session/lib/index.js:1401-1404
		if (!Array.isArray(events)) return "";
		for (let i = events.length - 1; i >= 0; i--) {
			const ev = events[i];
			if (ev?.type !== "assistant/message") continue; // F3：dsh-agent-loop/lib/index.js:673-681
			const content = ev?.data?.message?.content;
			if (!Array.isArray(content)) return "";
			return content
				.filter((block) => block?.type === "text" && typeof block.text === "string") // TextBlock：dsh-llm/lib/types/types.d.ts:39-42
				.map((block) => block.text)
				.join("\n");
		}
		return "";
	}

	/**
	 * 捕获一份 PeerStatus（同步，零 LLM；PROPOSAL §3.3 / A4 裁决：groupKey 由入参提供，不再内部 await）。
	 * goal/todos 服务缺席（projections 为 undefined 或 stateOf 返回 undefined）时为 null，其余字段照常（M2）。
	 * @param {object} session - 见 dsh-session（用 id/header/events，F5）
	 * @param {{ turn: number, reason?: { kind?: string } }} turnEndData - event.data of "turn/end"
	 *     （data={turn,reason}，reason.kind ∈ blocked/completed/aborted/error/max-tokens：
	 *     @deepseek-ai/dsh-agent-loop/lib/index.js:590-598，五种 kind：539/544/577/583/682，F1）
	 * @param {GroupKey} groupKey - 已由调用方解析（A4）
	 * @returns {PeerStatus}
	 */
	function captureStatus(session, turnEndData, groupKey) {
		const now = Date.now();

		// —— todos：stateOf(session,"todos") → [{content,status},...] | null | undefined（F14）——
		// stateOf 同步读、缺 key 返 undefined：@deepseek-ai/dsh-session-projection/lib/index.js:109-113（F12）；
		// todos 投影 shape：@deepseek-ai/dsh-tool-todo/lib/index.js:64-71（F14）。
		/** @type {PeerTodos|null} */
		let todos = null;
		const todosState = deps.projections?.stateOf(session, "todos"); // F12：服务缺席 → deps.projections 为 undefined → null（M2）
		if (Array.isArray(todosState)) {
			let pending = 0;
			let inProgress = 0;
			let completed = 0;
			const inProgressItems = [];
			const restItems = [];
			for (const item of todosState) {
				if (item?.status === "in_progress") inProgress++;
				else if (item?.status === "completed") completed++;
				else if (item?.status === "pending") pending++;
				if (typeof item?.content === "string") {
					if (item.status === "in_progress") inProgressItems.push(item.content);
					else restItems.push(item.content);
				}
			}
			// items：in_progress 优先，再按原序；≤ maxPeerEntries 条（A1）；每条头截 queryDetailBytes（A1）
			const items = [...inProgressItems, ...restItems]
				.slice(0, maxPeerEntries)
				.map((content) => truncateHead(content, queryDetailBytes));
			todos = { pending, inProgress, completed, items };
		}

		// —— goal：stateOf(session,"goal") → {goal:{objective,phase,...},roundsStarted,...}|null|undefined（F13）——
		// goal 投影 wire schema：@deepseek-ai/dsh-goal/lib/index.js:342-362（F13），提取须读
		// state.goal.objective / state.goal.phase / state.roundsStarted 再扁平化（PROPOSAL §4.1）。
		/** @type {PeerGoal|null} */
		let goal = null;
		const goalState = deps.projections?.stateOf(session, "goal"); // F12
		const goalInner = goalState != null && typeof goalState === "object" ? goalState.goal : undefined;
		if (goalInner != null && typeof goalInner === "object" && typeof goalInner.objective === "string") {
			goal = {
				objective: truncateHead(goalInner.objective, queryDetailBytes), // 捕获层头截 queryDetailBytes（A1）
				phase: goalInner.phase, // schema 保证 ∈ active/paused/blocked/complete（F13）
				roundsStarted: typeof goalState.roundsStarted === "number" ? goalState.roundsStarted : 0
			};
		}

		// —— recentFiles：环缓冲读取，≤ maxPeerEntries 条绝对路径（CONTRACT §1.4）——
		const files = recentFiles.get(session?.id) ?? [];

		// —— recentAssistantTail：倒扫首条 assistant/message text，尾截 queryDetailBytes（A1，存储级 2048 非 board 级 240）——
		const tail = truncateTail(lastAssistantText(session), queryDetailBytes);

		return {
			schemaVersion: 1, // CONTRACT §2：PeerStatus.schemaVersion 恒 1
			sessionId: session?.id, // F5：session.id getter（dsh-session/lib/index.js:1325-1327）
			label: truncateHead(
				`${typeof session?.id === "string" ? session.id.slice(0, 8) : ""} ${basename(session?.header?.cwd ?? "")}`,
				LABEL_BYTES // 头截 48B（CONTRACT §1.4/§5）
			),
			cwd: session?.header?.cwd ?? "", // F6：header.cwd 绝对路径（dsh-session/lib/types/index.js:41-47）
			groupKey, // A4：由调用方解析传入（CONTRACT §1.4）
			isSubagent: isSubagent(session), // F24：发布侧已排除，此字段冗余防御（PROPOSAL §4）
			publishedAt: now, // epoch ms，写入时刻
			lastActivityAt: now, // epoch ms = turn/end 时刻，活跃判定唯一主信号（CONTRACT §2 语义强调）
			turn: turnEndData?.turn, // F1：dsh-agent-loop/lib/index.js:590-598；仅信息性
			lastTurnReason: turnEndData?.reason?.kind, // F1：reason.kind ∈ 五种终局
			goal, // M2：projections 缺席 → null，其余字段照常
			todos, // M2：同上
			recentFiles: files,
			recentAssistantTail: tail
		};
	}

	return { trackRecent, captureStatus };
}
