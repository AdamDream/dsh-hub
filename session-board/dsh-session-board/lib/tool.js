/**
 * dsh-session-board · lib/tool.js —— `query_peers` 工具定义（CONTRACT §1.6）
 *
 * 只读、按需、拉取同组 peer 的更完整状态快照。**绝不唤醒 peer**（无 followup/send/interrupt）；
 * **不读 `ctx.sessionQuery.readSurface`**（PROPOSAL §8 预算纪律：只读已预算化的 PeerStatus 文件）。
 * 本文件无状态（纯工厂），由 lib/index.js 经 `ctx.tools.register(definition)` 注册
 * （F16：dsh-tools/lib/index.js:2762-2770，服务名 "tools"：2592）。
 */

import { defineTool } from "@deepseek-ai/dsh-tools"; // F16：dsh-tools/lib/index.js:836-882 defineTool(options)
import { renderPeersDetail } from "./board.js"; // CONTRACT §1.6 允许 import 的跨模块清单（board.js 渲染详情）

/**
 * @typedef {string} GroupKey    // repo 级归一路径（CONTRACT §2）
 * @typedef {string} SessionId   // session.id 原样（CONTRACT §2）
 */

/**
 * 运行时配置切片（CONTRACT §4 Config 的相关字段；一律经 deps.current() 动态读取，禁止模块级缓存）。
 * @typedef {Object} BoardConfig
 * @property {number} activeWindowMinutes - 活跃窗口（默认 30）
 * @property {number} queryLimit - query_peers 默认返回条数（默认 5）
 * @property {number} queryDetailBytes - 每 peer 详情字节预算（默认 2048）
 * @property {number} queryTotalBytes - 详情总输出字节预算（默认 8192）
 */

/**
 * peer goal 扁平化结构（CONTRACT §2 PeerGoal）。
 * @typedef {Object} PeerGoal
 * @property {string} objective
 * @property {"active"|"paused"|"blocked"|"complete"} phase
 * @property {number} roundsStarted
 */

/**
 * peer todos 扁平化结构（CONTRACT §2 PeerTodos）。
 * @typedef {Object} PeerTodos
 * @property {number} pending
 * @property {number} inProgress
 * @property {number} completed
 * @property {string[]} items
 */

/**
 * query_peers 输出的单 peer 条目（enrich 后；**不含** cwd/groupKey/isSubagent/publishedAt/turn/lastTurnReason，CONTRACT §1.6）。
 * @typedef {Object} PeerDetail
 * @property {SessionId} sessionId
 * @property {string} label
 * @property {boolean} active
 * @property {number} lastActivityAt
 * @property {PeerGoal|null} goal
 * @property {PeerTodos|null} todos
 * @property {string[]} recentFiles
 * @property {string} recentAssistantTail
 */

/**
 * 组文件形状（CONTRACT §2 GroupFile；由 storage.js readPeerFile 兜底保证非 throw）。
 * @typedef {Object} GroupFile
 * @property {1} schemaVersion
 * @property {GroupKey} groupKey
 * @property {number} updatedAt
 * @property {Record<SessionId, import("./tool.js").PeerStatus>} peers
 */

/**
 * query 是否命中某 peer：空 query 恒 true；否则大小写不敏感子串匹配
 * sessionId / label / cwd / goal.objective / todos.items[]（CONTRACT §1.6 matches）。
 * @param {PeerDetail | Record<string, unknown>} peer - PeerStatus（enrich 前）
 * @param {string | undefined} query
 * @returns {boolean}
 */
function matches(peer, query) {
	if (typeof query !== "string" || query.trim() === "") return true; // 空 query（含未传/空白）→ 全通过
	const needle = query.toLowerCase();
	const scalarFields = [peer.sessionId, peer.label, peer.cwd, /** @type {any} */ (peer).goal?.objective];
	if (scalarFields.some((field) => typeof field === "string" && field.toLowerCase().includes(needle))) return true;
	const items = /** @type {any} */ (peer).todos?.items;
	return Array.isArray(items) && items.some((item) => typeof item === "string" && item.toLowerCase().includes(needle));
}

/**
 * 把存储层 PeerStatus 收敛为输出条目（enrich，CONTRACT §1.6）：
 * 只保留白名单字段并归一类型，保证结果满足 output.schema（缺省 goal/todos → null、
 * recentFiles → []、recentAssistantTail → ""，容忍旧版/半旧条目，§6.3 不把脏数据抛给模型）。
 * @param {Record<string, any>} peer - PeerStatus
 * @param {number} activeWindowMs - current().activeWindowMinutes * 60 * 1000（运行时派生，§5）
 * @param {number} now - 本轮 execute 内统一的 Date.now() 基准（等价于契约的逐条 Date.now()）
 * @returns {PeerDetail}
 */
function enrichPeer(peer, activeWindowMs, now) {
	return {
		sessionId: peer.sessionId,
		label: peer.label,
		active: now - peer.lastActivityAt <= activeWindowMs, // 活跃判定：Date.now()-lastActivityAt <= activeWindowMs（§5 运行时派生）
		lastActivityAt: peer.lastActivityAt,
		goal: peer.goal ?? null,
		todos: peer.todos ?? null,
		recentFiles: Array.isArray(peer.recentFiles) ? peer.recentFiles : [],
		recentAssistantTail: typeof peer.recentAssistantTail === "string" ? peer.recentAssistantTail : ""
	};
}

