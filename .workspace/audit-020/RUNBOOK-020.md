# DSH 0.2.0 迁移 Runbook（可直接复制执行）

> **目标版本**：`@deepseek-ai/dsh@0.2.0-rc.1`（npm `next`；**不存在稳定 0.2.0**）
> **现役保护**：`3080`（0.1.1-rc.2）**全程不动**；本 Runbook **不含**任何切换现役的动作。
> **隔离端口**：`3098`（首选）/ `3099` / `3102` / `3103` / `9224` / `9225`
> **权威配套**：`.workspace/audit-020/reports/MIGRATION-ASSESSMENT.md`（评估与门禁）、`reports/PLUGIN-MATRIX.md`（插件矩阵）
>
> 行尾 `\` 续行**后面不得有空格**。

---

## 0. 一次性变量（后续所有片段都依赖它）

```bash
cd /home/CNS2026495165/dsh
export NPM_CACHE=/home/CNS2026495165/dsh/.workspace/npm-cache   # 必须！默认 ~/.npm/_cacache 只读(EROFS)
export NPM_LOGS=/home/CNS2026495165/dsh/.workspace/npm-logs
export VERSION=0.2.0-rc.1
export PORT=3098
export ROOT=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020   # 隔离根（工作区内）
mkdir -p "$NPM_CACHE" "$NPM_LOGS"

# ⚠️ 插件来源必须用「已迁移件树」，不是现役根！
# 现役 ~/.dsh/profiles/node_modules 里 ssh-gui/workerspace 仍是 0.1.1 版（真 import installSettingsSection），
# 从它复制会让已修好的插件退回未修状态（爆炸半径 7 个而非 3 个）。
export MIGRATED=/home/CNS2026495165/dsh/workbuddy-reverse-proxy/_audit/unified-assembly-20260929-121756/home/profiles/node_modules
```


> **为什么隔离根必须在工作区内**：本沙箱每个 bash 调用都在
> `bwrap --ro-bind / / --bind <workspace> <workspace> --unshare-pid` 内，`/` 只读挂载，
> **家目录不可写**（`mkdir ~/.dsh-020` 返回 `EROFS`，是挂载只读而非权限问题）。
> 因此 `~/.dsh-020` + `~/.npm-global-dsh020` 这种「与 0.1.7 同形」的布局**在本沙箱不可用**；
> 若要在真实宿主 shell 中用同形布局，把 `ROOT` 换成家目录前缀即可，其余步骤不变。

---

## 1. 前置闸门（全部只读；任一条不符**先停**）

```bash
# 1.1 现役实例仍在（只读探测，绝不停止/重启）
ss -ltn | grep -E ':(3080|3097) '
```
**预期**：两行 LISTEN（`127.0.0.1:3080`、`127.0.0.1:3097`）。缺任一行 ⇒ 停，先查现役。

```bash
# 1.2 目标端口空闲（bind-only 探针，比 ss 更强；只 bind 不 listen）
node -e 'const net=require("net");const p=process.argv[1];const s=net.createServer();
s.once("error",e=>{console.log("PORT "+p+" => "+e.code);process.exit(0)});
s.listen(p,"127.0.0.1",()=>{console.log("PORT "+p+" => FREE");s.close();});' "$PORT"
```
**预期**：`PORT 3098 => FREE`。若 `EADDRINUSE` ⇒ 换 §0 备用端口重跑本步。

```bash
# 1.3 现役配置指纹（迁移前后必须一致，作为「未污染」判据）
sha256sum ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/settings.yaml
```
**预期**：记下这两个 sha256 作为基线（**它们是活值，每轮必须重取，不得引用历史值**）。

```bash
# 1.4 目标制品完整性（与 registry 声明比对）
sha256sum /home/CNS2026495165/dsh/.workspace/dsh-020-pkg/deepseek-ai-dsh-0.2.0-rc.1.tgz
```
**预期**：`ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216`
（若文件缺失则 `npm pack @deepseek-ai/dsh@$VERSION --pack-destination /home/CNS2026495165/dsh/.workspace/dsh-020-pkg` 重新取得）

---

## 2. 现场备份（**先备份再动手**）

```bash
# 2.1 打时间戳备份目录
export TS=$(date +%Y%m%d-%H%M%S)
export BK=/home/CNS2026495165/dsh/.workspace/audit-020/backup-$TS
mkdir -p "$BK"
echo "备份目录：$BK"

# 2.2 配置类（小、关键、不可重建）
cp -a ~/.dsh/settings.yaml                        "$BK/settings.yaml"
cp -a ~/.dsh/profiles/web/cordis.patch.yml        "$BK/cordis.patch.yml.active"
cp -a ~/.dsh-017/profiles/web/cordis.patch.yml    "$BK/cordis.patch.yml.017"
cp -a ~/.dsh/.agent-presets                       "$BK/agent-presets"        2>/dev/null
cp -a ~/.dsh/skills                               "$BK/skills"               2>/dev/null
cp -a ~/.dsh/office-handoff                       "$BK/office-handoff"       2>/dev/null

# 2.3 本地插件部署件（13 个）
mkdir -p "$BK/plugins/@local" "$BK/plugins/@deepseek-ai"
cp -a "$MIGRATED/@local/."                                  "$BK/plugins/@local/"
for p in dsh-taste dsh-session-board dsh-vision-adam; do
  cp -a "$MIGRATED/@deepseek-ai/$p"                           "$BK/plugins/@deepseek-ai/$p"
done
cp -a "$MIGRATED/dsh-workspace-enhancement"                              "$BK/plugins/" 2>/dev/null

# 2.4 生成备份指纹清单（可验证，不是「看起来备份了」）
( cd "$BK" && find . -type f -exec sha256sum {} \; | sort -k2 ) > "$BK/SHA256SUMS"
wc -l "$BK/SHA256SUMS"
```
**预期**：`SHA256SUMS` 行数与备份文件总数一致（>100 行）。此文件是回滚时的比对基准。

```bash
# 2.5 高风险提示：老 home 首次被新版启动会「静默清理」这个遗留目录，先单独留存
ls -la ~/.dsh/profiles/web/.dsh-module-fallback 2>/dev/null && \
  cp -a ~/.dsh/profiles/web/.dsh-module-fallback "$BK/dsh-module-fallback" || echo "(无该目录，跳过)"
