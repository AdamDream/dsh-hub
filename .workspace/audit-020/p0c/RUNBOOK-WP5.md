# WP5 · Route B 端到端验收 Runbook

> **产物**：`/home/CNS2026495165/dsh/.workspace/audit-020/p0c/RUNBOOK-WP5.md`
> **目标**：验证「Nautilus 投递一个文件 → 0.2.0 侧真的出现工作区 + 会话」。
> **前提**：0.2.0-rc.2 隔离实例（`$A/prefix-cli-rc2`），DSH_HOME = `$A/home`。
>
> ## 执行者标注（每一节都标了，不要跳读）
> | 节 | 谁执行 | 为什么 |
> |---|---|---|
> | §0 变量 | 任何人 | 只读 |
> | §1 前置检查 | 任何人 | 只读（bind-only 探针 / `sha256sum`） |
> | §2 安装自建插件 | **协调者** | 写 `$A/home/profiles/node_modules/**`（本工单边界外） |
> | §3 追加 profile patch | **协调者**（独占写入） | `cordis.patch.yml` 是协调者独占文件 |
> | §4 生成并落地令牌 | **用户亲自** | 只有用户能定密钥值；不得写进本报告/脚本 |
> | §5 起实例 | **协调者/用户** | 起监听端口；本工单禁止起服务 |
> | §6 探针 + 端到端断言 | 任何人（§5 起来后） | 只读 + 一次 POST |
> | §7 Nautilus 右键 | **用户亲自**（点右键） | 桌面交互 + 需先应用投递器补丁 |
> | §8 故障排查 / §9 停栈回滚 | 任何人 | — |
>
> ## ⛔ 硬禁令（写进任何脚本前先读）
> * **不要重启/停止 3098** —— 它是本会话宿主，重启会杀掉会话。验收一律用 **3099**。
> * **不要改 `~/.dsh/**`、`~/.dsh-017/**`**（只读源）。
> * **不要把 `webserver.host` 改成 `0.0.0.0`** —— 自注册路由不带任何 TLS/认证/Origin 策略。
> * **不要把令牌写进**日志、`--json` 报告、spool、shell history、`ps` 可见的参数。
> * 行尾 `\` 续行**后面不得有空格**。

---

## §0 一次性变量（后面所有片段都依赖它，整段复制）

```bash
cd /home/CNS2026495165/dsh
export A=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020
export P=/home/CNS2026495165/dsh/.workspace/audit-020/p0c
export DSH_HOME_020="$A/home"
export CLI="$A/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"
export PORT=3099                 # 验收端口（**不要用 3098**）
export WEB_URL="http://127.0.0.1:$PORT"
export ROUTE=/office-handoff
export WS_ROOT="$DSH_HOME_020/DSH-办公投递"     # 两侧白名单根（见 §3 一致性断言）
export TOKEN_ENV=DSH_OFFICE_ROUTE_B_TOKEN
export LOG="$A/logs/web-$PORT.log"
mkdir -p "$A/logs"
echo "PORT=$PORT  WEB_URL=$WEB_URL  ROUTE=$ROUTE  WS_ROOT=$WS_ROOT"
```

**预期**：最后一行原样回显五个变量。`WS_ROOT` 之所以是 `$DSH_HOME_020/...` 而不是
现役家目录，是因为验收实例用 `env -i HOME=$A/home DSH_HOME=$A/home` 启动（§5）；
Runbook 全程用**显式同一个值**钉住两侧，不依赖 `HOME` 推断。

---

## §1 前置检查（只读；任一条不符先停）

```bash
# 1.1 现役实例仍在（只读；绝不停止/重启）
ss -ltn | grep -E ':(3080|3097|3098) '
```
**预期**：三行 LISTEN。缺任一行 ⇒ 停，先查现役/宿主，**不要**动它们。

```bash
# 1.2 验收端口空闲（bind-only 探针，比 ss 更强）
node -e 'const net=require("net");const p=Number(process.argv[1]);const s=net.createServer();
s.once("error",e=>{console.log("PORT "+p+" => "+e.code);process.exit(0)});
s.listen(p,"127.0.0.1",()=>{console.log("PORT "+p+" => FREE");s.close();});' "$PORT"
```
**预期**：`PORT 3099 => FREE`。若 `EADDRINUSE` ⇒ 换 3102/3103 重跑（同步改 `$PORT`）。

```bash
# 1.3 自建插件草案自测（不启动任何服务）
cd "$P" && node harness/selftest.mjs | tail -3
cd "$P/deliverer-patch" && node selftest.mjs | tail -3
```
**预期**：`=== 结果：34/34 通过，0 失败 ===` 与 `=== 结果：18/18 通过，0 失败 ===`。
任何失败 ⇒ **停**，先修草案，别往下走。

```bash
# 1.4 官方件与 peer 依赖齐备（只读）
B="$A/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"
for p in dsh-webhook dsh-webhook-github dsh-host-webserver dsh-credentials dsh-credentials-local \
         dsh-agent dsh-agent-preset-registry dsh-permission-presets dsh-workspace dsh-session-title dsh-session; do
  printf '%-30s %s\n' "$p" "$(node -e "console.log(require('$B/$p/package.json').version)" 2>/dev/null || echo MISSING)"
