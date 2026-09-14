# web2 (0.1.5-rc.2) 切换 Runbook（已验证版）

> 目标：把线上 GUI 从 profile `web`(0.1.1-rc.2) 切到并行 profile `web2`(0.1.5-rc.2)。
> 原则：旧 `web` profile 目录**原样保留**作回退；切换前在 3081 独立验收（已全部通过）。
> 状态：✅ 移植完成、✅ 3081 实测通过——以下命令可直接粘贴执行。

## 0. 已完成的移植与补丁（全部核验过）

| 项 | 状态 | 证据 |
|---|---|---|
| vision-adam 宿主侧（settings API） | ✅ | `installSection`(0.1.5 真实方法) + 运行时冒烟通过 |
| wallpaper 宿主侧（settings API） | ✅ | 契约等价（register 自校验同正则），import OK |
| taste bridge（`rpc.handle`→`register(ctx,…)`+inject webServer） | ✅ | /taste RPC 端到端实测：正常信封/未知端点/403/401 |
| btw/wallpaper/taste 客户端 inject→`client-store` + wallpaper defineStore | ✅ | 与 0.1.5 官方用法逐字一致 |
| tok/s → 0.1.5 ui-subagent bundle | ✅ | 聚合线上 bundle 实测含 tok/s×6（见 §3.③） |
| web-search `x-opencode-session` 中转头 | ✅ | L143 已打，node --check OK |
| agent-loop 补丁 | ⏭️ 不需要 | 0.1.5 已无 `assistant/chunk` 事件，日志膨胀根因消除 |

报告落盘：`port-vision-adam.md` / `port-wallpaper.md` / `port-taste.md` / `port-tokps-web2.md`（工作区 `/home/CNS2026495165/dsh/`）。
共享层 `~/.dsh/profiles/node_modules/` 与旧 profile `~/.dsh/profiles/web/` **零改动**（逐文件核验）。

## 1. 已知行为差异（0.1.5 引入，非故障）

- **浏览器认证**：0.1.5 默认开启浏览器认证，启动会打印带 token 的 URL。切换后**首次**用浏览器打开该 URL 一次（换取持久 cookie，之后重启无需再换）。
- **旧会话迁移**：旧会话为 v0 格式，0.1.5 打开时自动经 v0→v1→v2→v3 迁移链升级。切换前建议先备份会话目录（见 §6）。

## 2. 起服务（3081 独立验收端口）

```bash
cd ~/.dsh/profiles/web2
nohup node ./node_modules/.bin/dsh --profile web2 --port 3081 --no-open \
  > /tmp/dsh-web2-3081.log 2>&1 &
sleep 12
cat /tmp/dsh-web2-3081.log   # 预期只有一行: dsh web: http://127.0.0.1:3081/?token=...
```

## 3. 验收（复制粘贴，逐条看输出）

```bash
# ① boot 干净（应输出 0）
grep -cE "Error:|plugin tree failed" /tmp/dsh-web2-3081.log || echo "boot 干净"

# ② token 换 cookie，页面应 200 且含 btw/wallpaper/taste/store
TOKEN=$(grep -oE 'token=[A-Za-z0-9_-]+' /tmp/dsh-web2-3081.log | cut -d= -f2)
curl -sS -c /tmp/cj.txt -L "http://127.0.0.1:3081/?token=$TOKEN" -o /tmp/w2page.html
for k in '@local/dsh-btw' '@local/dsh-wallpaper' 'dsh-taste' 'dsh-client-store'; do
  echo "$k: $(grep -c "$k" /tmp/w2page.html)"
done

# ③ tok/s 已在线上 bundle 生效（应 ≥1）
AGG=$(grep -oE '/plugins/\?\?[^"]*dsh-client-ui-subagent/client\.js[^"]*' /tmp/w2page.html | head -1 | sed 's/&amp;/\&/g')
curl -sS -b /tmp/cj.txt "http://127.0.0.1:3081$AGG" -o /tmp/w2agg.js
grep -c "tok/s" /tmp/w2agg.js

# ④ GUI 目视（浏览器开 http://127.0.0.1:3081/?token=$TOKEN）：
#    - subagent 目录行有「tokens · N tok/s · 时长」
#    - 只读子会话页脚有「N tok/s」
#    - btw 侧聊可开、壁纸按钮在、taste 面板可开
#    - 旧会话列表完整（287 个，打开一个旧会话确认可读）

# ⑤ 验完停掉验收服务
kill $(pgrep -f '^node ./node_modules/.bin/dsh --profile web2 --port 3081') 2>/dev/null; sleep 2
ss -tlnp | grep ':3081 ' || echo "3081 已释放"
```

## 4. 切换（web2 接管 3080）

```bash
# 停旧服务并确认端口释放
kill $(pgrep -f '^node ./node_modules/.bin/dsh web') 2>/dev/null; sleep 3
ss -tlnp | grep ':3080 ' || echo "3080 已释放"

# 启 web2 接管 3080
cd ~/.dsh/profiles/web2
nohup node ./node_modules/.bin/dsh --profile web2 --port 3080 --no-open \
  > /tmp/dsh-web2.log 2>&1 &
sleep 10
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3080/   # 401 属预期（见 §1）

# 浏览器打开 cat /tmp/dsh-web2.log 里打印的完整 URL（含 ?token=）一次
```

## 5. 回退（旧 profile 原样可用）

```bash
kill $(pgrep -f '^node ./node_modules/.bin/dsh --profile web2') 2>/dev/null; sleep 3
cd ~/.dsh/profiles/web
nohup node ./node_modules/.bin/dsh web --no-open > /tmp/dsh-web.log 2>&1 &
sleep 10
curl -sS -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3080/
```

## 6. 备份与安全

- 会话数据 `~/.dsh/sessions`（287 个旧会话）切前建议整盘备份：
  `cp -r ~/.dsh/sessions ~/.dsh/sessions.bak-$(date +%Y%m%d)`
- 全部移植/补丁的恢复基线在 `~/dsh-upgrade-backup/`（配置 tgz、patched-official-files.tgz、self-built-plugins.tgz、dsh-vision-adam-0.2.0）。
- 切换后若需在新版重打任何补丁：tok/s 与 x-opencode-session 的补丁基线记录在对应 `port-*.md`。
