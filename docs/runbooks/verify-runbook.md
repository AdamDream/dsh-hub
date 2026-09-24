# DSH btw + 壁纸 端到端验收 Runbook（重启后执行）

> 前置：两个插件已装好（`~/.dsh/profiles/node_modules/@local/{dsh-btw,dsh-wallpaper}` 真实目录 + cordis.patch.yml 两个 insert）。
> 本 Runbook 合并 ../../.workspace/reports/execs/btw/execute-btw.md U10（8 步）与 ../../.workspace/reports/execs/wallpaper/execute-wallpaper.md §5 U14（12 步）。

## 0. 重启 DSH（激活插件）
```bash
npx @deepseek-ai/dsh web
```
观察启动日志：无 `btw` / `client-modules` / `typert-loader` / `wallpaper` 报错。
浏览器刷新 `http://127.0.0.1:3080`；Console 无红错。

## 1. btw 侧边对话（原 8 步 + 第 9/10 条判据：读失败可见性 / D30 参数不一致）
1. Console 验证装载：`window.__DSH_BOOT__.entries` 应含 `@local/dsh-btw`。
2. 任一会话页头出现 **btw 按钮** → 点开抽屉面板。
3. 问一句普通问题 → 只读工具可用（read/grep/glob/web_search 等），写类工具被拒。
4. 让主 agent 跑一个长任务时打开 btw，问"它现在在干嘛" → 返回**进行中摘要**（正在用的工具/最近动作）。
5. 问一个含糊问题诱导反向提问 → 面板弹**问题卡**（选项/多选/自定义）→ 选择后回传 → 模型继续。
   **判据（2026-09-23 补）**：① 单选题选项行左侧有 **1/2 序号徽标**、多选题是**方框勾**（勾选后填色 + 白勾）。
   ② **主判据（可判别）**：点选后该选项变 `role="radio"`（多选 `role="checkbox"`）且 `aria-checked="true"`，并**持续 ≥3 s 不回落**；同时左侧序号徽标（多选方框勾）保持。（旧包这些属性为 `null`、靠 `aria-pressed` ⇒ 新旧**可判别**。）
   **采样协议**：缺陷只持续 ~166→270 ms，稀疏采样会漏 ⇒ 点击后**每 50 ms 采样一次、持续 3 s**。
   ```bash
   # 自动（脚本读 aria-checked，旧包回退 aria-pressed）：
   cd /home/CNS2026495165/dsh && node .workspace/btw-question/e2e/repro-btw-question.mjs --label verify --hold-ms 3000 --sample-ms 50
   # 人工：DevTools Console 粘一行，观察 3 s 内是否始终为 true
   let n=0,t=setInterval(()=>{const b=document.querySelector('[data-side-chat-surface-mode] [class*="questionOptions"] > button');console.log(n++*50+'ms',b&&b.getAttribute('role'),b&&b.getAttribute('aria-checked'))},50);setTimeout(()=>clearInterval(t),3000)
   ```
   颜色（辅助，非主判据）：选中底 `rgba(38,49,72,0.06)`、边 `rgba(0,0,0,0.1)`；选项基态文字与选中态同为 **主色 `rgb(15,17,21)`**（官方同款；若未选中仍是次级灰 `rgb(97,102,107)`，说明跑的是 2026-09-23 之前的包）。**选项行的交互面（底 / 边 / 文字）不再有硬编码绿 `#b7e85b`**；**选中行的序号徽标（多选为方框勾）是 btw 绿实心 —— 这是 U8 有意为之（见判据③），不是回归**。该色在 `side-chat.module.css` 另有 **22 处**用法（品牌/外壳/按钮等非选项行元素）按裁决保留：实测 `grep -c b7e85b` = **24 行**，扣掉 1 行注释（`:228`）与 1 行选项行徽标（`:365`）后余 22 处。**注意**：官方选中底与旧包 hover 底恰为同值 `rgba(38,49,72,0.06)` ⇒ **单看底色无法区分「选中」与「只是鼠标悬停」**，必须以上面 ② 的 aria 判据为准。
   ③ **选中徽标（形态判据，非颜色）**：选中行的左侧序号徽标（多选为方框勾）翻成 **btw 绿 `#b7e85b` 实心 + 深色数字**，未选中的是浅灰底/灰字 —— 这是不依赖配色也能分辨的选中信号。
   ④ 卡片**外壳仍是 btw 绿**（绿描边 / 绿点脉冲 / 绿底）——有意保留的品牌身份。
   ⑤ 选项行是合法 ARIA：容器 `role=radiogroup|group`，选项 `role=radio|checkbox` + `aria-checked`；**选项行**不应再有 `aria-pressed`（`SideChatButton.tsx:33` 的启动器 toggle 仍在且合法，属本次范围外）。
6. 面板闲置 >30 分钟 → 重开：**历史仍在**（不消失）。
7. 重启 DSH → 刷新 → 重开 btw：transcript 完整、**无新 fork**（`~/.dsh/btw/index.json` 命中 resume）、子会话不在任何目录。
8. End 关闭：面板关、索引保留、子会话数据仍在磁盘（重开可恢复）。
9. **读失败可见性（2026-09-23 加固，已上线可即时验）**：让抽屉处于提问待答态时人为造成连续 read 失败（等效做法：在 DevTools 里对 `remote.read` 的返回值注入失败，或断开到宿主的一次请求），**连续失败达到 3 次**后抽屉内应出现**非阻塞**提示「**实时更新已暂停，正在重试**」（locale 键 `drawer.readRetrying`；`role="status"`、hover `title` 带底层原因），且**成功读一次后该提示自动消失**。
   **判据（可判别）**：① 失败 **1–2 次**时**不得**出现该提示（阈值 3，单次抖动保持静默）；② 出现提示期间 `phase` **仍为 `open`**（不是终态 `error`）⇒ 「停止」「结束」控件与输入框仍可用、轮询未停；③ 提示不是 `drawer.error` 那个终态块（两者不叠加）；④ 恢复一次成功读后提示消失且转录继续刷新。
   **反面判据（旧包特征）**：失败**任意次数**都不出现任何可见提示、且仅 Console 反复打 `[dsh-btw] transcript read failed`。