done
ls -d "$B/../@octokit/webhooks" 2>/dev/null || echo "(octokit 只在用官方 github 适配器时才需要)"
```
**预期**：11 行全部 `0.2.0-rc.2`，无 `MISSING`。

```bash
# 1.5 profile 里还没有这两行（幂等判据：跑完 §3 后应变成各 1 行）
grep -c "webhook-runtime" "$A/home/profiles/web/cordis.patch.yml" || true
grep -c "office-route-b"  "$A/home/profiles/web/cordis.patch.yml" || true
```
**预期**：两条都是 `0`（若已是 `1`，说明 §3 已做过，**跳过 §3**）。

---

## §2 安装自建插件【协调者执行】

```bash
install -d "$A/home/profiles/node_modules/@local/dsh-office-route-b"
cp -a "$P/plugin-draft/lib" "$P/plugin-draft/package.json" \
      "$A/home/profiles/node_modules/@local/dsh-office-route-b/"
cd "$A/home/profiles" && node --input-type=module -e "
const m = await import('@local/dsh-office-route-b');
console.log('resolved:', m.name, JSON.stringify(m.inject), 'configKeys=' + Object.keys(m.Config.dict).length);"
```
**预期**：`resolved: office-route-b ["webServer","webhookRuntime","credentials"] configKeys=11`

```bash
# 2.2 官方件可裸名解析（profile node_modules 里已有 291 条 @deepseek-ai 软链）
cd "$A/home/profiles" && node --input-type=module -e "
const w = await import('@deepseek-ai/dsh-webhook');
console.log('webhookRuntime export:', typeof w.WebhookRuntime);"
```
**预期**：`webhookRuntime export: function`

---

## §3 追加 profile patch【协调者执行 · 该文件协调者独占写入】

```bash
# 3.1 先备份
cp -a "$A/home/profiles/web/cordis.patch.yml" \
      "$A/home/profiles/web/cordis.patch.yml.pre-route-b-$(date +%Y%m%d-%H%M%S)"

# 3.2 追加 insert 片段（片段本体来自 p0c/cordis.patch.insert.yml）
cat "$P/cordis.patch.insert.yml" >> "$A/home/profiles/web/cordis.patch.yml"

# 3.3 只读语法/组合校验（不启服务、不改状态）
cd "$P" && DSH_HOME="$P/probe-home" node "$CLI" --profile web --dump-config > /tmp/route-b-dump.out 2>/tmp/route-b-dump.err
echo "exit=$?"; grep -n -A3 'id: office-route-b' /tmp/route-b-dump.out; cat /tmp/route-b-dump.err
```
> ⚠️ 3.3 用的是 `$P/probe-home`（**本工单边界内的一份副本**），不是 `$A/home`。
> 若要对 `$A/home` 真实组合做只读校验，请把命令里的 `DSH_HOME` 换成 `$A/home`
> （只读，不写状态）—— 由协调者决定。

**预期**：`exit=0`，出现
```
- id: office-route-b
  name: '@local/dsh-office-route-b'
  config:
    source: office-handoff
