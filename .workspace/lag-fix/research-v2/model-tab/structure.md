# 模型标签：渲染结构（静态源码 + 已有数据）

- 工作区：`.workspace/lag-fix/research-v2/model-tab/`（本档独占）
- **本文件不含任何新采集**。来源：`/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`（2812 行，符号链接 → `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`，mtime 2026-09-12）+ 本档**已落盘**的数据（`raw/phase-main.json` 等，采集于协调者冻结令之前）
- 机器可读件：`raw/structure-facts.json`（由 `node lib/structure.mjs` 生成，纯源码读取）
- 复算：`node lib/structure.mjs`（只读源码）

> **协调者冻结令（立即生效）**：本机 7 条线各开浏览器、独占窗口 0/5、持锁期间仍有 18–31 个外来 Playwright 进程 ⇒ **已停止一切新浏览器/新采集窗口**（我这侧进程已确认清零）。本文件只给**结构结论**；"固有 vs 放大"的受控实验设计见 `experiment-design.md`。绝对 ms/fps 数字一律只作**内部比值**使用，不得当基线。

---

## 1. 一句话结构结论

**模型标签是一棵「无 memo、无虚拟化、无 context 隔离」的普通 React 子树，但它在 session 事件流下每一次 commit 都不渲染——因为它的数据源（`ModelsSettingsStore`）根本不订阅 session 事件。** 于是：

- **每次 store 通知必重建的**：整棵已挂载子树（合成 fiber ≈ **45 个/次**：`Loaded`+`ModelsSection`+`SlotOutlet`+`SlotErrorBoundary`+`RootEntry`+`SettingsDocumentAction`+每个已挂载行组件），其中 `Loaded` 每次重建 **15–124 个树内 DOM 元素**（取决于展开状态，见 §3.3）。
- **每次 store 通知不重建的**：仅 3 处 `useMemo` 的缓存值（`ProviderEditor` 的 `root`/`node`/`protocols`，`1402/1403/1412`）——**行级 JSX 一律重建**。
- **本档已落盘数据里的实测**：模型面板子树每次 commit 渲染 **0 个 fiber**（12/12 窗口），面板 DOM mutation **0**，面板文本长度恒定 **144**。⇒ 上面那 15–124 个元素的"每次重渲染"路径**在测量期一次都没被触发**。

---

## 2. 组件清单与"谁创建 DOM"

由 `lib/structure.mjs` 逐组件花括号配平后统计（`raw/structure-facts.json`）：

| 组件 | 行范围 | jsx 标签数 | `jsx/jsxs` 调用 | `.map()` | `react.memo` | `useMemo` | `useState` | `useEffect` | 订阅 store |
|---|---|---|---|---|---|---|---|---|---|
| `DeepSeekModelsEditor` | 256–443 | 19 | 23 | **4** | 0 | 0 | 2 | 0 | 否（props.models） |
| `IconChevron` | 678–697 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 否 |
| `IconTrash` | 699–714 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 否 |
| `ModelListEditor` | 754–1051 | 29 | 36 | **8** | 0 | 0 | 6 | 0 | 否（props.models） |
| `CustomProviderCard` | 1092–1316 | 24 | 26 | 2 | 0 | 0 | 10 | 0 | 否 |
| `ProviderEditor` | 1393–1697 | 26 | 30 | 1 | 0 | **3** | 7 | **1** | 否 |
| `ModelsSection` | 1792–1802 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 否（仅转发注入） |
| **`Loaded`** | 1803–2108 | **31** | **39** | **3** | 0 | 0 | **8** | 0 | **是（1805）** |
| `OnboardingModal` | 2137–2170 | 3 | 4 | 0 | 0 | 0 | 0 | 2 | 否 |
| `DeepSeekOnboardingDialog` | 2205–2262 | 2 | 4 | 0 | 0 | 0 | 0 | 2 | 是（另一个 store：`hooks.models`） |
| `WelcomeNotice` | 2288–2335 | 4 | 6 | 1 | 0 | 0 | 0 | 2 | 是（`welcomeController.store`） |

### 全局事实（`client.js` 全文）

| 维度 | 值 | 证据 |
|---|---|---|
| `react.memo` | **0 处** | `grep -c "react.memo(" client.js` = 0 |
| `createContext` / `useContext` | **0 处** | 无 context 隔离，无法用 context 选择器阻断重渲染 |
| `useMemo` | **3 处**，全在 `ProviderEditor` | `1402`（`schema.rehydrate`）、`1403`（`schema.nodeAtPath`）、`1412`（`protocolChoices`） |
| `useCallback` | **1 处**，在 `WelcomeNoticeStore`（非渲染路径） | `2292` |
| 虚拟化标记（`virtual`/`overscan`/`IntersectionObserver`…） | **0 处** | 无任何窗口化/按需挂载 |
| 列表渲染方式 | 裸 `.map()`：`Loaded:1909`（provider 行）、`ModelListEditor:896`（模型行）、`DeepSeekModelsEditor:372`、`CustomProviderCard:1167` 区 | 全量、无 key 之外的优化（key 用 `row.entry.provider` / 数组下标隐含） |

