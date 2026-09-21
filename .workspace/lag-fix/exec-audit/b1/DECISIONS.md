# B1 修订：主 agent 裁决与执行契约（2026-09-21）

依据：`exec-audit/b1/audit.md`（只读执行前审计，产品文件零改动）

## 裁决 1：`lib/types/api-proxy.js` —— **一并改**

- 审计实测：它**运行时不可达**（`package.json` 的 `main`/`exports[".""]` 只指向 `lib/index.js`；`index.js` 无任何相对 import；全仓无 import 者）。
- 仍然要改，理由：留着会让**下一轮审计 grep 出与生效件矛盾的代码**（9-20 的 `ctx` 事故正是"规格与产物一致、但规格本身错"的形态）。
- **要求**：在回放规格与报告中**显式标注"该文件运行时不可达，改动属一致性维护"**，防止后人误判生效件。

## 裁决 2：A6 集合等式允许读 `~/.dsh/sessions`

- 允许，但**只解首帧 header**：≤1 个 8KB chunk、**不解析对话内容**、不写会话目录，并在脚本与报告中留证。
- 理由：项目既有做法（B2 清理逐会话解 header；协调者自己的 CC/DSH 普查亦同）。

## 已确认的技术结论（执行档不得重开）

1. **B① 采用策略②B1**（`(b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1)`）。
   **否决 A2（meta 补 mtime 型 updatedAt）**：`listSnapshots()` 的 mtime 被封装为**不透明 branded `revision`**，取不到数字 mtime；
   补齐需改 `dsh-session-persistence-jsonl` + 跨包类型契约 + 每次 list 新增 O(n) stat ⇒ **第二个产品包 + 第三个回滚点**，破坏批次隔离。
   代价（必须写进注释，不得让注释说谎）：「最近」窄化为「**最近创建**」，老创建新活动的冷 subagent 可能被挤出；同 ms 用 id 升序消歧。
2. **B② 采用策略①A2**（`childrenOf` 由 `ctx.sessions.list()` 的 `header.parentSession` 构建）；**本批次不叠加 keep-set 豁免**（独立产品决策；A2 已同时关闭两条通道，且**不改下发上界**）。
   语义边界：中间层行未下发时仍按 live 血缘计入 ⇒ **消费方必须优先宿主字段**；已实测客户端 `dsh-client-ui-workspace/lib/client.js:171/286/561` 均为 `typeof === "number" ? 宿主值 : byId 兜底` ⇒ **A2 单独即可修用户可见症状，无需重建客户端产物**。
3. **验收不变量的可判定性**：`applyServerFilter(pre_image)` **逐字节复现 live** ⇒ 修订后必须**恢复**该不变量。
   期望 sha：`lib/index.js 96ad39b7…`（217,279 B）、`lib/types/api-proxy.js f4752c39…`（175,895 B）。
4. **锚点撞车**：裸比较器 `(a, b) => b.updatedAt - a.updatedAt` 在同文件出现 **2 次**（冷候选与收口字面相同）⇒ 必须用带 `coldSource` 上下文的**整条四行语句**作锚点；**修订后该裸字面量应恰好剩 1 次**（可作验收断言）。
5. **必做伴随项**：`probes/verify-b1-ctx-binding.mjs` 的 `fakeCtx` 缺 `header`，A2 落地后**必然 TypeError → 假 FAIL**；修法已备（`verify-b1-ctx-binding.A2-proposed.mjs`），且需**向前兼容**（对现行部署也 PASS）并能保持相 B 反向对照有效。
6. **回滚**：pre-image = `backup/B1/server/20260920-154039/lib/{index.js,types/api-proxy.js}`（`142aac84…`/`7f56fb80…`）。
   ⚠️ `b1fix-20260920-183319/index.buggy.js`（`f568f8a9…`）**不是 pre-image** —— 它是"已打 B1 但缺 ctx 参数"的**中间故障态**，回滚脚本必须只认前者。

## harness 陷阱（审计档登记，后续线复用）

手写缩进换算 `/^\t/gm` 只吞第一个 TAB、锚点撞车、数括号被字符串里的 `{` 骗、模板字面量转义、
**`node --check` 查不出未声明标识符**（正是 9-20 事故成因）、**测试替身替被测代码补绑定**（同前一事故成因）。