```
stderr 为空。

### §3.4 两侧白名单根一致性断言（**最容易踩的坑**）

```bash
# 宿主侧：patch 里那一行 `!!js` 在本环境下会求值成什么
node -e '
const p = process.env;
const root = p.DSH_OFFICE_HANDOFF_WORKSPACE ?? ((p.HOME ?? "/tmp") + "/DSH-办公投递");
console.log("host-side plan:", "" + root);
'
# 投递侧：同一套优先级（--workspace > $DSH_OFFICE_HANDOFF_WORKSPACE > ~/DSH-办公投递）
echo "deliverer plan: ${DSH_OFFICE_HANDOFF_WORKSPACE:-$HOME/DSH-办公投递}"
```
**预期**：两行**完全同值**。
若不同值（典型情形：用 `$A/boot-web.sh` 启动，它做 `env -i` 把 `HOME` 设成
`$A/home` ⇒ 宿主侧是 `$A/home/DSH-办公投递`，而你的桌面 `HOME` 是
`/home/CNS2026495165` ⇒ 投递侧是 `/home/CNS2026495165/DSH-办公投递`）
⇒ **必须显式钉住**，见 §5 的启动命令（把 `DSH_OFFICE_HANDOFF_WORKSPACE`
放进 `env` 列表）与 §7 的 `--workspace`。

---

## §4 生成并落地令牌【**用户亲自执行**】

> 令牌值只能由用户决定。**不要**把它写进任何报告、脚本、spool、JSON 输出或 shell 历史。
> 推荐用 `read` 交互式输入，或在一个不写历史的 shell 里 export。

```bash
# 4.1 生成（若已有令牌就跳过，直接设为已有值）
openssl rand -hex 32
```
**预期**：64 位十六进制串。**记住它**（本节后面只用变量 `$TOKEN`，不再打印）。

```bash
# 4.2 设为本次 shell 的变量（不写历史：先 set +o history）
set +o history
read -rsp "粘贴刚生成的令牌: " TOKEN; echo
export DSH_OFFICE_ROUTE_B_TOKEN="$TOKEN"
set -o history
echo "token set: ${#DSH_OFFICE_ROUTE_B_TOKEN} chars"
```
**预期**：`token set: 64 chars`（**只回显长度，不回显值**）。

```bash
# 4.3 落盘到 credentials 服务（宿主侧解析面；0600）
#     分层优先级：启动环境 > $DSH_HOME/.credentials.yaml 的 refs: > 项目 .env > home .env
#     启动环境变量在启动时被**快照冻结**，所以"边跑边 export"不会被看到 ⇒ 落盘更稳。
python3 - "$DSH_HOME_020/.credentials.yaml" "$TOKEN_ENV" "$TOKEN" <<'PY'
import sys, os, pathlib
path, name, value = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path)
text = p.read_text(encoding="utf-8") if p.exists() else "refs:\n"
lines = [ln for ln in text.splitlines() if not ln.startswith(f"  {name}:")]
out, inserted = [], False
for ln in lines:
    out.append(ln)
    if ln.rstrip() == "refs:" and not inserted:
        out.append(f"  {name}: {value}")
        inserted = True
if not inserted:
    if not out or out[0].strip() != "refs:":
        out = ["refs:"] + out
        out.insert(1, f"  {name}: {value}")
p.write_text("\n".join(out) + "\n", encoding="utf-8")
os.chmod(p, 0o600)
print(f"wrote ref {name} into {p} (mode {oct(os.stat(p).st_mode & 0o777)})")
PY
```
**预期**：`wrote ref DSH_OFFICE_ROUTE_B_TOKEN into $A/home/.credentials.yaml (mode 0o600)`。
（回显里**没有**令牌值。若脚本报 mode 非 600，先 `chmod 600` 再重跑 —— 0.2.0 拒绝加载
任何其他用户可读的凭据文件。）

```bash
# 4.4 校验写入（只报存在性与长度，不报值）
python3 - "$DSH_HOME_020/.credentials.yaml" "$TOKEN_ENV" <<'PY'
import sys, re, pathlib
path, name = sys.argv[1], sys.argv[2]
for ln in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
    m = re.match(rf"^\s{{2}}{re.escape(name)}:\s*(\S+)\s*$", ln)
    if m:
        print(f"{name}: present, {len(m.group(1))} chars")
        break
else:
    print(f"{name}: MISSING")
PY
```
**预期**：`DSH_OFFICE_ROUTE_B_TOKEN: present, 64 chars`

```bash
# 4.5 同时落一份令牌文件（供 Nautilus 右键路径用：桌面会话拿不到你终端里的环境变量）
umask 077
printf '%s\n' "$TOKEN" > "$DSH_HOME_020/office-handoff/route-b.token"
chmod 600 "$DSH_HOME_020/office-handoff/route-b.token"
stat -c '%A %s %n' "$DSH_HOME_020/office-handoff/route-b.token"
```
**预期**：`-rw------- 65 …/route-b.token`（64 字符 + 换行）。
> 两侧读取优先级（投递侧草案 `resolveToken()`）：
> `$DSH_OFFICE_ROUTE_B_TOKEN` > `--token-file` > `$DSH_OFFICE_ROUTE_B_TOKEN_FILE`
> > `$DSH_OFFICE_HANDOFF_STATE/route-b.token` > `$DSH_HOME/office-handoff/route-b.token`。

**做完 §4 后建议**：`unset TOKEN DSH_OFFICE_ROUTE_B_TOKEN`（终端不再持有明文）。

---

## §5 起验收实例【协调者/用户执行 · 本工单未执行】

> 用 **3099**。`boot-web.sh` 的 `env -i` 会丢掉 `DSH_OFFICE_HANDOFF_WORKSPACE`，
> 所以下面把它显式加进 `env` 列表（这是让 §3.4 两行同值的唯一办法）。

```bash
# 5.1 启动（等价于 boot-web.sh，但显式带上白名单根）
cd "$A"
node -e 'const net=require("net");const p=Number(process.argv[1]);const s=net.createServer();
s.once("error",e=>{console.log("PORT "+p+" => "+e.code);process.exit(e.code==="EADDRINUSE"?1:0)});
s.listen(p,"127.0.0.1",()=>{console.log("PORT "+p+" => bind OK (free)");s.close();});' "$PORT" || exit 9

