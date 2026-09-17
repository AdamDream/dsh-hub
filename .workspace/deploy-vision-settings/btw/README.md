# deploy-vision-settings/btw — dsh-btw 能力检测部署件

部署位：`~/.dsh/profiles/node_modules/@local/dsh-btw/`

## 内容

| 路径 | 说明 |
|---|---|
| `lib/` | **tsdown 构建产物**（含能力检测逻辑的 `index.js` 与重建的 `client.js` 等） |
| `src/host/vision.ts` | 改动后的宿主源码（能力检测共享助手） |
| `src/host/prompt-transform.ts` | 改动后的主会话 waterfall 监听器源码（直传分支） |
| `src/host/side-chat-service.ts` | 改动后的侧聊服务源码（直传分支） |
| `tests/capability-detect.spec.ts` | 新增测试（解析面 + 主会话三态 + 保守回退） |
| `tests/host-image.spec.ts` | 修改后的侧聊图片测试（新增直传/文本/回退三用例） |

## 部署步骤（主代理执行）

```bash
DST=~/.dsh/profiles/node_modules/@local/dsh-btw
cp -r .workspace/deploy-vision-settings/btw/lib/* "$DST/lib/"
# 源码副本（记录用；运行时只读 lib）
cp -r .workspace/deploy-vision-settings/btw/src/* "$DST/src/"
cp -r .workspace/deploy-vision-settings/btw/tests/* "$DST/tests/" 2>/dev/null || true
```

部署后需**重启 dsh web** 使新 lib 生效。

## 验证（工作区内，基线命令 8 项全绿）

```bash
cd dsh-btw
node_modules/.bin/oxlint src tests tsdown.config.ts vitest.config.ts          # 0/0
node_modules/.bin/tsc -p tsconfig.json                                          # PASS
node_modules/.bin/tsc -p tsconfig.client.json                                   # PASS
node_modules/.bin/tsc -p tsconfig.tests.json                                    # PASS
node_modules/.bin/vitest run                                                    # 216 passed | 2 skipped
node_modules/.bin/tsdown                                                        # build complete
node scripts/smoke-build.mjs                                                    # ok
node_modules/.bin/publint --level error                                         # All good
```

## 行为（部署后验收）

- 主会话粘贴图片 + 对话模型声明 `input: [text, image]`（settings.yaml `llm-pi-ai.providers.<route>.models[].input` 或 `defaultInput`）→ 原图直传（消息进入模型上下文为图片块，无 vision-adam 文本包装）。
- 主会话 + 文本模型 / 声明缺失 / 注册表查询失败 → 既有 vision-adam 转文本 + R1-9 包装（保守回退）。
- btw 侧聊同规则：`entry.modelSelection.current` 决定的模型声明含 image → 内容块直传；否则 vision-adam。
- 当前部署（`~/.dsh/settings.yaml` adam 路由无 `input` 声明）默认 `['text']` → 全部走 vision-adam，行为与改造前一致，直到某模型显式声明 image。
