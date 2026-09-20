# subagent 部分显示 tok/s —— 执行与证据记录

日期：2026-09-11　目标：在 Web GUI 的 subagent 部分显示 tok/s（目录行 + 打开的子会话页脚）

## 1. 结论（改动前）

**不能。** subagent 目录行只渲染 `总tokens · 时长`，全链路没有任何速率字段。

## 2. 根因（源码级定位，两条独立成因）

| 位置 | 机制 |
|---|---|
| 目录行 | `SubagentHeaderLineage.tsx` 的 metrics 仅由 `tokenTotal(projectionValues.tokenUsage)` 与 `activityDuration(projectionValues.subagentTiming)` 组成——`subagentTiming` 投影**只有计时、没有 token/解码数据** |
| 子会话页脚 | `conversation.composer` 是 chain 槽位并以 `overlay:true` **接管**（`ConversationRoot.tsx:355-359`）。只读子会话由 `SubagentReadOnlyComposer`（`priority:-10`）顶掉 `composerBar`（含 InputBar），于是 `InputBar.tsx:552` 的 dock 条件 `input !== undefined` 不成立 → 挂 `conversation.composer.dock` 的 StatsLine **整条不渲染** → tok/s 随之消失 |

tok/s 的唯一数据源是 `sessionStats` 投影的 `decodeTokens / (decodeMs / 1000)`（主对话 `StatsLine.tsx:184-188` 即此口径）。

## 3. 已验证的数据可得性

- `sessionStats` 有 `wire` 块（`session-stats/src/projection.ts:199-212`，view 含 `decodeMs`/`decodeTokens`），并已合并进 `SessionProjectionMap`（`types.ts:44`）→ **客户端可见**。
- 投影值推送**只按 `def.wire !== void 0` 筛键，无任何按会话/按键过滤**（`session-projection/src/index.ts:448-470 viewCheckpoint`、`:533 restore`）。
- 线上（0.1.1-rc.2）实测同样成立：`dsh-session-projection/lib/index.js` 内 `def.wire === void 0` ×2 / `.wire !== void 0` ×2；`dsh-session-stats/lib/index.js` 含 `wire:` 与 `decodeMs`/`decodeTokens`。
- ⇒ 子会话 summary 的 `projectionValues` **必然带 `sessionStats`**。

## 4. 重要障碍：线上与源码版本不一致

| | 版本 | 外部依赖 |
|---|---|---|
| 线上 profile | `0.1.1-rc.2` | react / react-dom / **`@deepseek-ai/dsh-client-runtime/client`** / ui-primitives |
| `/tmp/dsh-repo` 源码 | `0.1.3-alpha.2` | react / react-dom / ui-primitives（**已不再依赖 client-runtime**） |

两版 API 契约与 i18n 约定均不同（0.1.1-rc.2 把 ` tok` 内联拼接，没有 `tokens.total` 键）。`/tmp/dsh-repo` 是单提交浅克隆、无 tag，取不到 0.1.1-rc.2 源码。

**⇒ 把 0.1.3-alpha.2 的构建产物直接投放到 0.1.1-rc.2 运行时属于「局部升级」，会因契约偏差破坏 UI，故否决。** 改为对线上 0.1.1-rc.2 bundle 做**版本精确的微创补丁**。

## 5. 实际落地方式

### 5.1 线上补丁（已生效，唯一实际部署物）

文件：`~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js`
（该 bundle **未压缩、可读**，841 行，保留 JSX 调用与 locale 字典）

补丁脚本 `/tmp/patch-subagent.py` 做 5 处精确锚点替换（每处校验命中次数，非 1 即中止）：

1. 新增 `formatTokensPerSecond(tps)`（≥10 取整、以下一位小数，与主对话 `message-chrome.ts` 同规则）。
2. 新增 `decodeTokensPerSecond(summary)`：读 `summary.projectionValues.sessionStats`，`decodeMs<=0` 返回 `undefined`。
3. 目录行新增 `speedMetric` = `` `${formatTokensPerSecond(tps)} tok/s` ``。
4. metrics 拆成 `headMetric`(tokens · tok/s) + duration 两行，空串不参与拼接；JSX 行 1 由 `tokenMetric` 改为 `headMetric`。
5. `SubagentReadOnlyComposer` 增加 `useProjection` 参数与速率 span；**防御式** `typeof useProjection === "function"` 守卫，未注入时自动降级、绝不崩 UI。

字节 41,404 → 42,608；`node --check` 通过；`tok/s` 出现 2 处。
备份：`lib/client.js.bak-20260911-105723`（41,404 B 原件）。

### 5.2 源码侧（0.1.3-alpha.2，已改但**未部署**）

为将来 profile 升级预留的同义改动，位于 `/tmp/dsh-repo`：

- `packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx`
- `packages/client/ui-subagent/src/client/SubagentReadOnlyComposer.tsx`（+ `.module.css` 的 `.speed`）
- `packages/client/ui-subagent/src/client/locales.ts`（新增 `tokens.perSecond` / `tokens.perSecondTitle`，中英双语）
- `packages/client/ui-subagent/tsconfig.json`（补 `session-stats` 项目引用）
- `packages/client/ui-subagent/package.json`（补 `@deepseek-ai/dsh-session-stats` devDependency）
- `packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx`（新增 2 条 tok/s 断言 + 修 2 条必需 prop）

该版本 `npx vitest run packages/client/ui-subagent` = **35/35 通过**；`pnpm run build:lib` 可成功构建。

## 6. 生效方式：刷新即可，无需重启

实测运行中的服务（PID 1640228，`dsh web`）：

- 插件包路由**按请求读盘**：`curl /plugins/@deepseek-ai/dsh-client-ui-subagent/client.js` 返回 **42,608 B、含 2 处 `tok/s`**，与磁盘补丁版逐字节一致。
- HTML 的插件索引里的 `rev` = **文件 SHA1 前 12 位**；补丁后 HTML 报告 `rev=508ed11aec66`，正是新文件的 sha1 前缀（旧文件为 `0bb1ff842ae8`）。
- ⇒ 内容寻址的 rev 每请求现算，浏览器会拉到新 URL，**不长命缓存旧包**。

## 7. 回滚

```bash
D=~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib
cp -p "$D/client.js.bak-20260911-105723" "$D/client.js"
```

## 8. 验收标准

1. 刷新 GUI 后，展开子代理目录（会话头部子代理触发器）→ 每行出现 `总 tokens · N tok/s · 时长`。
2. 打开一个一次性子代理（只读页脚）→ 页脚出现 `N tok/s`。
3. 数值口径 = 全窗口均速 `decodeTokens/(decodeMs/1000)`，与主对话 StatsLine 一致。
4. 子会话尚未产生解码时间时不显示速率（正常降级，非故障）。
