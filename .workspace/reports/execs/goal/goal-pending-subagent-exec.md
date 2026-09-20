# 执行报告：goal 等待 subagent 期间空转注入修复（方案 A：per-agent pending-subagent 计数）

- 日期：2026-09-16
- 角色：修订执行复核一体阶段子代理（路由 adam/deepseek-v4-flash）
- 目标：落地「等待 subagent 期间空转注入」修复（方案 A：per-agent pending-subagent 计数），同档自复核
- 依据：`.workspace/goal-round-gap-audit.md` §6.4（方案 A 设计）、用户裁决实施方案 A
- 约束遵守：只写 `.workspace/deploy-015/dsh-goal-round-driver/` 与报告；未改 `~/.dsh` / live 宿主 lib（部署由主代理执行）；未使用 sandbox_permissions

---

## 0. 结论摘要（TL;DR）

| 项 | 结论 |
|---|---|
| 方案 A 实现 | ✅ 完成：per-agent `pendingSubagents` 计数（subagent/start +1 / subagent/end -1，经 scope carrier 归因到 parent Agent）+ `readyToDrive` 追加 `pendingSubagents === 0` |
| 窄窗口兜底 | ✅ 复用现有 `competingQueued`：`subagent/end` 使计数归零时置位，阻止 drive() 在 settle notice 落地前注入；notice 被 agent 消费后回 idle 时由既有 idle 处理器清位恢复 |
| unified diff | ✅ `.workspace/deploy-015/dsh-goal-round-driver/pending-subagent.patch`（patch -p1 于包目录，基于含 P0-A 的 ce17b050 live 状态） |
| 应用后完整副本 | ✅ `.workspace/deploy-015/dsh-goal-round-driver/lib/index.js`（sha256 `c4f3ea68c56f51a11818bb5da096367fb65a711fa29bb70ed3f8384af9cf8973`） |
| node --check | ✅ 通过 |
| 与 :222/:237 零重叠 | ✅ 逐字保留（见 §3） |
| mock 行为验证 | ✅ 13/13 通过（S1 基线、S2 派发抑制、S4 窄窗口、S3/S5 多 subagent、S6 既有 round-limit 回归） |
| 自复核裁决 | ✅ **通过**（问题清单见 §7，均为文档级限制，非缺陷） |

---

## 1. 根因与机制（取自审计 §6，执行档核实）

- 现象：goal 激活时，主 agent 派发后台 subagent 后 turn 结束 → idle；等待期间 parent inbox 为空 → `readyToDrive`（idle && !competingQueued）全条件满足 → drive() 注入下一轮 goal_round prompt → 空转轮询 + 会话框刷屏，直到 subagent settle。
- 抑制缺失点：`competingQueued` 只在 `agent/inbox/inserted` 有 nextTurn 消息时置位（`lib/index.js:239-246`）；subagent 等待期间 parent inbox 空，无任何信号把 agent 从「可注入 goal」状态排除。
- 0.1.5 无此修复（readyToDrive/competingQueued 两版逐字一致，grep 'subagent|pending' 在驱动器中为空）；用户裁决本部署自研方案 A。

## 2. 事件 API 核实（0.1.1 dsh-subagent）

- `subagent/start`、`subagent/end` 两事件在 0.1.1 已存在：
  - one-shot：`observeRun`（`dsh-subagent/lib/index.js:191-212`）→ `run.result.then` 时 emit `subagent/end`（载荷 `{runId, provider, id, local, stopReason, lastAssistantMessage?}`），同步 emit `subagent/start`（载荷 `{runId, provider, id, local}`）。
  - continuable：`createActivationObserver`（`:224-257`）start/settle 同载荷形状。
- **parent scope 表达**：载荷本身**无 parent 字段**；parent 通过 scope-filtered dispatch 的 carrier 表达——`createLifecycleEmitter`（`:166-181`）以 `[carrier(parent), name, info]` 分发（`carrier = scopeTarget(service, parent)`，`dsh-scope/lib/index.js:327-338`），listener 的 `this` 即 carrier，`carrierKeyOf(this)`（`:352-355`）可还原 parent（Agent 对象）。`dsh-tool-cordis/lib/index.js:4232` 明确记录此契约。
- **归因链路**：`ctx.on("subagent/start", function (info) { const parent = carrierKeyOf(this); ... })` —— 驱动器的 ctx 为 unscoped，收到全部 parent 的 subagent 事件；按 carrier key 定位 `states.get(parent)`，state 挂 agent 键，实现 per-agent 计数。

