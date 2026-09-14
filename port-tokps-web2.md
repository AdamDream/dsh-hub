# 子代理 tok/s 显示：0.1.1-rc.2(web,已打补丁) → 0.1.5-rc.2(web2) 移植报告

日期：2026-09-11
目标文件：`/home/CNS2026495165/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js`（0.1.5-rc.2，CJS bundle，未压缩）
参考实现：`/home/CNS2026495165/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js`（0.1.1-rc.2 已打补丁；其补丁内容见 `.bak-20260911-105723` diff）

## 0. 数据链路确认（新版仍在）

- `dsh-session-stats`（web2）`lib/types/projection.js` / `lib/index.js`：`sessionStats` projection 仍在 `ctx.sessionProjections` 注册，schema 仍含 `decodeMs`、`decodeTokens`（非负 number）。
- `dsh-api-session-controller`（web2）`lib/client.js` ~L2896：列表快照把 `projectionStore.values()` 整体并入 summary 的 `projectionValues`，故 `summary.projectionValues.sessionStats`（含 decodeMs/decodeTokens）在 0.1.5 仍在。
- `dsh-client-ui-session`（web2）`lib/types/client/index.d.ts`：`SessionStandardProps` / `SessionMaybeStandardProps` 仍声明 `useProjection: UseProjection`；`conversation.composer` 为会话作用域 slot（宿主 ui-conversation 以 `renderSlotChain("conversation.composer", …)` 渲染并注入标准 props，其内部 `InputBar` 等同样消费 `useProjection`），因此只读 composer 组件可收到 `useProjection`。旧版补丁中 `typeof useProjection === "function"` 守卫一并保留，无会话/无该 prop 时优雅跳过。

## 1. 旧版改动点 → 新版对应锚点映射

旧版补丁共 4 处（.bak diff 可证），新版对应移植为 5 处编辑（其中 locale 键为 2 处同文案替换）：

| # | 旧版（0.1.1 已补丁）改动点 | 新版（0.1.5）锚点 / 位置 | 移植内容 |
|---|---|---|---|
| 1 | `formatTokens` 后新增 `formatTokensPerSecond` + `decodeTokensPerSecond`（diff `71a72,82`） | `formatTokens(value, t)` 结束 `}` 与 `/** Sum the four disjoint durable provider-usage buckets. */` 之间（现 L102–111） | 函数体逐字移植（`tps`≥10 取整否则 1 位小数；`summary?.projectionValues?.sessionStats`，`decodeMs<=0` 或缺失返回 `void 0`） |
| 2 | CatalogRows 指标区：新增 `tps`/`speedMetric`；`const metrics = [tokenMetric, durationMetric?.exact]...` 改为 `headMetric` + 过滤 `value !== ""`（diff `260a272,273`、`265c278,279`） | 新版 CatalogRows 指标区（现 L299–308）：`const tokenMetric = … t("tokens.total", …)` 之后、`durationMetric` 之前插 `tps`/`speedMetric`；`metrics` 行改为 `headMetric` + `metrics`（过滤条件加 `value !== ""`，因 headMetric 可能为空串） | 同旧版语义；`speedMetric` 文案改用 locale 键 `t("tokens.perSecond", { value: formatTokensPerSecond(tps) })`（见 §2） |
| 3 | 指标 JSX：`tokenMetric !== void 0 && … children: tokenMetric` → `headMetric !== "" && … children: headMetric`（diff `329c343`、`331c345`） | 新版指标 JSX `children: [tokenMetric !== void 0 && … metricToken … tokenMetric`（现 L372–374） | 改为 `headMetric !== "" &&` + `children: headMetric` |
| 4 | `SubagentReadOnlyComposer({ matched, t })` → `({ matched, t, useProjection })`，加 `stats`/`tps`/`speed`，页脚 children 追加 `speed !== void 0 && <span>`（diff `699c713`、`700a715,717`、`704c721`） | 新版 `function SubagentReadOnlyComposer({ matched, t })`（现 L733）及 `children: [<strong>…, <span>…]` 行（现 L741） | 同旧版逻辑：`typeof useProjection === "function" ? useProjection("sessionStats") : void 0`；`stats === void 0 \|\| stats.decodeMs <= 0` 时 `tps` 为 `void 0`；`speed` 用 `t("tokens.perSecond", …)`；children 末尾追加 speed span |
| 5 | （旧版无此步：旧版 `tok/s` 文案硬编码 `` `${v} tok/s` ``） | 新版 locale 字典内联于本 bundle：`zh`（原 L748 附近）与 `en`（原 L788 附近）各有一条 `"tokens.total": "{value} tok",` | 两字典均追加 `"tokens.perSecond": "{value} tok/s",`（2 处同文案，`replace_all` 一次替换） |

