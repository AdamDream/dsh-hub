/**
 * unit-C1-fixer.mjs — 由 spec 驱动的确定性打补丁器（不写盘；调用方决定落盘策略）
 *
 * 职责：
 *   - 逐个补丁做**锚点唯一命中校验**（grep -c 等价）与**幂等判定**（version marker）；
 *   - 应用替换，返回改后全文 + 每个补丁的状态；
 *   - 任何异常都不静默兜底：锚点不唯一 / 锚点缺失且未见标记 → 抛错。
 *
 * 用法（被 client-runtime-perf.sh 调用）：
 *   node unit-C1-fixer.mjs --file <client.js> --print-summary
 *   node unit-C1-fixer.mjs --file <client.js> --out <patched.js>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PATCHES, UNITS, markerOf } from "./unit-C1-clientspec.mjs";

/** 单元 → 组成补丁 的映射（用于 --only P1,P2 子集应用）。 */
export const UNIT_PATCHES = Object.fromEntries(UNITS.map((u) => [u.id, u.patches]));

/** 按 `--only P1,P2` 过滤补丁清单；未指定则返回全部。 */
export function selectPatches(only) {
  if (only === undefined || only === "" || only === "*") return PATCHES;
  const wanted = only.split(",").map((x) => x.trim()).filter((x) => x !== "");
  const unknown = wanted.filter((id) => UNIT_PATCHES[id] === undefined);
  if (unknown.length > 0) {
    throw new Error(`--only 含未知单元：${unknown.join(", ")}（可用：${Object.keys(UNIT_PATCHES).join(", ")}）`);
  }
  const keep = new Set(wanted.flatMap((id) => UNIT_PATCHES[id]));
  return PATCHES.filter((p) => keep.has(p.id));
}

