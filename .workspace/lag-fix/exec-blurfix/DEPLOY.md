# DEPLOY.md — exec-blurfix 落地说明（U-BLUR1 通用 M1 控制器）

> **一句话**：把 `candidates/theme.client.js`（117,156 B，sha256 `33216710f957e319e587…`）写到
> `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js`，然后
> **要求用户按 `Ctrl+Shift+R` 强刷一次**（本文 §3 说明为什么**必须**强刷）。
>
> 写入由**协调者**执行（本档不能写工作区外）。命令是脚本里的既有能力，**dry-run 默认**。

---

## 0.5 ✅ 当前落地状态（2026-09-22 18:1x 复核）

| 项 | 值 |
|---|---|
| deployed 现状 | **已写入本线候选件**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js` = `33216710f957e319e587fc6430c37cf245957cc094132d3c660550cf601a31d2`（117,156 B） |
| 服务端下发字节 | 与候选件**逐字节相同**（`curl` 与探针 `env.served.matchesCandidate=true` 双重核对） |
| 落地后复核 | `raw/lab-post1.json`：① 73.3% → **3.6%**；负对照 56.9%；③ A1 **PASS**；④ A2 **PASS**；边界 R6 100%（与 §5.2 一致） |
| 宿主 | 复核跑在**重启后的新宿主**上（协调者告知新宿主 pid 2988915；我的报 gates 里的 `hostPid` 检查的是旧 pid 301709 ⇒ 显示 `alive:false` 属正常，存活以 **HTTP 200/13–15 ms** 为证据） |
| 重启后二次复核 | `raw/lab-post2.json`：`env.served.matchesCandidate = **true**`（不拦截 URL，直接抓被服务字节，sha 与候选件逐字节相同）；① R1 **46.4% → R2 3.5%**；负对照 47.7%；③ A1 **PASS**；④ A2 **PASS**；边界 R6 98.9%。⚠️ 该轮 `env.boot.anims = 0` ⇒ "真实驱动"两腿（R4/R5）**本轮无效**（无驱动），真实驱动证据以 `lab-c1` 的 21.5%→3.8% 与 `carriers-c1` 的真实载体 71.1%→0.3% 为准 |
| 若要回滚 | 见 §3（`node apply-BlurFix-v1.mjs --rollback`）——注意 deployed 现在**已经是**候选件，`--rollback` 会还原成 pre-image `86f6ae4775ca…` |
| 重复落地 | 再跑 `--apply` 会报 **already-applied** 且不写字节（幂等，安全） |

> ⚠️ 重跑 §1 的 `--apply` **没有必要**（已落地）；若日后文件被改回 pre-image，按 §0 的前置检查重新走一遍即可。

## 0. 前置检查（写入前逐条确认）

```bash
# 1) 目标文件必须仍是记录的 pre-image（不是就别写，先查谁动过）
sha256sum ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js
#   期望：86f6ae4775ca2f4af29b7abaf200a18833b6675aa8446942f819342829eba6a5   (80,114 B)

# 2) 候选件身份
sha256sum .workspace/lag-fix/exec-blurfix/candidates/theme.client.js
#   期望：33216710f957e319e587fc6430c37cf245957cc094132d3c660550cf601a31d2   (117,156 B)

# 3) dry-run（不写任何字节；会打印锚点命中数、拼接后 sha、node --check 结果）
cd .workspace/lag-fix/exec-blurfix && node apply-BlurFix-v1.mjs
#   期望：anchor hits=1 offset=0；patchedSha256_12=33216710f957；syntax-gate(patched) pass=true；censusStable=true
```

**注意**：第 1 步的值是**唯一**允许拼接的源。若文件已被别的线改过（sha 不符），**不要**用 `--force` 之类绕过——
本脚本没有该开关，会直接拒绝（锚点唯一命中 + 全或无）。

---

## 1. 落地（写入 deployed）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-blurfix
node apply-BlurFix-v1.mjs --apply --allow-outside-workspace
```

脚本会：
1. 在 Buffer 上定位锚点（`window.__ModuleLoader__.load({\n\tid: "@deepseek-ai/dsh-client-ui-theme",`）——**必须唯一命中**；
2. 把自包含块 `candidates/blurfix-controller.js`（37,041 B）**逐字节**拼到文件开头，并留下成对哨兵
   `/* == dsh-blurfix/1 BEGIN … */ … /* == dsh-blurfix/1 END == */`；
3. 对拼接后的字节跑 `node --check`（不通过就不写）；
4. 自动抓 **pre-image**（`preimage/U-BLUR1.host-theme/theme.client.js.pre`）+ `manifest.U-BLUR1.host-theme.json`（前后 sha、块 sha、锚点偏移、结构标记普查）；
5. 写盘并保留原文件权限位（`664`）；
6. 第二次执行会报 **already-applied** 且**不写任何字节**（幂等）。