```

---

## 3. 安装 0.2.0 到隔离根

```bash
export npm_config_cache="$NPM_CACHE"
export npm_config_logs_dir="$NPM_LOGS"
mkdir -p "$ROOT/prefix-cli" "$ROOT/home/profiles/web" "$ROOT/logs"

# 3.1 全局安装（得到 lib/node_modules 形态，与现役一致）
npm install -g --prefix "$ROOT/prefix-cli" "@deepseek-ai/dsh@$VERSION" --no-audit --no-fund
```
**预期**：`added 546 packages in ~5–25s`，退出码 0。体积约 521–540 MB。

> **离线重建（T18+T27 实测，两个致命陷阱 + 一个体积杠杆）**
> 1. **空 cache + `--offline` 必报 `ENOTCACHED`**（npm 即使有 lockfile 仍需 packument 解析传递范围）
>    ⇒ 离线包**必须含预热 cacache**。反例实测：`npm cache add <本地 tgz>` 只写 `pacote:tarball:file:<绝对路径>` 键，缺 registry packument ⇒ `--offline` 直接 `ENOTCACHED`。
> 2. **把 74 个平台门控可选依赖平铺成显式 `file:` 依赖会报 `EBADPLATFORM`** ⇒ **必须走 lockfile 路线**（`npm ci`）。另：`npm ci` 要求根依赖与 lock **完全一致**，否则**静默跳过**。
>
> **已备好的现成产物**（T27 交付，可直接用，无需自己下载）：
> - `iso-020/pkgs/*.tgz` —— **607 个 tgz / 552.4 MiB**（闭包 606 + 1 余量），sha512 逐包校验 607/607 通过
> - `iso-020/manifests/dsh-0.2.0-rc.1.sha256`（607 行，`sha256sum -c` 可复核）
> - `iso-020/lockgen/0.2.0-rc.1/{package.json,package-lock.json}`（离线安装形态 1 的锁文件对）
> - `iso-020/bin/{dl-020.sh,offline-verify.sh,seed-cache.sh,fetch-pkgs.mjs,resolve-closure.mjs}`（**一键验收脚本内置网络闸门**）
> - `iso-020/meta/{manifest-0.2.0-rc.1.json,closure-table.md,direct-deps.md,download-report.json}`
>
> **`npm cache` 预热后 705 MiB**（`npm ci --offline` 3 秒级重建）⇒ 迁移期反复重建安装树时值得缓存；**cache 必须放工作区**（默认 `~/.npm/_cacache` 只读 EROFS）。
>
> **体积杠杆（T27 建议）**：552.4 MiB 中 **499.1 MiB（90.4%）是 74 个 os/cpu 限定包**
> （`libreoffice-kit` 307.9 / `sharp` 102.3 / `sherpa-onnx` 59.9 / `ripgrep` 22.8）。
> **linux-x64 子集仅 542 包 / 128.3 MiB（4.3× 缩减）**。若只在本机迁移，可只取子集；跨平台则建议保留全平台超集。
>
> **无 native addon 需编译**：5 个带 install 脚本的包全是预编译分发（`node-pty` 自带 7 平台 prebuilds、`koffi`/`sharp` 走平台包）⇒ **离线安装不需要 node-gyp/gcc/python**。

```bash
# 3.1b 一键离线验收（T27 交付，含网络闸门；ci / install 两模式均 PASS）
bash /home/CNS2026495165/dsh/.workspace/iso-020/bin/offline-verify.sh 2>&1 | tail -20
```
**预期**：`NET_UNREACHABLE: EAI_AGAIN`（闸门生效）→ `added 548 packages in ~3s` → 自检 `dsh 0.2.0-rc.1`
（`koffi`/`sharp`/`node-pty`/native 全部 `require` 成功）。

```bash
# 3.2 离线可用性自检
env -i HOME="$ROOT/home" DSH_HOME="$ROOT/home" PATH=/usr/bin:/bin \
  node "$ROOT/prefix-cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js" --version
```
**预期**：`0.2.0-rc.1`

> **运行时/原生面（T18 实测，无需任何动作）**：node `v22.23.2` **满足** 0.2.0 全部 `engines` 要求
> （612 条解析入口中 196 个声明 `engines.node`，195 个满足；唯一不满足项 `@img/sharp-win32-ia32` 是 win32/ia32 平台门控、本机永不安装）；
> 运行时下限为 9 个包的 `>=22.19.0`（含 `libreoffice-kit`、`undici@8.11.2`），有 4 个 patch 余量 ⇒ **无需升 node**。
> 6 个原生模块在 node 22.23.2 下**全部加载成功**，`node-pty` 真实 spawn PTY 成功，landlock `probe()` 返回 `full`（与 0.1.7 同二进制同输出），
> 5 个带 install 脚本的包**全部走预编译产物、未触发 gyp**，`.node` 产物两版无增减。
> **安全面默认值零变化**：`dsh-sandbox-policy`/`dsh-fs-sandbox`/`dsh-user-approval`/`dsh-credentials-local`/`dsh-sandbox` **源码逐字节相同**；
> 沙箱 `workspace-write`、审批 `ask`、凭据 `~/.dsh/.credentials.yaml`(0600) **全部未变** ⇒ 现役配置**无需任何默认值适配**。
> **唯一第三方依赖版本变化**：**`koffi` 3.3.2 → 3.1.1**（上游把 6 个包的 `^3.1.0` 改成精确 `3.1.1`，属主动锁定）。
> `koffi@3.1.1` 在 node 22.23.2 下 `require` 成功；**凡依赖 koffi FFI 语义的本地插件迁移后需重测**。

---

## 4. 组装 profile 组合

```bash
export CLI="$ROOT/prefix-cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js"
export NATIVE="$ROOT/prefix-cli/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"

# 4.1 三个 profile 骨架文件（cordis.yml 保持空数组，定制只写 patch 层）
cat > "$ROOT/home/profiles/web/cordis.yml" <<'YML'
# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
YML

cat > "$ROOT/home/profiles/web/pnpm-workspace.yaml" <<'YML'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
YML

cat > "$ROOT/home/profiles/web/package.json" <<JSON
{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "@deepseek-ai/cordis-plugin-group": "^1.0.1",
    "@deepseek-ai/dsh": "$VERSION",
    "ssh2": "^1.17.0"
  },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
}
JSON

# 4.2 把现役 patch 层搬过来（**这一步之后必须按 §5 逐条修订**）
cp -a ~/.dsh/profiles/web/cordis.patch.yml "$ROOT/home/profiles/web/cordis.patch.yml"
```

```bash
# 4.3 官方包解析面：为 @deepseek-ai 建「每包一链接」的农场
#     （不要用单个目录软链，会遮蔽本地插件）
mkdir -p "$ROOT/home/profiles/node_modules/@deepseek-ai" "$ROOT/home/profiles/node_modules/@local"
for d in "$NATIVE"/*; do
  [ -e "$d" ] || continue
  ln -sfn "$d" "$ROOT/home/profiles/node_modules/@deepseek-ai/$(basename "$d")"
done
echo "farm entries: $(ls "$ROOT/home/profiles/node_modules/@deepseek-ai" | wc -l)"

# 4.4 本地插件（13 个）
cp -a "$MIGRATED/@local/."                                   "$ROOT/home/profiles/node_modules/@local/"
for p in dsh-taste dsh-session-board dsh-vision-adam; do
  cp -a "$MIGRATED/@deepseek-ai/$p"                          "$ROOT/home/profiles/node_modules/@deepseek-ai/$p"
done
cp -a "$MIGRATED/dsh-workspace-enhancement"                   "$ROOT/home/profiles/node_modules/" 2>/dev/null

# 4.5 btw 的运行时依赖 zod（新组合顶层没有，现役 profile 有）
ln -sfn "$ROOT/prefix-cli/lib/node_modules/@deepseek-ai/dsh/node_modules/zod" "$ROOT/home/profiles/node_modules/zod"
node -e "console.log('zod ->', require('$ROOT/home/profiles/node_modules/zod/package.json').version)"
```

```bash
# 4.5b 来源闸门（必须过）：确认复制来的是「已迁移件」而非 0.1.1 现役件
for p in dsh-ssh-gui dsh-workerspace dsh-subagent-model; do
  n=$(grep -cE '^import \{[^}]*installSettingsSection' \
      "$ROOT/home/profiles/node_modules/@local/$p/lib/index.js" 2>/dev/null || echo 0)
  printf "  %-22s 真 import installSettingsSection: %s\n" "$p" "$n"
done
node -e "console.log('  zod:', require('$ROOT/home/profiles/node_modules/zod/package.json').version)"
```
**预期**：`dsh-ssh-gui 0`、`dsh-workerspace 0`（**已迁移**）、`dsh-subagent-model 1`（**待改造**）、`zod: 4.6.5`。
若 `ssh-gui`/`workerspace` 打印 `1` ⇒ **复制源错了**（用了现役根），必须停手重取，否则爆炸半径由 3 个变 7 个。


```bash
# 4.6 组合层自检（离线、不起服务）
env -i HOME="$ROOT/home" DSH_HOME="$ROOT/home" PATH=/usr/bin:/bin \
  node "$CLI" --profile web --dump-config | grep -c '^- id:'
```
**预期**：**199**（0.1.7 为 198）。若为 0 或报错 ⇒ 组合未闭合，先修 §4.1–4.5。

---

## 5. 组合层修订（0.1.7 → 0.2.0 的三处组合差异）

```bash
# 5.1 用 diff 亲眼确认差异面（应恰好是 otel 增、time-context/schedule/ui-schedule 删）
diff -u /home/CNS2026495165/dsh/.workspace/audit-020/dump-017.txt \
        /home/CNS2026495165/dsh/.workspace/audit-020/dump-020.txt | head -60
```
**预期要点**：
- 新增 `- id: otel` / `name: '@deepseek-ai/dsh-otel'`
- 新增 `desktop-product-telemetry`、`product-analytics`（均 `disabled: ...!== 'desktop'`，web 下不挂载）
- 新增 `- id: ui-settings-session-log`
- 删除 `time-context`、`schedule`、`ui-schedule`（自动化任务降级为可选 bundle）
- `session-telemetry-otel.exporter.url` 默认值改为 `dsh-otel-collector.deepseeksvc.com`

```bash
# 5.2 确认现有 patch 没有引用被删 id（已经实测 no matches，此处为复验）
grep -nE 'time-context|ui-schedule|^\s*- id: schedule' \
  "$ROOT/home/profiles/web/cordis.patch.yml" || echo "OK: patch 未引用被删 id"
```
**预期**：`OK: patch 未引用被删 id`。若命中 ⇒ 该条 patch 会静默失效，须改为挂载 `@deepseek-ai/dsh-experimental-schedule-bundle`。

---

## 6. 插件面：peer 闸门豁免（**不做这步会静默禁用 6 个插件**）

0.2.0 的 `dsh-app-boot` 在启动时执行 `evaluatePluginCompatibility`，凡 peer 上界为 `<0.2.0` 的插件
**会被静默禁用**（只在 stderr 打 `disabling profile plugin row ...`，GUI 无提示）。
官方给的解药是 **profile 级「精确版本豁免」**，存在 `<profile>/compatibility.json`。

```bash
cat > "$ROOT/home/profiles/web/compatibility.json" <<'JSON'
{
  "@deepseek-ai/dsh-taste@0.1.0": ["0.2.0-rc.1"],
  "@deepseek-ai/dsh-vision-adam@0.2.0": ["0.2.0-rc.1"],
  "dsh-workspace-enhancement@0.1.2": ["0.2.0-rc.1"],
  "@local/dsh-pptmaster@0.1.0": ["0.2.0-rc.1"],
  "@local/dsh-web-search-sse@0.1.0": ["0.2.0-rc.1"],
  "@local/dsh-workerspace@0.1.0": ["0.2.0-rc.1"]
}
JSON
chmod 600 "$ROOT/home/profiles/web/compatibility.json"
```
**格式规则（源码级）**：key = `精确包名@精确版本`，value = `精确 DSH 版本数组`；**不接受范围**，不合法条目会被忽略并 warning。

> **更彻底的替代做法**（可选）：把 7 个插件的 `peerDependencies` 上界由 `>=0.1.1-rc.2 <0.2.0` 放宽为 `>=0.1.1-rc.2 <0.3.0`（共 24 处声明）。
> 好处是语义正确、不依赖豁免文件；代价是改动插件制品。**本 Runbook 默认走豁免文件（不改制品、可审计）。**

---

## 7. 启动隔离实例并验收

```bash
# 7.1 启动（netns 网络隔离 + 空环境 + 显式端口 + 遥测关闭）
#     注意：--port 是强制项，0.2.0 组合默认端口硬编码为 3080 = 现役端口
rm -rf "$ROOT/logs"; mkdir -p "$ROOT/logs"
setsid unshare -rn env -i \
  HOME="$ROOT/home" \
  DSH_HOME="$ROOT/home" \
  PATH=/usr/bin:/bin \
  DSH_TELEMETRY_DISABLED=1 \
  DSH_TELEMETRY_MODE=DISABLED \
  bash -c "ip link set lo up 2>/dev/null; exec node '$CLI' --profile web --port $PORT --no-open" \
  > "$ROOT/logs/web-$PORT.log" 2>&1 &
echo "started; log: $ROOT/logs/web-$PORT.log"
```

> **必须用 `setsid`**：只杀包装进程会留下**仍在 LISTEN 的孤儿**；`setsid` + 进程组 kill 才能干净停栈。

```bash
sleep 15
# 7.2 验收判据 A：peer 闸门无禁用、插件加载结果、URL 已发放
grep -c 'disabling profile plugin row' "$ROOT/logs/web-$PORT.log"     # 预期 0
grep -A3 'did not activate' "$ROOT/logs/web-$PORT.log"                # 预期仅 2 条
grep -o 'http://127.0.0.1:[0-9]*' "$ROOT/logs/web-$PORT.log" | head -1 # 预期 http://127.0.0.1:3098
```
**预期裁决**：
- `disabling` 计数 = **0** ⇒ peer 闸门豁免生效
- 未激活 = **2 条**：`vision-adam`、`session-status-board`（**属已知门禁 N1，见 §10**）
- URL 已发放 ⇒ 实例起来了（0.2.0 启动约 1–2 s）

```bash
# 7.3 验收判据 B：HTTP 真实响应（必须在与服务同一个 netns 内探活）
TOKEN=$(grep -o 'token=[A-Za-z0-9_-]*' "$ROOT/logs/web-$PORT.log" | head -1 | cut -d= -f2)
unshare -rn bash -c '
  ip link set lo up 2>/dev/null
  curl -s -o /dev/null -w "no-token: HTTP %{http_code}\n" '"http://127.0.0.1:$PORT/"'
  curl -s -o /dev/null -w "with-token: HTTP %{http_code}\n" "'"http://127.0.0.1:$PORT/?token=$TOKEN"'"
'
```
**预期**：`no-token: HTTP 401`、`with-token: HTTP 303`（303 = 通过鉴权跳转）。

```bash
# 7.4 验收判据 C：零外呼证据（S 级三叠加）
#  (i) netns 无路由 —— 成功外呼在物理上不可能
unshare -rn bash -c 'ip link set lo up; echo "routes: $(ip route | wc -l)"'
# 预期 routes: 0
#  (ii) 遥测确实被关（配置层）
env -i HOME="$ROOT/home" DSH_HOME="$ROOT/home" PATH=/usr/bin:/bin \
  node "$CLI" --profile web --dump-config | grep -A3 'session-telemetry-otel'
# 预期可见 exporter.url 指向 dsh-otel-collector...，但运行时由 DSH_TELEMETRY_MODE=DISABLED 关闭
```

### 7.4b 零外呼的两条**必须遵守**的红线（T22 实测，源码级闭合）

```bash
# 红线 1：必须用 env -i 清空模型 key ——「netns 隔离」本身不足以保证零外呼
env -i HOME="$ROOT/home" DSH_HOME="$ROOT/home" PATH=/usr/bin:/bin \
  node "$CLI" --profile web --dump-config >/dev/null && echo "clean-env OK"
```
- **无 key ⇒ 源码级必然零外呼**：`resolveAuth` 在 `fetch` **之前**且在 `try{}` **之外**抛 `MISSING_CREDENTIAL`
  （`dsh-llm-deepseek/lib/index.js:2149` vs `2188`），而 `MISSING_CREDENTIAL`/`AUTH` **不在默认可重试码内**
  （`dsh-llm/lib/types/retry-policy.js:16-22`）⇒ 无静默重试。
- **反之（有 key + netns 隔离）会走 `TRANSPORT` 重试最多 5 次** ⇒ **不能只靠 netns**。
- 另注意**启动目录的 `.env` 也会供 key**（`dsh-credentials-local/lib/index.js:11-46,473-490`）。

```bash
# 红线 2：三条隐藏后台外呼风险，建议在 patch 层显式关闭（写进 profile patch）
cat >> "$ROOT/home/profiles/web/cordis.patch.yml" <<'YML'

# ---- 零模型请求加固（T22 实测：三条隐藏后台风险）----
# R1 首提示词自动标题；R2 回合内自动压缩（auto 默认 true）；R3 设置页模型发现的 pi-ai 真外呼
- id: session-title-llm
  disabled: true
- id: compaction-basic
  disabled: true
- id: llm-pi-ai
  disabled: true
YML
```

> **证据判读红线**：`session/title-llm-request` 事件表示「请求已**装配**」而**非**「已发出」；
> 只有 `session/title`（成功）或 `llm/retry` / `llm/retry-started` 才代表**真实外呼**。判读日志时不得混用。
>
> **启动期零请求的机制性保证**：`agent-loop` 启动时 `agents: []`，无 agent 进入 running 相位、不调 `wakeDriver`
> （`lib/index.js:1551-1560, 852-868`）；自动标题需「用户首条消息 + 主请求头落盘」才排程
> （`dsh-session-title/lib/index.js:379-388, 405-415`）；全树仅 4 个包调 `ctx.llm.stream`，其中 `auto-review` 默认关闭。
>
> **实测对照**：`unshare -rn` + `env -i` 下 `--dump-config` / `--dump-default-config` / `--help` 全部 exit 0，
> 输出与联网态 sha256 **完全相同**。

```bash
# 7.5 停栈（干净收尾 + 残留检查）
pkill -f "bin.js --profile web --port $PORT" ; sleep 3
node -e 'const net=require("net");const p=process.argv[1];const s=net.createServer();
s.once("error",e=>{console.log("port "+p+" => "+e.code);process.exit(0)});
s.listen(p,"127.0.0.1",()=>{console.log("port "+p+" => FREE (停栈干净)");s.close();});' "$PORT"
```
**预期**：`port 3098 => FREE (停栈干净)`

```bash
# 7.6 未污染判据：现役配置指纹必须与 §1.3 基线**完全一致**
sha256sum ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/settings.yaml
ss -ltn | grep -E ':(3080|3097) '
```
**预期**：现役 patch 与 settings 的 sha256 **与 §1.3 逐一相同**；3080/3097 仍 LISTEN。

> **不要用 `ps -p <pid>` 判存活**：本沙箱每个 bash 调用在独立 PID namespace 内，`ps` 只见自身；
> 且**端口占用是 per-netns 的**（同一端口号可在宿主与 netns 同时绑定且互不可见）。

---

## 8. 会话数据迁移（**实测为 no-op**，但仍须校验）

权威依据：两版 `SESSION_FORMAT_VERSION = 4`；`dsh-session-format` / `dsh-session-catalog` /
`dsh-session-persistence-jsonl` / `dsh-session-format-v0-to-v1` / `v3-to-v4` 五包 `lib/**/*.js`
**逐字节相同** ⇒ **0.2.0 不升代、旧会话可直接读**。

```bash
# 8.1 只读清点现役会话（不抄内容，只看结构与计数）
find ~/.dsh/sessions -maxdepth 1 -mindepth 1 -type d | wc -l          # 工作区目录数
find ~/.dsh/sessions -type f | wc -l                                   # 文件总数
find ~/.dsh/sessions -type f -name '*.jsonl' -printf '%s\n' | awk '{s+=$1} END {print "bytes:", s}'

