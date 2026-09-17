//#region lib/index.js
/**
 * dsh-subagent-model host half (P0' / P0 of subagent-model-gui audit).
 *
 * Registers the `dsh-subagent` settings namespace (provider/model, both
 * optional). Its resolved value is the HOT default route for
 * subagent / subagent_fork dispatches: the dsh-tool-subagent execute layer
 * (patched P0') reads this namespace per dispatch and overrides the
 * preset-static `config.agentOptions` fields when a non-empty value is
 * present; a missing/failed read degrades to the preset route untouched.
 *
 * Composition base = the current fixed preset route (standard-glm →
 * adam / deepseek-v4.1-flash), so an absent section resolves to exactly the
 * pre-change route and the AGENTS.md routing verdict keeps holding (default
 * unchanged; the only way to move it is the settings section / settings.yaml,
 * i.e. an explicit user instruction).
 */
import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";

const name = "dsh-subagent-model";
/** No direct host service dependencies; settings is injected by installSettingsSection. */
const inject = [];

/** Settings namespace carrying the subagent default route. */
const NS = settingsNamespace("dsh-subagent");

/** Current fixed preset route (standard-glm), used as the composition base. */
const DEFAULT_ROUTE = Object.freeze({ provider: "adam", model: "deepseek-v4.1-flash" });

/**
 * Optional per-field overrides; an absent key re-inherits the composition
 * base (the preset route). The dispatch layer treats a missing or empty
 * string value as "not set" and falls back to the preset.
 * (schemastery object keys are optional by default; defaults ride the
 * composition base passed to installSettingsSection.)
 */
const Config = z.object({
  provider: z.string(),
  model: z.string()
});

/** Register the namespace; `current` rides the hot settings source. */
function apply(ctx, config) {
  let current = () => config;
  installSettingsSection(ctx, NS, Config, { ...DEFAULT_ROUTE, ...config }, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {}
  });
}

export { Config, DEFAULT_ROUTE, NS, apply, inject, name };
