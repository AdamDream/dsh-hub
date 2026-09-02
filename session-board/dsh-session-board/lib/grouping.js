/**
 * dsh-session-board · lib/grouping.js —— 分组键解析 + 会话级缓存 + 同步读
 *
 * 实现依据：
 * - CONTRACT.md §1.1（本模块唯一接口依据：导出清单 / 签名 / 实现约束 / 允许 import 清单）
 * - PROPOSAL.md v2 §5（分组键算法：git rev-parse --git-common-dir → realpath；
 *   非 git 回退 realpath(cwd)；再回退 resolve(cwd)；每会话解析并缓存——TTL 再解析
 *   修订见 FIX-PROPOSAL.md B1）
 *
 * 本模块零 DSH/cordis API 用法，仅依赖 node: 内置模块（CONTRACT.md §1.1 允许 import
 * 清单：node:child_process / node:fs/promises / node:path），无外部依赖。
 *
 * 对契约的唯一偏离（实测修正）：CONTRACT.md §1.1 / PROPOSAL.md §5 的
 * `await execFile(...)` 无回调调用在 Node 22 返回 ChildProcess 而非 Promise，
 * 解构 { stdout } 得到 Socket、`.trim()` 必然抛错 → git 分支恒失败退回 cwd 回退链。
 * 实现改为同参数/同 options 的回调包 Promise 形式（见 resolveGroupKey 内注记），
 * 算法与失败回退链完全不变。其余严格照契约。
 *
 * 职责边界（CONTRACT.md §1.1「不做什么」）：不做文件哈希（sha256(groupKey) 属
 * storage.js）；不读写任何 PeerStatus 或组文件；不订阅任何事件；不做 cwd 之外的
 * 任何路径校验（header.cwd 由 dsh-session header 保证，F6:
 * dsh-session/lib/types/index.js:41-47）。
 */

import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

/**
 * repo 级归一路径（worktree → --git-common-dir → realpath）。
 * @typedef {string} GroupKey
 */

/**
 * 分组键再解析 TTL（模块常量，不入 Config；可经 createGrouping({ ttlMs }) 覆盖以便测试）。
 * 60s 为「git rev-parse 成本 / repo 身份变化收敛速度」平衡点：repo 身份（.git 出现/消失、
 * worktree 迁移）变化后，最多 60s 内经既有 refreshLiveGroups 周期触发再解析切换到新键
 * （FIX-PROPOSAL.md B1；同 storage.js RETENTION_MS 的「模块常量不入 Config」先例）。
 * @type {number}
 */
const GROUP_KEY_TTL_MS = 60 * 1000;

/**
 * 解析单一 cwd 到 repo 级分组键（无缓存、纯函数、永不 throw）。
 *
 * 算法（PROPOSAL.md v2 §5 原文照抄）：
 * 1. `git rev-parse --git-common-dir` → realpath；
 * 2. 失败回退 `realpath(cwd)`；
 * 3. 再失败回退 `resolve(cwd)`。
 *
 * 必须用 `--git-common-dir`、禁用 `--git-dir`：后者对链接 worktree 返回私有路径
 * （`.git/worktrees/<name>`），会把同一 repo 的不同 worktree 切成不同组
 * （CONTRACT.md §1.1 实现约束；PROPOSAL.md §5 要点）。
 * worktree 实测：主仓 git-common-dir 返回相对 ".git"，链接 worktree 返回主仓
 * .git 的绝对路径 → realpath 后二者同键（PROPOSAL.md §5）。
 *
 * @param {string | undefined} cwd - session.header.cwd（绝对路径；F6:
 *   dsh-session/lib/types/index.js:41-47 保证为绝对路径字符串）
 * @returns {Promise<GroupKey>} 归一路径；cwd 缺失（含空字符串，与 groupKeyFor
 *   的「为空」判定一致）返回 "no-cwd"
 */
export async function resolveGroupKey(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) return "no-cwd";
  try {
    // --git-common-dir 返回「共享 git 目录」，跨 worktree 相同（PROPOSAL.md §5）。
    // 偏离注记：契约原文 `await execFile(...)` 解构 { stdout } —— 实测 Node 22 中无回调的
    // child_process.execFile 返回 ChildProcess（stdout 为 Socket，非 Promise），照抄必回退。
    // 故以同二进制/同参数/同 options 的回调形式包 Promise，仅修正取值方式，算法不变。
    const out = await new Promise((res, rej) => {
      // 参数集照抄 CONTRACT.md §1.1：utf8 / timeout 2000ms / windowsHide
      execFile(
        "git",
        ["-C", cwd, "rev-parse", "--git-common-dir"],
        { encoding: "utf8", timeout: 2000, windowsHide: true },
        (err, stdout) => {
          if (err) rej(err);
          else res(stdout);
        }
      );
    });
    const rel = String(out).trim();
    // 空输出按失败处理，走回退链（PROPOSAL.md §5：if (!rel) throw）
    if (!rel) throw new Error("empty --git-common-dir output");
    // 相对结果（主仓如 ".git"、子模块如 ".git/modules/x"）拼成绝对路径；
    // 绝对结果（链接 worktree 返回主仓 .git 绝对路径）原样使用（PROPOSAL.md §5）
    const abs = isAbsolute(rel) ? rel : resolve(cwd, rel);
    // realpath 消解符号链接/"/.."，主仓与各 worktree 归一到同一物理路径（PROPOSAL.md §5 要点）
    return await realpath(abs);
  } catch {
    // git 不可用 / cwd 非仓库 / timeout / 空输出 → 回退链（PROPOSAL.md §5 失败回退链）
  }
  try {
    // 非 git 目录回退：cwd 归一化（同 cwd 会话仍同组，只是不与 worktree 兄弟同组）
    return await realpath(cwd);
  } catch {
    // cwd 不存在/不可达（竞态删除等）→ 末级回退
  }
  // cwd 已在函数入口验证为非空 string，path.resolve 为纯字符串运算，此处不可能 throw
  return resolve(cwd);
}