# 8.2 生成「冻结基线指纹」（迁移后据此证明无损）
( cd ~/.dsh && find sessions -type f -exec sha256sum {} \; | sort -k2 ) \
  > "$ROOT/logs/sessions-baseline.txt"
wc -l "$ROOT/logs/sessions-baseline.txt"
```
> **基线边界（必须写进结论）**：该指纹只能保证**采集时刻之后**的字节未变，**不保证采集前未缺失**。

> **⚠️ 两条必须遵守的会话数据纪律（T12 实测）**
> 1. **`zstdDecompressSync(整文件)` 只解第一帧** —— 会话日志是 **zstd 帧拼接**（单文件实测 880 帧），
>    整文件解压只得到**表头（约 200 B）**，对 12 MB 日志会**静默给出 190 B**。**必须按帧逐帧解码。**
> 2. **「resume 后日志字节不变」是错的断言** —— agent 级 resume 会把尾部修复合成事件 **durable 写回**
>    （`dsh-agent-loop/lib/index.js:1935-1936`）。正确断言是「**源代**字节不变」。
> 3. **`taste/` 与 `btw/` 不在会话日志内**（sidecar：`<DSH_HOME>/taste/`、`<DSH_HOME>/btw/index.json`）
>    ⇒ 与会话迁移**完全解耦**，但**不受任何会话备份覆盖** ⇒ §2 备份与 §8 复制都**必须单独携带这两棵 sidecar 树**。

```bash
# 8.0 sidecar 树（不在 sessions/ 内，容易漏）
mkdir -p "$ROOT/home/taste" "$ROOT/home/btw"
cp -a ~/.dsh/taste/. "$ROOT/home/taste/" 2>/dev/null
cp -a ~/.dsh/btw/.   "$ROOT/home/btw/"   2>/dev/null
echo "taste.md bytes: $(stat -c%s "$ROOT/home/taste/taste.md" 2>/dev/null)"
```
**预期**：`taste.md bytes: 17002`（**中文单轨**，4482 CJK；英文 sidecar `display.zh.json` 已退役为 `{}`，无需迁移）。

```bash
# 8.3 复制会话到隔离根
mkdir -p "$ROOT/home/sessions"
cp -a ~/.dsh/sessions/. "$ROOT/home/sessions/"

