/**
 * WP3 / B：运行时读值语义核验（真跑，不起服务）
 *
 * B1  cordis 到底把 .volatile() 字段交给插件的是什么？—— 用**真实 schemastery**
 *     （插件自己 import 的那一份）把 plain 配置解析成运行时 config，观察字段类型。
 *     依据：$B/schemastery/lib/index.mjs:235-237（.volatile() 打 meta）、
 *           :265-273（meta.volatile ⇒ createVolatile(value) 返回 cosmokit 引用对象）、
 *           :480（默认值同样 createVolatile）；$B/cosmokit/lib/index.js:83,102-118。
 * B2  subagent-model：同一份"volatile 运行时 config"喂给**改前**与**改后**的 apply()，
 *     看日志字符串（改前会把引用对象拼成 [object Object]）。
 * B3  vision-adam：把 apply() 真跑起来（stub fs / stub fetch / stub settings），
 *     断言 current() → resolveOptions() 之后的 model/baseURL/maxTokens/apiKeyEnv 是标量，
 *     两条路径（有 settings 描述符 / 无 settings 描述符）都验。
 * B4  消费侧 dsh-tool-subagent/lib/index.js:68-88 effectiveConfiguredAgentOptions
 *     的**源码文本**直接实例化后真跑，喂 describe() 投影出来的 value。
 *
 * 运行： node b-runtime-unwrap.mjs
 */
import { readFileSync } from "node:fs";
import z from "@deepseek-ai/schemastery";
import { isVolatile } from "@deepseek-ai/cosmokit";
import { credentialRef } from "@deepseek-ai/dsh-credentials";

const A = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020";
const B = A + "/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const NM = A + "/home/profiles/node_modules";
const SUBAGENT_AFTER = NM + "/@local/dsh-subagent-model/lib/index.js";
const SUBAGENT_BEFORE = "./before/subagent-model.index.mjs";
const VISION_AFTER = NM + "/@deepseek-ai/dsh-vision-adam/lib/index.js";
const VISION_BEFORE = "./before/vision-adam.index.mjs";

const out = [];
const log = (s = "") => { out.push(s); console.log(s); };
let failures = 0;
const assert = (cond, label, detail = "") => {
  if (!cond) failures++;
  log(`   ${cond ? "PASS" : "FAIL"}  ${label}${detail ? "   " + detail : ""}`);
  return cond;
};

// ── 从 dsh-settings 源码切出 volatileForm / plainConfig / projectForm（同 A 脚本） ──
const settingsLines = readFileSync(B + "/dsh-settings/lib/index.js", "utf8").split("\n");
const { redactSecrets } = await import(B + "/dsh-settings/lib/index.js");
const fns = new Function("z", "isVolatile", "redactSecrets",
  settingsLines.slice(96, 158).join("\n") + "\nreturn { plainConfig, volatileForm, projectForm, isVolatilePath };",
)(z, isVolatile, redactSecrets);
const { plainConfig, volatileForm, projectForm } = fns;

/** 造一份"运行时 config"：用真实 schemastery 按插件自己的 Config 解析 plain 值。 */
function runtimeConfig(schema, plain) {
  return z.resolve(plain, schema)[0];
}

// ═══ B1 ═══════════════════════════════════════════════════════════════════════
log("## B1  真实 schemastery 解析：.volatile() 字段在运行时 config 里是 cosmokit 引用对象");
const sm = readFileSync(B + "/schemastery/lib/index.mjs", "utf8");
log(`     依据 $B/schemastery/lib/index.mjs:${sm.split("\n").findIndex((l) => l.includes("if (schema.meta?.volatile) {")) + 1} ` +
    `= "if (schema.meta?.volatile) { ... return [createVolatile(value), adapted]; }"`);
const subMod = await import(SUBAGENT_AFTER);
const subRuntime = runtimeConfig(subMod.Config, { provider: "adam", model: "deepseek-v4-pro" });
log(`     subagent-model 运行时 config：provider typeof=${typeof subRuntime.provider} isVolatile=${isVolatile(subRuntime.provider)} ` +
    `get()=${JSON.stringify(subRuntime.provider.get())}`);
