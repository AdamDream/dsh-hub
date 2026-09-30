//#region lib/index.js
/**
 * dsh-subagent-model host half — 0.2.0 settings migration.
 *
 * 0.1.7+ 已删除 `installSettingsSection` / `settingsNamespace`（旧名空间自注册面）。
 * 0.2.0 的 settings 面改为「**profile 条目 id** + 插件 Config 自动表单」：
 *   - 本条目的 id 是 `subagent-model`（由 profile patch 的 insert 决定）；
 *   - 本插件导出 `Config`，宿主按该 schema 自动生成设置页；
 *   - 生效值由入口 `config` 给出，并可通过 settings 服务 `describe()` 实时读回
 *     （descriptor 含 `value` + `revision` + `applies:'live'`）⇒ 热生效天然成立。
 *
 * 消费侧：`dsh-tool-subagent` 的本地补丁在每次派发时读
 * `settings.describe().find(r => r.ns === ENTRY_ID)?.value`，
 * 用非空 `provider`/`model` 覆盖 preset 静态 `agentOptions`；读失败则原样回落。
 */
import z from "@deepseek-ai/schemastery";

const name = "dsh-subagent-model";

/** Profile 条目 id（= settings 命名空间；必须与 profile patch 的 insert id 一致）。 */
const ENTRY_ID = "subagent-model";

/** 现役固定路由（沿用现役部署的实际生效值；D9 裁决统一为 deepseek-v4-pro）。 */
const DEFAULT_ROUTE = Object.freeze({ provider: "adam", model: "deepseek-v4-pro" });

/**
 * 可选字段；缺键即继承组合基线的 preset 路由。
 * 派发层把空字符串视为「未设置」并回落到 preset。
 */
const Config = z.object({
  provider: z.string(),
  model: z.string()
});

/**
 * 0.2.0 无需自注册 settings 面：导出 `Config` 即由宿主按条目 id 生成表单。
 * 此处仅做一次性默认值回填的日志，便于确认条目已按预期装载。
 */
function apply(ctx, config) {
  const effective = { ...DEFAULT_ROUTE, ...(config ?? {}) };
  ctx.logger?.info?.(
    `dsh-subagent-model: entry "${ENTRY_ID}" effective route = ${effective.provider}/${effective.model}`
  );
}

export { Config, DEFAULT_ROUTE, ENTRY_ID, apply, name };
export default { apply, name, Config };
