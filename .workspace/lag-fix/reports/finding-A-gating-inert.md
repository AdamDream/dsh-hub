# 发现：A 线「可见性门控」曾经是**死代码**（标记存在但行为完全失效）

**发现时间**：2026-09-20（目标轮 6）· **发现方式**：**行为验证**探针，而非读标记
**严重度**：中高 —— 不造成错误结果，但**一项已宣称交付的需求实际未生效**，且此前 4 条交叉审计全部漏过

---

## 一、症状与根因

`@local/dsh-usage/lib/client.js` 里的可见性门控（A 线 B2 项）长这样：

```js
const setPollVisibleRef = react.useRef(null);
// Set inside the effect below; the IntersectionObserver callback reads it
// so a visibility change never needs to re-create the observer ...
const attachCardRef = react.useCallback((node) => {
  ...
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries)
      if (setPollVisibleRef.current) setPollVisibleRef.current(Boolean(entry.isIntersecting));
  }, { threshold: 0 });
  observer.observe(node);
  ...
}, []);
```

轮询 effect 依赖 `pollVisible`：

```js
if (!pollVisible || (typeof document !== "undefined" && document.hidden)) return;
const timer = setInterval(...);
return () => clearInterval(timer);
}, [refreshSec, pollVisible]);
```

**根因**：全文件**没有任何一处**给 `setPollVisibleRef.current` 赋值（注释声称"Set inside the effect
below"，但那个 effect 根本不存在）。于是：

1. 观察器回调里的 `if (setPollVisibleRef.current)` **恒为假** → 回调是空操作；
2. `pollVisible` 永远是初始值 `true` → effect 的依赖从不变化 → 定时器**从不被清理**；
3. 结果：卡片滚出视口后**照旧每 60s 轮询一次**，而每次轮询在旧宿主上要冻结事件循环 ~0.3–0.5s。

## 二、为什么 4 条交叉审计都没抓到

| 审计线 | 它检查了什么 | 为什么漏了 |
|---|---|---|
| 补丁完整性与可回滚性 | live 目标的 sha/行数/**标记字符串是否存在** | 检查的是"补丁是否落地"，不是"落地后是否有效" |
| 客户端生效与回归 | 4 个包 rev/字节一致、**8 个设置标签能渲染**、用量卡片**能渲染** | "能渲染"不等于"门控生效"；看的是页面可用性，没有制造"出视口"场景 |
| 验收数据可信性 | 数字可追溯性 | 不覆盖功能行为 |
| 文档/数据线 | 与 A 线无关 | — |

**教训**：对"行为类需求"（门控、节流、去重、缓存命中），验证必须**制造触发条件并观察前后差异**，
不能以"标记/代码存在"或"页面能渲染"代替。本轮的探针即是补上这个缺口。

## 三、修复

在三处同步补上接线（并加显式标记 `dsh-perf-fix A-gating-fix v1`，便于日后 grep 与幂等判定）：

```js
const setPollVisibleRef = react.useRef(null);
/* dsh-perf-fix A-gating-fix v1 */ /* 必须把 setter 接到 ref 上：缺此行时观察器回调里的
   if (setPollVisibleRef.current) 恒为假 → pollVisible 永远 true → 门控完全失效（死代码）。
   与下方 loadAllRef.current = loadAll 同一写法（渲染期赋值）。 */
