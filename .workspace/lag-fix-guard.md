# lag-fix-guard.md — FrameQueue 应答帧永不丢弃守卫（U-5b）简报告

> 任务：给「subagent 卡顿修复」FrameQueue 有界化产物加「应答帧永不丢弃」守卫并自验。
> 用户裁决：approval/question 应答帧极少数且阻塞用户操作 → **永不丢弃**，只丢普通推送帧（丢最旧策略保持）；
> 执行+复核一体，不做独立审计/复核。
> 范围：只写 `.workspace/deploy-lag/` 与本报告；未触碰 `~/.npm-global`、`~/.dsh`；未使用 sandbox_permissions。

## 1. 守卫实现点（文件 + 行）

| 项 | 位置 |
|---|---|
| 应答帧判定函数 `isAnswerableFrame()` | `deploy-lag/hardening/host-apiproxy.lib.index.js` **L1096-1100**（插在 `MAX_QUEUED_FRAMES` L1095 之后） |
| 丢帧守卫（push 溢出分支改写） | 同文件 **L1108-1116**（push 方法 L1106-1119） |
| 增量 patch | `deploy-lag/patches/dsh-host-apiproxy.u5b.patch`（2 hunk，31 行） |

## 2. 帧类型识别路径（读代码确认）

全库所有 `queue.push` 帧均为 `{ rpcId, payload }` 双字段信封，`payload.type` 是唯一类型判别符。
应答帧恰为 4 种、全部由两个 pending 注册表铸帧（行号为当前副本实测）：
- `approval/requested` — `requestedFrame()`（L1309）铸帧；approval/request 处理器推送 L1969、mux 重放 L3554
- `approval/resolved` — `settle()` 广播 L1946-1952
- `question/requested` — ask 处理器 envelope 推送 L1898-1906、mux 重放 L3546-3553
- `question/resolved` — `claimQuestion()` 广播 L1870-1876

协议 schema（L5032-5058）确认应答帧类型全集即上述 4 种；其余（session/subscribed、session/event、
session/jobs、session/queue、session/projection、host/* 等）均为普通推送帧。守卫用
`item?.payload?.type` 可选链判定：对畸形帧安全（视为可丢普通帧），应答帧必由注册表正规铸帧、不会畸形。

## 3. 改动摘要（守卫逻辑）

```js
/** 应答帧（approval/question 类，阻塞用户操作）永不丢弃；溢出只允许丢普通推送帧（丢最旧策略保持）。 */
function isAnswerableFrame(item) {
	const type = item?.payload?.type;
	return type === "approval/requested" || type === "approval/resolved" || type === "question/requested" || type === "question/resolved";
}
```
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

| 场景（buffer 已满） | 行为 | 结论 |
|---|---|---|
| 新帧 = 应答帧 | 跳过丢弃，直接入队（buffer 临时 MAX+1，排空即回落） | 应答帧绝不丢 |
| 新帧 = 普通帧，buffer 内有普通帧 | `findIndex` 从最旧起找第一个**非应答**帧 `splice` 丢弃（跳过队首应答帧） | 丢最旧普通帧 |
| 新帧 = 普通帧，buffer 全为应答帧 | `return` 丢弃本次普通帧（维持内存上限） | 应答帧不丢 |
| buffer 未满 | 原逻辑零丢弃 | 与 U-5 一致 |

改动仅限 U-5 既有丢帧路径（`push()`），零重构。应答帧连续涌入时 buffer 至多超出 MAX 1 帧/应答帧
（阻塞型帧优先送达的代价，实践中 ≈0）。

## 4. 自验结果（复核一体）

| 验证 | 结果 |
|---|---|
| `node --check hardening/host-apiproxy.lib.index.js` | **PASS** |
| 锚点 `grep -n "MAX_QUEUED_FRAMES"` | 2 命中（L1095 定义 / L1108 使用） |
| 锚点 `grep -n "if (!subscribed.has(session.id)) return;"` | 1 命中（L3575） |
| `grep -n "subscribeSession(queue, subscribed, session)"` | 2 命中（L3545 + L3596） |
| `grep -n "isAnswerableFrame"` | 3 命中（L1097 定义 / L1111、L1112 守卫内） |
| patches 链式 replay（tmp 内，live 原厂只读拷贝） | `live 原厂 → u4 → u5 → u5b` 与加固副本 **cmp 字节全等**（PASS-A）；`post-u5 + u5b` 增量路径亦字节全等（PASS-B）；pristine 副本未污染 |
| 行为测试（从加固副本逐行提取守卫代码，MAX=3） | 8/8 场景 PASS：未满零丢 / 满+普通帧丢最旧 / 满+应答帧入队不丢 / 队首应答帧跳过 / 全应答帧+普通帧丢本次 / 全应答帧+应答帧入队 / 队尾应答帧保留 / done 后忽略 |
| `bash -n replay-lag-fix.sh`（接入 U-5b 后） | PASS |

## 5. 部署集成（额外说明）

`replay-lag-fix.sh` 已接入 U-5b 步：新增 `u5b_applied()` 幂等锚点（`isAnswerableFrame`）、
`needs_apply` 判定、`patch_unit "U-5b"`（u4 → u5 → u5b 顺序应用）、`verify_u45` 增加守卫断言。
未接入前脚本的 U-5 幂等锚点 `MAX_QUEUED_FRAMES` 会被 u5 命中，u5b 将永远 SKIP —— 守卫实际不会部署，
故此次一并接入（属 deploy-lag 范围内最小改动）。已部署过 u5（无守卫）的环境重跑脚本会因 u5b 锚点未中
而补打 u5b。

## 6. Verdict

**pass** —— 守卫实现点（hardening 副本 L1096-1100 + L1108-1116）、增量 patch（u5b，部署序
u4→u5→u5b 字节全等）、文档（hardening-changes.md 追加 U-5b 节）、部署接入（replay-lag-fix.sh）
全部完成并通过自验。
