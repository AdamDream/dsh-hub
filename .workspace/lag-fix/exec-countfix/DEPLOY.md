# DEPLOY.md — U-W18B + U-W18B2 落地手册（**由协调者执行**）

> 本档（`exec-countfix`）**不写工作区外**，deployed 写入由协调者执行。
> 所有命令都在 `.workspace/lag-fix/exec-countfix/` 下运行。

---

## 0. 落地前：核指纹（不符 ⇒ 停下，别落）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-countfix
DEP=/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
sha256sum "$DEP/dsh-client-connection/lib/client.js" "$DEP/dsh-client-runtime/lib/client.js" | cut -c1-16
```

必须看到：

| 文件 | sha256 前 16 位 |
|---|---|
| `dsh-client-connection/lib/client.js` | **`f729a994183ae736`** |
| `dsh-client-runtime/lib/client.js` | **`4a2c298dd82613c7`** |

不符 ⇒ **停手上报**（可能已被他线改动）。脚本自身也把这个判据做成了**硬闸门**（不符则 `STOP` 且**零写入**）。

---

## 1. dry-run（默认，不写任何字节）

```bash
node apply-CountFix-v1.mjs            # 人读
node apply-CountFix-v1.mjs --json     # 机器读
```

期望：`mode=dry-run writes=0 ok=true`；两单元 `preHits=1`、`syntax-gate(planned).pass=true`；
U-W18B2 出现 `comment-only-assertion.logicIdentical=true`、`markers /* w07-throttle v1 */ 4→4`。

---

## 2. 落地 U-W18B + U-W18B2（**热面**，客户端插件；会触发用户页面 HMR 热刷新）

```bash
node apply-CountFix-v1.mjs --apply --allow-outside-workspace
```

- 两单元**先全部规划、后统一写盘**；任一锚点不唯一 / 指纹不符 / `node --check` 不过 ⇒ **一个文件都不写**。
- 写盘前自动抓 **pre-image**：`preimage/<unit>/client.js.pre` + `preimage/manifest.<unit>.json`（记前后 sha256、锚点偏移、mode、census）。
- 期望输出：

| 单元 | pre | post（预期） | 目标 |
|---|---|---|---|
| `U-W18B` | `f729a994183ae736` | **`3e2b048565b16e5e`** | `…/@deepseek-ai/dsh-client-connection/lib/client.js` |
| `U-W18B2` | `4a2c298dd82613c7` | **`1ac5d41659bd180e`** | `…/@deepseek-ai/dsh-client-runtime/lib/client.js` |

> ⚠️ **纪律**：写客户端插件会触发用户页面的 HMR 热刷新（该时序缺陷已修，见 `exec-hmr/report.md`），但落地后仍**应要求用户强刷一次**（Ctrl/Cmd+Shift+R）再验收。
> 同时注意：**11 条审计线 + 1 条执行线在飞**，此刻是争用窗口 —— 落地后先做**功能级**验收，性能复测留到安静窗。

### 落地后立即核（只读）

```bash
sha256sum "$DEP/dsh-client-connection/lib/client.js" "$DEP/dsh-client-runtime/lib/client.js" | cut -c1-16
# 期望 3e2b048565b16e5e / 1ac5d41659bd180e

node apply-CountFix-v1.mjs            # 期望 already-applied ×2，writes=0，ok=true
```

### 幂等

再跑一次 `--apply` ⇒ `already-applied`、`writes=0`、`ok=true`，**零字节写入**。
（幂等态改用 manifest 记录的 **post sha** 做指纹判据；无 manifest 则**拒绝**认作 PASS。）

---

## 3. 可选：U-W18B-EXT（**非审计单元，默认不选中 —— 需先裁决**）

**背景**：本档独立复核发现，**只落 U-W18B 不足以**触达审计验收判据 ②「UI 侧 `:171/286` 强分支可被命中」——
`dsh-client-runtime/lib/client.js` 的 `projectList()` 在 `:9324-9338` 有一张**显式 byId 白名单**（不含该字段），`:9384` 的 `stableById` 复用谓词也不含。
实测：U-W18B 后 **L1 99/99 但 L3/L4 仍 0/99**（`raw/chain-B.json`）；补 EXT 后 **L1/L2/L3/L4 全 99/99**（`raw/chain-C.json`），
且"子代理行未加载"场景从 **低报/缺口 2 行/37** 变为 **0/0**。详见 `report.md` §2 与 §五。

若裁决**采纳**：

```bash
node apply-CountFix-v1.mjs --unit U-W18B-EXT --apply --allow-outside-workspace
```

- 该单元的 pre 指纹接受两种状态：`4a2c298dd82613c7`（deployed 原态）或 `1ac5d41659bd180e`（U-W18B2 已落地态，**注释-only，锚点不受影响**）。
- 期望 post：`a822e97b39e2ae47`。
- 候选件可直接 diff：`candidates/dsh-client-runtime.client.U-W18B2+EXT.js` vs `candidates/dsh-client-runtime.client.U-W18B2.js`（见 `raw/diff-U-W18B-EXT.patch`）。
- **采纳后的行为变化是刻意的**：运行中子代理数变化时 `entryCache` 比较与 `stableById` 谓词会真正失配 ⇒ 一次 `list.set()` → React commit。
  频率上界 = **子代理启停事件数**（不是帧率），这正是徽标得以刷新的机制。

若裁决**不采纳** ⇒ 请把审计验收判据 ② 改写为
「L1 丢弃点关闭 + 字段随 `flattenLineage` 抵达 manager 条目」，或明确接受「UI 侧仍走弱口径」。

---

## 4. 落地后验收（**协调者必跑**）

### 4.1 数据级（真 bundle 字节 + 真内联 zod）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-countfix
DEP=/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai

# 全链路：L0 宿主 payload → L1 真 schema → L2 真 flattenLineage → L3 真 projectList → L4 UI 谓词
node tools/probe-chain.mjs "$DEP/dsh-client-connection/lib/client.js" "$DEP/dsh-client-runtime/lib/client.js" \
  ../program/w18-projection/raw/session-list-499k.json raw/post-deploy-chain.json \
  "$DEP/dsh-client-ui-workspace/lib/client.js"

# 声明字段语义/约束/非 passthrough
node tools/probe-field-semantics.mjs "$DEP/dsh-client-connection/lib/client.js" \
  ../program/w18-projection/raw/session-list-499k.json raw/post-deploy-semantics.json
```

