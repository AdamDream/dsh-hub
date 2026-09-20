# deploy-vision-settings — vision-adam 设置页 + 能力检测部署包

部署位：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/`

## 内容

| 文件 | 说明 |
|---|---|
| `lib/index.js` | 宿主侧插件主代码（与现部署副本一致的 v2 版本，未改动） |
| `lib/client.js` | **新增** 浏览器侧设置页 bundle（`settings.section`，settings.yaml `vision-adam` 段） |
| `package.json` | **新增** `exports["./client"]` 与 `dsh.client { platform: "web", inject }` |

## 部署步骤（主代理执行）

```bash
DST=~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam
cp ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js ~/.dsh/backups/vision-adam.index.js.bak 2>/dev/null || true
cp ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/package.json ~/.dsh/backups/vision-adam.package.json.bak 2>/dev/null || true
cp .workspace/deploy-vision-settings/lib/index.js  "$DST/lib/index.js"
cp .workspace/deploy-vision-settings/lib/client.js "$DST/lib/client.js"
cp .workspace/deploy-vision-settings/package.json "$DST/package.json"
```

前置条件（自复核确认）：

1. `dsh.client` 声明会被 `@deepseek-ai/dsh-client-modules` 扫描到 —— 扫描对象是 **host Loader 的活动插件条目**；vision-adam 必须是已激活插件（`analyze_image` 工具可用即证明）。部署后需**重启 dsh web**，使 client-modules 增量扫描拾取新声明并生成 boot 图（`/plugins/@deepseek-ai/dsh-vision-adam/client.js`）。
2. 设置页读取 `settingsScope` 服务（`dsh-client-ui-settings` 提供）与 `slots` 服务（`dsh-client-runtime` 提供）—— 均为客户端根服务，bundle 的 `exports.inject = ["slots", "settingsScope"]` 与之匹配。
3. 写入经 `api.settings.mutate`（loopback 专属 RPC）→ host `settings.update('vision-adam', …)` → settings-file 持久化到 `~/.dsh/settings.yaml` 的 `vision-adam` 段。远程浏览器连接为 memory 模式，界面会提示不可持久化（与官方设置页行为一致）。

## 验证（工作区内，已通过）

```bash
cd .workspace/dsh-vision-adam-src
node --check lib/client.js && node --check lib/index.js
node smoke-client.mjs            # 注册形状 + section 注册 + 服务端渲染
node smoke-client-interactive.mjs  # happy-dom 交互：改 model→set / 清空已存字段→unset / 未动字段不写
```

## 验收（部署后）

- 设置页 → 左侧出现「vision-adam 识图设置」；四个字段显示当前生效值；改 model 保存 → `~/.dsh/settings.yaml` `vision-adam.model` 更新；清空字段保存 → 该键从 settings.yaml 消失（恢复默认）；apiKey/maxBytes 等未编辑键保持不变。
- 旧值兼容：`vision-adam: { model, maxTokens }` 的存量配置在设置页正常显示，未声明键回退默认值。
