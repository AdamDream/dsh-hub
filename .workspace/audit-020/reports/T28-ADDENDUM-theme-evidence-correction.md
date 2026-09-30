# T28-ADDENDUM — wallpaper / ui-theme 证据校正与 token 级细查

- 性质：**T27 轨道代跑的 T28 证据校正**（协调者插播指派）；本档**不修改** `T28-wallpaper-theme-compat.md`，仅补正与细化（避免与 T28 报告存在并发写入冲突）
- 审计时刻：2026-09-29（全部数字为本轮实跑取得）
- 依据标注：全文严格区分 **【哈希全等推定】**（`lib/` 逐字节 sha256 相同 ⇒ 推定为未变）与 **【源码实读】**（0.2.0 `lib/` 源码逐行读取/结构化解析 ⇒ 确认）
- 未触碰：未写 `~/.dsh/**`、`~/.dsh-017/**`、未改产品代码；未启动监听端口；未发起模型请求
- 产物目录：`.workspace/iso-020/t28/`（`dp-017.css` / `dp-020.css` / `token-delta.json`）

## 对照树与口径（先固定，避免再次混口径）

| 记号 | 路径 | 版本 |
|---|---|---|
| `[A-017]` | `/home/CNS2026495165/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai` | `0.1.7-rc.2` |
| `[B-020]` | `/home/CNS2026495165/dsh/.workspace/iso-020/npm-global/node_modules/@deepseek-ai` | `0.2.0-rc.1` |

四个受查包在两侧的版本已逐一确认：`dsh-client-ui-theme` / `dsh-host-frontend-static` / `dsh-host-webserver` / `dsh-fs-local` 均为 `0.1.7-rc.2 → 0.2.0-rc.1`。

---

## 1. 结论摘要

| # | 结论 | 依据类型 | 判定 |
|---|---|---|---|
| A1 | 协调者插播的**方法论**（"判定官方包是否变化必须按 `lib/` 口径"）**正确且已复核成立**：本机大量包的"差异"确实只是 `package.json` 里的版本号字符串 | 【源码实读】 | ✅ 采纳 |
| A2 | **协调者给出的三个包 churn 数字混用了"整树"口径，与 `lib/` 口径结论矛盾，应以其 `lib/` 结论为准**（详见 §2） | 【源码实读】 | ⚠️ **需更正** |
| A3 | **`dsh-client-ui-theme` 的真实改动只有 1 个文件**：`lib/client.js` 内联的 `design-platform.css` 字符串（16 个 `lib/` 文件中 1 改，churn **6.3%**，非 23.8%）。`lib/index.js`、`lib/types/**`、`lib/styles/**`、`lib/client.js` 以外的全部 `lib/` 文件**逐字节相同** | 【源码实读】+【哈希全等推定】 | ✅ 已实测 |
| A4 | **`dsh-host-frontend-static` / `dsh-host-webserver` / `dsh-fs-local` 三者 `lib/` 均为零改动**（0 / 0 / 0），其"1 处差异"全部是 `package.json` 版本号字符串 | 【哈希全等推定】 | ⚠️ **更正协调者"按 lib 口径复核是否真代码"的悬念：均非真代码** |
| A5 | **token 级改动 = 纯新增：新增 10 条（5 个 token 名 × 明/暗两套），移除 0 条，改值 0 条**。⇒ **没有任何 CSS 变量名/token 名被改名或移除**，本机主题定制**不存在"键失效"** | 【源码实读】（结构化解析 CSS 声明块） | ✅ 已实测 |
| A6 | 官方 release note「改善深色主题下的开关色彩区分度」**精确对应新增 token `--dsw-alias-switch-thumb`**（`body` 明色 `--dsw-static-neutral-bluish-00`＝`#fff`；`body[data-ds-dark-theme]` 暗色 `--dsw-static-neutral-bluish-400`＝`#adb2b8`） | 【源码实读】 | ✅ 已定位 |
| A7 | **`ui-theme` 是官方包提供的 settings 命名空间，不是本机定制**；本机 `ui-theme:` 段**仅 1 个键** `preference: light`，在 0.2.0 **完全有效**，且无任何键失效 | 【源码实读】 | ✅ 已实测 |
| A8 | **本机 `wallpaper:` 段与 `ui-theme` 无关**——它由本机 fork 插件 `@local/dsh-wallpaper` 的 settings 命名空间提供（另一条独立路径）。该插件 `peerDependencies` 声明 `<0.2.0`：`0.2.0-rc.1` **因 includePrerelease 语义仍可通过**，但 **0.2.0 稳定版一发布即 deny 整插件行** | 【源码实读】 | ⚠️ 待改造（与 T28 MU1 一致） |
| A9 | 壁纸插件引用的 `--dsw-alias-fill-tertiary` 在 0.1.7 与 0.2.0 主题中**均无定义**（官方 `dsh-client-ui-attachment` 也引用它）——属**既存悬空引用**，带 fallback，**非 0.2.0 回归** | 【源码实读】 | ✅ 非阻塞 |