export function sha1(text) {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

export function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * 幂等判定（按 spec 顺序）。返回：
 *   { applied: boolean, firstMissing: string|undefined }
 * applied = 该补丁全部 patch 的 marker 都已出现（或标记已出现）。
 */
export function alreadyApplied(text, patches = PATCHES) {
  const missing = [];
  for (const patch of patches) {
    const marker = markerOf(patch);
    if (countOccurrences(text, marker) === 0) missing.push(`${patch.id}:${marker}`);
  }
  return { applied: missing.length === 0, missing };
}

/**
 * 应用整批补丁。
 * @returns {{ ok: boolean, text: string, steps: Array<object>, error?: string }}
 */
export function applyAll(text, patches = PATCHES) {
  const steps = [];
  const state = alreadyApplied(text, patches);
  if (state.applied) return { ok: true, text, steps: [{ id: "*", status: "already-applied" }] };
  if (state.missing.length !== patches.length) {
    // 区分「合法子集已应用」与「半应用/未知中间态」：按单元汇总，给出可执行建议。
    const unitStatus = UNITS.map((u) => {
      const present = u.patches.filter((id) => countOccurrences(text, markerOf(PATCHES.find((p) => p.id === id))) > 0);
      return { id: u.id, present: present.length, total: u.patches.length };
    });
    const complete = unitStatus.filter((u) => u.present === u.total).map((u) => u.id);
    const absent = unitStatus.filter((u) => u.present === 0).map((u) => u.id);
    const mixed = unitStatus.filter((u) => u.present > 0 && u.present < u.total).map((u) => `${u.id}(${u.present}/${u.total})`);
    const parts = [];
    parts.push(`已完整应用单元：${complete.length > 0 ? complete.join(",") : "无"}`);
    parts.push(`完全未应用单元：${absent.length > 0 ? absent.join(",") : "无"}`);
    if (mixed.length > 0) parts.push(`半应用单元（危险）：${mixed.join(",")}`);
    const hint =
      mixed.length > 0
        ? "存在半应用单元 → 这是未知中间态，请先用 --rollback 还原到基线。"
        : `这是「合法子集已应用」状态。若要继续，请用 --only ${absent.join(",")}（只补未应用的单元）；` +
          `若要整体重来，先 --rollback。`;
    return {
      ok: false,
      text,
      steps,
      error: `拒绝继续：目标并非干净基线，也不是本次要应用的完整集合。${parts.join("；")}。${hint}`
    };
  }
  let out = text;
  const appliedIds = new Set();
  for (const patch of patches) {
    // 依赖补丁（after）已应用时，锚点可能已被上游补丁改写 → 用 afterAnchor/afterReplacement。
    const dependent = (patch.after ?? []).length > 0 && (patch.after ?? []).every((id) => appliedIds.has(id));
    const anchor = dependent && patch.afterAnchor !== undefined ? patch.afterAnchor : patch.anchor;
    const replacement = dependent && patch.afterReplacement !== undefined ? patch.afterReplacement : patch.replacement;
    const hits = countOccurrences(out, anchor);
    if (hits !== 1) {
      return {
        ok: false,
        text: out,
        steps,
        error: `补丁 ${patch.id}（${patch.title}）锚点命中 ${hits} 次（要求恰好 1 次）——拒绝应用。`
      };
    }
    out = out.replace(anchor, replacement);
    appliedIds.add(patch.id);
    const marker = markerOf(patch);
    const post = countOccurrences(out, marker);
    if (post === 0) {
      return { ok: false, text: out, steps, error: `补丁 ${patch.id} 应用后未出现标记 ${marker}——拒绝交付。` };
    }
    steps.push({ id: patch.id, status: "applied", anchorHits: hits, marker });
  }
  // 交付态复核：对改后文本再跑一次全量判定，必须整体判定为「已应用」。
  // （不能简单检查锚点是否残留：P4d 的替换文本本身内嵌了 P4a 替换后的签名行。）
  const post = alreadyApplied(out, patches);
  if (!post.applied) {
    return { ok: false, text: out, steps, error: `交付态复核失败：改后文本仍缺标记 ${post.missing.join(", ")}` };
  }
  for (const patch of patches) {
    const marker = markerOf(patch);
    if (countOccurrences(out, marker) === 0) {
      return { ok: false, text: out, steps, error: `交付态复核失败：补丁 ${patch.id} 标记缺失` };
    }
  }
  // 逐条复核：本补丁「替换文本里新增的行」必须真的出现在交付文本里（防截断/防只替换了一半）
  for (const patch of patches) {
    const replacement = (patch.after ?? []).length > 0 && patch.afterReplacement !== undefined ? patch.afterReplacement : patch.replacement;
    const anchor = (patch.after ?? []).length > 0 && patch.afterAnchor !== undefined ? patch.afterAnchor : patch.anchor;
    const anchorLines = new Set(anchor.split("\n"));
    const added = replacement.split("\n").filter((line) => line.trim() !== "" && !anchorLines.has(line));
    const missingLine = added.find((line) => countOccurrences(out, line) === 0);
    if (missingLine !== undefined) {
      return {
        ok: false,
        text: out,
        steps,
        error: `交付态复核失败：补丁 ${patch.id} 的新增行未出现在交付文本中：${JSON.stringify(missingLine.slice(0, 80))}`
      };
    }
  }
  return { ok: true, text: out, steps };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const argOf = (name, dflt) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
  };
  const file = argOf("--file", "");
  if (file === "") {
    console.error("用法：node unit-C1-fixer.mjs --file <client.js> [--out <path>] [--only P1,P2] [--print-summary]");
    process.exit(2);
  }
  let patches;
  try {
    patches = selectPatches(argOf("--only", ""));
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exit(2);
  }
  const input = readFileSync(file, "utf8");
  const result = applyAll(input, patches);
  const summary = {
    file,
    ok: result.ok,
    only: patches.length === PATCHES.length ? "*" : patches.map((p) => p.id).join(","),
    error: result.error ?? null,
    steps: result.steps,
    input: { bytes: Buffer.byteLength(input, "utf8"), sha1: sha1(input) },
    output: result.ok ? { bytes: Buffer.byteLength(result.text, "utf8"), sha1: sha1(result.text) } : null,
    alreadyApplied: alreadyApplied(input, patches).applied
  };
  if (argv.includes("--out") && result.ok) {
    const out = argOf("--out", "");
    writeFileSync(out, result.text, "utf8");
    summary.written = out;
  }
  if (argv.includes("--print-summary") || !argv.includes("--out")) console.log(JSON.stringify(summary, null, 2));
  process.exit(result.ok ? 0 : 1);
}
