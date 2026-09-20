# 重启 Runbook（宿主重启 → 复测 → phase 2）

> 前置：代码补丁与数据清理（phase 1）已完成；只差重启让**服务端过滤**与**用量卡片宿主侧修复**生效。
> 重要：**请在普通终端里执行**（例如当前跑着 `npm exec dsh web` 的那个 pts）。**不要**在 GUI 内置终端里执行——那是宿主进程的子进程，会被一起终止。

---

## 第 0 步 · 前置检查（约 2 秒）

```bash
pgrep -af 'bin/dsh'
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3080/
df -h /home/CNS2026495165 | tail -1
```

**预期**：只出现一行宿主进程（`node .../bin/dsh web`，当前 PID **20806**）＋ `HTTP 200` ＋ 磁盘可用约 1.6T。

---

## 第 1 步 · 预览（不杀不启，约 1 秒）

```bash
cd /home/CNS2026495165/dsh
bash .workspace/deploy-lag/dsh-restart.sh --dry-run
```

**预期输出**（实测原文）：

```
[dsh-restart] == 预览（未执行任何杀/启动作）==
[dsh-restart] 目标进程: PID=20806  node /home/CNS2026495165/.npm-global/bin/dsh web 
[dsh-restart] 进程校验: /proc cmdline 含 bin/dsh + web ✓（仅向该校验通过的进程发信号）
[dsh-restart] 启动命令来源（ps 推断的包装链，供确认同 profile/同启动方式）:
[dsh-restart]     PID   20792 npm exec dsh web
[dsh-restart]     PID   20805 sh -c dsh web
[dsh-restart] 将执行:
[dsh-restart]   1) SIGTERM -> 20806，有界等待 15s dispose
[dsh-restart]   3) 启动: npx --no-install @deepseek-ai/dsh web  （后台分离，日志 ~/.dsh/backups/dsh-restart.log）
[dsh-restart]   4) 冒烟: curl -sf http://127.0.0.1:3080 轮询至 HTTP 200（上限 30s）
[dsh-restart] == dry-run 结束：以上仅为预览，未发送任何信号、未启动任何进程 ==
```

> 若这里报 **「发现多个 dsh web 进程」**：说明有别的实例或探测误报——把该 PID 贴给我，或显式指定：
> `bash .workspace/deploy-lag/dsh-restart.sh --dry-run --pid 20806`

---

## 第 2 步 · 重启（约 20~40 秒；GUI 会短暂断开并自动重连）

```bash
bash .workspace/deploy-lag/dsh-restart.sh --yes
```

**预期**：

```
[dsh-restart] SIGTERM -> PID 20806（有界等待 15s dispose）
[dsh-restart] 进程已退出（Ns）
[dsh-restart] 启动: npx --no-install @deepseek-ai/dsh web （后台分离...）
[dsh-restart] ✅ boot OK（Ns）: http://127.0.0.1:3080/（HTTP 200 冒烟通过）
```

**故障排查**：

| 现象 | 处置 |
|---|---|
| 15s 后进程仍存活 → 脚本中止（不杀） | 再跑一次加 `--force`（超时后 SIGKILL），或手工 `kill -TERM 20806` |
| 30s 内未 boot OK | 看 `~/.dsh/backups/dsh-restart.log`；再 `curl -I http://127.0.0.1:3080/` 探活 |
| 起不来且要退回代码基线 | 各单元自带回滚：`bash .workspace/lag-fix/patches/client-runtime-perf.sh --rollback`（客户端热面，刷新即生效）／`bash .workspace/lag-fix/patches/server-session-filter.sh --rollback`（冷面，需再重启）／`bash .workspace/lag-fix/patches/usage-plugin.sh --rollback --target deployed`（冷面） |

---

## 第 3 步 · 一键复测（约 6~8 分钟）

```bash
cd /home/CNS2026495165/dsh
bash .workspace/lag-fix/probes/verify-post-restart.sh
```

**判读门槛**（脚本会逐项打印 PASS/FAIL）：

| 项 | 门槛 | 重启前实测 |
|---|---|---|
| `session.list` 条目 | **≤ 287**（顶层 87 + subagent 200） | 2,396 ❌ |
| `session.list` 字节 | **≤ 500 KB** | 3.94 MB ❌ |
| 顶层会话 ID | 一条不少（87 条，含新增 3 条） | ✅ |
| `runningSubagentCount` 字段 | 顶层行全部带上（number） | 0/87 ❌ |
| `/usage/heatmap` | **< 40ms** | 285~306ms ❌ |
| 宿主事件循环停顿 | **无 > 100ms** | 264.9~272.2ms ❌ |
| 客户端空闲 script | **< 60 ms/s** | 45 ✅（已达标） |
| 客户端设置页停留 script | 对照基线 190 → 越低越好 | 81.4 ✅ |
| 帧 >50ms（空闲/停留） | 对照基线 22/40 → 降 >50% | 9 / 24（−59% / −40%） |
| 设置页帧 p99 | **< 50ms** | 83.4~100ms（待 N 下降后复测） |

---

## 第 4 步 · B2 phase 2（孤儿索引清理，约 1 分钟）

```bash
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --apply --phase 2 --days 7
```

**预期**：清理 `session_projcache.json` 孤儿键（约 1,670）+ `sync_state` 悬空行（约 2,334）；校验后 projcache ≈732 行、sync_state ≈410 行。

---

## 第 5 步 · 回到对话收尾

重启会把当前回合打断（我跑在宿主进程里）。重启完成后，把下面这段贴回对话（或直接说「继续」）：

```
继续 goal-93254121 的收口。宿主已重启，代码补丁已全部落地。
请跑 bash .workspace/lag-fix/probes/verify-post-restart.sh 复测，然后做 phase 2 与 Track D 文档整理。
细节见 .workspace/lag-fix/NEXT_SESSION_PROMPT.txt。
```

> 文档整理（Track D）我**故意留到重启后**执行：它要移动 210 个文件并提交 git，中途被重启打断会留下半移动的工作树。