---

## 2. 对协调者插播第 2 条的更正（最重要）

协调者原文："`dsh-client-ui-theme` **21 个文件中 5 个改动（churn 23.8%）** ⇒ 需重点细查；`dsh-host-frontend-static` 7 文件中 1 改、`dsh-host-webserver` 8 文件中 1 改、`dsh-fs-local` 9 文件中 1 改。"

**实测：这三个数字是"整树"口径，不是 `lib/` 口径**（复现命令见 §6）。两口径并列如下：

| 包 | 整树文件 | 整树差异 | **`lib/` 文件** | **`lib/` 差异** | `lib/` churn |
|---|---|---|---|---|---|
| `dsh-client-ui-theme` | 21 | 5 | **16** | **1** | **6.3%** |
| `dsh-host-frontend-static` | 7 | 1 | **2** | **0** | **0.0%** |
| `dsh-host-webserver` | 8 | 1 | **3** | **0** | **0.0%** |
| `dsh-fs-local` | 9 | 1 | **4** | **0** | **0.0%** |

`dsh-client-ui-theme` 整树 5 处差异的**逐项分解**（`diff -rq` 原始输出）：

```
lib/client.js        不同   ← 唯一的真代码改动
package.json         不同   ← 版本号字符串
README.i18n.yaml     不同   ← 文档
README.md            不同   ← 文档
README.zh.md         不同   ← 文档
```

⇒ 协调者用"整树 5 改"来下达"重点细查"指令，恰好**违反了其自己第 1 条 `lib/` 口径**；按 `lib/` 口径，主题包只有 **1** 处真改动，另三个包**一处都没有**。

**同时确认既有 churn 表数据是对的**：`churn-lib-017-020.txt` 中 `dsh-client-ui-theme 16 15 0 0 1 6.3%` 与本轮实测**完全一致**；该表的 16/1 与我独立复算相同，故表数据可信（另三包不在该表"CHANGED"列表中，亦与"`lib/` 零改动"一致）。

---

## 3. `dsh-client-ui-theme` 真改动细查（契约核验集中处）

### 3.1 改动定位

```
$ diff -rq [A-017]/dsh-client-ui-theme/lib [B-020]/dsh-client-ui-theme/lib
文件 …/lib/client.js 和 …/lib/client.js 不同       ← 唯一

$ sha256sum 两侧 lib/client.js
0.1.7 : de57d7864e2f3cbd…     100 536 B
0.2.0 : ee332fb582767f98…     101 519 B
$ diff -u … | wc -l
11                            （= 1 个 +行、1 个 −行、7 行上下文、1 行 @@、2 行 ---/+++）
```

`lib/` 内**逐字节相同**的文件（【哈希全等推定】）包括：`lib/index.js`（宿主半，`aea6a97a3ca9dccf` 两侧相同）、`lib/types/theme-settings.d.ts`（`f597f7219797ace5` 两侧相同）、`lib/types/client/*.d.ts`、`lib/styles/brand-font.css`、三个 `montserrat-*.woff2` 字体、`lib/types/boot-theme.d.ts` 等。

### 3.2 改动内容 = 一条内联 CSS 字符串

`lib/client.js` 的 diff 只有一处：`var design_platform_css_default = "…"` 这一整行字符串被替换（源文件路径注释显示其来源为 `packages/client/ui-theme/src/styles/design-platform.css.mjs`）。