setPollVisibleRef.current = setPollVisible;
```

| 目标 | 文件 | 修复后 sha256（前 16） |
|---|---|---|
| 部署件（live，热替换即生效） | `~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js` | `eeb5dcf2f4bd638b` |
| 源码件 | `dsh-usage/lib/client.js` | `911d050b4bfa45ed` |
| 替换规格（防重放复发） | `patches/usage-plugin.replacements.txt` | 已在 `client-poll` 作业的 `@@NEW` 段补同一行 |
| 备份指纹 | `backup-usage/{deployed,source}/backup-20260920-154018/POST_SHA256SUMS` | 已更新（附 `.note` 留痕） |

## 四、验证（行为级前后对比）

探针：`probes/verify-usage-gating.mjs`（自带**前提自证**：先确认卡片几何上完全离开视口，
否则报 INCONCLUSIVE 而不是误判 FAIL）。

| 相 | 条件 | 修复前 | 修复后 |
|---|---|---|---|
| A | 卡片在视口内 70s | 7 次请求（挂载后 60s 轮询一次） | 7 次请求（同） |
| **B** | **卡片完全出视口 70s** | **7 次请求（114s 仍在轮询）← 缺陷** | **0 次请求** ✅ |

原始证据：`reports/usage-gating.json`（修复前）与 `reports/usage-gating-after-fix.json`（修复后）。

顺带在同一次测量中确认了 A 线的另外两项：
- **轮询间隔 = 60s** ✅（挂载 → 54s → 114s，间隔 60s）
- **客户端窗口日对齐** ✅（实测 `from=2026-09-13T16:00:00.000Z` = 本地 UTC+8 的 09-14 00:00 整点）
- 首屏加载与手动刷新**不受门控**（与代码注释一致，属预期）

## 五、对既有结论的影响

- `reports/unit-A.md` 与 `RUNBOOK §一` 中"A 线已落地"的说法**需要加注**：门控部分在 2026-09-20 轮 6
  之前**实际未生效**，本轮修复后才真正交付（其余部分——`usage_daily` 路线、日对齐、60s 间隔、
  首屏不门控——经本轮行为验证**均成立**）。
- 该缺陷**不影响**任何已给出的性能数字（它只是"少省了一些轮询"，方向与结论一致，不存在虚报）。
- 该缺陷**不影响**回滚安全性（只涉及客户端 bundle 内容，`POST_SHA256SUMS` 已同步）。

---

## 六、同类风险普查（同一教训的系统性排查）

发现 A 线门控是死代码后，用同一视角（**声明/标记存在 ≠ 行为生效**）排查了其余性质相同的改动：

| 改动 | 风险类型 | 核查方式 | 结论 |
|---|---|---|---|
| **C1 P2** 三个引用稳定化比较器（`sameIdList`/`sameJobViewList`/`sameSubagentCatalogs`/`sameSubagentCatalogEntries`） | ①是否被调用（死代码）②是否过宽（内容变了判相等 → **界面静默冻结**） | ①grep 调用点：L9324/9342/9346 **各 1 处**，用于保留引用 ✅；②新增 `tools/test-c1-comparators.mjs`：从 live 文件**程序化抽取**四个函数，逐字段验证"改一个字段必须判不等" | **通过（46/46）**：三个比较器均已接线；每个被比较字段都能正确判不等；字段名在依赖树 695 个文件里均真实存在（不存在则比较恒为 `undefined !== undefined` → 该维度会被漏判） |
| **C2** `sessions()` 按快照对象标识记忆化 | 若 store **就地 mutate** 同一对象 → 记忆化会返回陈旧行（静默冻结） | 静态核查 store 语义：`getSnapshot()` 为「缓存引用 + 失效时重建」（runtime `snapshotCache` / `notifier.ensureFresh()` 的 docstring 明示） | **前提成立（安全性方向）**：引用变化必伴随内容变化 → 只会保守失效、不会返回陈旧行。残留不确定性：未见就地 mutate 的 store；**若要彻底证实需在真实远程工作区做行为验证**（本轮无该条件，登记为未验证项） |
| **A 线另外三项**（`usage_daily` 路线 / 日对齐 / 60s 间隔） | 声明存在但无效 | 行为验证（本轮门控探针顺带覆盖） | 均**成立** ✅：轮询间隔实测 60s；窗口 `from` 为本地当日 00:00（日对齐）；首屏与手动刷新不受门控（符合注释） |

**方法论沉淀**（建议纳入后续所有"行为类需求"的验收）：
1. 行为类需求（门控/节流/去重/缓存/稳定化）必须**制造触发条件并观察前后差异**，不能只验标记或"页面能渲染"；
2. 探针必须**自证测试前提**（如"卡片确实完全出视口"），前提不成立时报 INCONCLUSIVE 而非误判 FAIL；
3. 比较器/缓存类改动要做**反向测试**：不仅验"该稳定时稳定"，还要验"该失效时必须失效"。
