# DSH 工作区总 Runbook（2026-09-14 修订版，含 6 项启动修复）

> 覆盖：btw v2 + P0、btw 面板对齐、usage 热力图与 tooltip、识图提示词、ppt-master、dsh-workerspace、
> 卡顿修复与插件恢复基线。所有改动均有备份（`.workspace/backup-*`、`~/.dsh/profiles/.backup-p0-*`）。

## 0. 已部署清单

| 线 | 内容 | 部署位 |
|---|---|---|
| 卡顿修复 | ②b 非流式 + mux 订阅过滤 + FrameQueue 有界（应答帧不丢）+ token 上限（adam 990000 / vision 393216） | 全局树 4 包 + settings |
| btw v2 | 图片管线（vision-adam 转文本）、跳转列表、项目总览、模型路由、索引 v2（10 remote） | `@local/dsh-btw/lib` + host-apiproxy 补丁 |
| btw P0 | 官方 dsh-subagent `materializeContinuableChild`（仅恢复不投递）+ host 打开链路（不要求 parent live） | 全局树 dsh-subagent + btw lib |
| btw 面板 | 浅绿运行横幅、图片序号徽标（左上角白底黑字）、大图 lightbox 修复 | btw lib |
| usage | 热力图重设计（蓝阶/空心/月份/峰值环）+ 三图自绘跟随鼠标 tooltip | `@local/dsh-usage/lib` |
| 识图提示词 | analyzeImageBytes 三落点「完整转录 + 审美/设计合理性分析」 | vision-adam lib + btw vision.ts |
| ppt-master | skill（~/.dsh/skills/ppt-master + venv python-pptx）+ 插件 `@local/dsh-pptmaster`（pptxgenjs 等已装） | skills + profiles + cordis insert |
| dsh-workerspace | 底座 `dsh-workspace-enhancement@0.1.2`（4 行适配 + ssh2/cpu-features/koffi）+ 薄插件 `@local/dsh-workerspace`（ws_serial_*/ws_flash） | profiles + cordis inserts + settings 段 |
| 插件基线 | taste/wallpaper/vision-adam/usage/session-board 启用、web2 废弃 | cordis.patch.yml |

## 1. 六项启动问题修复确认（2026-09-14 实测全部解决）

| # | 报错 | 修复（已应用） | 验证 |
|---|---|---|---|
| 1 | Cannot find package 'ssh2' | ssh2 + cpu-features + koffi 装入 `profiles/node_modules/dsh-workspace-enhancement/node_modules/` | require.resolve 三包通过 |
| 2 | parameters.artifacts.additionalProperties… | ws_flash 工具参数补 `additionalProperties: false`（lib/index.js:492） | grep 命中 |
| 3 | directoryPicker 重复注册（auto） | cordis.patch.yml 禁用 `directory-picker`(auto) + 插入 `directory-picker-browse` | patch 条目在位 |
| 4 | directoryPicker 重复注册（ssh picker） | 追加禁用 `directory-picker-ssh` | 同上 |
| 5 | @local/dsh-pptmaster 未注册 | client.js 首行 `id: "@local/dsh-pptmaster"` 对齐 | grep 命中 |
| 6 | 同类隐患（预防） | @local 批量扫描：btw/pptmaster/usage/wallpaper 全部 id==包名，零不匹配 | 扫描通过 |

> 注：cordis.patch.yml 含 `!!js` 表达式（cordis 合法），python-yaml 解析报错属预期；skill 部署位与 staging 全量 `diff -rq` 一致。

## 1b. 重大事故记录：npm 遮蔽导致补丁集体失效（2026-09-15 根因，已修复）

**根因**：`npm install --prefix ~/.dsh/profiles/web ssh2@^1.16.0`（部署 dsh-workerspace 时）会读取
profile 的 `package.json` 并把**整棵依赖树（198 个 @deepseek-ai 包）安装成未打补丁的本地副本**到
`profiles/web/node_modules/@deepseek-ai/`——运行进程优先加载这些副本，**②b 非流式 / mux+FrameQueue 加固 /
P0 materialize / 图片变换补丁全部被绕回**，表现为「并行 subagent 又卡 + btw 冷子代理打不开
(materializeContinuableChild runtime patch is not applied)」。

**修复**：删除 `~/.dsh/profiles/web/node_modules/@deepseek-ai/`（以及整个 `profiles/web/node_modules`，
恢复事故前空态）；解析恢复经符号链接农场→全局打补丁树（7 个关键包核验 ✓）。

**⚠️ 防复发（写入约定）**：**绝不对 `~/.dsh/profiles/web` 执行任何 npm/pnpm install**。
插件依赖一律装入插件自身目录（如 `dsh-workspace-enhancement/node_modules/ssh2` 已装）或显式指定
`--prefix` 目标目录；需要官方包补丁的依赖调整走全局树补丁 + `replay-lag-fix.sh`（重放脚本已覆盖
4 包+dsh-subagent，重装后一键恢复）。

## 2. 重启与静态核验

```bash
npx @deepseek-ai/dsh web
# 新终端：
curl -s http://127.0.0.1:3080/ | grep -o '"id":"[^"]*"' | grep -E 'pptmaster|workspace|workerspace|usage|taste|wallpaper|dsh-btw'
grep -n 'dsh-workerspace' ~/.dsh/settings.yaml
ls ~/.dsh/skills/ppt-master/SKILL.md
```

## 3. GUI 验收矩阵

| 项 | 操作 | 期望 |
|---|---|---|
| btw P0 | 打开冷子代理 btw | 能打开；首次触发一次 parent 冷 materialize（不跑模型轮） |
| btw 图片 | 粘贴图片发送 | 经 vision-adam 转文本 + R1-9 包装进对话；转录见缩略图+分析 |
| btw 面板 | 子代理回合中 | 顶部浅绿运行横幅「输出中…·当前动作」；工具 IN/OUT 行；图片左上角白底黑字序号；点击缩略图→大图 lightbox（遮罩/Esc/关闭） |
| btw 跳转 | 抽屉列表/项目全部 tab | 点击切换侧聊、激活项目 |
| usage | 三图悬停 | 跟随鼠标 tooltip（日期+token，四象限翻转）；热力图蓝阶/空心/峰值环正常 |
| 识图 | 粘贴截图 | 分析为「完整转录 + 审美/设计合理性分析」风格 |
| ppt-master | 新会话 | `available_skills` 含 ppt-master；可调 `pptmaster_*` 工具生成/编辑 PPTX（venv python-pptx） |
| workerspace | 新会话 | 模型可见 `sw_*`（SSH 远程）+ `ws_serial_list/open/send/read/close`、`ws_flash`（白名单+确认模态）；设置页出现两命名空间 |
| 回归 | 模型选择器/主会话打字机 | adam/opencode 可选；主会话打字机正常 |

## 4. 回滚

```bash
# btw P0 官方补丁回滚
(cd ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai && patch --batch -p0 -R < /home/CNS2026495165/dsh/.workspace/deploy-p0/dsh-subagent.materialize.patch)
# btw lib / usage lib / vision lib：从 .workspace/backup-batch*/backup-batch2* 还原
# 卡顿修复回滚
cd /home/CNS2026495165/dsh/.workspace/deploy-lag && bash replay-lag-fix.sh --rollback
# 插件移除：cordis.patch.yml 用备份还原；rm -rf profiles/node_modules/@local/dsh-pptmaster、@local/dsh-workerspace、dsh-workspace-enhancement
# 全部备份：.workspace/backup-*、~/.dsh/profiles/.backup-p0-*
```