```
内联 CSS 串长度：0.1.7 = 17 732 B    0.2.0 = 18 715 B（+983 B）
```

### 3.3 token 级精确集合对比（【源码实读】，非 diff 目测）

用解析器把两侧 CSS 按 `选择器块 || 自定义属性名 → 值` 建表后求差（脚本见 §6），结果：

**新增 10 条（5 个 token × 明/暗两套）**

| token | `body`（明色） | `body[data-ds-dark-theme]`（暗色） |
|---|---|---|
| `--dsw-alias-switch-thumb` | `var(--dsw-static-neutral-bluish-00)` = `#fff` | `var(--dsw-static-neutral-bluish-400)` = `#adb2b8` |
| `--dsw-alias-label-shimmer` | `color-mix(in srgb, var(--dsw-static-neutral-1000) 30%, transparent)` | `color-mix(in srgb, var(--dsw-static-neutral-00) 45%, transparent)` |
| `--dsw-alias-bg-document-selection` | `color-mix(in srgb, var(--dsw-static-blue-500) 40%, transparent)` | 同左（明暗一致） |
| `--dsw-alias-label-deep-diving` | `color-mix(in srgb, var(--dsw-static-deepseek-500) 70%, var(--dsw-static-blue-950))` | `color-mix(in srgb, var(--dsw-static-deepseek-450) 55%, var(--dsw-static-neutral-bluish-400))` |
| `--dsw-alias-label-deep-diving-shimmer` | `color-mix(in srgb, var(--dsw-static-deepseek-500) 30%, var(--dsw-static-blue-950))` | `color-mix(in srgb, var(--dsw-static-blue-300) 65%, var(--dsw-static-deepseek-400))` |

**移除 0 条；既有 token 改值 0 条。**

> 说明：T28 报告 §5.4 把 `--dsw-alias-label-shimmer` 归入"新增/调整"，本档按"选择器块内是否原本存在"判定，确认它是**纯新增**（0.1.7 中明暗两处均不存在），不存在"调整"项。这是本档与 T28 表述的唯一差异，属措辞精度差异，不影响结论。

### 3.4 与 release note 的对应

官方 release note「**改善深色主题下的开关色彩区分度**」（by @Yifffan）→ 精确对应 **`--dsw-alias-switch-thumb`** 的引入：0.1.7 及以前**没有** switch 滑块专用 token，组件只能用通用前景色（暗色下常取白），在暗色轨道上区分度不足；0.2.0 新增该 token 并在暗色下改用 `--dsw-static-neutral-bluish-400`（`#adb2b8`，中灰蓝），与暗色轨道形成稳定的明度差。

其余 4 个新增 token 对应 release note 的另两项：
- `--dsw-alias-bg-document-selection` → 「Office 与 PDF 预览**文字选区**清晰度」（此前选区无专用 token）；
- `--dsw-alias-label-deep-diving` / `-shimmer` / `--dsw-alias-label-shimmer` → 思考/深度推理文案的**流式 shimmer 动画**表现形式。

### 3.5 对本机 `ui-theme` 定制的影响

**无影响。** 理由（【源码实读】逐条）：

1. 本轮 token 改动**只有新增**，没有任何改名或移除 ⇒ 本机不引用新 token，也不存在"引用了被删 token"的情形。
2. 本机 `ui-theme:` 段只有 `preference` 一个键，见 §4，其契约由官方宿主半提供且**逐字节未变**。
3. 本机当前 `preference: light` ⇒ **暗色专属的 `--dsw-alias-switch-thumb`（dark 值）在本机当前外观下根本不会被取用**，该 release note 项对本机表现为"无感"（除非日后切到 dark/system 且系统为暗色）。

---

## 4. `ui-theme` 是官方命名空间还是本机定制？（明确回答）

**答：`ui-theme` 是官方包 `@deepseek-ai/dsh-client-ui-theme` 提供的 settings 命名空间；本机没有任何定制代码，只有配置值。**

### 4.1 命名空间登记在官方宿主半（【源码实读】）

`[B-020]/dsh-client-ui-theme/lib/index.js`（全文 97 行，两侧逐字节相同）：