setsid env -i \
  HOME="$DSH_HOME_020" \
  DSH_HOME="$DSH_HOME_020" \
  DSH_OFFICE_HANDOFF_WORKSPACE="$WS_ROOT" \
  PATH=/usr/bin:/bin \
  DSH_TELEMETRY_MODE=DISABLED \
  node "$CLI" --profile web --port "$PORT" \
  > "$LOG" 2>&1 &
echo "started pid=$! log=$LOG"
```
**预期**：`PORT 3099 => bind OK (free)` + `started pid=… log=…`。
**必须 `setsid`**：只杀包装进程会留下仍在 LISTEN 的孤儿。

```bash
sleep 8
# 5.2 我们的两个条目是否真的激活（Route B 的装载判据）
grep -n "office-route-b\|webhook-runtime\|did not activate\|disabling profile plugin row" "$LOG" | head -20
grep -c 'disabling profile plugin row' "$LOG"
```
**预期**：
* `disabling profile plugin row` 计数 = **0**；
* **没有**任何一行把 `office-route-b` / `webhook-runtime` 列为 "did not activate"
  （本部署既有的 2 条未激活是 `vision-adam`、`session-status-board`，属已知门禁 N1）。
* 若出现 `office-route-b` 未激活 ⇒ 看紧邻的错误行：最常见是
  `workspaceRoots must list at least one absolute directory`（§3 的 `!!js` 求值成了空/相对）
  或 `Cannot find module '@local/dsh-office-route-b'`（§2 没做或没做对）。

```bash
# 5.3 URL 已发放
grep -o 'http://127.0.0.1:[0-9]*' "$LOG" | head -1
```
**预期**：`http://127.0.0.1:3099`

---

## §6 探针 + 端到端断言（只读 + 一次 POST）

### 6.1 探针：零副作用，确认路由存在且**不经 `/api` cookie 门**

```bash
# 不带任何 cookie、不带令牌 —— 预期 405（而不是 401/404）
curl -sS -o /dev/null -D - "$WEB_URL$ROUTE" \
  | sed -n '1p;/^[Aa]llow:/p'
```
**预期**：
```
HTTP/1.1 405 Method Not Allowed
allow: POST
```
* 若是 **401** ⇒ 你打到的是 `/api` 门（路径写错，或路由没注册成功）；
* 若是 **404** ⇒ 路由没注册（回 §5.2）；
* 若是 **200/HTML** ⇒ 落到了 SPA fallback（路径写错）。

```bash
# 对照：/api 无 cookie 一定是 401（证明两扇门确实不同）
curl -sS -o /dev/null -w "/api 无 cookie => HTTP %{http_code}\n" "$WEB_URL/api/session/list" -X POST \
  -H 'content-type: application/json' --data '{"type":"client-request","rpcId":"probe","method":"session/list","payload":{}}'
```
**预期**：`/api 无 cookie => HTTP 401`。（这就是 Route A 在 0.2.0 结构性失效的现场证据。）

### 6.2 投递前快照

```bash
snap() {
  echo "--- workspace.json workspaces ---"
  python3 -c "
import json,sys
d=json.load(open('$DSH_HOME_020/storages/workspace.json'))
for wid,w in (d.get('tables',{}).get('workspaces') or {}).items():
    print(wid, w['path'], 'sessions=' + str(len(w.get('sessionIds') or [])))
" 2>/dev/null || echo "(还没有 workspace.json)"
  echo "--- sessions 里已有的 webhook-* 会话 ---"
  find "$DSH_HOME_020/sessions" -mindepth 2 -maxdepth 2 -type d -name 'webhook-*' 2>/dev/null | sort
}
snap | tee /tmp/route-b-before.txt
```
**预期**：打印现有工作区与 `webhook-*` 会话（首次跑通常**没有** `webhook-*` 行）。
记下 `workspace.json` 的 sha256 作为基线：`sha256sum "$DSH_HOME_020/storages/workspace.json" | tee /tmp/route-b-ws-sha-before.txt`

### 6.3 投递一个文件（真正的端到端触发）

```bash
# 造一个测试文档（**不要**用你的真实资料）
TESTDIR="$DSH_HOME_020/DSH-办公投递"
mkdir -p "$TESTDIR"
printf 'hello route b\n' > "$TESTDIR/route-b-probe.txt"
```

