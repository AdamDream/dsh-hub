# 事故报告：会话列表全空白（B1 补丁 `ctx` 作用域缺陷）

**时间**：2026-09-20 18:26 症状出现（宿主重启后）／18:33 定位并修复
**症状**：GUI 侧边栏**看不到任何会话**，用户判读为「会话被全删了」
**实际**：**没有任何用户会话丢失**；被删的 1,670 个全部是 `origin=subagent` 会话（B2 计划内操作）
**结论**：`POST /api/session.list` 抛 `ReferenceError: ctx is not defined` → HTTP 500 → 客户端拿不到行

---

## 1. 根因（源码级）

B1 补丁（单元「会话列表全量下发 + 聚合字段」）新增了一个**模块级**函数：

```
dsh-host-apiproxy/lib/index.js:1243   function annotateRunningSubagentCounts(items) {
dsh-host-apiproxy/lib/index.js:1253       for (const session of ctx.sessions.list()) ...   ← ctx 从哪来？
dsh-host-apiproxy/lib/index.js:2292       return annotateRunningSubagentCounts(retained);
```

`ctx` 只是 `createApiProxy(ctx, defaults)`（同文件 :1708）的形参；该函数定义在**模块顶层**（第 0 列），
作用域链里没有 `ctx` → 调用必抛 `ReferenceError`。`lib/types/api-proxy.js:394/1529` 同一份代码同缺陷。

**为什么 15:40 写入时没炸、18:26 才炸**：B1 的宿主半是**冷面补丁**，必须重启才被加载。
15:40 落地后补丁一直处于「已写入但未生效」状态；18:26 重启使新代码上线，缺陷立即显形。

**为什么 4 条审计 + 语义测试全漏过**（关键教训）：
`patches/B1-semantic-test.cjs:138` 原写法

```js
const makeFn = new Function('ctx', `${fnSrc}; return annotateRunningSubagentCounts;`);
const annotate = makeFn(hostCtx);          // ← 测试自己把 ctx 补成了包装函数形参
```

测试**替被测代码提供了缺失的绑定**，因此自由变量 `ctx` 在测试里永远合法 → 该缺陷在测试中**不可能显形**。
这是「测试无法证伪实现」的典型：测试环境比生产环境"更宽容"。

---

## 2. 修复（最小作用域修正，3 处）

| 文件 | 行 | 改动 |
|---|---|---|
| `lib/index.js` | 1243 | `annotateRunningSubagentCounts(items)` → `(ctx, items)` |
| `lib/index.js` | 2292 | 调用点 → `annotateRunningSubagentCounts(ctx, retained)` |
| `lib/types/api-proxy.js` | 394 / 1529 | 同上（两处） |