```js
// lib/index.js:10-11
/** Settings namespace owned by the theme plugin. */
const THEME_SETTINGS_NAMESPACE = "ui-theme";
// lib/index.js:12-13
const THEME_PREFERENCE_FIELD = "preference";
// lib/index.js:14-15
const FONT_SIZE_FIELD = "fontSize";
// lib/index.js:80-83
const Config = z.object({
	preference: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE).volatile(),
	fontSize: z.number().step(1).min(12).max(17).default(14).volatile()
});
// lib/index.js:88-91  apply() 中：ctx.inject(["settings"], child => … child.settings.configure({auto:false}, ctx.fiber))
// lib/index.js:92-94  同时登记 webserver/index-inject（首屏 boot 主题注入）
```

`lib/client.js:992` 同样定义 `const THEME_SETTINGS_NAMESPACE = "ui-theme"`（`:994` = `THEME_PREFERENCE_FIELD`，`:1581` 用它取 `ctx.configForms.get(THEME_SETTINGS_NAMESPACE)` 构造 `ThemeRuntime`）。以上行号在 0.1.7 与 0.2.0 两侧**完全一致**（【哈希全等推定】：`lib/index.js` 两侧 sha256 同为 `aea6a97a3ca9dccf…`）。

### 4.2 0.2.0 默认 bundle 内含该 entry（【源码实读】）

`[B-020]/dsh-web-app/cordis.patch.yml:236-237`：

```yaml
    - id: ui-theme
      name: '@deepseek-ai/dsh-client-ui-theme'
```

⇒ 0.2.0 官方 Web bundle 默认即组合 `ui-theme`，无需本机补 entry。

### 4.3 本机 `ui-theme:` 段的全部键

`~/.dsh/settings.yaml:249-250`（只读读取）：

```yaml
ui-theme:
  preference: light
```

- 键集合 = `{preference}` ⊂ `{preference, fontSize}`（`ThemeSettings` 接口两字段）⇒ **无键失效**。
- 合法取值 `THEME_PREFERENCES = ["light","dark","system"]`，`light` 合法。
- `DEFAULT_PREFERENCE = "system"`；本机显式 `light` 属**有效覆盖**。
- 类型契约 `lib/types/theme-settings.d.ts` 在 0.1.7↔0.2.0 **逐字节相同**（【哈希全等推定】+ 实读内容一致）：`THEME_SETTINGS_NAMESPACE="ui-theme"`、`THEME_PREFERENCE_FIELD="preference"`、`FONT_SIZE_FIELD="fontSize"`、`FONT_SIZE_MIN=12`、`FONT_SIZE_MAX=17`、`DEFAULT_FONT_SIZE=14`。

### 4.4 结论：`ui-theme` 段里"可能失效的键"= 空集

**没有任何键失效。** 唯一需要注意的不是"键失效"，而是**落位机制**变化（属 T28 MU3 范畴，本档不改判）：

- 0.1.1 时代 `ui-theme` 段由 `settingsNamespace("ui-theme")` + `ctx.settings.register` 承载；
- 0.2.0 改为 **entry id 派生**（`id: ui-theme` 的 entry 拥有该 Config），并由 `dsh-settings` 的 `importLegacyDocument()` 做 **rename-first 一次性**导入（T28 报告 §1.5 已述）。
- ⇒ 风险不在键名，而在"**先完成 profile patch、再投放 settings.yaml**"的时序（T28 MU3 已列为闸门）。

---

## 5. 与本机 `wallpaper:` 段的分野（避免把两者混为一谈）

| 维度 | `ui-theme` 段 | `wallpaper` 段 |
|---|---|---|
| 提供者 | **官方包** `@deepseek-ai/dsh-client-ui-theme` | **本机 fork 插件** `@local/dsh-wallpaper` v0.5.0 |
| 命名空间登记点 | `dsh-client-ui-theme/lib/index.js:11`（`settingsNamespace` 语义） | `@local/dsh-wallpaper/lib/index.js:30`（`const WALLPAPER_NAMESPACE = settingsNamespace("wallpaper")`） |
| 0.2.0 默认 bundle | ✅ 含（`dsh-web-app/cordis.patch.yml:236-237`） | ❌ 不含（实测 `grep wallpaper` 于该 bundle **零命中**）⇒ 本机靠 `~/.dsh/profiles/web/cordis.patch.yml:28-30` 的 `insert` 承载 |
| 本机段内键 | `preference: light`（1 键） | `global: {source, darkMask, opacity, blur}`（4 键） |
| 0.2.0 状态 | **零改造**，键全部有效 | **需改造**：`package.json` peer 上界 `<0.2.0`（4 条 + 相关注入元数据） |

