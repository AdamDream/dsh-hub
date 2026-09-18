# 为什么 btw 贴图不产生 `request-images/` 派生文件 —— 机制结案

日期：2026-09-18 ｜ 触发：用户指出"我就是根据这个才认为 btw 没看见"

## 结论（一句话）

**`request-images/` 里没有文件 ≠ 模型没看到图；它只说明"该图已符合该路由的请求预算、无需重编码"。
规律恰好相反：只有在请求版与存储版字节不同（需要重编码/降采样）时才落盘。**

## 源码证据链（三处，缺一不可）

1. **谁写**：`@deepseek-ai/dsh-attachment-local` 的请求图缓存
   `lib/index.js:653  function cachePath(root, hash) { return join(root, "request-images", hash.slice(0,2), hash); }`
2. **什么时候写**：同一文件 `:723`
   ```js
   if (cached === void 0 && version.data !== attachment.data) await writeCached(path, version.data);
   ```
   —— `version.data !== attachment.data` 是唯一的落盘条件。
3. **什么时候"相同"**：`createRequestImage`（`:632-639`）
   ```js
   let dimensions = requestImageDimensions(attachment.ref.width, attachment.ref.height, policy.maxPixels);
   if (dimensions.width === attachment.ref.width && dimensions.height === attachment.ref.height
       && attachment.data.byteLength <= policy.maxBytes)
     return { data: attachment.data, mediaType: attachment.ref.mediaType, width, height };   // ← 原样返回
   ```
4. **谁触发整条链路**：LLM 适配器在**构建模型请求时**对请求里出现的每个 image part 调用它
   `dsh-llm-pi-ai/lib/index.js:1118`
   ```js
   const prepared = await Promise.all(orderedRefs.map((ref) => attachments.readImageRequest(ref, policy, signal)));
   ```
   上游 `collectImageRefs`（`:1112`）遍历 `message.content` 收集所有 `type === "image"`。
   **这一步与图从哪条管线进来无关**：主会话 waterfall 与 btw 的 `agent.followup` 都走同一个适配器。
5. **pi-ai 路由预算**：`dsh-llm-pi-ai/lib/index.js:845/847`
   ```js
   const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048;   // 4,194,304 px
   const DEFAULT_REQUEST_IMAGE_MAX_BYTES  = 1024 * 1024;     // 1 MiB
   ```

## 实测代入（本机真实盘面）

| 图 | 尺寸 | 存储字节 | ≤4.19MP | ≤1MiB | request-images 落盘 | 说明 |
|---|---|---|---|---|---|---|
| 主会话 09-17 18:31（用户 5120×2880 截图） | 入库时已归一化到 2048×1152 | **1,766,643**（1.68 MiB） | ✓ | **✗** | **✓**（196,370 B WebP） | 超 1 MiB → 必须重编码 → 落盘 |
| 主会话 09-17 16:42 | — | — | — | — | **✓**（201,992 B） | 同上类 |
| **btw 09-18 10:24**（`0920a507…`） | 2048×872 | **522,975** | ✓ | **✓** | **✗ 无** | **原样直通，不落盘** |
| 主代理 10:37–10:42 用 `read_image` 看的 5 张预览图 | ≤2.2M px | 20–80 KB | ✓ | ✓ | **✗ 无** | **行为级反证：确实看见了，仍无派生文件** |

## 为什么"主会话总有、btw 总没有"

不是管线差异，而是**图尺寸差异**：用户的截图是 5K 级原图，入库归一化后仍是 1.68 MiB 的 PNG，
超过 pi-ai 的 1 MiB 请求预算 → 每次都必须重编码 → 每次都落盘；
btw 那几张（2048×872 / 522 KB）本身就在预算内 → 直通 → 不落盘。
主代理自己贴的预览图同样在预算内，也都没有派生文件。

## 可验证的判据（可复现）

```bash
# 1) 该目录只有两张、都是 09-17；目录 mtime 停在 09-17 18:31:53
find ~/.dsh/attachments/v1/request-images -type f -printf '%TY-%Tm-%Td %TH:%TM  %s  %p\n' | sort -r
# 2) btw 那张图确实入库了（objects 里有，且 mtime=10:24）
ls -la ~/.dsh/attachments/v1/objects/09/0920a507*
# 3) 我的预览图同样入库、同样无派生
find ~/.dsh/attachments/v1/objects -type f -newermt '2026-09-18 10:30' -printf '%TH:%TM %s %f\n' | sort
```
**预测规则（可证伪）**：对 pi-ai 路由，任何"存储字节 ≤ 1 MiB 且 像素 ≤ 4,194,304"的图，
无论从主会话还是 btw 进来，都**不会**在 `request-images/` 留下文件；反之必然留下。

## 对既往判断的影响

- **不需要**修任何代码：btw 直传路径没有丢图，它走的就是同一个适配器物化点。
- 审计档此前把这条列为"未解观察"，**现予结案**；用户在 `ask_user_question` 里"因为看不到派生文件
  所以认为 btw 没看见"的推断，是有机制依据的**误判**（观察为真、解释反了）。
- 顺带一个可观测推论：btw 在预算内的图是**逐字节原样直传**（本例是 522 KB 的 PNG），
  而主会话超过预算的图会被重编码为 WebP（有损）。就"读小字保真度"而言，btw 这条路径
  可能**不劣于甚至优于**主会话——但重编码的质量参数未在本轮核实，故仅记为假设，不作结论。