/**
 * query_peers 的输出 schema（value-schema-spec，F16：output.schema 经 valueSchemaSpecToJsonSchema 编译，
 * dsh-tools/lib/index.js:790-795）。与 CONTRACT §1.6 逐字段一致，仅 goal/todos 的
 * `type: ["object","null"]` 改为受支持子集内的等价 `oneOf: [{type:"object",additionalProperties:true},{type:"null"}]`：
 * type 数组不被 dsh-tools 支持（raw 子集断言 :234-235 "type arrays are not supported"；author 编译 default 分支
 * :730 直接 authorError，实测 defineTool 构造期抛 JsonSchemaError、工具无法注册），oneOf 为受支持关键字（:204、:656-677）。
 * @type {object}
 */
const outputSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		groupKey: { type: "string", required: true },
		peers: {
			type: "array",
			required: true,
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					sessionId: { type: "string", required: true },
					label: { type: "string", required: true },
					active: { type: "boolean", required: true },
					lastActivityAt: { type: "number", required: true },
					goal: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }], required: true },
					todos: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }], required: true },
					recentFiles: { type: "array", required: true, items: { type: "string" } },
					recentAssistantTail: { type: "string", required: true }
				}
			}
		}
	}
};

/**
 * 创建 registry-ready 的 `query_peers` 工具定义（CONTRACT §1.6，PROPOSAL §8）。
 * 分组键**只从调用方 agent.session 的 cwd 推导**（deps.groupKeyFor），绝不接受外部传入路径，防越组读。
 * @param {{
 *   current: () => BoardConfig,
 *   groupKeyFor: (session: object) => Promise<GroupKey>,
 *   peerFile: (groupKey: GroupKey) => string,
 *   readPeerFile: (filePath: string) => Promise<GroupFile>
 * }} deps - 由 lib/index.js 装配注入（CONTRACT §3 步骤 1）
 * @returns {object} defineTool(...) 的返回值（registry-ready；由 index.js 调 ctx.tools.register 注册）
 */
export function createQueryPeersTool(deps) {
	const { current, groupKeyFor, peerFile, readPeerFile } = deps;
	return defineTool({
		name: "query_peers",
		description:
			"Read richer status of peer sessions in the current project group (read-only; never wakes them). " +
			"Use after the injected board when you need a peer's fuller todos/goal/recent files.", // PROPOSAL §8 原文
		parameters: {
			// 每属性 map 由 parameterSchemaSpecToJsonSchema 隐式包成 object 根（dsh-tools/lib/index.js:800-810）
			query: { type: "string", description: "Optional case-insensitive substring matched against session id, label, cwd, goal objective, or todo items." },
			limit: { type: "number", description: "Optional max peers to return (default from config)." }
		},
		output: {
			schema: outputSchema, // F16：value-schema-spec（dsh-tools/lib/index.js:790-795）
			render: (args, value) =>
				// userRender(args, value) 透传（dsh-tools/lib/index.js:848-851）；运行时调用点 tool.output.render(exec.arguments, value)（:3411）
				// 预算参数每次经 current() 动态读取（§4 禁止缓存 config 字段）
				[{ type: "text", text: renderPeersDetail(value.groupKey, value.peers, current().queryDetailBytes, current().queryTotalBytes) }]
		},
		// defineTool 包装为 tool.isConcurrencySafe(args)（dsh-tools/lib/index.js:877-881），registry 按 exec.arguments 查询（:2941-2944）；只读工具恒并发安全
		isConcurrencySafe: () => true,
		/**
		 * execute：args 先经参数 schema 校验后透传（dsh-tools/lib/index.js:868-875）；
		 * exec.agent 可选（调用点判空 ：1216/:2815），缺席属合法失败 → 抛 Error，
		 * 由 ToolRuntime 经 toolErrorResult 转 isError 工具结果呈现给模型，不 crash 进程（F23：:3479-3493，§6.3）。
		 * @param {{ query?: string, limit?: number }} [args]
		 * @param {{ agent?: { session: { id: string } } }} exec
		 * @returns {Promise<{ groupKey: GroupKey, peers: PeerDetail[] }>} 空 peers 不报错（PROPOSAL §10 验收 2）
		 */
		async execute(args, exec) {
			const agent = exec.agent;
			if (!agent) throw new Error("query_peers requires a calling agent (exec.agent was undefined)"); // §6.3 契约原句
			// 分组键只从调用方 cwd 推导（deps.groupKeyFor → grouping.js），不接受外部路径（PROPOSAL §8 防越组读）
			const groupKey = await groupKeyFor(agent.session);
			// 直读组文件（最新）；readPeerFile 对 JSON 损坏/不存在兜底空骨架不抛（CONTRACT §1.2），故不把文件损坏抛给模型（§6.3）
			const board = await readPeerFile(peerFile(groupKey));
			const now = Date.now();
			const activeWindowMs = current().activeWindowMinutes * 60 * 1000; // §5 运行时派生，每次读 current()
			const rawLimit = args?.limit;
			// args.limit ?? current().queryLimit（契约步骤 4）；对非法数值（负数/非有限）回退默认，避免 slice 负参从尾部反剥
			const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit >= 0 ? Math.floor(rawLimit) : current().queryLimit;
			const peers = Object.values(board?.peers ?? {})
				.filter((p) => p !== null && typeof p === "object") // 防御旧版/脏条目（§6.3 精神：脏数据降级为跳过，不抛给模型）
				.filter((p) => p.sessionId !== agent.session.id) // 排除自己（裁决 A5：统一 agent.session.id，与 PeerStatus.sessionId 同源）
				.filter((p) => matches(p, args?.query))
				.sort((a, b) => b.lastActivityAt - a.lastActivityAt) // lastActivityAt 降序（毫秒时间戳为唯一主信号，§2/§4）
				.slice(0, limit);
			return { groupKey, peers: peers.map((p) => enrichPeer(p, activeWindowMs, now)) };
		}
	});
}