`@local/dsh-wallpaper` 的 peer 声明（【源码实读】，`package.json`）：

```
"@deepseek-ai/dsh-settings":            ">=0.1.1-rc.2 <0.2.0"
"@deepseek-ai/dsh-client-runtime":      ">=0.1.1-rc.2 <0.2.0"
"@deepseek-ai/dsh-client-locale":       ">=0.1.1-rc.2 <0.2.0"
"@deepseek-ai/dsh-client-ui-theme":     ">=0.1.1-rc.2 <0.2.0"
"@deepseek-ai/dsh-client-ui-settings":  ">=0.1.1-rc.2 <0.2.0"
```

- `0.2.0-rc.1` 是 **prerelease**；T28 报告已查明 `dsh-app-boot` 仅在 `includePrerelease` 的 `semver.satisfies` **失败**时才 deny，故 rc 阶段**侥幸通过**；
- 但 **`>=0.1.1-rc.2 <0.2.0` 对稳定版 `0.2.0` 明确不满足** ⇒ 0.2.0 稳定版发布即 **deny 整 entry**（整插件行 disabled）。这与 T28 MU1 的"上界改 `<0.3.0`"改造项一致，本档不改判。

### 5.1 一处既存悬空引用（非 0.2.0 回归，非阻塞）

壁纸插件消费的 CSS 变量（全量，【源码实读】`lib/client.js` / `lib/index.js`）：`--dsw-alias-bg-base`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-button-elevated-fill`、`--dsw-alias-fill-tertiary`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-label-tertiary`、`--dsw-alias-state-error-primary`、`--dsw-specific-sidebar-fill`。

其中 **`--dsw-alias-fill-tertiary` 在 0.1.7 与 0.2.0 的 `design-platform.css` 中均无定义**：

```
dp-017.css 中 --dsw-alias-fill-* : 0 处
dp-020.css 中 --dsw-alias-fill-* : 0 处
0.1.7 树内 "--dsw-alias-fill-tertiary:" 定义：0 处
```

它同时被**官方** `dsh-client-ui-attachment/lib/client.js` 引用（`--dsw-alias-fill-tertiary,#00000014`）。壁纸侧该处使用带 fallback：

```js
// @local/dsh-wallpaper/lib/client.js:362
background: "var(--dsw-alias-fill-tertiary, rgba(127,127,127,0.15))"
```

⇒ 两侧都靠 fallback 生效，**属既存状况、非 0.2.0 引入、非阻塞**；仅提示该 token 名在官方侧疑似为历史遗留（若日后官方补定义，壁纸预览底色会随之变化，需回归一次）。

其余 9 个 token 在 0.2.0 中**均存在且值未变**（【源码实读】+ §3.3 的"移除 0 / 改值 0"）。

---

## 6. 本档所用可复现命令

