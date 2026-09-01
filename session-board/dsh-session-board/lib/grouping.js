/**
 * dsh-session-board · lib/grouping.js —— 分组键解析 + 会话级缓存 + 同步读
 *
 * 实现依据：
 * - CONTRACT.md §1.1（本模块唯一接口依据：导出清单 / 签名 / 实现约束 / 允许 import 清单）
 * - PROPOSAL.md v2 §5（分组键算法：git rev-parse --git-common-dir → realpath；
 *   非 git 回退 realpath(cwd)；再回退 resolve(cwd)；每会话解析一次并缓存）
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
 * 创建每-apply 一份的分组键缓存工厂（CONTRACT.md §1.1）。
 *
 * 内部维护两个 Map（CONTRACT.md §1.1 实现约束）：
 * - `pending`:  Map<sessionId, Promise<GroupKey>> —— 去重并发解析；条目常驻，
 *   保证每会话仅解析一次（PROPOSAL.md §5「每会话解析一次并缓存，会话 cwd 不变」）
 * - `resolved`: Map<sessionId, GroupKey> —— resolveGroupKey 完成后回填，供注入侧同步读
 *
 * @returns {{ groupKeyFor: Function, groupKeySync: Function }}
 */
export function createGrouping() {
  /** @type {Map<string, Promise<GroupKey>>} */
  const pending = new Map();
  /** @type {Map<string, GroupKey>} */
  const resolved = new Map();

  /**
   * 取某会话的分组键（异步，按 session.id 缓存一次）。
   * `session.header.cwd` 为空 → 直接返回 "no-cwd" 并写入 resolved；
   * 否则走 pending 去重，成功后写 resolved（CONTRACT.md §1.1 实现约束）。
   * @param {{ id: string, header: { cwd: string | undefined } }} session
   * @returns {Promise<GroupKey>}
   */
  async function groupKeyFor(session) {
    const sessionId = session?.id;
    const cwd = session?.header?.cwd;
    if (!cwd) {
      resolved.set(sessionId, "no-cwd");
      return "no-cwd";
    }
    let p = pending.get(sessionId);
    if (!p) {
      p = (async () => {
        const key = await resolveGroupKey(cwd);
        resolved.set(sessionId, key); // 完成后回填 resolved（CONTRACT.md §1.1）
        return key;
      })();
      pending.set(sessionId, p); // 去重并发解析（CONTRACT.md §1.1）
    }
    return p;
  }

  /**
   * 同步读已解析的分组键（注入侧专用；未解析完成返回 undefined）。
   * 只读 resolved，绝不同步触发异步解析（CONTRACT.md §1.1 实现约束）。
   * @param {string} sessionId
   * @returns {GroupKey | undefined}
   */
  function groupKeySync(sessionId) {
    return resolved.get(sessionId);
  }

  return { groupKeyFor, groupKeySync };
}