---

## 3. 哪些部分每次 commit 重建

### 3.1 订阅与触发面（决定性结构事实）

| 环节 | 位置 | 结构含义 |
|---|---|---|
| 面板订阅 | **`client.js:1805`** `const state = injected.useSnapshot((snapshot) => snapshot);` | **恒等选择器 =「整快照订阅」**：store 一发通知就必然重渲染 |
| 订阅通路 | `dsh-client-ui-renderer/lib/client.js:154` `bindSnapshotSelector` → **`:92/:158`** `useSyncExternalStoreWithSelector`（`Object.is`） | 快照引用变即重渲染，无浅比较 |
| store 引擎 | `dsh-client-runtime/lib/client.js:5397` `createSnapshotStore`；`update` 在 **`:5418`**（`produce(...)` 后 `setState(..., true)`） | `produce` 产出新对象 ⇒ `Object.is` 必不等 ⇒ 即便"内容没变"也重渲染 |
| **store 写入口** | `client.js:538` `ModelsSettingsStore.load()` | **全 bundle 唯一的 store 写入点** |
| `load()` 调用时机 | ① `Loaded:1856`（仅 `status==="idle"`，即首次挂载）② **`2772`** `settings/document-updated` ③ **`2775`** `credentials/reference-updated` ④ **`2776`** `llm/adapters-updated` ⑤ **`2777`** `connection/reset`；`2779` `refreshIfLoaded` 仅对这些 `$on` 生效 | **session 事件不在其中任何一条** |

**⇒ 模型面板与 `session/event`、`session/projection` 在结构上无任何订阅关系。** 每次 commit 重建的那 15–124 个元素只可能在**配置/凭证真正变化**时出现。

### 3.2 已落盘数据对该结构推断的实测校验（非新采集）

| 结构推断 | 实测（`raw/phase-main.json`，12 × 60s，冻结令前采集） | 一致？ |
|---|---|---|
| 面板不订阅 session 事件 | 面板子树 fiber 渲染 **0 / 12 窗**（含展开态复核 `raw/verify2.json`） | ✅ |
| 面板不因事件重渲染 ⇒ DOM 不变 | 面板 DOM mutation `text=0, child=0`（12 窗合计 0） | ✅ |
| 面板文本不随事件变化 | 面板文本长度恒为 **144**（通用标签恒为 314） | ✅ |
| 配置失效信号未发生 | `ws` 分类计数中 `settings/document-updated` **0 次**；`http.total=0`、`xhr.total=0`（12 窗） | ✅ |
| 器械能看见面板渲染（排除假 0） | `raw/fiber-diag.json`：设置面板与 dialog 同一 React root（`contentAncestorChain` = `SettingsPanel→SettingsRoot→RootEntry→SlotOutlet→AppFrame→…→HostRoot`），**面板挂载那次 commit 匹配 167 个 fiber** | ✅ |
| 若 store 真的通知，面板必整体重建 | 静态可证（1805 + 92/158 + 5418 三者合成）；**实测未能触发**（无失效信号）⇒ 该路径在本批窗成本 **0**，但机制上是"全量重建"而非"增量" | ⚠️ 机制确证、成本未测到 |

### 3.3 每次重建的元素数（静态精确计数）

`client.js` 的 JSX 是静态可见的，故可对每个状态精确计数（不含展开态 `details` 内的条件子块，见脚注）：

