# hardening-changes.md — dsh-host-apiproxy 加固改法说明（U-4 + U-5 + U-5b）

> 交付单元：U-4（mux 会话级订阅过滤 seam）/ U-5（FrameQueue 有界化）/ U-5b（应答帧永不丢弃守卫）
> 权威规格：lag-fix-audit.md §2、§7 U-4/U-5。本文件记录精确改法、锚点行号、
> 改动前后片段与验证结果。改动文件 = `host-apiproxy.lib.index.js`（本目录完整副本，
> 由 live 原厂 `dsh-host-apiproxy/lib/index.js` 施加下述改动生成；`node --check` PASS）。
> U-5b 为用户裁决追加项（approval/question 应答帧极少数且阻塞用户操作 → 永不丢弃）。

## 行号对照

| 改动 | live 原厂锚点（审计行号） | 加固副本行号 | 说明 |
|---|---|---|---|
| U-5 常量 | L1094（类注释之前） | L1095（定义）/ L1108（使用） | `MAX_QUEUED_FRAMES` 定义 + push 使用 |
| U-5b 守卫 | —（新增） | L1096-1100（`isAnswerableFrame` 定义）/ L1108-1116（push 守卫块） | 应答帧判定 + 丢帧守卫 |
| U-5 push | L1099-1103 | L1106-1119 | 溢出丢最旧帧（普通帧），应答帧不丢 |
| U-4 订阅签名+登记 | L1158-1164 | L1174-1181 | `subscribeSession` 加 `subscribed` 参数 + `subscribed.add` |
| U-4 mux 订阅集合 | L3525（`const queue = new FrameQueue();` 之后） | L3543 | `const subscribed = /* @__PURE__ */ new Set();` |
| U-4 连接时全量订阅调用 | L3527 | L3545 | 传 `subscribed` |
| U-4 session/event 过滤 | L3556（监听器首行） | L3575 | `if (!subscribed.has(session.id)) return;` |
| U-4 session/created 订阅调用 | L3577 | L3596 | 传 `subscribed` |

> 注意：审计行号为 **live 原厂文件** 行号（历史快照，个别锚点与现版 live 有 ±1 级差）；
> 加固副本行号为实测 grep 结果。U-5b 在 U-4 锚点之前共插入 +13 行（`isAnswerableFrame` 定义 +5、
> push 守卫块扩展 +8），故 U-4 各行号 = 原加固副本 +13；U-5 push 使用行 +5（仅 helper 位于其前）。
> 同名监听器 L1840（session/projection 广播路径）与 L3610 `host()` 的 FrameQueue 实例
> **均不改动**（审计界定范围外；后者因共用 FrameQueue 类自动获得有界化封顶与应答帧守卫）。

---

## U-5 FrameQueue 有界化（2 处）

### 改动 1：模块级常量（插在 FrameQueue 类注释之前，live L1094 / 副本 L1095）

改动前：
```js
}
/** Simple async queue: core callbacks push, the AsyncIterable pulls; abort/return cleans up. */
var FrameQueue = class {
```

改动后：
```js
}
/** SSE 帧队列上限：溢出丢最旧帧保 UI 响应（仅在消费者积压时触发）。 */
const MAX_QUEUED_FRAMES = 4096;
/** Simple async queue: core callbacks push, the AsyncIterable pulls; abort/return cleans up. */
var FrameQueue = class {
```

### 改动 2：push() 溢出丢最旧帧（live L1099-1103 / 副本 L1101-1107）

改动前：
```js
	push(item) {
		if (this.done) return;
		this.buffer.push(item);
		this.waiter?.();
	}
```

改动后：
```js
	push(item) {
		if (this.done) return;
		if (this.buffer.length >= MAX_QUEUED_FRAMES) this.buffer.shift();
		this.buffer.push(item);
		this.waiter?.();
	}
```

**语义**：正常流量 buffer≈0、零丢弃；仅消费者（浏览器）积压 ≥4096 帧时封顶内存并丢
**最旧**帧（通常是早已渲染过的早期帧），新帧（含最终 assistant/message、done 类）优先
送达 → 保 UI 响应。mux 与 host 两条流共用该类均封顶（host 流量低实际不触发）。丢帧只
影响「推送到浏览器」的实时流，会话日志（真相源）不受影响。**U-5b 起，丢帧前先判类型，
approval/question 应答帧永不丢弃，只丢普通推送帧**（详见下节）。