# 8.4 校验无损
( cd "$ROOT/home" && find sessions -type f -exec sha256sum {} \; | sort -k2 ) \
  > "$ROOT/logs/sessions-after.txt"
diff "$ROOT/logs/sessions-baseline.txt" "$ROOT/logs/sessions-after.txt" && echo "会话数据逐字节一致 ✅"
```
**预期**：`会话数据逐字节一致 ✅`（无 diff 输出）。

> **活跃写入告警**：若现役实例正在写会话，**不要**用顺序 `cp` 当一致快照
> （历史实测 12 次里 0 次一致）。需一致快照时用 `{readOnly:true}` + `VACUUM INTO`（若为 SQLite 形态）。
> 本步骤的 `sha256sum` 比对在复制后立即执行，若现役同时写入会自然报出差异——这正是它的作用。

---

## 9. 配置面迁移（settings 命名空间 → profile 条目 id）

**机制变更（最关键的一条）**：0.1.7+ 起 `settings.yaml` **只被读一次随即 `rename` 成 `settings.yaml.imported`**；
settings 命名空间**不再取 YAML 段名，而取 profile 插件条目 id**；未知段 / 未知 target **一律 warn + skip，从不报错** ⇒ **静默丢失**。

```bash
# 9.1 先看现役 settings.yaml 有哪些命名空间（不抄凭据值）
grep -nE '^[a-zA-Z@][a-zA-Z0-9_-]*:' ~/.dsh/settings.yaml
```
**预期**（本轮实测 12 段）：`ui-onboarding`、`llm-deepseek`、`llm-pi-ai`、`agent-default-model`、
`vision-adam`、`agent-presets`、`web-search-deepseek`、`wallpaper`、`dsh-workerspace`、
`dsh-ssh-gui`、`ui-theme`、`dsh-subagent`。

**逐段处置表**：

| 段名 | 处置 | 说明 |
|---|---|---|
| `ui-onboarding` | 自动接住 | 官方重映射到 `ui-settings-general` |
| `llm-pi-ai` | 自动接住 | 条目 id 同名 |
| `agent-default-model` | 自动接住 | 条目 id 同名 |
| `web-search-deepseek` | 自动接住 | 条目 id 同名 |
| `ui-theme` | 自动接住 | 条目 id 同名 |
| `llm-deepseek` | 自动接住 | 空段 |
| `dsh-workerspace` | **建议删** | 无对应条目 |
| `agent-presets` | **人工搬运（必须）** | 条目已改名 `agent-preset-registry`；`default` 非 volatile，只能写进 patch 的 `config` |
| `dsh-ssh-gui` | **人工搬运** | 条目 id 是 `ssh-gui`，与段名不一致 |
| `dsh-subagent` | **人工搬运** | 条目 id 已变为 `subagent-model-selection-settings`（且见 §10-N2） |
| `vision-adam` | **人工搬运** | 插件断层（见 §10-N1） |
| `wallpaper` | **人工搬运** | 命名空间名/条目 id 不匹配 |

> **唯一会静默改变现役 agent 行为的**是 `agent-presets.default: standard-glm`：
> 因条目改名为 `agent-preset-registry`，旧 patch 的 `- id: agent-presets` **静默不命中** ⇒ 回落到官方 `standard`。

```bash
# 9.2 确认你的 patch 用的是新 id（隔离根 ~/.dsh-017 的版本已是修正版）
grep -n -A3 'agent-preset' ~/.dsh/profiles/web/cordis.patch.yml      # 现役：旧 id（需改）
grep -n -A3 'agent-preset' ~/.dsh-017/profiles/web/cordis.patch.yml  # 017：新 id（可参照）
```
**修法**：把 patch 中 `- id: agent-presets` 改为 `- id: agent-preset-registry`，
并按 §10-N3 一并修正自建 preset 的 `config.text:` → `config.prefix:`。

---

## 10. 已知门禁（**未闭项，不得当作已通过**）

| 编号 | 内容 | 严重度 | 处置 |
|---|---|---|---|
| **N1** | 3 个插件 import 即失败：`@local/dsh-subagent-model`、`@deepseek-ai/dsh-session-board`、`@deepseek-ai/dsh-vision-adam`，真因是 `installSettingsSection`/`settingsNamespace` 在 **0.1.7 就已删除**（**非 0.2.0 引入**，是上一轮未闭缺口） | 阻塞 | 须改代码。**样板已就绪**：`dsh-ssh-gui` / `dsh-wallpaper` / `dsh-workerspace` 已完成同一改造（源码内保留「0.1.7 已无 `installSettingsSection`，改用 `liveConfig()`/`cfg()`」注释） |
| **N2** | 「subagent 默认模型 = settings 段」是现役部署的 **73 行本地补丁**（上游两树均无此逻辑），0.2.0 全新安装不继承 | 阻塞 | 重新施加补丁（宿主半）+ 插件两端重写 + settings 数据迁移；或降级方案 B（只改 preset 静态 `agentOptions`，零宿主补丁） |
| **N3** | 自建 preset `standard-glm`：`config.text:` 非法（应为 `prefix`，必填）⇒ **激活失败**；`dsh-workflow-worker-thread` 包已停发 ⇒ 换 `dsh-workflow-ptc`；`agentOptions.model` 与 settings 段实测值不一致 | 阻塞 | 逐条改；见 T13 报告 §6 |
| **N4** | 0.2.0 新增默认远端遥测外呼，无 `enabled` 开关，**卸载时 drain**（停实例本身是外呼时点） | 高 | 已用 `DSH_TELEMETRY_MODE=DISABLED` 关闭（接受值实测为 `DISABLED`/`FEEDBACK_ONLY`）；零外呼验收**必须另证「未发起」**，不能只靠 `unshare` |
| **N5** | `--dump-config-schema` **两版都恒 exit 1**（`complete=false` + 6 条 diagnostic） | 中 | **不得**把它的退出码当作配置校验/启动失败判据 |
| **N6** | `dsh-skill-office` 与全部 `dsh-experimental-*` **未被任何 bundle 挂载**（本部署为休眠包）；`office-to-pdf` 是迁到 0.2.0 才新增的官方能力 | 低 | 无需动作；若启用官方 office 技能须同时挂 `dsh-tool-workspace-dependencies` 并保证 `libreoffice-kit`/`python-pptx`/`openpyxl` 可用，否则 `apply()` 直接抛错 |
| **N7** | A 的引用有效性（附件对象未验） | 待裁决 | 私有副本缺附件对象；分页会触发 `ATTACHMENT_NOT_FOUND`（未见内容损坏证据） |
| **N8** | 宿主层 S-4：`resolveGenerationInDirectory` 按最高代选代、不校验内容包含 | 机制已证、未修 | 发布前须以完整性门 + 隔离陈旧件处置 |
| **N9** | `CLI/lib` 三版逐字节相同 ⇒ **但 `home` 首启会静默清理** `<profile>/.dsh-module-fallback` | 低 | §2.5 已备份 |

---

## 11. 逐项验收标准（迁移是否算「完成」的判据）

| # | 判据 | 命令 | 通过条件 |
|---|---|---|---|
| V1 | 组合可解析 | §4.6 | 条目数 = 199 |
| V2 | 实例可启动 | §7.2 | URL 已发放 |
| V3 | peer 闸门清零 | §7.2 | `disabling` = 0 |
| V4 | 插件加载 | §7.2 | 未激活 ≤ 2（且恰为 N1 的 2 个） |
| V5 | HTTP 可达 | §7.3 | 401 / 303 |
| V6 | 零外呼 | §7.4 | netns `routes: 0` + `DSH_TELEMETRY_MODE=DISABLED` |
| V7 | 停栈干净 | §7.5 | 端口 FREE |
| V8 | 现役未污染 | §7.6 | 两处 sha256 与 §1.3 一致；3080/3097 仍 LISTEN |
| V9 | 会话无损 | §8.4 | `diff` 无输出（**逐字节**一致） |
| V10 | 旧会话可读 | 打开一个历史会话 | 可列出、可渲染（**零模型请求下只验「打开/渲染」**） |
| V11 | 配置段不静默丢失 | §9.1 对照表逐段核对 | 每一段都有明确去向 |
| V12 | 老会话**可继续**（与 V10 不同） | 见下 | **源代**字节不变 + 继任代已发布 + 二次 resume 幂等 |

> **V12 为什么必须单列**：`open(id,'read')` 读通**不等于**「老会话可冷恢复」。
> `ctx.sessions` 按设计**没有** resume/reopen/load，唯一公开入口是 `ctx.agents.resume()`；
> 而后端 `open(id, access)` 的 **`read` 分支不做** `claimWrite`/`acquireLease`/`publishStoredMigration`，
> **只有 `write` 分支**才迁移并发布 v4 继任代。
> **V10（能读）通过 ≠ V12（能继续）通过** —— 这正是历史误判 D-01 的机理。
>
> **V12 的验收配方（零模型请求，三层）**：
> 1. **迁移链放行**：按 zstd **帧**逐帧解码目标 v0/v3 日志，确认事件类型全部落在 `RELEASED_V0_EVENT_DISPOSITIONS` 封闭清单内。
> 2. **投影正确性 A==B**：只读通路与 write-open 通路的投影结果等值。
> 3. **盘面证据**：write-open 后**源代文件字节不变**（sha256 相同）**且**新出现继任代（v3 与 v4 两代共存、体积变化）。
> 4. **幂等层（3b）**：**第二遍 resume 必须零新增 closers** —— 这是「干净继续」的核心断言。
>
> 本机已有的**旁证**：0.1.7 根存在 8 个 v4 代，其中 **2 个目录同时含 v3 与 v4 两代**（源代 mtime 09-12 < 继任代 09-28），`session.lock` 恰 8 个。
> **未验证**：老 v0 会话在 0.2.0 下的 agent 级 `resume` **实跑**（受零模型请求约束未执行）⇒ **不得宣告 V12 已通过**。

> **验收层级纪律（上一轮最贵的教训）**：`单元/机制 PASS` **不得**上推为 `目标 PASS`，更不得上推为 `发布准入`。
> 五层必须分开写：**隔离证据 / 机制 PASS / 目标 PASS / 发布准入 / 切换授权**。
> **本 Runbook 不含任何切换现役的步骤；切换必须由用户单独确认。**

---

## 12. 回滚（新根一键废弃，零风险）

```bash
# 12.1 停隔离实例
pkill -f "bin.js --profile web --port $PORT" ; sleep 2