**令牌怎么带**（令牌**不经过 HTTP 从服务端取**；也没有 `--token` 开关 ——
命令行参数会进 `ps` 与 shell history）：

```bash
if [ -z "${DSH_OFFICE_ROUTE_B_TOKEN:-}" ]; then
  DSH_OFFICE_ROUTE_B_TOKEN="$(tr -d '\n' < "$DSH_HOME_020/office-handoff/route-b.token")"
fi
export DSH_OFFICE_ROUTE_B_TOKEN

curl -sS -o /tmp/route-b-resp.txt -D /tmp/route-b-resp.headers \
  -X POST "$WEB_URL$ROUTE" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $DSH_OFFICE_ROUTE_B_TOKEN" \
  --data "$(python3 -c '
import json,sys
print(json.dumps({
  "workspacePath": sys.argv[1],
  "files": [sys.argv[1] + "/route-b-probe.txt"],
  "note": "Runbook §6.3 端到端探针（不可信示例文本）",
}, ensure_ascii=False))
' "$TESTDIR")"
sed -n '1p' /tmp/route-b-resp.headers; echo "body=[$(cat /tmp/route-b-resp.txt)]"
```
**预期**：
```
HTTP/1.1 202 Accepted
body=[]
```
（**空体**是契约的一部分。）

### 6.4 断言：0.2.0 侧真的出现了工作区 + 会话

```bash
# 轮询 30 秒，等 webhook-<uuid> 会话目录出现
for i in $(seq 1 30); do
  NEW=$(comm -13 <(sort /tmp/route-b-before.txt | grep 'sessions/.*/webhook-' || true) \
                 <(find "$DSH_HOME_020/sessions" -mindepth 2 -maxdepth 2 -type d -name 'webhook-*' 2>/dev/null | sort) || true)
  [ -n "$NEW" ] && break
  sleep 1
done
echo "new session dirs:"; echo "${NEW:-<none>}"
```
**预期**：1 行形如
`/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/home/sessions/<编码后的工作区路径>/webhook-<uuid>`

```bash
# 断言 A：会话日志真的在长（投了 prompt ⇒ 会产生会话事件）
SD="$(echo "${NEW:-}" | head -1)"
ls -la "$SD" 2>/dev/null
find "$SD" -name 'session.v4.jsonl.zstd' -size +0c 2>/dev/null | head
```
**预期**：目录里同时有 `session.lock`（0 字节）与 **非空** `session.v4.jsonl.zstd`。

```bash
# 断言 B：工作区注册表里出现了该目录，且 sessionIds 含这个 webhook 会话
python3 - "$DSH_HOME_020/storages/workspace.json" "$WS_ROOT" "$(basename "$SD")" <<'PY'
import json, sys
path, root, sid = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(path))
hits = [(wid, w) for wid, w in (d.get('tables', {}).get('workspaces') or {}).items() if w.get('path') == root]
print("workspaces at", root, "=>", len(hits))
for wid, w in hits:
    print(f"  {wid}  title={w.get('title')!r}  sessionIds={w.get('sessionIds')}")
    print("  contains our session:", sid in (w.get('sessionIds') or []))
print("VERDICT:", "PASS" if hits and any(sid in (w.get('sessionIds') or []) for _, w in hits) else "FAIL")
PY
```
**预期**：
```
workspaces at <WS_ROOT> => 1
  <uuid>  title='DSH-办公投递'  sessionIds=['webhook-<uuid>']
  contains our session: True
VERDICT: PASS
```

```bash
# 断言 C：GUI 侧的权威看法（本会话**不**用 cookie 去调 /api，只在浏览器里看一眼）
echo "请在浏览器打开（需要 §5 日志里的 ?token= URL）：$WEB_URL"
echo "预期：左栏出现工作区「DSH-办公投递」，其中一条会话标题形如「办公投递 · route-b-probe.txt」"
```
> 断言 C **必须由用户亲自执行**（需要浏览器 + cookie）。

### 6.5 负例断言（**白名单真的在拦**）

```bash
# 负例 1：目标目录在白名单外 ⇒ 403（先造一个白名单外的目录）
mkdir -p "$DSH_HOME_020/not-allowed"
curl -sS -o /tmp/n1.txt -w "outside-root => HTTP %{http_code}  body=" \
  -X POST "$WEB_URL$ROUTE" -H 'content-type: application/json' \
  -H "authorization: Bearer $DSH_OFFICE_ROUTE_B_TOKEN" \
  --data "{\"workspacePath\":\"$DSH_HOME_020/not-allowed\",\"files\":[\"$DSH_HOME_020/not-allowed/x.docx\"]}"; cat /tmp/n1.txt; echo
```
**预期**：`outside-root => HTTP 403  body=workspacePath is outside the configured roots`