### 1.1 ⚠️ 这会触发用户页面的 HMR（必须与强刷一起安排）
写客户端 bundle **会推 `rebuilt` 帧**，并且在热刷新窗口内可能让依赖方崩溃 ⇒ **用户界面短暂空白，直到强刷**。
⇒ **建议**：把这次写入与其他线的客户端写入**攒成一批只让用户刷一次**。
⇒ **落地后必须明确告诉用户：请按 `Ctrl+Shift+R`（强刷）**，不要只按 F5。

---

## 2. 落地后复核（强刷之后跑；用**真正被服务的字节**）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-blurfix
node tools/blurfix-lab.mjs --stamp post1 --no-route
```

- `--no-route` = **不拦截**主题 bundle URL，改抓**磁盘上真正被服务的那份**，并与候选件比 sha
  （`raw/lab-post1.json` 的 `env.served.matchesCandidate` 必须为 `true`、`status=200`）。
- 期望（与 c1 同构）：`R2_carrier_ctrlON` 的 `>33ms` **≤10%**、`R1`（停用）**≈60–70%**、A1/A2/A3 三项审计 **PASS**、
  所有 run 的 `pageerror` 计数为 `0`；`env.boot.blurfix=true`、`tag="dsh-blurfix/1"`、
  `registry.census = {filesScanned:60, keyframes:19, pause:14, neverPause:5}`。
- 若 `env.boot.blurfix=false` ⇒ 说明服务的字节不是候选件（未强刷 / 写错文件 / rev 未变）⇒ **门禁会直接 BOOT_FAILED**（这是承重判据，不是"测试失败"）。

### 2.1 人工确认（30 秒）
1. 打开设置 → **Agent 预设 → 某行「查看」**（只读查看器）：对话框打开期间侧栏**不应卡顿**（实测同窗 71.1% → 0.3%）。
2. 遮罩关闭后，侧栏的状态点动画必须**立刻恢复**在动（成对恢复）。
3. 浏览器控制台执行 `window.__DSH_BLURFIX__.stats()`：`engaged` 只在遮罩可见时为 `true`；`residualAudit().inlineCount` 在遮罩关闭后应为 `0`。

---

## 3. 回滚（单条、可验证）

```bash
node apply-BlurFix-v1.mjs --rollback            # 只认 manifest 记录的 pre/post 两个 sha；第三种样子直接拒绝
sha256sum ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js
#   期望回到 86f6ae4775ca2f4af29b7abaf200a18833b6675aa8446942f819342829eba6a5
```
回滚后同样**需要一次强刷**才会生效。

### 3.1 不刷新的临时停用（kill switch，仅当前页面会话有效）
```js
window.__DSH_BLURFIX__.setEnabled(false)   // 立即 releaseAll() 并停止扫描；setEnabled(true) 立即恢复
```
用途：现场排查"是不是这条机制造成的"；**不是**持久化开关（刷新即回到默认启用）。

---

## 4. 生效面 / 影响面（落地前请确认口径）

| 项 | 值 |
|---|---|
| 生效面 | **热面**：写入后页面刷新即生效（宿主 HTML 注入的 `rev` 是 bundle 内容 sha1-12；服务端下发字节随磁盘变化） |
| 需要重启？ | **不需要**（这是"既有 bundle 的内容变更"，走 `dsh-client-modules` 的 `onRebuilt` 重哈希路径；新建插件才需要重启） |
| 改动文件数 | **1 个**（`@deepseek-ai/dsh-client-ui-theme/lib/client.js`），文件内是**纯加性**拼接（原文件 80,114 B 内容**逐字节未变**，只在头部前插 37,041 B + 1 个换行） |
| 注入的全局 CSS | **无**（全部是逐元素内联样式 + 一个 `document` 级 MutationObserver/定时器） |
| 运行期开销 | 快路扫描节流 200 ms；全量兜底扫描 2 s 一次（先几何筛、只对全屏元素读计算样式）；实测 `scanMsMax` 2.4–3.4 ms、sweep 1.9–3.0 ms；未介入时不动任何元素的样式 |
| 会被暂停的东西 | 仅"**被可见全视口模糊遮罩盖住、且在它背后、且无限循环**"的动画（外加遮罩背后的运行中过渡）；**5 个 spinner 与遮罩上方的元素一律不碰** |
| 观感代价（已量化） | 点阵之外**整页逐字节相同（max=0）**；被暂停元素脚印内的差异**恰好等于该动画自身某一相位**；遮罩关闭后动画立刻照常（详见 `report.md` §4.3 / §5.1） |
| 未覆盖 | 载体 5/6 的帧收益未测（INCONCLUSIVE）；遮罩**上方**的持续重绘仍会卡（观感优先，故意不停）；Gecko 未测 |