## 3. 实现（方案 A，最小面）

改动文件：`dsh-goal-round-driver/lib/index.js`（基于含 attempt-attribution :222 + P0-A :237 的 live 副本），4 个 hunk：

1. **import**（`lib/index.js:3`）：`import { carrierKeyOf } from "@deepseek-ai/dsh-scope";` —— dsh-scope 为宿主树既有包（dsh-agent-loop peerDep 之一，`dsh-agent-loop/package.json` 含 `@deepseek-ai/dsh-scope`），运行时从驱动器位置 `require.resolve` 实测可解析（见 §5），零新安装依赖。
2. **state 字段**（`stateFor`，`:67`）：`pendingSubagents: 0` —— per-agent 计数起点。
3. **`readyToDrive`**（`:82`）：追加 `state.pendingSubagents === 0` —— 有未决 subagent 时不再满足可注入条件。
4. **两个监听器**（`:270-283`，置于 `agent/inbox/discarded` 处理器之后、`session/event` 之前）：
   - `subagent/start`：`carrierKeyOf(this)` 归因 → `states.get(parent).pendingSubagents += 1`。
   - `subagent/end`：归因 → 计数 `>0` 时 `-=1`；**归零时 `state.competingQueued = true`（窄窗口兜底）**；`requestDrive(state)` 重估（此时被 competingQueued 挡住，不会注入）。

**窄窗口兜底设计（按实现最小面选择 competingQueued 复用）**：
- 窗口成因：`subagent/end` 在 run settle 时 emit，而 settle notice 经 `notifySettlement`（continuable `:1580-1582`）/ tool-jobs `onJobDone`（one-shot）稍后投递进 parent inbox；窗口内计数已为 0 但 notice 未入 inbox，若此时 drive() 运行会提前注入一轮。
- 兜底机制：end 归零时置 `competingQueued = true`，`readyToDrive` 因此为假 → drive() 空转返回；notice 落地 → `agent/inbox/inserted` 将其保持 true（非本驱动器 attempt）→ agent 消费 notice 后回 idle → 既有 `agent/status idle` 处理器（`:218-219`）清 `competingQueued=false` → requestDrive → 下一轮正常注入。即「end→notice→消费→恢复」链上无注入窗口。
- 备选（drive() 前置 inbox 检查）未采用：需新增 inbox 扫描逻辑且与既有 competingQueued 语义重叠；competingQueued 复用为 1 行、语义与既有「任意竞争消息抑制注入」完全一致。

**与 :222/:237 零重叠**：diff 仅 4 个 hunk（import/state/readyToDrive/监听器块），未触碰 `:222` attempt-attribution 与 `:237` P0-A pause→cancel 两行；patched 文件对 live 副本的 `:222`/`:237` 内容逐字保留（diff 输出中两行均未出现在 `<`/`>` 变更行）。

## 4. 产物

| 产物 | 路径 |
|---|---|
| unified diff（patch -p1 于包目录） | `.workspace/deploy-015/dsh-goal-round-driver/pending-subagent.patch`（2859B） |
| 应用后完整副本 | `.workspace/deploy-015/dsh-goal-round-driver/lib/index.js`（392 行，sha256 `c4f3ea68c56f51a11818bb5da096367fb65a711fa29bb70ed3f8384af9cf8973`） |
| mock 验证脚本 | `.workspace/deploy-015/dsh-goal-round-driver/verify/mock-verify.mjs` |
| mock 验证输出 | `.workspace/deploy-015/dsh-goal-round-driver/verify/mock-verify-output.txt`（13/13 PASS） |
| 本报告 | `.workspace/goal-pending-subagent-exec.md` |

**patch 应用验证**：以 live 副本（`~/.npm-global/.../dsh-goal-round-driver/lib/index.js`，含 P0-A）为基，`patch -p1 --dry-run` 通过；实际应用后与 patched 副本 `diff -q` 一致（精确复现）。

## 5. 行为验证（mock 级）

Harness 要点：`verify/mock-verify.mjs` 构造最小 fake ctx（events bus + agents/goals/sessions 服务），加载 **patched** 驱动器；subagent 事件用**真实 dsh-scope** 的 `scopeTarget` 构造 carrier 分发（验证真实 `carrierKeyOf` 归因路径，非桩）；按真实 loop 纪律模拟 claim+admit+run+idle 全周期。

