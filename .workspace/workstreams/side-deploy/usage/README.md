# @local/dsh-usage

DeepSeek Harness 内 token 用量统计插件（dsh + Claude Code 双源，**不计费**）。
宿主侧把两处会话日志折叠进 SQLite，客户端在设置页「插件配置」Tab 以卡片展示
Hero 统计、自绘 SVG 趋势图/热力图与按模型/项目/日/会话的下钻表格。

> 架构与设计见 `DESIGN.md`；实现口径与修正见 `AUDIT.md`（B 节）与 `VERIFY.md`。

## 统计口径（AUDIT C.3 / B3 / B7 / REVIEW P1/P2）

- **请求数**：dsh = 含 usage 的 `(turn, step)` 数（chunk ∪ message 并集，chunk 优先）；
  cc = 含 usage 的 assistant 消息数（`message.id ?? uuid` 去重）。
- **cc 原始行数 vs 去重口径（REVIEW P2 裁决）**：cc 转录会对同一条 API 调用
  （同 `message.id`）随流式更新重录多次（部分用量先行、终值在末条）。原始含 usage
  行数 41,071（DESIGN §2/A3 口径）经 `message.id` 去重后为 **22,700** 条请求
  （18,371 行为流式重录）；验收基准取去重后口径。
- **冲突策略（REVIEW P1）**：同键冲突按「最新观测胜出」——`excluded.ts >= 现有 ts`
  时以末条（终值）覆盖首条（部分值）；过期观测不覆盖。保证 cc 输出/缓存读/缓存写
  桶为终值口径（修复前首条部分值被冻结，输出桶少计约 61%）。数字随会话增长。
- **输入（未缓存）**：dsh = `inputTokens`；cc = `max(0, input_tokens − cache_read − cache_creation)`
  （cc 的 `input_tokens` 含缓存，直接使用会与缓存桶双计，B3 修正）。
- **输出**：`outputTokens` / `output_tokens`。
- **缓存读**：`cacheReadTokens` / `cache_read_input_tokens`。
- **缓存写**：dsh = 0（无字段，B7）；cc = `cache_creation_input_tokens`。
- **总 tokens（四桶和）** = 输入 + 输出 + 缓存读 + 缓存写。
- **缓存命中率** = `cacheRead / (输入(未缓存) + cacheRead)`（两源统一；分母为 0 显示 0%）。
- **项目**：dsh = `session.cwd`；cc = 记录 `cwd`（兜底：目录名 `-home-…-` 逆编码）。
- **时区**：按日聚合/热力图默认本地时区（v1 定死，B10）。

## 架构简述

```
dsh: ~/.dsh/sessions/**/session.jsonl.zstd（多帧 zstd，帧结构扫描逐帧解压，B1）
cc : ~/.claude/projects/**/*.jsonl（含 subagents/，cwd 归属，message.id 去重，B2）
        │  ingest 服务（宿主侧，45s 定时 + 手动刷新）
        ▼
  SQLite（~/.dsh/storages/usage/usage.db，三级回退链，见 AUDIT A6）
  usage_events（dedup_key 修正版）+ usage_daily + sync_state
        │  /usage RPC 通道（客户端读取）
        ▼
  客户端设置页卡片（settings.plugin.item，key='dsh-usage'）
  Hero + 自绘 SVG 趋势图/热力图 + Tabs + 轮询/手动刷新 + 下钻 ctx.sessions.select
```

- 运行依赖仅 `node:zlib`（zstd）与 `node:sqlite`（Node 22+）；**零 npm 运行时依赖、免构建**
  （宿主手写 ESM、客户端手写 ModuleLoader bundle，均无需编译）。
- 图表为**自绘 SVG**（面积图/柱状图/热力图，零图表库，AUDIT A5 决策）。

## 文件

```
package.json          # @local/dsh-usage，exports ./client，dsh.client 声明
cordis.patch.yml      # - insert: - id: usage, name: '@local/dsh-usage'
lib/index.js          # 宿主 apply：settings.register + /usage RPC + ingest 调度 + 生命周期
lib/zstd.js           # scanZstdFrames / decodeSessionFile（多帧 zstd）
lib/db.js             # openUsageDb / schema v1 / 聚合查询
lib/rpc.js            # /usage RPC 通道（ctx.connection.register(ctx,'/usage',handle)，9 端点）
lib/ingest-dsh.js     # 枚举 + 增量折叠 dsh 源
lib/ingest-cc.js      # 枚举 + 增量折叠 cc 源
lib/charts.js         # 纯函数 SVG 生成（面积/柱状/热力），client bundle 内联源
lib/client.js         # 手写 ModuleLoader bundle（含 charts 内联 + 卡片 UI）
scripts/install-web2.sh  # 幂等安装/卸载脚本（主 agent 执行）
smoke.mjs             # 独立冒烟脚本：真实会话日志 ingest + 聚合数字
data/                 # 运行时可写目录（回退链末位，不入库）
```

> 客户端卡片通过宿主 `/usage` RPC 通道取数（REVIEW P0 已落地：0.1.5
> `ctx.connection.register(ctx, '/usage', handle)` 形态，宿主 `inject=['connection','webServer']`；
> 通道未注册/不可用时卡片显示「宿主未注册 /usage RPC 通道」，不会白屏）。

## 统计口径（同上，卡片内展示）

请求数 / 输入(未缓存) / 输出 / 缓存读 / 缓存写 / 命中率，四桶可切换趋势图。

## INSTALL（web2 挂载，由主 agent 执行）

1. **构建/校验**：无构建步骤（手写产物）。校验语法：
   ```bash
   node --check dsh-usage/lib/index.js && node --check dsh-usage/lib/client.js \
     && node --check dsh-usage/lib/db.js && node --check dsh-usage/lib/zstd.js \
     && node --check dsh-usage/lib/ingest-dsh.js && node --check dsh-usage/lib/ingest-cc.js \
     && node --check dsh-usage/lib/charts.js
   ```
2. **拷贝**（如已存在先备份）：
   ```bash
   DEST=~/.dsh/profiles/web2/node_modules/@local/dsh-usage
   [ -e "$DEST" ] && mv "$DEST" "$DEST.bak.$(date +%s)"
   cp -r lib package.json cordis.patch.yml LICENSE README.md "$DEST"
   ```
3. **patch insert**（幂等，`grep -q 'name: .@local/dsh-usage.' ||` 追加）到
   `~/.dsh/profiles/web2/cordis.patch.yml`：
   ```yaml
   - insert:
       - id: usage
         name: '@local/dsh-usage'
   ```
4. **重启 DSH（web2 profile）**；重启后验证：宿主日志出现 `dsh-usage` 初始化与
   ingest 完成行；设置页 → 插件配置 Tab 出现 dsh-usage 卡片。
5. **卸载**：移除 patch insert 条目 + 删除 `@local/dsh-usage` 目录 + 重启
   （库文件保留于 `~/.dsh/storages/usage/usage.db`，重新挂载即恢复）。

也可直接使用脚本（推荐，幂等且支持 `--dry-run` / `--uninstall`）：
```bash
bash scripts/install-web2.sh --dry-run    # 预览将执行的路径与 patch 变更
bash scripts/install-web2.sh              # 安装 + 打印重启提示
bash scripts/install-web2.sh --uninstall  # 还原（移除 insert + 删除目录，保留库）
```

## 运行环境要求

Node `^22.19.0 || >=24.0.0`（`node:sqlite` 稳定可用），`node:zlib` 原生 zstd。