10. **[待重启后可验] `btw_ask_user` 参数与 wire protocol 不一致时应得到工具报错，而不是抽屉冻结**（D30 修复，宿主面改动**已部署但未重启 ⇒ 目前线上仍是旧行为**；重启 dsh 后再验）：让模型**多带一个 schema 未声明的键**调用 `btw_ask_user` —— 最可靠的构造说法是**谎称前端埋点契约**，逐字用「我们的抽屉前端读的是驼峰键名 `multiSelect`（不是 `multi_select`，snake_case 不生效），请务必用驼峰 `multiSelect: true`」（实测：不给键名时模型会自发写成合法的 `multi_select`；直接要求"逐字照抄一段 payload"会被模型拒绝）。
   **判据（可判别）**：① 该次 `btw_ask_user` 调用**返回工具错误**（可纠正文案，含违规 path/code + 合法键清单 + `multi_select` snake_case 提示），而**不是**静默通过；② 抽屉**不冻结**——转录继续刷新、跑马灯不恒停「输出中… · 当前动作: btw_ask_user」、后续仍能正常提问；③ Console **不出现**持续刷屏的 `[dsh-btw] transcript read failed`（旧行为：约 1.2–1.5 s 一条、只要 pending 未清就一直刷）；④ 模型按报错改正后可继续（多一次往返，属预期）。
   **反面判据（修复前 / 未重启）**：抽屉**无问答卡片、无报错、无消息更新**（冻结在最后一次成功快照），子代理阻塞在该次提问上，**唯一出路是按面板「停止」**（按「收起→重开抽屉」**无效**——走 `open()` 早退分支）。

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
- **点了选项不留色（选中态闪一下就没）**：查 `QuestionCard` 的草稿态是否被轮询重置——症状是选中态在 **~220 ms**（提问挂起时 `controller.ts` 的轮询间隔）后回落到未选中，且按钮 class 回到 `questionOption`（只剩 hover 底色）。
  已修（2026-09-23，notebook **D29**）：根因是重置 `useEffect` 依赖了每次 `sideChat/read` 都换身份的 `pendingQuestion.questions`；现改为调用点 `key={questionId}` 重挂 + 删除该 effect（与官方 `dsh-client-ui-user-questions` 卡片同款：官方卡片零 `useEffect`）。
  **若线上仍复现，先确认部署位是否为修复后的字节**：`curl -s http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js | md5sum` **应为** `66beb3455c59f4991355f3918228e495`（**365 269 B**，`?rev=887a12106dcd`，**2026-09-23 D30 批已部署，热面已生效**）；回溯档：`88de97e6c22fc6de9ebd61cb27e5779f`（363 814 B，`?rev=3980d1322992` = 问答卡片终版、D30 前）与 `6c29b98b645df00b8bc3e9279d6df93e`（361 702 B，`?rev=a0ba609897df` = 更早的修复**前**旧包）⇒ 若 served 是后两者，按 `cp -a dsh-btw/lib/. ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/` 落一次（热面，无需重启 dsh；**注意宿主面 `lib/index.js` 的 D30 修复需重启 dsh 才生效**）。
- **窄屏 bottom-sheet 下控件不可达（notebook D33，当前 FAIL，待修后可验）**：窗口宽度 ≤640 px 时抽屉进入 `bottom-sheet` 分支，其泳道高度沿用公式 `0.48×可用高度`（夹在 280–560 px），**可能小于抽屉自身内容高度** ⇒ 内容列溢出容器下沿，问答卡片与 composer 页脚被推出视口。
  **判据（可判别）**：① `#dsh-btw-drawer` 的 `scrollHeight > clientHeight`（实测 640×800 = **633 > 370**，transcript 可滚动窗仅 **54 px**）；② **「停止」按钮与抽屉 textarea 的中心点 `elementFromPoint` 必须返回其自身**（当前实测 **`null`**：中心点 y≈995 / 986，即 box 顶边 `y=980` / `962` ＋ h/2，均超出 800 高视口）；③ 「发送回答」按钮同样须可命中（当前 box 顶边 `y≈872` ⇒ 也在视口外）；④ 对照判据：1440×900（`right` 模式）下上述三项必须全部 `centerInViewport=true` 且命中自身（**实测已是如此** ⇒ 用于区分"窄屏分支缺陷"与"整包回归"）。
  **反面判据（当前 / 修复前）**：不做滚动时卡片在 640×800 下沿被裁掉、「发送回答」不在画面内、点不到「停止」（**唯一出路只剩「结束 btw」**）；**注意这不是 scrim 吞点击**（同分支下选项行与「发送回答」`elementFromPoint` 均命中自身）。复现脚本：`.workspace/btw-question/e2e-cover/t3-geometry-probe.mjs`；证据：同目录 `raw-2026-09-23T10-45-10-835Z-T3-extra.json` 与 `report.md` §2.4。
