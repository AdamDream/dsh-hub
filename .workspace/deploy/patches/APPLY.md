# dsh-host-apiproxy sessions.prompt 门禁放行补丁 — 应用说明

> 审计单元 U-G-2（`.workspace/btw-upgrade-impl-audit.md` §3.1 / U-G-2）。
> 语义：`sessions.prompt` 在模型图片门禁（`MODEL_DOES_NOT_SUPPORT_IMAGES`）之前先跑一次插件变换瀑布
> `session/prompt-image-transform`；变换结果非 undefined 时替换有效 content，门禁仅对变换后仍含图的消息生效。
> **无插件监听时行为与现状完全一致**（fallback 返回 undefined → effective === content → nowHasImage === hasImage）。

## 目标文件（唯一）

```
~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
```

（`package.json` `main` 指向此文件；profiles 根符号链接 farm 亦解析到此文件。改动区域：`sessions.prompt`
handler 的 `admit()`，部署位原 :2750-2782，补丁 hunk 头 `@@ -2749,7 +2749,13 @@`。）

## 备份（应用前必做，任一方式）

```bash
mkdir -p ~/.dsh/backups
cp ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js \
   ~/.dsh/backups/dsh-host-apiproxy.index.js.$(date +%Y%m%d%H%M%S).bak
```

## 应用（方式 A：patch，推荐）

```bash
cd ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy
patch -p1 < ~/dsh/.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch
# 期望输出：patching file lib/index.js
```

## 应用（方式 B：整文件替换）

```bash
cp ~/dsh/.workspace/deploy/patches/dsh-host-apiproxy.lib.index.js \
   ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
```

## 应用后验证

```bash
# 1) 补丁内容已生效
grep -n 'session/prompt-image-transform' ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
grep -n 'nowHasImage' ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
# 2) 与交付副本字节一致（方式 A 应输出一致）
diff ~/dsh/.workspace/deploy/patches/dsh-host-apiproxy.lib.index.js \
     ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js
# 3) 语法校验
cd ~/.dsh/profiles/web/node_modules/@deepseek-ai/dsh-host-apiproxy && node --check lib/index.js
# 4) 回滚（如需）：cp ~/.dsh/backups/dsh-host-apiproxy.index.js.<ts>.bak 原路径
```

## 行为验收（部署后 GUI）

1. 无 btw 监听（或 btw 未加载）时：含图 + 文本模型 → 仍 `MODEL_DOES_NOT_SUPPORT_IMAGES`；含图 + 图片模型 → 放行（回归=现状）。
2. btw 监听后：主会话含图 prompt → 消息变纯文本（R1-9 模板）进模型 → 任何模型放行（验收 6.4.a/d）。
3. 变换抛错 → `prompt` 返回 `agent-busy` + details.reason，消息未进会话（验收 6.4.c 主会话侧）。