```bash
# 负例 2：扩展名不在白名单 ⇒ 403
printf 'x' > "$TESTDIR/evil.exe"
curl -sS -o /tmp/n2.txt -w "bad-ext => HTTP %{http_code}  body=" \
  -X POST "$WEB_URL$ROUTE" -H 'content-type: application/json' \
  -H "authorization: Bearer $DSH_OFFICE_ROUTE_B_TOKEN" \
  --data "{\"workspacePath\":\"$TESTDIR\",\"files\":[\"$TESTDIR/evil.exe\"]}"; cat /tmp/n2.txt; echo

# 负例 3：令牌错误 ⇒ 401（且响应体不回显令牌）
curl -sS -o /tmp/n3.txt -w "bad-token => HTTP %{http_code}  body=" \
  -X POST "$WEB_URL$ROUTE" -H 'content-type: application/json' \
  -H "authorization: Bearer wrong-token" \
  --data "{\"workspacePath\":\"$TESTDIR\",\"files\":[\"$TESTDIR/route-b-probe.txt\"]}"; cat /tmp/n3.txt; echo

# 负例 4：Content-Type 不对 ⇒ 415
curl -sS -o /dev/null -w "text/plain => HTTP %{http_code}\n" \
  -X POST "$WEB_URL$ROUTE" -H 'content-type: text/plain' \
  -H "authorization: Bearer $DSH_OFFICE_ROUTE_B_TOKEN" --data '{}'
```
**预期**（四行）：
```
bad-ext      => HTTP 403  body=file extension is not in the allowlist
bad-token    => HTTP 401  body=invalid handoff token
text/plain   => HTTP 415
```

```bash
# 负例 5：日志里绝不出现令牌
grep -c "Bearer\|$DSH_OFFICE_ROUTE_B_TOKEN" "$LOG" || true
```
**预期**：`0`。

```bash
# 清理测试件
rm -f "$TESTDIR/route-b-probe.txt" "$TESTDIR/evil.exe" "$DSH_HOME_020/not-allowed" 2>/dev/null
rmdir "$DSH_HOME_020/not-allowed" 2>/dev/null || true
unset DSH_OFFICE_ROUTE_B_TOKEN
```

---

## §7 Nautilus 右键路径【**用户亲自执行**：点右键】

> 前置：**先应用投递器补丁**（本工单产出的 `p0c/deliverer-patch/`，**未落地**）：
> `cp -a ~/.local/lib/dsh-office-handoff ~/.local/lib/dsh-office-handoff.pre-route-b`
> → 用 `api.route-b.js` 覆盖 `lib/api.js` → 按 `cli.edits.md` 改 7 处 `lib/cli.js`
> → `node --check` 两个文件。
> **不改投递器也可以先验证宿主侧**（§6 已经做到了）—— §7 只是把"右键"这一段接上。

```bash
# 7.1 让桌面会话也能拿到令牌（Nautilus 继承桌面环境，不是你终端的环境）
#     方式：把令牌文件放到投递器的默认读取位置（§4.5 已做），或按桌面环境的机制注环境变量。
ls -l "$DSH_HOME_020/office-handoff/route-b.token"

# 7.2 自检：dry-run（不确认、不复制、不登记、不写 spool）
export DSH_WEB_URL="$WEB_URL"
export DSH_OFFICE_HANDOFF_FORBID_3080=1
export DSH_OFFICE_HANDOFF_WORKSPACE="$WS_ROOT"
export DSH_OFFICE_HANDOFF_STATE="$DSH_HOME_020/office-handoff"
~/.local/bin/dsh-office-handoff --dry-run --json -- ~/some-office-file.docx | head -30
```
**预期**：JSON 报告里 `probe.ok=true`、`probe.httpStatus=405`、`probe.allow="POST"`、
`origin` 是 3099、`route` 是 `/office-handoff`；**报告里没有任何令牌字段/值**。

```bash
# 7.3 **用户点右键**：在 Nautilus 里选一个 .docx/.pdf/… → 右键 → 脚本 → "DSH-纳入工作区"
```
**预期**（用户观察）：
1. 弹出一个确认框（默认选中项是「忽略」）；点「复制到工作区」；
2. 终端/通知里出现投递成功；
3. **几秒内**浏览器 0.2.0 页面左栏的「DSH-办公投递」工作区里出现一条新会话，
   标题形如 `办公投递 · <文件名>`；点进去能看到宿主生成的投递清单提示词。