| 状态 | `Loaded` 树内元素/次渲染 | 合成 fiber/次 | 说明 |
|---|---|---|---|
| **折叠态**（无编辑卡，3 个 provider 行） | `h2 1 + p 3 + div 4 + ul 1 + li 1 + span 7 + button 4 + select 1 + option 1` ≈ **23** + 行内 **3 × 9–11 = 27–33** ⇒ **≈ 50–56** | **≈ 45** | `Loaded:1886-1997` 的 map 体 `1931-1995`；行内 = `li + div + span + 2~3 span + span + 1~2 button` |
| **展开 pi-ai provider 编辑卡**（已落盘复核用 opencode-go：**16 个模型行**） | 折叠态 **+ `ProviderEditor` 26**（`p 5 + div 7 + span 6 + input 3 + details 1 + summary 1 + select 1 + option 2`）**+ `ModelListEditor` 29/次调用**（`section/div 6/span 5/button 5/p 2/input 5/label 3/ul/li`）+ **每模型行 `div.modelEntry + div.modelRow + 2 input + button + svg + path + button + svg + path` = 10** ⇒ 16 行 = **160** ⇒ 合计 **≈ 265–270** | **≈ 75–85**（含 16 行各自的合成 fiber） | 静态计数与实测吻合：展开后对话框节点 **120 → 303**（+183）、`modelEntry 0→16`、`input 0→34`、`svg 11→43`（`raw/verify2.json`） |
| **自定义添加卡**（`CustomProviderCard`） | 折叠态尾部 `addBlock` 换成该卡：`24` 个 jsx 标签 | ≈ 45 | 实测对话框节点 146 |

> 脚注：`details`（`ProviderEditor:1656` 区内）与 `ModelListEditor` 的行内 `expanded` 分支（`953` 起）是**再一层的条件子块**；上表按"默认收起"计，若逐行展开"高级"字段则每行再 +`div.modelAdvanced + 2 label + 2 span + 2 input` ≈ +7 元素/行。
> 配置规模（只读 `~/.dsh/settings.yaml`）：`llm-pi-ai.providers` = `opencode-go`（**16 个 model**）、`adam`（**50 个 model**）；页面另有一行 `deepseek-official`，共 **3 个 provider 行**。⇒ **若 adam 卡被展开，模型行数将是 50 行 ≈ 500 个元素**——这是静态可预测的最大单次重建量级。

---

## 4. 结构结论（供裁决用，不含绝对性能数）

1. **模型标签没有任何"每次 commit 必做的行级工作"**：行级 map 只在对应编辑卡**展开**时执行（`Loaded:1984` 的 `open ? renderProviderEditor(...) : null`），折叠态一次也不执行。已落盘实测：折叠态 `modelEntry=0`。
2. **面板缺少一切常规防线**：`react.memo` 0、context 0、虚拟化 0、全量 `.map()`、恒等选择器订阅（`1805`）。⇒ 一旦 `ModelsSettingsStore.load()` 被频繁触发，成本是**整棵子树全量重建**（折叠态 ≈50–56 元素、展开 16 行 ≈265–270 元素、极端 50 行 ≈500 元素），而非增量。
3. **但该触发路径与 session churn 无关**：`load()` 只挂在 4 条配置/凭证/拓扑失效信号上（`2772–2777`），本批 12 窗内这些信号**一次都没发生**（`http/xhr = 0`、WS 分类无该类型）⇒ 面板在 churn 下**零渲染**。
4. **因此"模型标签固有渲染成本"这一命题在当前配置下没有可测载体**：折叠态不渲染行，展开态才渲染，而展开态也不因事件而渲染。**真正的"随手一碰就全量重建"风险点在 ①(`1805` 恒等订阅) 与 ③(`5418` 引用必变)，属"配置频繁变更"场景，不是"会话事件流"场景。**
5. **反过来说**：若要在架构上给模型标签"上保险"（不针对当前卡顿，而是防止配置热更新场景下的抖动），最小且有效的两处是 `1805` 的窄选择器与 `5418` 的快照引用复用；**行级 memo / 虚拟化是无效投入**（折叠态不渲染行；虚拟化还会改 DOM 结构，破坏 `aria-label` 里的行号 `${index+1}`（`906/917/926/937`）与删除后行号重排 `reindexOnRemove`（`771`）的语义）。

---

## 5. 与"模型标签最慢"的关系（用结构说话）

- 已落盘数据里，**模型标签与通用标签在"事件流关掉"条件下几乎无差别**（比值：fps 模型/通用 = **1.031**；脚本占比此条件下两者都 ≈0，比值无意义）。自然条件下脚本比为 **1.48**、fps 比为 **0.897**，但该组窗事件率比为 **1.77**（模型窗更忙）——即差值随工作量而非标签走。绝对值见 `audit.md`；**因并发负载不可当基线，此处只用比值**。
- 结构上，两者的差别只在**面板内 DOM 节点数**（模型 120 vs 通用 97，比 **1.24**）与**面板内订阅形态**；两者都**不**订阅 session 事件。
- ⇒ **"模型标签身份主导成本"在结构层与已落盘数据层都得不到支持**。原始 13.2 fps 观测与被观测窗的宿主并发负载/事件率同向（校准轮里同一标签在 load1=34 → 7.9 fps、load1=24 → 60.0 fps，比 **0.13**）。**裁决所需的正交实验见 `experiment-design.md`。**
