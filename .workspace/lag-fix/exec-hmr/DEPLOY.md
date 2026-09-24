# DEPLOY.md — 落地手册（HMR 热刷新时序缺陷修复 A）

> 交付单元：`.workspace/lag-fix/exec-hmr/`
> 选定方案：**A-2「槽错误边界上的有界延迟重挂 + 窗口期内不 abdicate」**（选型理由见 `plan.md §1.4`）
> 补丁件：`patch-hmr-timing.mjs`（dry-run 默认 / `--apply` / `--rollback` / `--self-test`）
> 候选字节：`candidate/A1-renderer.patched.client.js`、`candidate/A2-hmr-latch.patched.client.js`
> 探针：`probe-hmr.mjs`（**真的触发热刷新**，见 `report.md` 验收节）

---

## 0. ⚠️ 最重要的一条：落地后**必须硬刷新**（Ctrl+Shift+R）

**为什么必须刷新**：补丁改的是 `dsh-client-ui-renderer/lib/client.js`。
而 `ctx.uiRenderer.mount` 只在 boot 时建一次 React root（`dsh-client-ui-renderer/lib/client.js:973-981`），
`renderSlot('root')` 与 `SlotRegistry.hostFace()` 都在那一刻被闭包捕获（`dsh-client-runtime/lib/client.js:253-282`）。
⇒ **热改 renderer bundle 不会让“已经在跑的那棵 React 树”换成新代码**（旧闭包继续渲染）。
不刷新的话：本修复**不会生效**，而且你会以为已经修好了。

**落地流程（顺序不能颠倒）**：

1. 写补丁（本步由主 agent 执行，见 §1）；
2. **要求用户按 Ctrl+Shift+R 强刷一次**（不需要重启宿主，客户端 bundle 按 `/plugins/<id>/client.js?rev=…` 重新取）；
3. 强刷之后，**此后每一次**客户端插件写入都受保护（包括本程序里剩下的所有落地）；
4. 强刷是**唯一一次**额外代价——它同时也是“部署新 bundle 本来就要做的”那一次刷新。

> 落地这一批时如果用户本来就要刷新（例如同批还有别的客户端落地），
> 请**把客户端写入攒成一批**，让“必须刷新”这次代价被合并掉，不额外多要一次刷新。

---

## 1. 落地（写产品树，二选一）

### 1.1 方式 A（推荐）：写产品树 + 强刷

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-hmr

# ① 先 dry-run（默认就是 dry-run，不写任何字节）
node patch-hmr-timing.mjs
#   期望输出：A1-renderer / A2-hmr-latch 两个单元都 [ok]，
#   且每个 edit 都写明 "anchor matched once"。任何 anchor 命中数 ≠ 1 ⇒ 一个文件都不写、exit=2。

# ② 落盘（自动写 pre-image、自动 node --check、失败自动还原）
node patch-hmr-timing.mjs --apply
#   期望输出：每个文件 "sha256: <before> -> <after>"、"node --check: OK"、pre-image 路径