---

## U-5b 应答帧永不丢弃守卫（用户裁决追加，2 处改动）

> 裁决背景：approval/question 类应答帧极少数且**阻塞用户操作**（UI 必须收到才能继续），
> 被溢出丢帧会直接卡死交互 → 用户裁决：**永不丢弃**，只丢普通推送帧（丢最旧策略保持）。

### 改动 1：应答帧判定函数（副本 L1096-1100，插在 `MAX_QUEUED_FRAMES` 之后）

改动后：
```js
/** 应答帧（approval/question 类，阻塞用户操作）永不丢弃；溢出只允许丢普通推送帧（丢最旧策略保持）。 */
function isAnswerableFrame(item) {
	const type = item?.payload?.type;
	return type === "approval/requested" || type === "approval/resolved" || type === "question/requested" || type === "question/resolved";
}
```

**类型判定依据**：全库所有 `queue.push` 帧均为 `{ rpcId, payload }` 双字段信封，`payload.type`
是唯一类型判别符。应答帧恰为 4 种、且全部由两个 pending 注册表铸帧（行号均为当前副本实测）：
- `approval/requested` — `requestedFrame()`（L1309）铸帧，approval/request 处理器推送
  （L1969）与 mux 重放（L3554）；
- `approval/resolved` — `settle()` 广播（L1946-1952）；
- `question/requested` — ask 处理器 envelope 推送（L1898-1906）与 mux 重放（L3546-3553）；
- `question/resolved` — `claimQuestion()` 广播（L1870-1876）。

其余类型（session/subscribed、session/event、session/jobs、session/queue、
session/projection、host/* 等）均为普通推送帧，照旧可丢。协议 schema（L5032-5058）确认
应答帧类型全集即上述 4 种。`item?.payload?.type` 可选链对任何畸形帧安全（视为可丢普通帧，
应答帧必由注册表正规铸帧，不可能畸形）。

### 改动 2：push() 丢帧守卫（副本 L1108-1116）

改动前（U-5 产物）：
```js
	push(item) {
		if (this.done) return;
		if (this.buffer.length >= MAX_QUEUED_FRAMES) this.buffer.shift();
		this.buffer.push(item);
		this.waiter?.();
	}
```

改动后：
```js
	push(item) {
		if (this.done) return;
		if (this.buffer.length >= MAX_QUEUED_FRAMES) {
			// 应答帧永不丢弃：新帧为应答帧时直接入队（临时超出上限，阻塞型帧优先送达）；
			// 新帧为普通帧时从最旧起找第一个可丢的普通帧；缓冲区全为应答帧则丢本次普通帧。
			if (!isAnswerableFrame(item)) {
				const drop = this.buffer.findIndex((buffered) => !isAnswerableFrame(buffered));
				if (drop >= 0) this.buffer.splice(drop, 1);
				else return;
			}
		}
		this.buffer.push(item);
		this.waiter?.();
	}
```

**守卫逻辑（逐分支）**：
| 场景（buffer 已满） | 行为 | 结论 |
|---|---|---|
| 新帧 = 应答帧 | 跳过丢弃，直接入队（buffer 临时 MAX+1，消费者排空即回落） | 应答帧绝不丢 |
| 新帧 = 普通帧，buffer 内有普通帧 | `findIndex` 从最旧起找第一个**非应答**帧 `splice` 丢弃（跳过队首应答帧） | 丢最旧普通帧，应答帧不丢 |
| 新帧 = 普通帧，buffer 全为应答帧 | `return` 丢弃本次普通帧（维持内存上限） | 应答帧不丢，上限保持 |
| buffer 未满 | 原逻辑零丢弃 | 与 U-5 一致 |

代价：全为应答帧时普通帧入队失败（可接受，应答帧极少数；防御性分支实际几乎不触发）；
应答帧连续涌入时 buffer 可短暂超出 MAX 至多 1 帧/应答帧（阻塞型帧优先送达的代价，上界
= 积压应答帧数，实践中 ≈0）。丢最旧策略对普通帧保持。**改动仅限 U-5 既有丢帧路径，零重构。**

---

## U-4 mux 会话级订阅过滤 seam（4 处改动，5 个 hunk）

### 改动 1：mux() 内建订阅集合（live L3525 之后 / 副本 L3530）

改动前：
```js
			mux(_request, signal) {
				const queue = new FrameQueue();
				muxQueues.add(queue);
```

改动后：
```js
			mux(_request, signal) {
				const queue = new FrameQueue();
				const subscribed = /* @__PURE__ */ new Set();
				muxQueues.add(queue);