/**
 * 创建每-apply 一份的分组键缓存工厂（CONTRACT.md §1.1；TTL 再解析，FIX-PROPOSAL.md B1）。
 *
 * 内部维护三张 Map：
 * - `pending`:    Map<sessionId, Promise<GroupKey>> —— 去重并发解析（首次或再解析）；
 *   settle 后删除条目，保证 TTL 过期后能再次再解析
 * - `resolved`:   Map<sessionId, GroupKey> —— resolveGroupKey **成功后**回填，供注入侧同步读
 *   （groupKeySync 只读本 Map；仅成功时写 ⇒ 再解析进行中/失败时读到「上一次成功值」，绝不 undefined）
 * - `resolvedAt`: Map<sessionId, number> —— 最近成功解析的 epoch ms（TTL 判断基准）
 *
 * TTL 语义：TTL 内复用 resolved 旧值（不发 git）；过期后重新 resolveKey(cwd)，成功才原子替换
 * `resolved`+`resolvedAt`（键变化时经 onChange 通知），失败保留旧值且不动两张 Map（下轮重试）。
 *
 * @param {{
 *   ttlMs?: number,       // 分组键再解析 TTL，默认 GROUP_KEY_TTL_MS（60_000）；测试可缩短
 *   onChange?: (sessionId: string, oldKey: GroupKey, newKey: GroupKey) => void,  // 键变化回调（warn 日志）
 *   resolveKey?: (cwd: string | undefined) => Promise<GroupKey>   // 解析函数注入点，默认 resolveGroupKey（测试用）
 * }} [deps]
 * @returns {{ groupKeyFor: Function, groupKeySync: Function }}
 */
export function createGrouping({ ttlMs = GROUP_KEY_TTL_MS, onChange, resolveKey = resolveGroupKey } = {}) {
  /** @type {Map<string, Promise<GroupKey>>} */
  const pending = new Map();
  /** @type {Map<string, GroupKey>} */
  const resolved = new Map();
  /** @type {Map<string, number>} */
  const resolvedAt = new Map();

  /**
   * 取某会话的分组键（异步；TTL 内复用缓存，TTL 过期后再解析）。
   * 再解析成功且键变化时经 deps.onChange 通知；失败保留旧值。
   * `session.header.cwd` 为空 → 直接返回 "no-cwd" 并写入 resolved/resolvedAt（会话 cwd
   * 稳定，等价终态）；否则走 pending 去重（在飞解析共享同一 Promise）。
   * @param {{ id: string, header: { cwd: string | undefined } }} session
   * @returns {Promise<GroupKey>}
   */
  async function groupKeyFor(session) {
    const sessionId = session?.id;
    const cwd = session?.header?.cwd;
    if (!cwd) {
      resolved.set(sessionId, "no-cwd");
      resolvedAt.set(sessionId, Date.now());
      return "no-cwd";
    }
    const inflight = pending.get(sessionId);
    if (inflight) return inflight; // 去重在飞（首次或再）解析
    const prev = resolved.get(sessionId);
    if (prev !== undefined && Date.now() - (resolvedAt.get(sessionId) ?? 0) < ttlMs) {
      return prev; // TTL 内：复用旧值，不发 git
    }
    const p = (async () => {
      try {
        const key = await resolveKey(cwd);
        // 仅成功才原子替换旧值；此段执行期间 groupKeySync 仍读到 prev（绝不 undefined 抖动）
        resolved.set(sessionId, key);
        resolvedAt.set(sessionId, Date.now());
        if (prev !== undefined && prev !== key) {
          try { onChange?.(sessionId, prev, key); } catch { /* 日志失败不影响键更新 */ }
        }
        return key;
      } catch {
        // 解析失败：保留旧值（resolved/resolvedAt 不动 → resolvedAt 保持过期，下轮重试）
        return prev ?? "no-cwd";
      }
    })();
    pending.set(sessionId, p);
    const clear = () => { if (pending.get(sessionId) === p) pending.delete(sessionId); };
    p.then(clear, clear); // settle 后清除，保证过期能再次再解析
    return p;
  }

  /**
   * 同步读已解析的分组键（注入侧专用；未解析完成返回 undefined）。
   * 只读 resolved，绝不同步触发异步解析（CONTRACT.md §1.1 实现约束）；因 resolved
   * 仅在成功时写，再解析期间返回旧值，绝不因再解析出现 undefined 抖动。
   * @param {string} sessionId
   * @returns {GroupKey | undefined}
   */
  function groupKeySync(sessionId) {
    return resolved.get(sessionId);
  }

  return { groupKeyFor, groupKeySync };
}