```bash
A=/home/CNS2026495165/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
B=/home/CNS2026495165/dsh/.workspace/iso-020/npm-global/node_modules/@deepseek-ai

# (1) 版本确认
for p in dsh-client-ui-theme dsh-host-frontend-static dsh-host-webserver dsh-fs-local; do
  node -e "console.log('$p', require('$A/$p/package.json').version, '->', require('$B/$p/package.json').version)"
done

# (2) 两口径 churn 并列（暴露协调者口径混淆）
for p in dsh-client-ui-theme dsh-host-frontend-static dsh-host-webserver dsh-fs-local; do
  printf "%-28s 整树 %s/%s   lib %s/%s\n" "$p" \
    "$(diff -rq $A/$p $B/$p | wc -l)" "$(find $A/$p -type f | wc -l)" \
    "$(diff -rq $A/$p/lib $B/$p/lib | wc -l)" "$(find $A/$p/lib -type f | wc -l)"
done
# 实测输出：
# dsh-client-ui-theme          整树 5/21   lib 1/16
# dsh-host-frontend-static     整树 1/7    lib 0/2
# dsh-host-webserver           整树 1/8    lib 0/3
# dsh-fs-local                 整树 1/9    lib 0/4

# (3) 主题包 diff 明细（只有 client.js 是代码）
diff -rq "$A/dsh-client-ui-theme" "$B/dsh-client-ui-theme"
diff -u  "$A/dsh-client-ui-theme/lib/client.js" "$B/dsh-client-ui-theme/lib/client.js" | wc -l

# (4) token 级集合对比（脚本产物落在 .workspace/iso-020/t28/token-delta.json）
node -e '
const fs=require("fs");
const A=process.argv[1], B=process.argv[2];
function extract(p){const s=fs.readFileSync(p,"utf8");
  const m=/var design_platform_css_default = (".*?");\n/s.exec(s); return JSON.parse(m[1]);}
function parse(css){const out=new Map(); const re=/([^{}]+)\{([^{}]*)\}/g; let m;
  while((m=re.exec(css))){const sel=m[1].trim(); const tr=/(--[a-z0-9-]+)\s*:\s*([^;]+)/gi; let t;
    while((t=tr.exec(m[2]))) out.set(sel+" || "+t[1], t[2].trim());}
  return out;}
const a=parse(extract(A+"/dsh-client-ui-theme/lib/client.js"));
const b=parse(extract(B+"/dsh-client-ui-theme/lib/client.js"));
const keys=new Set([...a.keys(),...b.keys()]);
const added=[],removed=[],changed=[];
for(const k of [...keys].sort()){const x=a.get(k),y=b.get(k);
  if(x===undefined)added.push([k,y]); else if(y===undefined)removed.push([k,x]); else if(x!==y)changed.push([k,x,y]);}
console.log("added",added.length,"removed",removed.length,"changed",changed.length);
for(const [k,v] of added) console.log(" +",k,"=",v);
' "$A" "$B"

# (5) ui-theme 命名空间与契约
grep -n "THEME_SETTINGS_NAMESPACE\|THEME_PREFERENCE_FIELD" "$B/dsh-client-ui-theme/lib/index.js"
diff -q "$A/dsh-client-ui-theme/lib/types/theme-settings.d.ts" "$B/dsh-client-ui-theme/lib/types/theme-settings.d.ts" && echo "d.ts 逐字节相同"
grep -n "ui-theme" "$B/dsh-web-app/cordis.patch.yml"
grep -n "wallpaper" "$B/dsh-web-app/cordis.patch.yml"     # 预期零命中

# (6) 悬空 token 复核
grep -rl -- "--dsw-alias-fill-tertiary:" "$A" "$B"        # 预期零命中
grep -c -- "--dsw-alias-fill-tertiary" .workspace/iso-020/t28/dp-0{17,20}.css
```

---

## 7. 未验证项

1. **未做真实浏览器渲染验证**（未启动任何监听端口的服务）。§3.5 关于"`--dsw-alias-switch-thumb` 暗色值在本机 `preference: light` 下不生效"是**基于源码语义的判定**，非渲染实测。
2. **未验证 0.2.0 稳定版发布后的 peer deny 实际行为**（稳定版尚不存在，基线明确"不存在稳定 0.2.0"）；§5 的判定基于 T28 已查明的 `evaluatePluginCompatibility` 语义。
3. **未验证 `importLegacyDocument()` 对 `ui-theme` / `wallpaper` 两段的实际搬运结果**（需真实 boot 0.2.0，属 T25/T20 轨道范围）。
4. **未覆盖 0.1.1→0.2.0 直跳路径**：本档对照树为 `0.1.7-rc.2 → 0.2.0-rc.1`（协调者指定）。0.1.1（现役）与 0.1.7 之间的主题差异本档未测（T28 报告 §5 已给出 0.1.1→0.2.0 的命名空间/注入机制变化）。
5. **未审计 `lib/` 之外的其余平台专属资源**（如 `dsh-host-frontend-static` 的静态产物目录构成）；本档按要求只对 `lib/` 口径与主题契约负责。
6. 本档**未修改** `T28-wallpaper-theme-compat.md`；若协调者要把 §2 更正与 §3.3 的"纯新增"措辞精度合并进 T28，请由 T28 唯一写入者执行，避免并发写冲突。