```bash
# 7.4 断言（与 §6.4 同一套）
find "$DSH_HOME_020/sessions" -mindepth 2 -maxdepth 2 -type d -name 'webhook-*' | sort | tail -3
python3 -c "
import json; d=json.load(open('$DSH_HOME_020/storages/workspace.json'))
for wid,w in d['tables']['workspaces'].items():
    if w['path']=='$WS_ROOT': print(wid, w['title'], w['sessionIds'])
"
```
**预期**：出现新的 `webhook-<uuid>` 目录，且工作区的 `sessionIds` 里含它。

---

## §8 故障排查

| 现象 | 原因 | 处置 |
|---|---|---|
| `GET $ROUTE` ⇒ **401** | 打到了 `/api` 门（路径错），或路由被注册在别处 | 核对 patch 的 `path: /office-handoff`；`curl -D -` 看响应头有没有 `allow: POST` |
| `GET $ROUTE` ⇒ **404** | 路由没注册 | 看 §5.2：`office-route-b` 是否 "did not activate"；`@local/dsh-office-route-b` 是否装对位置 |
| `GET $ROUTE` ⇒ **200 + HTML** | 落到了 SPA fallback | 路径写了尾部 `/` 或多了前缀 |
| POST ⇒ **503** `office handoff token is unavailable` | 凭据槽解析为空 | §4.3 是否写入 `$DSH_HOME/.credentials.yaml` 的 `refs:`；文件是否 600；**启动环境变量是否在启动前就设好**（启动后 export 无效——环境在启动时被快照冻结） |
| POST ⇒ **401** | 两侧令牌不一致 | 宿主侧解析出的值 vs §4.5 的令牌文件；用 §4.4 的"长度"校验（别打印值） |
| POST ⇒ **415** | `content-type` 不是 `application/json` | 补 `-H 'content-type: application/json'`（带 `; charset=utf-8` 也接受） |
| POST ⇒ **413** | 体超 256 KiB | 正常信封远小于此；检查是不是把文件内容塞进了体里（**不要**，只传路径） |
| POST ⇒ **403** `workspacePath is outside the configured roots` | 两侧根不同值（**最常见的坑**） | 跑 §3.4 的一致性断言；用 `DSH_OFFICE_HANDOFF_WORKSPACE` 钉死两侧 |
| POST ⇒ **403** `workspacePath does not exist` | 宿主**不**按调用方输入 mkdir | 先让投递器把副本复制进去（投递器本来就会 mkdir 目标目录） |
| POST ⇒ **403** `file extension is not in the allowlist` | 扩展名不在白名单 | 用 `p0c/cordis.patch.insert.yml` 的 `extensions` 对表；两侧白名单必须同集 |
| **202 但永远没有会话** | 规则没命中 / 规则抛错 / preset 不存在 | 看 `$LOG` 里 `webhook-runtime` 的 warn：`office-route-b: rule=office-handoff refused: …` 或 `webhook: provider=… rule=… failed: …`；最常见是 `agentPreset: standard-glm` 未注册 |
| 会话出现但标题是默认名 | `dsh-webhook` 的 `sessionTitle.rename` 失败 | 看 warn；`session-title` 服务是否挂载（base bundle 提供） |
| 端口起不来 `EADDRINUSE` | 3098 是宿主/或 3099 被占 | **绝不要动 3098**；换 3102/3103 |
| 起不来且日志里有 `Cannot find module` | §2 安装路径错 | 目标必须是 `$A/home/profiles/node_modules/@local/dsh-office-route-b/`（`lib/` + `package.json` 两层） |

---

## §9 停栈与回滚

```bash
# 9.1 停验收实例（进程组 kill；只杀包装进程会留孤儿）
pkill -f "bin.js --profile web --port $PORT" ; sleep 3
node -e 'const net=require("net");const p=Number(process.argv[1]);const s=net.createServer();
s.once("error",e=>{console.log("port "+p+" => "+e.code);process.exit(0)});
s.listen(p,"127.0.0.1",()=>{console.log("port "+p+" => FREE (停栈干净)");s.close();});' "$PORT"
```
**预期**：`port 3099 => FREE (停栈干净)`

```bash
# 9.2 回滚 Route B（热面；三条任一）
# (a) 删掉 patch 末尾这次追加的两个 insert（最干净）
# (b) 只删 office-route-b 那一条（保留官方 runtime，等价于关闭 Route B）
# (c) 恢复备份：
ls -t "$A/home/profiles/web/"cordis.patch.yml.pre-route-b-* | head -1
# cp -a "$(ls -t "$A/home/profiles/web/"cordis.patch.yml.pre-route-b-* | head -1)" \
#       "$A/home/profiles/web/cordis.patch.yml"
```
> **不要**用 `(c)` 覆盖掉协调者在备份之后写的其它内容 —— 先 `diff` 确认差异只有本片段。