```

### 改动 2：subscribeSession 签名 + 登记（live L1158-1164 / 副本 L1161-1168）

改动前：
```js
function subscribeSession(queue, session) {
	queue.push(frame({
		type: "session/subscribed",
		sessionId: session.id,
		lastSeq: session.seq - 1
	}));
}
```

改动后：
```js
function subscribeSession(queue, subscribed, session) {
	subscribed.add(session.id);
	queue.push(frame({
		type: "session/subscribed",
		sessionId: session.id,
		lastSeq: session.seq - 1
	}));
}
```

### 改动 3：连接时全量订阅调用点传 subscribed（live L3527 / 副本 L3532）

改动前：`for (const session of ctx.sessions.list()) subscribeSession(queue, session);`
改动后：`for (const session of ctx.sessions.list()) subscribeSession(queue, subscribed, session);`

### 改动 4：session/event 监听器首行过滤（live L3556 / 副本 L3562，openCalls 处理之前）

改动前：
```js
					ctx.on("session/event", (session, event) => {
						if (event.type === "tool/call") {
```

改动后：
```js
					ctx.on("session/event", (session, event) => {
						if (!subscribed.has(session.id)) return;
						if (event.type === "tool/call") {
```

### 改动 5：session/created 订阅调用点传 subscribed（live L3577 / 副本 L3583）

改动前：`subscribeSession(queue, session);`
改动后：`subscribeSession(queue, subscribed, session);`

**语义**：连接时订阅全部 live 会话 + 新会话自动订阅 → 过滤恒真 → 行为与现状完全一致
（零降帧、零破坏）；为将来客户端驱动订阅留好 seam。**本单元不降帧**（订阅=全量），
真实降帧由 U-1（②b 非流式恢复）+ U-5 封顶承担——见 lag-fix-audit.md §2.1 审计发现：
mux WS 为 downlink-only（客户端消息直接 1008 关闭）、HTTP RPC 与 WS 无连接令牌，
纯服务端改动无法获得「消费者关注哪些会话」的信号源；按「可见会话」过滤需协议级改动，
列为后续项，本修复不做。

---

## 验证结果（本工作区产物）

| 验证 | 结果 |
|---|---|
| `node --check host-apiproxy.lib.index.js` | PASS |
| `grep -n "MAX_QUEUED_FRAMES"` | 2 命中（定义 L1095 + 使用 L1108） |
| `grep -n "isAnswerableFrame"` | 3 命中（定义 L1097 + 守卫 L1111/L1112） |
| `grep -n "if (!subscribed.has(session.id)) return;"` | 1 命中（L3575） |
| `grep -n "subscribeSession(queue, subscribed, session)"` | 2 命中（L3545 + L3596） |
| `diff -u live 加固副本` | 仅 8 hunk（u4 4 hunk + u5 2 hunk + u5b 2 hunk），全部落在审计指定函数（FrameQueue / subscribeSession / mux） |
| patches 链式 replay | `live 原厂 → u4 → u5 → u5b` 与加固副本**字节全等**（cmp PASS，见 lag-fix-guard.md）；`post-u5 + u5b` 增量路径亦字节全等 |
| 加固副本 sha256 | `217a7b97ecc9373290e540f5aadf3e34415559b7334371f3f3535cbec1bcd270`（5574 行） |
| replay-lag-fix.sh | 已接入 U-5b 步（`patch_unit` + 幂等锚点 `isAnswerableFrame` + `verify_u45` 守卫断言）；`bash -n` PASS |
