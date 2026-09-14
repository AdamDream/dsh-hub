# dsh-taste 中文显示 + 置信度两位小数 — 实现报告

> 依据：`zh-display-design.md`（含修订记录，ISSUE-A~H 全部吸收）。
> 基线 162/162 → **204/204 pass**（+42 新测试，零回归）。
> 验证：`node --test "test/*.test.js"` 绿；`node --check lib/client.js` 通过；
> import 冒烟 `name=taste`、`inject=["agents","commands","systemPrompt","connection"]` 不变。

## 逐文件改动

| 文件 | 改动 |
|---|---|
| `lib/storage.js` | `DISPLAY_FILENAME`、`loadDisplayMap`（缺失/非法 JSON/非对象/非字符串值全容错）、`writeDisplayMap`/`mergeDisplayMap`/`pruneDisplayMap`（display 专用锁 `<scopeDir>/display.zh.json.lock`，进锁前 `mkdir(recursive,0o700)`；prune 在锁内自解 liveKeys 杜绝 TOCTOU）、`scopeStatementKeys`；`formatTasteConfidence`「一位或两位」格式化器（round 两位后第二位为 0 则 toFixed(1)：`0.9→"0.9"`、`1→"1.0"`、`0.88→"0.88"`、`0.95→"0.95"`），`renderTasteFile` 改用之——存量注入快照字节不变；parseTasteFile JSDoc 示例统一 0.88 |
| `lib/learner-tools.js` | `write_taste_file`/`edit_taste_file` 增可选 `display` 参数（`{type:"object", additionalProperties:true}`，dsh-tools 实证：`additionalProperties` 必须显式 boolean、true 时 value 不校验 → execute 层 `sanitizeDisplay` 净化：非字符串/空白值丢弃并 log、键必须 normalize 后对应本次写入/编辑产生的 statement，否则丢弃）；write 在 taste 锁 RMW **之后**串行 merge display（不嵌套）；edit 捕获前后 statement 键集，集合有差异 → `pruneDisplayMap`（旧译文不挂新文本），再按 display 覆盖（置信度-only 编辑保留旧译文）；新增 `write_display_file`（只写边车，键过滤 against scope liveKeys，绝不碰 taste.md）+ `createTranslateTools`（read_taste_file + write_display_file）；`UNPARSABLE_HINT` 与 description 示例 0.9→0.88 |
| `lib/learner.js` | `LEARNER_PROMPT` 示例 `Confidence: 0.88` + 追加 display 指令段（content 保持英文、键须逐字匹配、可省略、勿传 null）；`runLearner` 新增 `promptText=LEARNER_PROMPT`、`toolsFactory=createTasteTools` 参数（带校验），默认零行为变化 |
| `lib/translate.js`（新） | `TRANSLATE_PROMPT`、`parseTranslateArg`（空→both/非法→error）、`translateEntryLine`/`buildTranslateInput`（逐字原文+scope+relPath+置信度）、`collectUntranslatedEntries`（注入 IO：按 displayMap 已有中文键跳过，键去重，文件序） |
| `lib/commands.js` | `translate` 子命令（闸门顺序同 backfill：参数→learningEnabled→熔断→`translateProgress.active` 重入门→enqueueTranslate；空清单→「已全部翻译，覆盖率 100%」；超预算余量提示重跑）+ dispatch + `USAGE`/hint；`list` `toFixed(2)`；`remember` 文案 `1.00`；`status` 新增 `translation: 已译/总数`（writable scopes 合计，scopeStatementKeys+loadDisplayMap）；`forget` 删除后对受影响 scope `pruneDisplayMap`（一致性补充） |
| `lib/index.js` | `translateProgress` 单例；`enqueueTranslate`（scope 解析→未翻译收集→`observer.maxInputChars` 预算内增量截断（至少保 1 条）→单 job `queue.push`，job=`{agent,kind:"translate",translateEntries,cwd,onSettled}`；onSettled try/finally 双路径清 active，失败经 executeJob rethrow 喂共享熔断；push 被拒时自行清门禁）；`runTasteJob` 分派：translate job 走 `buildTranslateInput`+`TRANSLATE_PROMPT`+`createTranslateTools`，学习 job 原样；commands deps 增 `enqueueTranslate`/`translateProgress`/storageFns 三函数，bridge deps 增 `loadDisplayMap`/`normalizePreferenceKey` |
| `lib/bridge.js` | `scopeFiles` 每 scope 读一次边车，entry 附加 `display`（中文或显式 null）；`getTree` 各 scope 增 `coverage:{translated,total}`（去重键口径）；commandCode 分支 entry 显式 `display:null` + `coverage 0/total`；安全包络不变（只读白名单，无路径透传） |
| `lib/client.js` | `TasteEntry`：中文优先英文回退、`ts_untranslated` 未翻译标记（`scopeName==="commandCode"` 不打标）、置信度文字标签 `value.toFixed(2)`（旧 0.9 渲染层补零 0.90，不回写）、进度条仍 `pct%`；`scopeName` prop 经 ScopeBody→CategoryGroup→FileRow 传递；`TasteScopeBody` 顶部覆盖率行 `t("coverage",…)`；zh/en 字典增 `untranslated`/`coverage`；CSS 增 `.ts_untranslated`/`.ts_coverage` |
| `README.md` | 工作原理（英文本体+中文边车+锁序）、存储（边车格式/两位小数兼容）、命令表（translate 行、status/list/forget 更新）、Web GUI（中文显示/覆盖率/两位置信度）、测试计数 204 |

## 测试（162 → 204，+42）

- storage.test.js：边车 API 全套（容错读/写覆盖合并/裁剪/键集/并发 merge×prune 竞态/并发双文件共享边车/快照不受边车影响）+ 两位渲染与解析兼容。
- learner-tools.test.js：write display 匹配/孤儿丢弃/非字符串丢弃/无 display 不建文件；edit 改述裁剪、置信度-only 保留、显式覆盖、错误路径零副作用；write_display_file liveKeys 过滤、taste.md 字节不变、并发共享。
- learner.test.js：prompt 两位示例与 display 指令断言；runLearner promptText/toolsFactory 覆盖（translate 工具面）+ 默认零变化 + 非法参数拒绝。
- translate.test.js（新）：parseTranslateArg/translateEntryLine/buildTranslateInput/collectUntranslatedEntries 纯单元 + 集成（入队 job 的 TRANSLATE_PROMPT+工具面、幂等 100%、重入门禁与清除、scope 参数、三道闸门、无 cwd project 拒绝、status 覆盖率行）。
- bridge.test.js：display join/coverage/commandCode null（含坏边车容错）；既有 shape 断言同步。
- client.test.js：zh-display 渲染标记字符串门 + 既有全绿。
- 回归护栏：既有 `0.9→"0.9"`、`1→"1.0"`、loadTasteSnapshot 断言全部保留未改。

## 设计偏离

- 无实质偏离。仅两处文档口径的落地细化：① status 覆盖率与 bridge coverage 均按去重键口径统计（§4.5/§5 未指明，去重与边车 1:1 身份一致）；② forget 的 prune 按 §2.3 补充实现（每受影响 scope 一次、taste 锁全部结束后串行、失败 warn 不阻断）。

## 明确不做（依 §9）

GUI 触发翻译按钮、自动翻译 hook、taste.md/注入快照中文化（`loadTasteSnapshot` 绝不读边车）、`/taste list` 中文译文、零新依赖、零官方包改动。
