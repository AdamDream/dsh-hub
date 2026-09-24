# DEPLOY.md — U-BOOT1（压缩 + Range/条件请求）部署与回滚

> 线：`exec-boot`｜日期：2026-09-22｜宿主 PID 301709（**本档全程未重启、未 pkill、未改产品文件**）
> **deployed 写入由协调者执行**：本档只交候选件 + 补丁脚本（默认 dry-run）。

---

## 0. 交付件

| 件 | 路径 | 说明 |
|---|---|---|
| 补丁脚本 A（发点 A：插件 bundle） | `scripts/apply-Boot1a-v1.mjs` | 默认 dry-run；`--apply` 才写；自动 pre-image；幂等；`--rollback` |
| 补丁脚本 B（发点 B：静态资产） | `scripts/apply-Boot1b-v1.mjs` | 同上 |
| 编码器单一事实源 | `scripts/codec-source.mjs` | 两个补丁逐字内嵌（不引入跨包依赖 ⇒ 各自独立可回滚） |
| 已生成候选（可 diff 复核） | `candidates/A-dsh-client-modules-index.js`<br>`candidates/B-dsh-host-frontend-static-index.js` | 由 `--out-copy` 产出，与产品文件逐字节可比对 |
| 纪律自证 | `scripts/selftest-patch-scripts.mjs` → `evidence/selftest-patch-scripts.json` | 28/28（dry-run 不写 / apply / 幂等 / rollback / 锚点失败一个文件都不写 / 写后语法） |

**两个发点**（审计 C2 取证的两个发点，均已覆盖）：

| 发点 | 文件 | 原行为 | 改后 |
|---|---|---|---|
| A | `<dsh>/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js` 的 `serveBundle` | `content-type` + `cache-control: no-cache`，`res.end(body)` | br/gzip 协商、强 ETag/304、Range 206/416、`Vary`、`Accept-Ranges` |
| B | `<dsh>/node_modules/@deepseek-ai/dsh-host-frontend-static/lib/index.js` 的 `serveStatic` | `content-type`，`res.end(body)` | 同上；并把 `req` 透传进 `serveStatic`（原签名拿不到 req），旧 5 参调用保持可用 |

`<dsh>` = `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh`（可用 `--root` 覆盖）。

---

## 1. 是否需要重建 Web 产物？—— **不需要，且本机也重建不了**（务必读）

**结论：两个发点都在"宿主侧 lib 产物"里，不是在 `dist` 构建物里。**

- 发点 A/B 的目标文件是 **Node 宿主进程加载的 lib 代码**（`dsh-client-modules`、`dsh-host-frontend-static`）。
- `dist/assets/*`（`index-ClqxG24t.js` / `vendor-D22_Mp1f.js` / 两个 CSS）是**被读取的既有构建产物**；
  本补丁只在**读取它们时**改变响应编码，**不修改也不重新生成**它们。
- ⇒ **改这两个文件不需要重建 `dsh-web-frontend/dist`**。

**本机重建能力（实测，属"影响面不可控"的诚实告知）**：

```
package.json: { "files": ["lib/*.js", "config"] }   # 安装树只含 lib 产物
ls <dsh>/apps  <dsh>/packages  <dsh>/src            # 三者均不存在
find / -maxdepth 4 -name dsh-web-frontend -type d   # 未找到源码目录
```

⇒ **本机没有 `apps/web` 源码树，无法重建 Web 产物**。因此：

- 任何需要改 `apps/web` **源码**的改动（例如 U-BOOT2 启动协议惰性层）在**本机不可执行**，见
  `candidates/U-BOOT2-HOLD.md`。
- U-BOOT1 **不依赖**重建：打补丁 → 重启宿主即可生效。
  **冷面**：`dsh-*` 的 lib 是宿主进程启动时加载的，必须重启宿主进程才生效。

> ⚠️ **升级即失效**：`dsh` 包升级会覆盖这两个文件；升级后需重跑补丁脚本（脚本会如实报 `ANCHOR_FAIL`
> 并**一个文件都不写**，不会写出半截补丁）。

---

## 2. 部署步骤（协调者执行）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-boot