| 场景 | 断言 | 结果 |
|---|---|---|
| S1 基线：无 pending，idle+armed goal 注入 | 第 1 轮注入、完成后续注入第 2 轮 | PASS（正常 goal 轮不受影响） |
| S2：subagent/start 后 idle | 不再注入 | PASS |
| S4 窄窗口：subagent/end 已到但 notice 未入 inbox | 不注入（competingQueued 挡住） | PASS |
| S4：notice 落地→消费→idle | 恢复注入 | PASS |
| S3：第二个 subagent 往返 | start 抑制 / end+notice 后恢复 | PASS |
| S5：两个并发 subagent | 仅最后一个 end+notice 消费后恢复 | PASS |
| S6：round-limit 既有路径 | 仍 block（回归） | PASS |

补充静态验证：
- `node --check lib/index.js` ✅
- `carrierKeyOf` 导出存在于 `dsh-scope/lib/index.js:357`；从驱动器目录 `require.resolve('@deepseek-ai/dsh-scope')` 实测解析到宿主树包 ✅
- 锚点：`subagent/start`（`:270`）、`subagent/end`（`:275`）、`pendingSubagents`（`:67,:82,:273,:279-281`）、`carrierKeyOf`（`:3,:271,:276`）

## 6. 自复核（同档）

| 检查项 | 结论 |
|---|---|
| 无 pending 时行为不变 | ✅ `pendingSubagents` 恒 0（无 subagent 事件时），`readyToDrive` 与基线逐位等价；S1/S6 实测 |
| 事件关联正确 | ✅ carrier 归因链经真实 `scopeTarget`/`carrierKeyOf` 验证；载荷无 parent 的边界（parent===undefined → `carrierKeyOf` 返回 undefined → 跳过）已防御 |
| 与既有双补丁共存 | ✅ `:222`/`:237` 逐字保留，diff 无重叠 hunk |
| 0.1.1 事件 API 适配 | ✅ 事件名/载荷/scope 语义逐项核实（§2）；仅新增 1 个 import，宿主树既有包 |
| 竞态/时序 | ✅ end→notice 窄窗口由 competingQueued 覆盖；notice 消费→idle 恢复链与既有机制一致；`subagent/end` 对计数为 0 的冗余事件直接 return（防御） |
| 生命周期 | ✅ 监听器注册于 `ctx.effect` 内（随 effect dispose）；state 按 agent 键挂载，`agent/disposed` 走既有 `states.delete` |

**自裁决：通过**（无返工项；问题清单均为文档级限制，见 §7）。

## 7. 问题清单 / 限制（文档级，非缺陷）

1. **事件到达顺序依赖**：one-shot 的 settle notice 经 tool-jobs `onJobDone` 投递，与 `subagent/end` 存在毫秒级竞态；本修复以 competingQueued 兜底覆盖（§3）。若未来 notice 投递路径变化（如取消投递），需要复核该兜底。
2. **foreground subagent（run_in_background=false）**：父 agent 自身 turn 内 await，`subagent/start`→`end` 计数同样生效；父 turn 未结束时不 idle，无注入窗口；end 归零置位 competingQueued 会在父 turn 结束后被 idle 清除——无影响。语义正确但未在 mock 中显式建场景（可在后续批次补）。
3. **`agent/session-start` 会清 `competingQueued`**（既有行为 `:213`）：若 session 重启恰好落在 end→notice 窗口内，兜底位会被提前清除；概率极低（session 重启本身罕见），且 notice 落地后 inbox/inserted 会再次置位，最终语义仍收敛。
4. **host 树依赖声明**：`dsh-scope` 未列入 `dsh-goal-round-driver/package.json` peerDependencies（宿主树既有、resolve 实测通过）；若未来独立发布该包需补声明。本部署为 live 补丁，不涉及发布。

## 8. 部署要点（供主代理）

- **宿主 lib 改动需重启 dsh 进程生效**；并入下次部署批次（与 P0-A `ce17b050` 状态同基线，patch 在其之上应用，二者兼容）。
- 部署步骤：`patch -p1 < .workspace/deploy-015/dsh-goal-round-driver/pending-subagent.patch`（于 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-goal-round-driver/` 目录），或直接以 `lib/index.js` 完整副本覆盖；随后重启。
- 建议部署后轻量冒烟：派发一个后台 subagent，观察等待期间会话框不再出现 goal_round 注入；subagent settle 且 notice 消费后恢复注入。