# ③ 顺手把候选字节也留一份（可选，便于事后比对）
ls -la candidate/ preimage/
```

**基线 sha256（未打补丁，用于事后核对）**

| 文件 | 基线 sha256 |
|---|---|
| `…/dsh-client-ui-renderer/lib/client.js` | `4361ea099f70506010482babd7075dc700e0f94485e71f0c989b68e4e278c229` |
| `…/dsh-client-hmr/lib/client.js` | `b4b414537f4169bc0a9da6b66a974edceb74d91c1570b4018f4fc34c7ec92478` |

**打补丁后的 sha256（本次候选字节，已 `node --check` 通过）**

| 文件 | 补丁后 sha256 | 字节 |
|---|---|---|
| `dsh-client-ui-renderer/lib/client.js` | `7468f0c67407622f83a483d8d7f1788069ead374218aff2d6ef0b76cd4143172` | 39235 → 42999 |
| `dsh-client-hmr/lib/client.js` | `8ea91bb3b48ccb3f2b416739ab9fb305966f442042f5152c4f97b0f9412b1efc` | 3427 → 4219 |

> 若只想上 A1（renderer），加 `--no-hmr-latch`。A1 单独可用（判据 ② 的前半段 = 边界挂载时效），
> 但 A2 让“热刷新窗口”变成**可直接观测**的事实（`globalThis.__DSH_HMR__`），**建议两个都上**。

### 1.2 方式 B（零产品树写入）：profile shadow + 重启宿主

已在 `.workspace/lag-fix/exec-hmr/evidence/isolated-host.md` 逐条实测（含行号级解析链证据）：
`dsh-client-modules/lib/index.js:274-276` 用 `createRequire(<profileDir>)` 解析包，
所以 `<profileDir>/node_modules` **优先于** `$DSH_HOME/profiles/node_modules` 的产品树符号链接。

```bash
P=~/.dsh/profiles/web/node_modules/@deepseek-ai
mkdir -p "$P"
cp -a ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer "$P/"
cp -a ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-hmr        "$P/"
cp candidate/A1-renderer.patched.client.js "$P/dsh-client-ui-renderer/lib/client.js"
cp candidate/A2-hmr-latch.patched.client.js "$P/dsh-client-hmr/lib/client.js"
# 然后重启 3080 宿主，并强刷页面
```

**两条方式的差别**（请按需选）：

| | 方式 A 产品树 | 方式 B profile shadow |
|---|---|---|
| 写到哪里 | `~/.npm-global/.../node_modules/@deepseek-ai/*` | `~/.dsh/profiles/web/node_modules/@deepseek-ai/*` |
| 需要重启宿主吗 | **不需要**（路径没变，只是字节变了） | **需要**（`pkgMeta` 按包名缓存不过期，`dsh-client-modules/lib/index.js:80-85`） |
| 影响范围 | 所有 profile / 所有宿主实例 | 只有该 profile |
| 强刷仍需 | **需要** | **需要** |
| 回滚 | `--rollback`（用 pre-image） | 删掉 shadow 目录 + 重启 |

---

## 2. 落地后的自检（不需要跑探针）

强刷后，在**页面 Console** 里粘这三行，逐条核对：

```js
// ① 修复已激活（A1）
!!window.__DSH_HMR__                      // 期望：true（上了 A2 才有；只有 A1 时为 undefined，不算失败）
// ② 之后每次插件热刷新都会被记录（有恢复即非空数组）
window.__DSH_SLOT_TRANSIENT__              // 期望：[] 或含 {slotKey, message, attempts, ageMs, viaHmr, at} 的数组
// ③ 缺服务仍然如实报错（阴性对照随时可做：见 §3.3）
```

**真正的落地自检 = 做一次“无害字节写入”**（见 §3.1）。这一步做完，你就有了“这条线以后可以放心写客户端插件”的实证。

---

## 3. 验收（探针口径，可在隔离宿主上复跑）

### 3.1 隔离宿主（**不触碰 3080、不触碰用户 profile**）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-hmr
./iso-main.sh setup                     # 建独立 DSH_HOME（iso-home/），profile 是副本
./iso-main.sh shadow dsh-client-ui-conversation   # 把要触发的包放进 shadow（只影响隔离宿主）
# 启动（受管后台作业；端口 3187）—— 见 report.md 里记录的确切命令与 job id
DSH_HOME="$PWD/iso-home" node ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js \
  web --port 3187 --host 127.0.0.1 --no-open --trusted-host 127.0.0.1:3187
```

**为什么 shadow 是安全的**：`/plugins/<id>/client.js` 的路由与 HMR 的 stat 轮询读的是**同一个**
`clientModules.clientPath(id)`（`dsh-client-modules/lib/index.js:317,480` / `dsh-client-hmr/lib/index.js:95,58,82`）。
shadow 后这个路径落在 `iso-home/` 里 ⇒ **往 shadow 写字节只会让隔离宿主推 `rebuilt`，3080 收不到任何帧，产品树零写入**。
（实测依据见 `evidence/isolated-host.md §3.2/§3.3`。）

### 3.2 跑臂

```bash
node probe-hmr.mjs --arm=recon        --base=http://127.0.0.1:3187   # 基线 + 启动回归
node probe-hmr.mjs --arm=repro        --base=http://127.0.0.1:3187   # 对照：未修 ⇒ 必须复现缺陷
node probe-hmr.mjs --arm=fix          --base=http://127.0.0.1:3187   # 修复：必须不崩且被记录
node probe-hmr.mjs --arm=selfreload   --base=http://127.0.0.1:3187   # 修复自身热刷新不得自崩
node probe-hmr.mjs --arm=neg-service  --base=http://127.0.0.1:3187   # 阴性对照①：真缺失仍须报错
node probe-hmr.mjs --arm=neg-other    --base=http://127.0.0.1:3187   # 阴性对照②：非服务错误立即报错
```

探针会自己在 shadow 里写“无害注释字节”并在结束时按 sha256 **还原原始字节**；
每个臂的原始 JSON 落在 `evidence/probe-<arm>-<ts>.json`，截图落在 `shots/`。

### 3.3 阴性对照（真缺失必须仍如实报错）

`--arm=neg-service` 用 route 拦截把一份**改坏**的 `dsh-client-ui-conversation` 只送到页面
（把 `super(ctx, "conversation")` 改名 ⇒ `conversation` 服务**真的不存在**）。
期望：**必须**出现 `slot entry crashed in 'conversation.session'` 与
`ui-conversation: conversation service unavailable`，且 `[data-slot-error="conversation.session"]` 出现
⇒ 证明修复没有把真实错误吞掉（只是把报告延后到重试预算耗尽）。

---

## 4. 回滚

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-hmr
node patch-hmr-timing.mjs --rollback
#   期望输出：每个文件 "sha256: <now> (expected <before>) MATCH"、"node --check: OK"
# 回滚后请核对 sha256 == §1.1 的基线值；然后强刷页面。
```

- pre-image 落在 `preimage/`，索引 `preimage/state.json`（含 unit / file / sha256Before / sha256After / appliedAt）。
- `--rollback` 只还原“本脚本自己的记录”，**不会**碰别的文件。
- 回滚后行为**逐字**等于今天（补丁是纯字面锚点替换，没有新依赖、没有新服务、没有改 shell）。

---

## 5. 已知边界与注意事项

1. **修复保护的是“之后每一次写”，不是“写它自己的那一次”**（原因见 §0）。所以落地顺序必须是
   **先写补丁 → 再强刷 → 之后才正式写业务插件**。
2. **不要**把 shadow 放进 `$DSH_HOME/profiles/node_modules`（`healProfilesModuleFallback` 会接管那一层，
   `dsh-app-boot/lib/index.js:371-386` `ensureSymlink` 遇非符号链接直接抛错）。要放 `profiles/<name>/node_modules/`。
3. A2 只发布 `globalThis.__DSH_HMR__ = { rebuilds, inFlight, lastRebuiltAt }`，
   **不改变 `reload()` 的任何控制流**（原函数体整体改名为 `reloadEntry`，外面包一层 try/finally 记时间戳）。
   若不需要它，`--no-hmr-latch` 只上 A1。
4. 本修复**不覆盖**第二类疑似缺陷（`dsh-client-modules/lib/client.js:135` 的 `data-plugin` 归属）——
   只登记，不在本批修（见 `report.md`「第二类缺陷登记」）。
5. 若以后升级 DSH 产品树，锚点会随上游 bundle 变化：**先跑 dry-run**，anchor 不唯一命中就一个字节都别写
   （脚本会 exit=2 并说明命中数），此时按新 bundle 重新定位锚点即可。