log(`     model    typeof=${typeof subRuntime.model} isVolatile=${isVolatile(subRuntime.model)}`);
assert(typeof subRuntime.provider === "object" && isVolatile(subRuntime.provider), "volatile 字段在运行时是引用对象（不是字符串）");

// ═══ B2 ═══════════════════════════════════════════════════════════════════════
log("");
log("## B2  subagent-model apply() 日志：同一份 volatile 运行时 config 喂给改前/改后模块");
function runSubagentApply(mod, config, tag) {
  const lines = [];
  const ctx = { logger: { info: (m) => lines.push(String(m)) } };
  mod.apply(ctx, config);
  const line = lines[0] ?? "";
  log(`     [${tag}] apply() 日志 = ${JSON.stringify(line)}`);
  const m = /route = ([^/]*)\/(.+)$/.exec(line);
  return m === null ? null : { provider: m[1], model: m[2] };
}
/** 同一件事，但返回原始日志行（用于断言 [object Object] 情形）。 */
function runSubagentApplyRaw(mod, config, tag) {
  const lines = [];
  mod.apply({ logger: { info: (m) => lines.push(String(m)) } }, config);
  const line = lines[0] ?? "";
  log(`     [${tag}] apply() 日志 = ${JSON.stringify(line)}`);
  return line;
}
const beforeSub = await import(SUBAGENT_BEFORE);
const beforeSchemaRuntime = runtimeConfig(beforeSub.Config, { provider: "adam", model: "deepseek-v4-pro" });
const rBeforeOwnSchema = runSubagentApply(beforeSub, beforeSchemaRuntime, "改前模块 + 改前 schema（普通字符串，修复前真实形态）");
assert(rBeforeOwnSchema?.provider === "adam" && rBeforeOwnSchema?.model === "deepseek-v4-pro",
  "改前模块 + 改前 schema：日志仍是 adam/deepseek-v4-pro（修复前不坏，因为根本没有 volatile）");

const beforeVolatileLog = runSubagentApplyRaw(beforeSub, subRuntime, "改前模块 + volatile 运行时 config");
assert(beforeVolatileLog.includes("[object Object]/[object Object]"),
  "改前模块 + volatile config：日志被拼成 [object Object]/[object Object]（证明'加 volatile 必须配套解包'）",
  JSON.stringify(beforeVolatileLog));

const rAfter = runSubagentApply(subMod, subRuntime, "改后模块 + volatile 运行时 config");
assert(rAfter?.provider === "adam" && rAfter?.model === "deepseek-v4-pro",
  "改后模块：日志仍是 adam/deepseek-v4-pro（void 引用解包生效）", JSON.stringify(rAfter));

// ═══ B3 ═══════════════════════════════════════════════════════════════════════
log("");
log("## B3  vision-adam current() → resolveOptions()：两条路径都必须是普通标量（真跑 apply + execute，stub fs/fetch）");

function makeCtx(descriptor) {
  const captured = { tool: undefined, credentialsRef: undefined, url: undefined, init: undefined };
  const ctx = {
    _captured: captured,
    get: (name) => {
      if (name === "settings") return descriptor === undefined ? undefined : { describe: () => [descriptor] };
      if (name === "credentials") return { resolve: async (ref) => { captured.credentialsRef = ref; return { value: "sk-from-credentials" }; } };
      return undefined;
    },
    systemPrompt: { section: () => {} },
    tools: { register: (t) => { captured.tool = t; return () => {}; } },
    emit: () => {},
    fs: {
      resolve: async (p) => ({ displayPath: p }),
      stat: async () => ({ type: "file", version: 1 }),
      readBytes: async () => Buffer.from("89504e470d0a1a0a", "hex"),
    },
  };
  return ctx;
}