# ① 先看 dry-run：锚点唯一命中 + 写前语法校验 + pre-image 路径
node scripts/apply-Boot1a-v1.mjs
node scripts/apply-Boot1b-v1.mjs

# ② 落盘（自动 pre-image 到 candidates/preimage/）
node scripts/apply-Boot1a-v1.mjs --apply
node scripts/apply-Boot1b-v1.mjs --apply

# ③ 冷面生效：重启 dsh 宿主机进程（由协调者按批次统一重启；本档不重启）
```

幂等：重复 `--apply` 会返回 `ALREADY_APPLIED` 且不改字节。

### 2.1 运行时开关（环境变量，无需改代码重新打补丁）

| 变量 | 默认 | 作用 |
|---|---|---|
| `DSH_W08_ENCODER_CONCURRENCY` | `8` | 并发压缩上限，避免 50 个 bundle 同时抢占 libuv threadpool（默认 4 线程） |
| `DSH_W08_ENCODER_MIN_BYTES` | `1024` | 小于该值不压（压缩头开销反而变大） |
| `DSH_W08_ENCODER_CACHE_DIR` | **未设置 = 关闭** | **磁盘编码缓存目录**。⚠️ 本机 dsh 运行在 workspace-write 沙箱下时 `mkdtemp('/tmp')` 会 EACCES（本档实测）⇒ 默认关闭，走"内存缓存 + 预热"。**生产宿主（非沙箱）建议显式开启**，例如 `DSH_W08_ENCODER_CACHE_DIR=/var/cache/dsh-enc`；开启后跨重启无需重压 |

> 内存缓存上限 24 条变体（`br` 与 `gzip` 各占一键）；冷启动首次会压一遍 50 个 bundle，
> 之后同进程内 100% 命中。

---

## 3. 重建后的 **served 字节核对方法**（响应体哈希；`?rev=` 不是内容哈希）

审计口径已明确：`?rev=` 是**注册表 revision**，不得当内容哈希用。本档独立核验了一个有力的巧合，
但**代码不依赖它**：

> **实测**：50/50 个 `/plugins/*/client.js?rev=<12hex>` 的 `rev` 恰好等于磁盘文件 `sha1` 的前 12 位
> （`{same:50, diff:0}`，脚本见下）。**但补丁自身一律从响应体重算 sha1**，不读 `?rev=`
> ⇒ 即使将来 `rev` 语义变化，ETag 仍正确。

### 3.1 核对 served 字节（三种口径，任选但须说明用哪种）

```bash
# 口径 1：线上字节（wire）—— 必须带 Accept-Encoding 且**不要**让 curl 自动解压
curl -s --compressed -o /dev/null -w '%{size_download} %{content_type}\n' \
  -H 'Accept-Encoding: br' 'http://127.0.0.1:3080/assets/index-ClqxG24t.js'
# 期望：size_download ≈ 136789（= 399361 × 0.3425，br q4 实测）

# 口径 2：响应体哈希（内容真值）—— 与磁盘逐一比对
#   注意：curl --compressed 会**自动解压** ⇒ 得到的哈希可与磁盘文件直接比；
#   不加 --compressed 时拿到的是编码体，只能与"离线压同一档"的结果比。
for f in /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/*.js; do
  b=$(basename "$f")
  disk=$(sha1sum "$f" | cut -c1-40)
  wire=$(curl -s --compressed "http://127.0.0.1:3080/assets/$b" | sha1sum | cut -c1-40)
  [ "$disk" = "$wire" ] && echo "OK   $b" || echo "DIFF $b  disk=$disk wire=$wire"
done

# 口径 3：压缩体哈希（用于证明"同一档同一结果"）—— 离线压同一档再比
FILE=<dist>/assets/index-ClqxG24t.js node -e '
const z=require("zlib"),fs=require("fs"),c=require("crypto");
const p=process.env.FILE;const b=fs.readFileSync(p);
const e=z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:4,[z.constants.BROTLI_PARAM_SIZE_HINT]:b.length}});
console.log(p, "br4 bytes="+e.length, "sha256="+c.createHash("sha256").update(e).digest("hex").slice(0,16));
' <dist>/assets/index-ClqxG24t.js
# 期望 br4 bytes=136789（与口径 1 的 size_download 应一致）
```

### 3.2 `?rev=` 与磁盘 sha1-12 一致性核对（审计 C2 验收项）

```bash
node - <<'EOF'
const fs=require('fs'),c=require('crypto'),http=require('http');
http.get('http://127.0.0.1:3080/',r=>{let h='';r.on('data',d=>h+=d);r.on('end',()=>{
  const m=[...h.matchAll(/\/plugins\/([^"?]+)\/client\.js\?rev=([0-9a-f]{12})/g)];
  let same=0,diff=0,miss=0;
  for(const [,id,rev] of m){
    const cands=[
      `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/${id}/lib/client.js`,
      `/home/CNS2026495165/.dsh/profiles/node_modules/${id}/lib/client.js`];
    const f=cands.find(fs.existsSync); if(!f){miss++;continue;}
    const s=c.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0,12);
    s===rev?same++:diff++;
  }
  console.log({entries:m.length,same,diff,miss});
});});
EOF
# 本档实测（未部署状态）：{ same: 50, diff: 0, miss: 0 }
```

### 3.3 功能零回归核对（部署后必须跑）

| 项 | 方法 | 期望 |
|---|---|---|
| 脚本可执行、50 条 fiber 全 active | 浏览器打开首屏，控制台无 `web boot: N entries did not activate` | 0 条报错 |
| 设置 4 个 tab | 打开设置逐 tab | 均正常 |
| 插件列表 / 用量 9 路 RPC | 见兄弟线闸门 | 不回归 |
| `content-encoding` 生效且比例达标 | 口径 1：`encodedBodySize/decodedBodySize ≤ 0.45`（对**纯代码包**）；pptmaster 例外 ≈0.558 | 达标 |
| 304 条件请求 | 二次加载时 `If-None-Match` → `304`（传输 0 字节） | 达标 |
| 关键路径 wire 字节 | 见 §3.1 口径 1，或离线 `evidence/estimate-wire.json` | `≤ 6.1 MB`（基线 11.90 MB） |

---

## 4. 回滚（两个单元各自独立）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/exec-boot
node scripts/apply-Boot1a-v1.mjs --rollback      # 发点 A 单独回滚
node scripts/apply-Boot1b-v1.mjs --rollback      # 发点 B 单独回滚
# 然后按批次重启宿主
```

- `--rollback` 从 `candidates/preimage/` 取**最新** pre-image，校验 sha1-12 后原子还原，并回读验证。
- 回滚是**纯服务端**的：无客户端状态、无缓存清理需求（客户端只是重新拿到未压缩响应）。
- 回滚粒度：**A 与 B 互不影响**——只回 A 仍享有 `/assets/*` 压缩，反之亦然。

---

## 5. 已知限制与不做的事

1. **本档未在 3080 上验证"打补丁后的真实挂载时刻"**：本档无写权限（workspace-write），
   deployed 写入由协调者执行 ⇒ "关键路径字节"是实测（真实文件字节 × 实测压缩比），
   **"挂载时刻改善"本轮未同窗测量**（见 `report.md` 的诚实边界）。
2. **Range 对压缩表示不做切片**：带 `Range` 且协商到 br/gzip 时返回**全量编码体**（合法，
   且在"索引的是我们没发送的字节"时是唯一诚实答案）。仅 `identity` 表示支持 206/416。
   若确需压缩体切片，需另立单元。
3. **壁纸 PNG（2.33 MB）几乎不可压**：PNG 已压缩，br 对它无收益 ⇒ 它在关键路径上的 2.33 MB
   **不在本单元的收益里**（离线估算把 `other` 类保守取 1.0）。
4. **`/api/*` JSON 响应不在本单元范围内**：本补丁只覆盖上述两个发点（`/plugins/*/client.js`
   与 dist 静态资产，含 `/`）。`session.list` 的 505 KB JSON 由兄弟线负责。
5. **不引入 HTTP/2**：见 `report.md` 的 U-BOOT4 结论（本档只交可行性，不实施）。