- 生效件路径：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/`
  （`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-host-apiproxy` 是指向它的**符号链接**，同一份文件）
- pre-image 备份：`backup/B1/server/b1fix-20260920-183319/{index,api-proxy}.buggy.js` + `pre.sha256`
- 修复后 sha256：`index.js=1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62`
  `api-proxy.js=f5c34a439043b9d5771286a76c8b16210951c25d7d5873b168bcc947720eac0d`
- **生效方式：需重启宿主**（冷面补丁）

## 3. 防重放复发（改回放规格，不止改现场）

| 文件 | 改动 |
|---|---|
| `patches/B1-transform.cjs:181/213/279` | 生成代码签名与调用点同步改为传 `ctx` |
| `patches/B1-transform.cjs:verifyServerFilter` | 新增 3 条**防复发断言**：签名必须声明 `ctx`、调用点必须传 `ctx`、函数体引用 `ctx` 则签名必须接收它 |
| `patches/B1-semantic-test.cjs:123/138-140` | 抽出函数改用正则（不再写死签名）；**去掉 `new Function('ctx', …)` 注入**，改为 `makeFn()(hostCtx, rows)` |
| `patches/B1-semantic-test.cjs:191` | 第二处调用点同步改为 `makeFn()(hostCtx, …)` —— 修好盲点后**当场暴露**的漏传参调用点 |

## 4. 验证证据（重启前，全部真跑）

| 证据 | 结果 |
|---|---|
| `node --check`（两份文件） | PASS |
| `probes/verify-b1-ctx-binding.mjs`（修复件） | **PASS**：《真实函数体解出、不注入 ctx 调用成功》+《语义 top1=2/top2=1 正确》+《反向对照：旧签名必须抛 ReferenceError》 |
| 同一探针跑 pre-image（有 bug 版） | **FAIL**（证明探针有证伪能力，不是空过） |
| 回放规格复算（从**原始基线**重跑变换） | `verifyServerFilter` 0 failure + ESM 语法 OK + 探针 PASS |
| `patches/B1-semantic-test.cjs`（修好盲点后） | **全部 PASS**（含 N=200 截断语义、顶层逐 ID 相等、聚合计数逐 id 与客户端实现相等） |
| 模块级自由变量普查（`ctx` 未声明） | 两份文件 **0 处残留** |

## 5. 数据事实（会话到底少了什么）

| 项 | 数值 |
|---|---|
| 磁盘现存会话目录 | **756（顶层 90 / subagent 666）** —— header 级普查口径（逐目录解 `session.jsonl.zstd` 首行取 `origin`）；与宿主下发行**逐条吻合** |
| projcache 登记 | 2,423（含 1,670 个**孤儿键**，B2 phase 2 未执行） |
| B2 phase 1 已删 | 1,670 个目录 / 770,143,893 B，**全部 `origin=subagent`**（逐个解 header 复核，`{subagent: 1670}`，顶层 **0 个**） |
| 可恢复性 | `backup/B2/20260920-074510/deletable-sessions.tar`（774,400,000 B 真副本）+ `meta/`（projcache / usage.db / workspace.json） |

> 结论：**用户顶层会话一条未删**；「全删了」的观感完全来自 `session.list` 500。

> ⚠️ **口径更正（自查登记）**：本报告初稿写「顶层 120」是用 projcache 的 `subagent` 投影行做真值判断得出的，
> 属**高估 32 条**——那 32 条会话在 projcache 里有 `subagent` 行但 `val` 为 `null`，被误判为顶层。
> header 级普查（权威）为 **顶层 90 / subagent 666**，与宿主实际下发的 90 条顶层逐条吻合。
> 教训同 §1：**投影行 ≠ 权威字段**，判定必须落在 header。

## 5.1 重启后实测（2026-09-20 18:39）

| 项 | 结果 |
|---|---|
| 旧宿主退出 | PID 741611 SIGTERM → 1s 退出 |
| 新宿主 | PID 751793，boot OK 2s，冒烟 HTTP 200 |
| `POST /api/session.list` | **HTTP 200 / `ok:true`**（此前 HTTP 500 `ReferenceError: ctx is not defined`） |
| 下发条目 | **290 = 顶层 90 + subagent 200**（B1 截断语义生效；响应 469,855 B < 500KB 门槛） |
| 顶层行 `runningSubagentCount` | **90/90 全覆盖**（number） |
| 会话日志写入 | 新宿主正常写 `~/.dsh/sessions/...`（本会话 `session-d565c2bf` 持续增长）→ 未继承沙箱限制 |
| 用户手动 `npx dsh web` 报 `EADDRINUSE 127.0.0.1:3080` | **属正常现象**：新宿主已占用端口，无需再起一个实例 |


## 6. 待决：B1 冷会话预截断的第二个缺陷（同类：假设了不存在的字段）

```
lib/index.js  冷会话分支： coldSource.filter(meta => meta.origin === "subagent")
                                .sort((a, b) => b.updatedAt - a.updatedAt)   ← meta 上没有 updatedAt！
```

`persistence.list()` 返回的是**会话 header**（`listArtifacts().map(a => a.header)`，由 `fromHeaderLine` 构造），
实测真实 header 字段集 = `agentPreset / createdAt / cwd / delegationDepth / id / origin / parentSession / type / version`
—— **没有 `updatedAt`**。于是比较器恒 `NaN` → 排序退化为无操作 → `slice(0,200)` 取到的是**枚举顺序**而非「最近 200 条」。

- 影响面：**冷会话** subagent 行的可见性（最近活跃的 subagent 可能不在列表里，显示的反而是任意/较旧的 200 条）；
  **正在运行**的 subagent 走内存分支（用 `sessionListUpdatedAt(header, metadata)`，口径正确）→ 不受影响。
- 语义测试同样漏过：它是在**summary 行（带 updatedAt）**上模拟过滤，而生产是在**header meta** 上排序——同一类盲点（测试数据形状 ≠ 生产数据形状）。
- 处置：**未擅自修改**（超出本轮批准的「改 2 处传 ctx」范围），待裁决。

## 7. 回滚与复验命令

```bash
# 回滚到修复前（会恢复 500 症状，仅在修复本身出问题时用）
S=/home/CNS2026495165/dsh/.workspace/lag-fix/backup/B1/server/b1fix-20260920-183319
P=/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib
cp -a "$S/index.buggy.js" "$P/index.js" && cp -a "$S/api-proxy.buggy.js" "$P/types/api-proxy.js"
bash /home/CNS2026495165/dsh/.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh --yes

# 复验（重启后）
node /home/CNS2026495165/dsh/.workspace/lag-fix/probes/verify-b1-ctx-binding.mjs --file "$P/index.js"
curl -s -X POST http://127.0.0.1:3080/api/session.list -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"chk","method":"session.list","payload":{}}' | head -c 200
```