**判据**：

| 项 | 落 U-W18B | 再落 EXT |
|---|---|---|
| `layerCounts.L1_afterRealSchemaParse_rowsWithField` | **99**（`= L0`） | **99** |
| `layerVerdicts.L1_dropPoint_closed` | **true** | **true** |
| `layerVerdicts.L1_valuesIdenticalToHost` | **true** | **true** |
| `l1_sentinel.otherDeclaredKeyMismatches` | **0** | **0** |
| `l1_sentinel.unknownKeyCanary.leaked` | **false** | **false** |
| `l1_sentinel.schemaIsPassthrough` | **false** | **false** |
| `layerCounts.L3_afterProjectList_byId_rowsWithField` | 0（已知缺口，见 §3） | **99** |
| `layerCounts.L4_uiStrongBranchHits_topLevel` | 0（已知缺口，见 §3） | **99** |
| `field-semantics`: `unknownKeyStillStripped` / `schemaIsPassthrough` | true / false | true / false |

### 4.2 渲染级（探针锁 + headless；`pageerror===0`、插件失败界面不出现、`.subagent` 界面正常）

```bash
# 等锁空闲（绝不回收未确证死亡的锁）
bash tools/with-lock-wait.sh 300 -- node tools/accept-browser.mjs \
  --out raw/post-deploy-browser.json --list-out raw/post-deploy-session-list.json
```

**判据**：`verdicts.pageerrorZero=true`、`noConsoleErrors=true`、`noPluginFailureUI=true`、`appRendered=true`、`hostWroteField=true`（顶层行 **101/101** 带字段）；
且 `badgeProbe.rows` 里出现的会话行徽标数**等于该行宿主值**。

> ⚠️ 已知局限：侧边栏默认**只渲染"当前会话所在组"**的行（`dsh-client-ui-workspace` 自动展开当前组；其余组折叠、且多数组不出现 `sessionOverflowButton`）
> ⇒ DOM 里通常只有 1–2 行会话，**徽标级 A/B 无法作为判据**；功能级判据请用上面的链路探针 + 截断扫描。
> ⚠️ `[data-slot]` 运行时是 `display:contents` ⇒ **可见面积恒 0，不得据此判失败**。
> ⚠️ 探针**不点击** Sessions 树行内按钮（会弹 Rename/Delete 菜单）。

### 4.3 回归：审计自带基准复跑（基线应仍复现）

```bash
node ../program/w18-projection/scripts/bench-zod.mjs ../program/w18-projection/raw/session-list-499k.json raw/post-deploy-w18zod.json
# 注意：它**手写复现** schema（用 dsh/node_modules/zod 4.6.2），落地后它的 droppedByFullSchema 仍会显示 ["runningSubagentCount"]
#       —— 这是**预期**的：它不读产品文件。真实判据请看 §4.1。
```

---

## 5. 回滚（每单元独立；拒绝猜）

```bash
node apply-CountFix-v1.mjs --rollback --unit U-W18B                     # 只回 U-W18B
node apply-CountFix-v1.mjs --rollback --unit U-W18B-EXT                 # 只回 EXT（若曾落地）
node apply-CountFix-v1.mjs --rollback                                   # 回滚一切有 manifest 的单元
```

- 只认 manifest 里的 **pre / post** 两个 sha：文件是**第三种样子**就 `refusing`（`raw/neg-4-rollback-thirdstate.json` 实测）。
- 回滚目标在工作区外 ⇒ 同样需要 `--allow-outside-workspace`：

```bash
node apply-CountFix-v1.mjs --rollback --allow-outside-workspace
```

- 回滚后期望 sha：`U-W18B` → `f729a994183ae736`；`U-W18B2` → `4a2c298dd82613c7`。
- `preimage/` 是回滚唯一依据，**请勿删除**。

---

## 6. 一览表

| 单元 | 目标文件 | pre | post | 默认选中 | 面 |
|---|---|---|---|---|---|
| `U-W18B` | `dsh-client-connection/lib/client.js` | `f729a994183ae736` | **`3e2b048565b16e5e`** | ✅ | 热（客户端插件，需强刷） |
| `U-W18B2` | `dsh-client-runtime/lib/client.js` | `4a2c298dd82613c7` | **`1ac5d41659bd180e`** | ✅ | 热（纯注释，逻辑零改动） |
| `U-W18B-EXT` | `dsh-client-runtime/lib/client.js` | `4a2c298dd82613c7` 或 `1ac5d41659bd180e` | `a822e97b39e2ae47` | ❌（需裁决） | 热 |

> 落地顺序建议：`U-W18B` + `U-W18B2` 一起（一条命令），验收通过后再决定 `U-W18B-EXT`；两者可**同一次刷新**生效。
