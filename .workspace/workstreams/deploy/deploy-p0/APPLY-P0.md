# APPLY-P0 — btw「子代理会话无法打开」P0 部署手册（路线 a）

本手册对应诊断 `../btw-open-p0-diagnosis.md` ④ 的路线 a：给官方 `dsh-subagent` 增加一个
**「仅 materialize、不投递模型轮」的公开方法** `materializeContinuableChild`，由 btw host 在冷恢复
持久化子代理 parent 时调用。本目录产物：

| 文件 | 说明 |
|---|---|
| `dsh-subagent.materialize.patch` | 官方补丁 unified diff（`patch -p0` 于 `@deepseek-ai` 根应用，含 `lib/index.js` 与 `lib/types/index.d.ts` 两文件） |
| `dsh-subagent.lib.index.js` | 补丁后完整文件副本（lib/index.js） |
| `dsh-subagent.lib.types.index.d.ts` | 补丁后完整文件副本（lib/types/index.d.ts） |

## 0. 前置：构建 btw（本仓库 /home/CNS2026495165/dsh/dsh-btw，二进制直跑，勿用 pnpm）

```bash
cd /home/CNS2026495165/dsh/dsh-btw
node_modules/.bin/oxlint src tests tsdown.config.ts vitest.config.ts
node_modules/.bin/tsc -p tsconfig.json
node_modules/.bin/tsc -p tsconfig.client.json
node_modules/.bin/tsc -p tsconfig.tests.json
node_modules/.bin/vitest run
node_modules/.bin/tsdown
node scripts/smoke-build.mjs
node_modules/.bin/publint --level error
```
产物在 `dsh-btw/lib/`。

## 1. 备份

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
BK=~/.dsh/profiles/.backup-p0-$STAMP
mkdir -p "$BK"
# 官方 dsh-subagent 包整包备份
cp -r ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent "$BK/dsh-subagent"
# btw 部署 bundle 备份（lib 目录）
cp -r ~/.dsh/profiles/node_modules/@local/dsh-btw "$BK/dsh-btw"
sha256sum ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js \
          ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/types/index.d.ts \
          > "$BK/original.sha256"
echo "备份完成：$BK"
```

## 2. 应用官方 dsh-subagent 补丁

```bash
ROOT=~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
# 预检（dry-run）
(cd "$ROOT" && patch --batch -p0 --dry-run < /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.materialize.patch)
# 应用
(cd "$ROOT" && patch --batch -p0 < /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.materialize.patch)
```
补丁不改任何其他文件；`lib/index.js`（运行时）与 `lib/types/index.d.ts`（类型）同时更新。

## 3. 应用 btw lib（新 bundle 拷入 profile）

```bash
BTW_LIB=~/.dsh/profiles/node_modules/@local/dsh-btw/lib
cp /home/CNS2026495165/dsh/dsh-btw/lib/index.js      "$BTW_LIB/index.js"
cp /home/CNS2026495165/dsh/dsh-btw/lib/index.d.ts    "$BTW_LIB/index.d.ts"
cp /home/CNS2026495165/dsh/dsh-btw/lib/client.js     "$BTW_LIB/client.js"
cp /home/CNS2026495165/dsh/dsh-btw/lib/*.js          "$BTW_LIB/"      # 其余 remote-*.js / typert.host.js 等
cp /home/CNS2026495165/dsh/dsh-btw/lib/*.d.ts        "$BTW_LIB/"
```
> 以 `dsh-btw/lib/` 实际构建产物为准逐文件覆盖（推荐 `cp -r dsh-btw/lib/. "$BTW_LIB/"`，先删旧 `remote-*` 存量防残留）。

## 4. 验证

```bash
# 官方补丁：语法 + 锚点
node --check ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js
grep -c materializeContinuableChild ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js   # 期望 3
grep -c materializeContinuableChild ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/types/index.d.ts # 期望 1
# 与交付副本 cmp（逐字节一致）
cmp ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js \
    /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.lib.index.js
cmp ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/types/index.d.ts \
    /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.lib.types.index.d.ts
# btw bundle 语法
node --check ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/index.js
```
补丁后文件 sha256（用于脚本锚点）：
- `dsh-subagent/lib/index.js`        → `64088a4be6f84f1e5c803f9848899cd8cba7b38537d5fb9aa523fbead8c467b5`
- `dsh-subagent/lib/types/index.d.ts` → `36c832b62a710be8a0574ad918bd2e2f983a792962fe8351d70c83cbc713adf9`

## 5. 重启与实测

重启 DSH 后（npx @deepseek-ai/dsh web），跳转列表/侧聊打开一个**持久化冷子代理** btw：
- 期望：能打开（不再报 `The parent conversation is not live.`），首次触发一次 parent 冷 materialize
  （持久化 inspect + Agent 重建，不跑模型轮），恢复的 parent 驻留，btw 行为与主会话 btw 一致。
- 副作用说明：被 btw materialize 的子代理在本次进程内保持驻留（parked），其后缀正常
  send_message 仍可执行，但完成时不再向主会话发送「Background subagent finished」通知
  （settlement 通知仅随激活自动回收发出；parked 激活不自动回收）。主机重启后一切恢复常态。

## 6. 回滚

```bash
# 用第 1 步的备份整包还原（或对官方补丁反向应用）
(cd "$ROOT" && patch --batch -p0 -R < /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.materialize.patch)
# btw bundle 从备份还原
cp -r "$BK/dsh-btw"/* ~/.dsh/profiles/node_modules/@local/dsh-btw/
# 重启 DSH 生效
```
> 重放脚本（`../deploy-lag/replay-lag-fix.sh`）已纳入 dsh-subagent 单元（备份/应用/锚点校验/`--rollback`），
> 全局树重装后跑 `replay-lag-fix.sh` 可一次性恢复本补丁。

## 7. 语义约定（供部署与排障）

- 新公开方法 `ctx.subagents.materializeContinuableChild(parent, childId, options)`：
  - `parent` 必须是该子代理**精确的 live 直接父 Agent**（与 `followup`/`coldResume` 同一授权线）；
  - 子代理已 live 则原样返回其 Agent；否则按持久化 descriptor 冷恢复（不投递任何消息）；
  - 恢复的 Activation 被 park（settlement watcher 不自动回收），驻留至 manager drain（主机停）或父离开注册表；
  - 会话不存在/非 continuable → `SubagentError`（NOT_RESUMABLE 等），调用方负责兜底。
- btw host 侧：冷普通会话走 `ctx.agents.resume`（官方 dsh-api-remotes 先例）；冷子代理走本方法；
  两者都失败/会话不存在才抛 `parent-not-found`（文案区分「会话不存在」与「恢复失败」）。