```bash
# 9.3 回滚已建的测试工作区/会话（**只删自己造的**，逐条确认路径后再删）
#     工作区列表在 $DSH_HOME_020/storages/workspace.json；会话在 sessions/<编码路径>/
#     建议：直接删掉本次测试生成的 webhook-* 会话目录，并在 GUI 里删掉测试工作区。
find "$DSH_HOME_020/sessions" -mindepth 2 -maxdepth 2 -type d -name 'webhook-*' -print
# 确认上面只列本次测试的后，再：
# find "$DSH_HOME_020/sessions" -mindepth 2 -maxdepth 2 -type d -name 'webhook-*' -newer /tmp/route-b-before.txt -exec rm -rf {} +
```

```bash
# 9.4 未污染判据：现役 3080/3097/3098 与改前一致
ss -ltn | grep -E ':(3080|3097|3098) '
sha256sum "$A/home/profiles/web/cordis.patch.yml"
```

---

## §10 本 Runbook **未验证**的项（不得当结论用）

1. **[未验证]** §2–§7 的**每一条**命令都**没有**在本工单里跑过：本工单被禁止起服务、
   被禁止写 `$A/home/**` 与 `~/.local/**`。除 §1.3 之外没有实跑证据。
2. **[未验证]** §3.3 的 `--dump-config` 只在 `$P/probe-home`（**副本**）上跑过，
   证明的是"这段 YAML 能被 loader 的 patch 算法吃下"（`exit=0`，两个条目进组合），
   **不是**"在 `$A/home` 上真的能起实例"。
3. **[未验证]** `dsh-webhook` 挂进本部署后其 `inject` 的六个服务是否全部解析成功；
   `agentPresets.resolve("standard-glm")` / `permissionPresets.resolve("workspace-write")`
   在**运行期**是否成立（源码层已核：默认 preset 是 `standard-glm`，权限表含
   `workspace-write`；但未实跑）。
4. **[未验证]** §4.3 的 `python3` 落盘脚本**没有**在本机凭据文件上跑过
   （`$A/home/.credentials.yaml` 是协调者/用户的数据，本工单不写）。
   它按 `dsh-credentials-local` README 的 `refs:` 文档形写成，但**未验证** 0.2.0 是否
   接受该写法（尤其是"注释与格式保留"这条产品承诺）。
5. **[未验证]** `curl` 是被允许的（它遵守代理环境变量的问题只对**投递器**成立 ——
   投递器纪律要求用内建 `fetch`；Runbook 里的 `curl` 是人工诊断，打的是 loopback）。
6. **[未验证]** §7 的投递器补丁**没有**落地：`api.route-b.js` 与 `cli.edits.md` 是草案，
   它们的自测（18/18）只用**假 fetch**，从未对一个真实 HTTP 服务发过请求。
7. **[未验证]** 会话目录名的编码规则（`~XXXX` + `-` 包裹）是**观察**现有目录名总结的，
   未在源码里找到出处；本 Runbook 的断言脚本因此**不预测**路径，而是"投递前后取差集"。

---

## §11 需要用户裁决的点

1. **端口/实例**：Route B 最终挂到哪个 0.2.0 实例？（本次验收用 3099；生产切换后是
   你日常用的那个 0.2.0 端口。**不要**是 3080 —— 那是 0.1.1，没有 `/office-handoff`。）
2. **白名单根**：用 `DSH_OFFICE_HANDOFF_WORKSPACE` 统一钉一个绝对路径，
   还是接受 `$HOME/DSH-办公投递` 的默认（要求 dsh 与 Nautilus **同一个 HOME**）？
3. **是否另起独立监听**：官方 `dsh-webhook-github` README 描述了"隔离 `webServer` +
   独立端口 + TLS 反代"的组合，但官方指南 `docs/user/guide/github-review.md`
   **未随包发布**（`find` 无结果），所以本工单**不给出**那段 YAML。要不要走这条路？
4. **是否复用官方 `dsh-webhook-github`** 而不是自建路由（见 `p0c/REPORT.md` §C2 的取舍）：
   自建路由的投递侧改动是"多一个 `authorization` 头"；官方适配器要求投递侧实现
   `sha256=` HMAC + 三个 `x-github-*` 头，但 HTTP 层代码量为 0（仅需规则插件）。
5. **投递器补丁的落地**：`api.js` 整份替换 + `cli.js` 7 处改动，是否现在落地？
   （`--json` 报告会**破坏性变更**：`workspace.workspaceId/title/created` 变成 `null`/`"unknown"`。）
6. **令牌轮换机制**：令牌是长期静态值还是定期轮换？轮换只需要重写
   `.credentials.yaml` 的 ref（宿主每次请求解析）+ 令牌文件（投递侧）。
