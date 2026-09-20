# DSH btw + 壁纸 端到端验收 Runbook（重启后执行）

> 前置：两个插件已装好（`~/.dsh/profiles/node_modules/@local/{dsh-btw,dsh-wallpaper}` 真实目录 + cordis.patch.yml 两个 insert）。
> 本 Runbook 合并 ../../.workspace/reports/execs/btw/.workspace/reports/execs/btw/execute-btw.md U10（8 步）与 ../../.workspace/reports/execs/wallpaper/.workspace/reports/execs/wallpaper/execute-wallpaper.md §5 U14（12 步）。

## 0. 重启 DSH（激活插件）
```bash
npx @deepseek-ai/dsh web
```
观察启动日志：无 `btw` / `client-modules` / `typert-loader` / `wallpaper` 报错。
浏览器刷新 `http://127.0.0.1:3080`；Console 无红错。

## 1. btw 侧边对话（8 步）
1. Console 验证装载：`window.__DSH_BOOT__.entries` 应含 `@local/dsh-btw`。
2. 任一会话页头出现 **btw 按钮** → 点开抽屉面板。
3. 问一句普通问题 → 只读工具可用（read/grep/glob/web_search 等），写类工具被拒。
4. 让主 agent 跑一个长任务时打开 btw，问"它现在在干嘛" → 返回**进行中摘要**（正在用的工具/最近动作）。
5. 问一个含糊问题诱导反向提问 → 面板弹**问题卡**（选项/多选/自定义）→ 选择后回传 → 模型继续。
6. 面板闲置 >30 分钟 → 重开：**历史仍在**（不消失）。
7. 重启 DSH → 刷新 → 重开 btw：transcript 完整、**无新 fork**（`~/.dsh/btw/index.json` 命中 resume）、子会话不在任何目录。
8. End 关闭：面板关、索引保留、子会话数据仍在磁盘（重开可恢复）。

## 2. 壁纸（12 步）
1. Settings → General 出现「壁纸」卡片（目标选择器 + 三滑杆 + URL 输入）。
2. 全局默认：上传 png → 壁纸出现、cover 铺满；`~/.dsh/wallpapers/` 有原图（大小=原文件）；`cat ~/.dsh/settings.yaml` 出现 `wallpaper:` 节。
3. URL 来源：输入 https 图片地址 → 立即切换；非法输入 → 报错且 settings.yaml 不变。
4. 绝对路径导入：输入本机 png 绝对路径 → MEDIA_ROOT 出现副本、壁纸切换。
5. per-page：为「首页」「会话页」分别设不同壁纸；无会话↔打开会话切换正确；打开 Settings→General 时 settings 覆盖生效、关闭恢复。
6. 页面覆盖回落：清除某页覆盖 → 该页回全局壁纸。
7. 遮罩滑杆：0.5 时壁纸变暗、0 恢复、无壁纸时无遮罩；透明度/模糊滑杆生效。
8. 持久化：重启 DSH 后壁纸一致；换浏览器（无痕）壁纸一致。
9. 明暗主题切换下壁纸与遮罩正常。
10. 无壁纸时外观与现状一致。
11. 移除壁纸 → 层/遮罩清除；替换壁纸 → 旧媒体文件被删（若未被其他页引用）。
12. `curl -sI 127.0.0.1:3080` 正常；插件加载无报错日志。

## 3. 故障排查
- 插件没加载：查 `~/.dsh/profiles/web/cordis.patch.yml` 是否有 `btw`/`wallpaper` 两个 insert；查 `~/.dsh/profiles/node_modules/@local/` 是否真实目录（`ls -ld`，非 symlink）。
- 壁纸卡片不显示：确认 `~/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js` 存在；Console 查 `dsh-client-ui-settings` 解析。
- btw 按钮不出现：Console 查 `dsh-btw` client bundle；确认 `typert-loader` 无报错。
- 反向提问无问题卡：确认面板打开了 btw（`btw_ask_user` 只在侧聊子代理内注册）。