## 2. locale 处理方式

- 新版 0.1.5 该 bundle 的 `subagent` 命名空间字典（`zh`/`en`）**内联在 bundle 内**（`apply()` 中 `ctx.locale.register(NS, { zh, en })`），因此按任务优先级直接新增键。
- 新增键：`"tokens.perSecond": "{value} tok/s"`（zh 与 en 键集一致，值为同一模板）。调用处统一 `t("tokens.perSecond", { value: formatTokensPerSecond(tps) })`，与新版既有的 `t("tokens.total", { value: formatTokens(totalTokens, t) })` 风格一致（`{value}` 插值已由 tokens.total 验证可行）。
- 备注：`dsh-client-ui-chat` 0.1.5 有 `message.tokensPerSecond`（"{tps} tok/s"），但属于 `chat` 命名空间，本 bundle 的 `t` 以 `subagent` 为作用域，不可跨命名空间引用，故不借用，按内联字典新增。
- 渲染结果与旧版硬编码 `` `${v} tok/s` `` 完全一致（≥10 取整如 "12 tok/s"，否则 1 位小数如 "3.5 tok/s"）。

## 3. 验证输出

```
$ node --check /home/CNS2026495165/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js
SYNTAX OK

$ grep -c "tok/s" <bundle>            # 字典 2 处（zh/en 模板）
2

$ grep -n "formatTokensPerSecond\|decodeTokensPerSecond\|headMetric\|tokens.perSecond" <bundle>
102:  function formatTokensPerSecond(tps) {
107:  function decodeTokensPerSecond(summary) {
301:  const tps = decodeTokensPerSecond(summary);
302:  const speedMetric = tps === void 0 ? void 0 : t("tokens.perSecond", { value: formatTokensPerSecond(tps) });
307:  const headMetric = [tokenMetric, speedMetric].filter((value) => value !== void 0).join(" · ");
308:  const metrics = [headMetric, durationMetric?.exact].filter((value) => value !== void 0 && value !== "").join(" · ");
372:  children: [headMetric !== "" && (0, react_jsx_runtime.jsx)("span", {
374:    children: headMetric
735:  const speed = tps === void 0 ? void 0 : t("tokens.perSecond", { value: formatTokensPerSecond(tps) });
766:  "tokens.perSecond": "{value} tok/s",
807:  "tokens.perSecond": "{value} tok/s",
```

锚点唯一性：每个 old_string 替换前经 grep 计数——`Sum the four disjoint durable provider-usage buckets`=1、`const metrics = [tokenMetric, durationMetric`=1、`tokenMetric !== void 0 && (0, react_jsx_runtime.jsx)("span", {`=1、`function SubagentReadOnlyComposer({ matched, t }) {`=1、`"tokens.total": "{value} tok",`=2（zh/en，`replace_all` 同文案替换）。改后 `node --check` 通过。

## 4. 降级行为说明

- 目录行（SubagentHeaderLineage/CatalogRows）：
  - `summary` 缺失、`projectionValues.sessionStats` 缺失、或 `decodeMs <= 0`（无解码阶段/未产出首 token）→ `decodeTokensPerSecond` 返回 `undefined` → `speedMetric` 为 `undefined` → 被 `headMetric` 过滤，不显示 tok/s。
  - `tokenMetric` 与 `speedMetric` 均缺失时 `headMetric === ""` → `metrics` 过滤新增 `value !== ""`，仅剩时长段（与旧版补丁一致，避免出现 " · 3分5秒" 前导分隔符）；JSX 侧 `headMetric !== "" &&` 守卫跳过 metricToken span，`metrics !== "" &&` 守卫跳过整个指标区（维持原 0.1.5 无补丁时行为）。
- 只读子会话页脚（SubagentReadOnlyComposer）：
  - `useProjection` 非函数（旧版同样保留的守卫；如无会话上下文）→ `stats` 为 `undefined`；`sessionStats` 缺失或 `decodeMs <= 0` → `tps` 为 `undefined` → `speed` 为 `undefined` → 不渲染 speed span，页脚与未打补丁的 0.1.5 一致。
- 未改动：rev 计算（服务端每次按文件内容重算 sha1[:12]，改文件即自动生效）；`formatTokens`/`tokenTotal`/`activityDuration`/`duration*` 等无关逻辑；slot 注册（`apply` 内注册参数不变，仅组件内部消费新增的 `useProjection` 标准 prop）。

## 5. 触碰范围

- 仅修改：`/home/CNS2026495165/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js`。
- 未触碰：`web`（0.1.1 旧 profile，含已补丁 bundle 与 .bak，仅只读）、`profiles/node_modules`（共享层，未动）、`/tmp/dsh-repo/`（未动）。
