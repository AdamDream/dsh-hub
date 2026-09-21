# 模型标签归因：本档交付索引（v2，响应协调者冻结令）

**状态**：动态采集已**冻结**（协调者指令：本机 7 条线各开浏览器、独占窗口 0/5、持锁期间 18–31 个外来 Playwright 进程）。我这侧**已停止一切新浏览器与新采集窗口**，进程已清零。以下是两段交付。

| # | 交付 | 内容 |
|---|---|---|
| **(a)** | **`structure.md`** | **静态源码 + 已有数据**的结构结论：模型标签真实渲染结构（组件表 + 行号）、哪些部分每次 commit 重建、模型行数量级（含配置实测：opencode-go 16 行 / adam 50 行）、`react.memo`=0 / 虚拟化=0 / 恒等选择器订阅（`client.js:1805`）等 path:line 证据。复算：`node lib/structure.mjs` → `raw/structure-facts.json` |
| **(b)** | **`experiment-design.md`** | **分离固有 vs 放大所需的受控实验设计**：自变量=应用侧事件投递（FULL/ZERO）、窗口序列（3 cycle × 4 窗 × 60s）、判据阈值（含 `LOAD-CONFOUNDED` 标记规则）、执行命令、**执行前必须修的 4 处器械缺陷（D1–D4）**。交协调者统一串行执行 |
| 证据 | `audit.md` | 冻结令前采集的完整归因记录（原始证据与内部比值出处）；顶部已加冻结声明。**其绝对 ms/fps 不得当基线** |
| 原始件 | `raw/phase-main.json` | 12 × 60s 原始窗口（CDP 累计原值 / WS 分类 / React commit 明细 / 进程负载采样），未删改 |
| | `raw/analysis.json` | `lib/analyze.mjs` 独立重算（integrity 12 窗 0 回退 0 issues） |
| | `raw/verify.json`、`raw/verify2.json` | 展开态复核（含 `settingsUnchanged: true`） |
| | `raw/fiber-diag.json` | fiber↔DOM 归属校准（证明"面板 fiber=0"不是器械瞎） |
| | `raw/ws-shape.json` | 事件流 payload 形态与字节数 |
| | `raw/structure-facts.json` | 静态结构机器可读件 |
| 器械 | `lib/structure.mjs` | 静态结构分析（纯源码读取，无浏览器） |
| | `lib/analyze.mjs` | 独立重算器（无浏览器） |
| | `lib/init.js`、`lib/probe.mjs` | 页内器械 + 交替窗口驱动（**已冻结，待串行窗口复用**） |
| | `lib/verify.mjs`、`lib/verify2.mjs`、`lib/init3.js`、`lib/diag-fiber.mjs`、`lib/ws-shape.mjs` | 复核与校准器械（同上） |

## 无浏览器即可复算的部分

```bash
cd .workspace/lag-fix/research-v2/model-tab
node lib/structure.mjs     # 静态结构（读 client.js）
node lib/analyze.mjs       # 从 raw/phase-main.json 独立重算全部 delta/对比/相关性
```

## 纪律

- 未点保存/应用/删除/模型切换；只点设置页导航标签与「编辑」只读披露开关
- 单浏览器实例（我这条线任一时刻只开 1 个）；运行结束已 `browser.close()`
- **未 pkill/kill 任何共享资源**；仅记录 PID（兄弟线浏览器：2104881 / 2906734 / 2922757 等）
- `~/.dsh/settings.yaml` sha256 前后一致（`75718baaaddff265`）
- 不为凑数字在并发下继续采集
