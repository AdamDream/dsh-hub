# WP3 复核工作区（独立复核 · 只读源 + 本目录写入）

> 本目录是 WP3 执行档的**唯一脚本/原始输出落点**（连同 `../reports/VOLATILE-FIX-VERIFY.md`）。
> 所有判定都能在这里用一条命令重跑。

## 0. 先决条件（本目录内已建好）

```bash
# 为了让脚本能解析 @deepseek-ai/*（schemastery / cosmokit / dsh-credentials / dsh-app-boot …）
ls -la node_modules      # -> $A/home/profiles/node_modules 的软链
A=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020
[ -e node_modules ] || ln -sfn $A/home/profiles/node_modules ./node_modules
```

`before/*.mjs` 是 `volatile-fix-backup/*.orig` 的**逐字节副本**（只改扩展名，Node 才能 import）：

| 副本 | sha256 |
|---|---|
| `before/subagent-model.index.mjs` | `044e05ca38d8c9c2cab3f6b68b918d1e453f4f00b7c0ac671e4e18842ddbfc00` |
| `before/vision-adam.index.mjs` | `9ccf89117567e0ea57e9b68ffcea94d2161a17d856e9c05342b717aeda471d05` |

## 1. 重跑

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020/verify-volatile
node a-volatile-form-parity.mjs    > out/a-parity.txt      2>&1   # A：改前/改后 volatileForm / isVolatilePath
node b-runtime-unwrap.mjs          > out/b-runtime.txt     2>&1   # B：运行时解包语义（末行应为 "## B 全项 PASS"）
node c-serviceability.mjs          > out/c-serviceability.txt 2>out/c-serviceability.err   # C：200 条登记表
node d-restart-compatibility.mjs   > out/d-restart-compatibility.txt 2>&1                 # D 附录：兼容闸门
```

## 2. 关键实现手法（避免"凭记忆复刻"）

- **A/B** 都在运行时从 `$B/dsh-settings/lib/index.js` **切出第 97–158 行源码文本**，
  用真实依赖（`z`、`isVolatile`、`redactSecrets`）`new Function` 实例化后调用
  ⇒ `volatileForm` / `isVolatilePath` / `plainConfig` / `projectForm` 与 0.2.0 运行时是同一份字节。
- **B** 的"运行时 config"不是手搓的假对象，而是用**插件自己 import 的那一份 schemastery**
  `z.resolve(plain, Config)` 解析出来的（`.volatile()` ⇒ `createVolatile` 引用对象，与 cordis 给插件的一致）。
- **B4** 把消费者 `dsh-tool-subagent/lib/index.js:68-88` 的**源码文本**直接实例化后真跑。
- **C** 逐条 `import(<条目 name>)` 取 Config；Schemastery 的 Schema 实例 `typeof === "function"`，
  判型必须同时接受 object/function（第一版按 object 判会出现全表假阴性）。
- **D 附录** 调官方 `@deepseek-ai/dsh-app-boot` 导出的 `evaluatePluginCompatibility()` /
  `readProfileCompatibility()`，跑真实 profile 的 `compatibility.json`。

## 3. 原始证据

| 文件 | 内容 |
|---|---|
| `describe-live.json` | 现役 **3098** 宿主 `/api/settings/describe` 实抓（只读；POST `/api/settings/describe`，body 形如 `{"type":"client-request","rpcId":"1","method":"settings/describe","payload":{"args":{}}}`，cookie 由 `GET /?token=<见 $A/logs/web-3098.log>` 换取） |
| `out/live-3098-namespaces.txt` | 上述实抓的 25 个命名空间 + value 简表 |
| `out/evidence-boot-and-drill.txt` | 3098 boot 时间线、`web-3098.log` disabling 计数、被修复文件 mtime、另一执行档 3099 drill 的只读摘录 |
| `out/a-parity.txt` / `out/b-runtime.txt` / `out/c-serviceability.txt` / `out/d-restart-compatibility.txt` | 四份脚本原始输出 |
| `before/*.mjs` | 改前原件副本（sha256 见上） |

## 4. 纪律

本目录只读 `$A/**` 与 `$B/**`；**没有**起服务、**没有**重启任何实例（3080/3097/3098/3099 全部未碰）、
**没有**改任何插件源码或 `cordis.patch.yml`。`cookie.txt` / `c2.txt` 是本目录内的临时 cookie 文件，可删。