async function runVision(mod, config, descriptor, tag) {
  const ctx = makeCtx(descriptor);
  mod.apply(ctx, config);
  const tool = ctx._captured.tool;
  if (tool === undefined) { log(`     [${tag}] FAIL: 未注册工具`); failures++; return undefined; }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    ctx._captured.url = String(url);
    ctx._captured.init = init;
    return { ok: false, status: 500, json: async () => ({ error: "stub-transport" }) };
  };
  try {
    await tool.execute({ file_path: "probe.png" }, { signal: undefined, agent: { session: { header: { cwd: "/tmp" } } } });
    log(`     [${tag}] 未抛错（意外）`);
  } catch (error) {
    log(`     [${tag}] execute 抛错（预期，stub 传输）= ${error.message}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return ctx._captured;
}

const visionMod = await import(VISION_AFTER);
const visionSchema = visionMod.Config;
const visionPlain = {
  apiKey: "sk-literal",
  apiKeyEnv: "ADAM_API_KEY",
  baseURL: "https://llmapi.roboscience.xyz/v1/",
  model: "gpt-6-astra",
  maxTokens: 393216,
};
const visionRuntime = runtimeConfig(visionSchema, visionPlain);
log(`     vision-adam 运行时 config volatile 字段 = ${Object.entries(visionRuntime).filter(([, v]) => isVolatile(v)).map(([k]) => k).join(", ")}`);

// —— 需要 plainConfigOf 的证据①：引用对象不能当凭据引用名用
let naiveError;
try { credentialRef(visionRuntime.apiKeyEnv); } catch (error) { naiveError = error.message; }
log(`     [反证①] credentialRef(运行时 config 的 apiKeyEnv 引用对象) ⇒ ${naiveError ?? "(未抛错)"}`);
assert(naiveError !== undefined, "反证成立：不先解包，apiKeyEnv 引用对象直接进 credentialRef 会抛 TypeError");

// —— 需要 plainConfigOf 的证据②：baseURL/model/maxTokens 不解包会变成对象，.replace 立刻炸
const naiveOptions = visionMod.resolveOptions({ ...visionRuntime, apiKeyEnv: "ADAM_API_KEY" });
log(`     [反证②] resolveOptions({...运行时 config, apiKeyEnv 换成标量}) ⇒ baseURL typeof=${typeof naiveOptions.baseURL} ` +
    `model typeof=${typeof naiveOptions.model} maxTokens typeof=${typeof naiveOptions.maxTokens}；typeof baseURL.replace = ${typeof naiveOptions.baseURL?.replace}`);
assert(typeof naiveOptions.baseURL === "object" && typeof naiveOptions.baseURL.replace !== "function",
  "反证成立：不解包时 baseURL/model/maxTokens 仍是引用对象，analyzeImageBytes 的 baseURL.replace() 必然 TypeError");

// 路径①：有 settings 描述符
const desc = { ns: "vision-adam", value: { model: "from-settings", baseURL: "https://settings.example/v1/", apiKeyEnv: "SETTINGS_KEY", maxTokens: 4242 } };
const c1 = await runVision(visionMod, visionRuntime, desc, "路径①有 settings 描述符");
let body1;
try { body1 = JSON.parse(c1.init.body); } catch { body1 = {}; }
assert(c1.url === "https://settings.example/v1/chat/completions", "baseURL 是普通字符串（settings 层覆盖生效，尾斜杠已归一）", c1.url);
assert(body1.model === "from-settings", "body.model 是普通字符串", JSON.stringify(body1.model));
assert(body1.max_tokens === 4242 && typeof body1.max_tokens === "number", "body.max_tokens 是 number", String(body1.max_tokens));

// 路径②：无 settings 描述符（回落组合基线）
const c2 = await runVision(visionMod, visionRuntime, undefined, "路径②无 settings 描述符（回落基线）");
let body2;
try { body2 = JSON.parse(c2.init.body); } catch { body2 = {}; }
assert(c2.url === "https://llmapi.roboscience.xyz/v1/chat/completions", "baseURL 回落基线且是普通字符串", c2.url);
assert(body2.model === "gpt-6-astra", "body.model 回落基线且是普通字符串", JSON.stringify(body2.model));
assert(body2.max_tokens === 393216, "body.max_tokens 回落基线且是 number", String(body2.max_tokens));

// 路径③：无 literal apiKey，观察 credentials.resolve 收到的 apiKeyEnv 是不是标量
const visionPlainNoKey = { ...visionPlain };
delete visionPlainNoKey.apiKey;
delete visionPlainNoKey.apiKeyEnv;
const visionRuntimeNoKey = runtimeConfig(visionSchema, visionPlainNoKey);
const c3 = await runVision(visionMod, visionRuntimeNoKey, desc, "路径③走 credentials.resolve（验 apiKeyEnv 标量）");
assert(typeof c3.credentialsRef === "string" && String(c3.credentialsRef) === String(credentialRef("SETTINGS_KEY")),
  "credentials.resolve 收到的是普通字符串 apiKeyEnv（= settings 层的 SETTINGS_KEY）",
  `got typeof=${typeof c3.credentialsRef} value=${String(c3.credentialsRef)}`);
assert(!isVolatile(c3.credentialsRef), "credentialsRef 不是 cosmokit 引用对象");

// 对照：改前模块（schema 非 volatile ⇒ 运行时 config 是普通字符串）
const visionBeforeMod = await import(VISION_BEFORE);
const visionBeforeRuntime = runtimeConfig(visionBeforeMod.Config, {
  apiKey: "sk-literal", apiKeyEnv: "ADAM_API_KEY", baseURL: "https://llmapi.roboscience.xyz/v1/", model: "gpt-6-astra", maxTokens: 393216,
});
const c4 = await runVision(visionBeforeMod, visionBeforeRuntime, desc, "对照：改前模块 + 改前 schema");
let body4; try { body4 = JSON.parse(c4.init.body); } catch { body4 = {}; }
assert(c4.url === "https://settings.example/v1/chat/completions" && body4.model === "from-settings",
  "改前模块在'无 volatile'schema 下同样工作（说明修复前不是功能回归，而是设置面缺口）", `${c4.url} ${JSON.stringify(body4.model)}`);

// ═══ B4 ═══════════════════════════════════════════════════════════════════════
log("");
log("## B4  消费侧真跑：dsh-tool-subagent/lib/index.js:68-88 effectiveConfiguredAgentOptions 源码文本实例化");
const consumerSrc = readFileSync(B + "/dsh-tool-subagent/lib/index.js", "utf8").split("\n").slice(67, 88).join("\n");
if (!consumerSrc.startsWith("function effectiveConfiguredAgentOptions(")) throw new Error("consumer slice start mismatch");
const effectiveConfiguredAgentOptions = new Function(`${consumerSrc}\nreturn effectiveConfiguredAgentOptions;`)();

for (const [tag, mod, config] of [
  ["改后（volatile）", subMod, subRuntime],
  ["改前（普通字符串）", beforeSub, runtimeConfig(beforeSub.Config, { provider: "adam", model: "deepseek-v4-pro" })],
]) {
  // 复刻 describe():436 的投影链，再把 value 交给真实消费函数
  const form = volatileForm(mod.Config);
  const projected = form === undefined ? config : projectForm(form, plainConfig(config));
  if (form === undefined) log(`     (${tag}: volatileForm === undefined ⇒ describe() 不产出该 ns，消费侧一路回落 preset)`);
  const runtimeCtx = { get: () => ({ describe: () => (form === undefined ? [] : [{ ns: "subagent-model", value: projected }]) }) };
  const result = effectiveConfiguredAgentOptions(runtimeCtx, { provider: "preset-provider", model: "preset-model" });
  log(`     [${tag}] describe().value = ${JSON.stringify(form === undefined ? null : projected)} ⇒ consumer 结果 = ${JSON.stringify(result)}`);
  assert(form === undefined ? result.provider === "preset-provider" && result.model === "preset-model"
      : result.provider === "adam" && result.model === "deepseek-v4-pro",
    `${tag}：${form === undefined ? "未收录 ⇒ 消费侧原样回落 preset（无报错、无字符串破损）" : "消费侧拿到字符串并成功覆盖 preset"}`,
    JSON.stringify(result));
}

log("");
log(failures === 0 ? "## B 全项 PASS" : `## B 有 ${failures} 项 FAIL`);
process.exitCode = failures === 0 ? 0 : 1;