# 12.2 废弃隔离根（现役从未被写入，因此无需「恢复」）
mv "$ROOT" "$ROOT.abandoned-$(date +%Y%m%d-%H%M%S)"

# 12.3 证明现役完好
sha256sum ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/settings.yaml   # 与 §1.3 一致
ss -ltn | grep -E ':(3080|3097) '                                      # 仍 LISTEN
```

---

## 13. 故障排查

| 现象 | 根因 | 处置 |
|---|---|---|
| 启动即 `EADDRINUSE` | 0.2.0 组合默认端口**硬编码 3080 = 现役端口** | 必须传 `--port`（§7.1 已含） |
| 插件「莫名消失」 | peer 闸门静默禁用 | 捕获 **stderr** 并 `grep disabling`（§7.2）；补 `compatibility.json` |
| `Cannot find package 'zod'` | 新组合顶层缺 `zod` | §4.5 |
| `does not provide an export named 'installSettingsSection'` | settings API 断层 | N1（须改代码） |
| `Cannot find package '@deepseek-ai/schemastery'` | 插件嵌套依赖未就位 | 确认 `@deepseek-ai` 农场是**每包一链接**（§4.3），不要用单个目录软链 |
| `DSH_HOME` 设了但仍读真 home | `DSH_*` 属 bootstrap-only，只能由**继承环境**提供；且必须**同时覆盖 `HOME`**（20+ 处 `homedir()` 站点） | §7.1 的 `env -i` 同时给 `HOME` 与 `DSH_HOME`；**`DSH_HOME="   "`（空白）会静默回退真 `~/.dsh`** ⇒ 闸门须断言「非空 + 绝对 + 落在隔离根内」 |
| `npm` 报 `EROFS ... /_cacache/` | 默认 cache 在只读挂载上 | §0 的 `NPM_CACHE` |
| 杀进程后端口仍占用 | 只杀了包装进程 | 用 `setsid`（§7.1）+ 进程组 kill |
| `ps -p <pid>` 恒 NO_SUCH_PID | 每个 bash 调用一个 PID namespace | 改用「端口 + 配置哈希 + 日志判据」 |
| `--dump-config-schema` exit 1 | 两版既有状况 | 忽略（N5） |

---

## 14. 迁移后建议的下一批动作

1. **闭 N1**：以 `dsh-ssh-gui`/`dsh-wallpaper`/`dsh-workerspace` 为样板，改造 3 个失败插件的 settings 接入。
2. **闭 N2**：对 0.2.0 的 `dsh-tool-subagent` 重新生成派发时读取补丁（**目标文件哈希已变，不可直接套用旧 diff**）。
3. **闭 N3**：修 preset 三层问题。
4. **文档收口**：按 `.workspace/audit-020/reports/T31-docs-impact-inventory.md` 的 30 个交付单元更新 17 份文档（**209 处**硬编码版本/路径断言）。
5. **切换预案**：产出 `office-upgrade-cutover-plan.md`（只准备，不执行）。

---

## 附：本条 Runbook 已实测通过的部分（本轮证据）

| 片段 | 实测结果 |
|---|---|
| §3.1 安装 | `added 546 packages`，exit 0，521–540 MB，5–23 s（两处独立复现） |
| §3.2 `--version` | `0.2.0-rc.1` |
| §4.6 `--dump-config` | 199 条目，exit 0 |
| §7.1 启动 | 成功；netns 内 ~1–2 s 就绪（协调者 3098 / T25 3102 / T20 3098 三处独立） |
| §7.3 HTTP | `401` → 带 token `303`（T25/T20 实测） |
| §7.4 零外呼 | netns `routes: 0`；`unshare -rn` 沙箱允许；`lo` 需显式 `ip link set lo up` |
| §6 豁免效果 | `disabling` 由 **6 → 0**（本轮实测） |
| §7.2 插件 | **11/13 加载成功**；失败 2 个 = N1 |
| §8 会话格式 | `SESSION_FORMAT_VERSION=4` 两版相同；格式五包逐字节相同 |

---

## 附二：T19 实测补充（**必读，两条会静默丢数据的坑**）

### 附二.1 最危险的失败模式是「静默丢数据」，`integrity_check` 抓不到
对真实现役 `usage.db` **只拷 db、丢掉 `-wal`**（5.17 MB）后：
`PRAGMA integrity_check` = **ok**、schema 完整、表内自洽 —— **却静默丢失 13 条已提交事件**。
⇒ **仅凭 `integrity_check` 判定快照可用是错的。**
- 正确做法：`{readOnly:true}` + `VACUUM INTO`（实测 **12/12 通过**；顺序 `cp` db+wal+shm **0/12**、仅 `cp` db **0/12**，全部 `database disk image is malformed`）。
- 必须叠加**staleness 水印**：实测 `sync_state` 行数 +1 而 `rowid` +319 ⇒ **只看 rowid 会误判**，需按表性质选水印。
- **不可外推**：撕裂取决于「拷贝耗时 vs checkpoint 频率」—— 28 KB 小库 25/25 通过，72 MB 现役库落在撕裂区间。**小库试通不代表大库安全。**
- 通用性已验证：一套命令对 `~/.dsh`（72 MB→95 ms）与 `~/.dsh-017`（9.8 MB→39 ms）**都有效**。
- **会话数据是另一种形态**：多帧 zstd 追加流（548 KB 文件含 979 帧），40/40 抽样均为现役文件的**字节前缀** ⇒ **直接 `tar` 安全**，SQLite 坑**不适用**；`tar -cf` 仅 802 ms（gzip 慢 24× 只省 2.8%，属无谓开销）。

### 附二.2 patch 层的真实根**不是**顶层 `node_modules/`
**真实根 = `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/`**。
用错根时 85 个文件**全部报「未找到」**（实测 `missing=85`），**恢复动作静默无效**。
⇒ §2.2 备份必须显式包含这一层；这也是**「0.2.0 必须装到独立前缀」的硬性理由**（见 §0 的 `ROOT` 设计）：
- 否则 `npm i` 会**就地覆盖这 85 个不可重建的手改文件**；
- 且 `~/.dsh/profiles/node_modules` 的 **496 条绝对符号链接**会把两代文件**混着解析**。
- 独立前缀下 **0.1.1 天然可回滚，回滚场景零恢复动作**。

### 附二.3 「未污染」判据：完全绕开 `ps`（已实盘验证）
`ps` 不可用**不是工具坏而是 namespace 语义**（`bwrap --unshare-pid`）。改用**六组见证**：
socket inode（`14152` / `15397376`）+ HTTP 指纹 + `dsh-host.jsonl` 单调 `sn` + 日志内宿主 pid `6021` + 配置哈希 + 会话数非递减。
审计结束与基线逐行 diff —— **仅 2 行变化**（`sn` 4160→4176、1311→1320，正是「同一世代仍在写」的期望行为），inode/HTTP/pid/配置/会话数**逐字符相同**。
⚠️ **`settings.yaml` 是活值**（现役自行改写），**不能当未污染判据**；校验须走带「易变路径排除表」的 `manifest.sh`。

### 附二.4 两个真实缺陷（工具侧，已修正）
1. **`grep -F "  $rel"` 查 patch 哈希会被前缀同名孪生文件误匹配**（`client.js` 同时命中 `client.js.pre-ShellFix-v1.bak`）⇒ 产生 **2/85 假 MISMATCH**，把正确的恢复判成失败。改 `awk '$2==r'` 后 **85/85 通过**。
2. **无效实验会被 liveness guard 拦下**：一轮 12/12「通过」实为对**已静默库**测得，整轮作废重做 ⇒ 任何快照一致性结论**都须附 liveness 证据**。

### 附二.5 可信回滚点（T19 清点）
| # | 回滚点 | 校验结论 |
|---|---|---|
| ① | patch 层 09-25 | `cmp` **85/85** 与现役全等 ✅ |
| ② | 会话内容 09-25 | `zstd -t` **1875/1875** 有效 + **40/40** 为现役字节前缀 ✅ |
| ③ | 插件层 09-25 | 8/8 目录哈希全等 ✅，但**缺 `dsh-web-search-sse`** |
| ④ | 本轮新建最小集合 | 119 MB / 8 s，已过恢复演练（patch 85/85、插件 9/9、配置 53/53）✅ |

其余 11 项（`dsh-home-config.tgz` 897 MB/09-11、`self-built-plugins.tgz` 仅 2 插件、`~/.dsh/backups` 22 项、`profiles-archive` 324 MB 等）判为**过期或不完整，不得单独依赖**。

### 附二.6 两条非对称事实（迁移脚本不可假设两个 home 同构）
- **`~/.dsh-017` 没有 `settings.yaml`**；
- 其 `cordis.patch.yml` 引用的 `dsh-vision-adam` 在现役 `@local` 中**已不存在**。

---

## 附三：阶段二已裁定事项（协调者实测，执行档直接采纳，**不得重开**）

### 附三.1 N10 = **采纳方案 B**（丢弃私有依赖岛）
三条前提已逐条隔离实测：

| 前提 | 结论 | 依据 |
|---|---|---|
| ① `ctx.set` 能否顶掉官方已 provide 的服务 | ✅ **允许**（后注册者胜，child 的 set 会覆盖根） | cordis 4.0.4 最小复现：`root.set OK`、`child.set OK` |
| ② `dsh.client.inject` 缺包名是否致命 | ✅ **非阻塞** —— 信息性字段 | `dsh-client-modules:66-67` 仅 `optionalStringArray`；`dsh-package-manifest/types.d.ts:79` 原文 *"Informational package-name dependencies, **not** Cordis service injection"* |
| ③ 私有岛是否被安装期重建 | ❌ **不会**，岛随包分发且钉死 0.1.1 | `dsh-workspace-enhancement` 岛内 **66** 项、`dsh-pptmaster` **23** 项，`dsh-fs`/`dsh-fs-local`/`dsh-fs-sandbox`/`dsh-subprocess`/`dsh-subprocess-local` 全部 = **0.1.1-rc.2**，而官方是 **0.2.0-rc.1** |

**⇒ 保留旧岛 = 永久 0.1.1 语义 + 无法满足 0.2.0 新契约**（`readByteRange` / `terminalEnvironment` / `resize` / `inspectActivity`），
方案 A 不是「保守」而是「半吊子」；**必须丢弃旧岛**（方案 B）。

### 附三.2 N12（taste 图标）**已闭环**，A/B 验证
`Icon*Outline16` → `*OutlineRegular`（5 处 + 测试夹具）。A/B 实测：

| 版本 | tests | pass | fail |
|---|---|---|---|
| **已修** | 218 | **202** | **16** |
| 回退未修 | 218 | 201 | 17 |

⇒ **净收益 +1 通过、零新失败**；`test/client.test.js` 单跑 **7/7**。剩余 16 个为既有夹具问题，与本修复无关。

### 附三.3 口径纪律（适用于本 Runbook 全部判据）
- 凡「是否变化」**一律以 `lib/` 逐文件为准**；整树口径只能用于「发布物是否重打」。
- 依据类型必须标注：`[lib全等推定]` / `[源码实读]` / `[部署件实测]`。
- **部署件优先于源码树**：`btw`/`ssh-gui`/`wallpaper`/`workerspace` 的**部署件已在上轮改造**（无 settings 具名导入，实测 import OK）；
  settings 断层**只阻塞 3 个**：`dsh-subagent-model`、`dsh-session-board`、`dsh-vision-adam`。
- **不得**把 import 通过当作功能通过（历史坑「单元 PASS ⇒ 目标 PASS」的同型错误）。
