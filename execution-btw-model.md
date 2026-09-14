# btw 模型路由 + 选择 UI — 执行证据

## 落地改动（9 单元，均按 audit-btw-model.md 实现）
- U1 `src/shared/remote.ts`：新增 `btwModelSchema`（z.enum 三模型）+ `startSideChatRequestSchema.model?` + `startSideChatValueSchema.model?` + `readSideChatResultSchema.value.model?` + `setSideChatModelRequest/Value/Result` 三 schema。
- U2 `src/remote-descriptors.ts`：新增 `setModel` directDescriptor（第 7 个）。
- U3 `src/typert.host.ts`：members 加 `setModel`。
- U4 `src/client/remote.ts`：`SideChatRemoteNamespace.setModel` + `TypertRemoteMap['sideChat/setModel']`。
- U5 `src/host/side-chat-service.ts`：`BTW_PROVIDER='adam'` + `DEFAULT_BTW_MODEL='glm-5.3-flash'` + `sanitizeBtwModel`；`LiveSideChat.modelSelection`；start/resume 传 `{provider:'adam', model: request.model ?? 'glm-5.3-flash'}`；`composeChild` 里 `installBtwModelSelection`（getter: picked→持久化 header→默认；setter: picked）+ `installModelSelection(childCtx, selection)`；新增 `setModel()` 方法；`transcript` 与 `startValue` 回传 model。
- U6 `src/client/controller.ts`：`SideChatClientState.model?`；`setModel()` 方法（remote.setModel + 本地 state 更新）；open/poll/confirmRestore 回填 model。
- U7 `src/client/SideChatSurface.tsx`：headerActions 加 `<select>`（三选项，value=state.model，onChange→controller.setModel，disabled 非 interactive）。
- U8 `src/client/locales.ts`：`drawer.model` + `drawer.modelNextTurn`（en/zh）。
- U9 `scripts/smoke-build.mjs` + `tests/package-contract.spec.ts`：6→7 断言 + setModel 存在性。

## 验证结果（全部通过）
- `tsc -p tsconfig.json -p tsconfig.client.json` → 0 错误
- `oxlint src tests` → 0 warning 0 error
- `tsdown` → 构建成功（新哈希 remote-descriptors-BJSVE5SG.js / remote-DE_NyxCW.d.ts）
- `node scripts/smoke-build.mjs` → smoke ok
- `vitest run` → 132 passed, 2 skipped
- 安装：workspace `lib/` 全量替换到 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/`，旧哈希已清，产物含 setModel/glm-5.3-flash/installModelSelection。

## 待运行时验证（用户重启 DSH）
1. 开 btw → 模型选择器默认 glm-5.3-flash（不再跟随主会话 deepseek-v4-pro）。
2. 切 glm-5.3 / deepseek-v4-pro → 下一轮生效。
3. 关闭重开（resume）→ 沿用上次选择。
4. 主会话/btw 其余功能（ask-back、只读、digest）不受影响。

## 回滚
- git 无独立仓库，改动在 workspace；回滚 = 还原 9 个文件到改动前（或重建旧产物重装 @local）。

## 复核结论（自审通过；独立复核子代理 504f6f1f 4 轮零产出已中断）
- ① 默认模型不跟随主会话：L407/L464 `resolveChildAgentOptions(parent, {provider:'adam', model: request.model ?? 'glm-5.3-flash'}, childDepth)`（requested 展开在父字段后覆盖父模型）。✅
- ② 中途切换：`installBtwModelSelection` getter(picked→持久化header→默认)/setter(picked) + `installModelSelection(childCtx, selection)` 挂 agent/request 钩子；`setModel()` 只更新 selection.current、下一轮生效、不打断 generation。✅
- ③ 持久化：getter 读 `childAgent.session.requestHeader()?.config`（resume 读回）；buildRequest 经 installModelSelection 覆盖后写 request/header。✅
- ④ 协议贯通：schema→descriptor→typert.host→client remote→controller→Surface select 全对齐，typecheck/build/smoke 0 错误证明贯通。✅
- ⑤ 副作用：vitest 132 passed 无回归；ask-back/只读/digest/cancel/close 未改逻辑。✅
- 结论：**通过**，无遗漏。
