/**
 * @module @deepseek-ai/dsh-session-board/lib/storage
 *
 * dsh-session-board · 存储层：落盘（withFileLock + writeFileAtomic）+ 内存镜像 + retention。
 * 依据：CONTRACT.md §1.2（接口/签名/允许 import/实现约束）、§2（共享类型）、§5（RETENTION_MS）、
 *       §6（错误约定）；PROPOSAL.md v2 §6（存储设计：位置/写侧/读侧/镜像/重启）、§5（文件名哈希）。
 *
 * 职责边界（CONTRACT §1.2「不做什么」）：不做分组键解析（grouping.js）；不做状态捕获（capture.js）；
 * 不做渲染/截断（board.js）；不做 fsync（dsh-atomic-write 明示不 fsync —— README.md:45-47，状态板非权威账本）。
 *
 * 错误约定（CONTRACT §6）：
 * - readPeerFile：损坏/缺失 → 空骨架，不抛（§6-4；本模块无 ctx.logger，warn 以 console.warn 承接，
 *   发布侧整体 warn 语义由 index.js 的 ctx.logger.warn 负责）。
 * - upsertPeer：锁超时/写失败 → 抛给调用方（§6-2：发布侧 index.js 捕获后 ctx.logger.warn，绝不抛向会话主流程）。
 */

import { createHash } from "node:crypto"; // CONTRACT §1.2 允许 import：node:crypto（createHash，文件名哈希）
import { mkdir, readFile } from "node:fs/promises"; // CONTRACT §1.2 允许 import：node:fs/promises（readFile；mkdir 为首写父目录保障的必要补充，见 upsertPeer 行内依据，已报告偏离）
import { homedir } from "node:os"; // CONTRACT §1.2 允许 import：node:os（homedir）
import { join } from "node:path"; // CONTRACT §1.2 允许 import：node:path（join）
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write"; // CONTRACT §1.2 / F15：dsh-atomic-write/lib/index.js:92-115, 30-46（命名导出见 :117）

/** @typedef {string} GroupKey repo 级归一路径（worktree → --git-common-dir → realpath） */
/** @typedef {string} SessionId session.id 原样 */

/**
 * @typedef {Object} PeerGoal
 * @property {string} objective 头截（≤ queryDetailBytes）
 * @property {"active"|"paused"|"blocked"|"complete"} phase
 * @property {number} roundsStarted
 */

/**
 * @typedef {Object} PeerTodos
 * @property {number} pending
 * @property {number} inProgress
 * @property {number} completed
 * @property {string[]} items content，in_progress 优先，≤ maxPeerEntries 条，每条头截
 */

/**
 * @typedef {Object} PeerStatus
 * @property {1} schemaVersion
 * @property {SessionId} sessionId
 * @property {string} label `${id前8} ${basename(cwd)}`，≤48B 头截
 * @property {string} cwd session.header.cwd 绝对路径
 * @property {GroupKey} groupKey 跨进程比对用
 * @property {boolean} isSubagent 发布侧已排除，冗余防御
 * @property {number} publishedAt epoch ms，写入时刻
 * @property {number} lastActivityAt epoch ms，= turn/end 时刻（活跃判定主信号）
 * @property {number} turn 进程内单调，跨重启可回退，仅信息性
 * @property {("completed"|"max-tokens"|"aborted"|"error"|"blocked")|undefined} lastTurnReason
 * @property {PeerGoal|null} goal stateOf("goal") 扁平化；服务缺席 → null
 * @property {PeerTodos|null} todos stateOf("todos") 扁平化；服务缺席 → null
 * @property {string[]} recentFiles 绝对路径，去重，≤ maxPeerEntries
 * @property {string} recentAssistantTail 尾截 ≤ queryDetailBytes
 */

/**
 * @typedef {Object} GroupFile
 * @property {1} schemaVersion
 * @property {GroupKey} groupKey
 * @property {number} updatedAt epoch ms
 * @property {Record<SessionId, PeerStatus>} peers
 */

/**
 * retention 时长：7 天（CONTRACT §5 / §9-A2 裁决：storage.js 模块常量，不入 Config）。
 * @type {number}
 */
const RETENTION_MS = 7 * 24 * 3600 * 1000;

/**
 * 解析 DSH home 根目录（纯函数，不做 IO）。
 * @returns {string} `process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh")`（CONTRACT §1.2 JSDoc；PROPOSAL §6.1）
 */
export function homeDir() {
  return process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/**
 * 组文件目录 `<home>/session-board/peers`（PROPOSAL §6.1；内部辅助，不导出）。
 * 独立于 peerFile 抽出，使本模块对 node:path 的使用仅限契约允许的 `join`。
 * @returns {string}
 */
function peersDir() {
  return join(homeDir(), "session-board", "peers");
}

/**
 * 组键 → 落盘文件绝对路径（纯函数，不创建目录、不做任何 IO）。
 * @param {GroupKey} groupKey
 * @returns {string} `<home>/session-board/peers/<sha256(groupKey).slice(0,32).hex>.json`
 *   （CONTRACT §1.2 JSDoc；PROPOSAL §5：文件名 = sha256(groupKey) 前 32 个十六进制字符，文件内保留完整 groupKey）
 */
export function peerFile(groupKey) {
  const hash = createHash("sha256").update(groupKey).digest("hex").slice(0, 32);
  return join(peersDir(), `${hash}.json`);
}

/**
 * 空组骨架（readPeerFile 的兜底返回值；groupKey 由 upsertPeer 回填，维持 GroupFile 形状）。
 * @returns {GroupFile}
 */
function emptyGroupFile() {
  return { schemaVersion: 1, groupKey: "", updatedAt: 0, peers: {} };
}

/**
 * @param {unknown} e
 * @returns {string} 一句话可日志化错误描述
 */
function describeError(e) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 读一个组文件（读侧无锁 —— PROPOSAL §6.3：writeFileAtomic 的 rename 提交保证读到
 * 旧或新完整内容，容忍「旧一点」；CONTRACT §1.2 JSDoc：JSON 损坏/不存在 → 空骨架，不抛）。
 *
 * warn 语义（CONTRACT §6-4「解析失败→空骨架 + warn，不抛」）：解析失败/形状损坏/非 ENOENT
 * 读取失败经 console.warn 诊断（本模块不可及 ctx.logger）；ENOENT（首次发布前）为正常态，静默。
 *
 * @param {string} filePath
 * @returns {Promise<GroupFile>} 永不 reject
 */
async function readPeerFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return emptyGroupFile();
    console.warn(`session-board: read failed for ${filePath}: ${describeError(e)}`);
    return emptyGroupFile();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(`session-board: discarding corrupt peer file ${filePath}: ${describeError(e)}`); // CONTRACT §6-4
    return emptyGroupFile();
  }
  if (
    parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
    parsed.peers === null || typeof parsed.peers !== "object" || Array.isArray(parsed.peers)
  ) {
    console.warn(`session-board: discarding malformed peer file ${filePath}`); // 形状不符按损坏处理（CONTRACT §1.2 JSDoc）
    return emptyGroupFile();
  }
  return {
    schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1,
    groupKey: typeof parsed.groupKey === "string" ? parsed.groupKey : "",
    updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    peers: parsed.peers
  };
}

/**
 * retention 清理：删除 `lastActivityAt < now - RETENTION_MS` 的条目（CONTRACT §1.2 实现约束、
 * PROPOSAL §10.5「防文件无限增长」）；缺失/非数值 lastActivityAt 的畸形条目视同孤儿一并清理。
 * 原地修改。
 * @param {Record<SessionId, PeerStatus>} peers
 * @param {number} now epoch ms
 * @returns {void}
 */
function pruneRetention(peers, now) {
  const cutoff = now - RETENTION_MS;
  for (const id of Object.keys(peers)) {
    const lastActivityAt = peers[id]?.lastActivityAt;
    if (typeof lastActivityAt !== "number" || lastActivityAt < cutoff) delete peers[id];
  }
}

/**
 * 锁内 read-modify-write 合并写入某组文件，并顺带 retention 清理（CONTRACT §1.2）。
 * 锁超时/写失败 → 抛给调用方（CONTRACT §1.2「发布侧吞掉」、§6-2），本函数不捕获。
 * @param {GroupKey} groupKey
 * @param {string} sessionId
 * @param {PeerStatus} status
 * @returns {Promise<void>}
 */
async function upsertPeer(groupKey, sessionId, status) {
  const file = peerFile(groupKey);
  // 首写父目录保障（对契约 §1.2 伪代码的必要补充，已报告偏离）：
  // withFileLock 的锁是 <file>.lock 同目录兄弟文件，要求父目录必须已存在
  // （dsh-atomic-write/lib/index.js:86 "The parent directory must exist"；:98 writeFile(lockPath) 遇 ENOENT 直接抛）；
  // 而 writeFileAtomic 只在锁内才创建父目录（dsh-atomic-write/lib/index.js:31 mkdir），时序晚于取锁。
  await mkdir(peersDir(), { recursive: true });
  await withFileLock(file, async () => { // dsh-atomic-write/lib/index.js:92-115（F15：wx 独占建锁 :98-101，waitMs :94，超时抛错 :106，finally 释放 :112-114）
    const prev = await readPeerFile(file); // 锁内读：旧完整内容或空骨架（PROPOSAL §6.2）
    if (!prev.groupKey) prev.groupKey = groupKey; // 回填骨架缺失的组键，维持 GroupFile 形状（CONTRACT §2；PROPOSAL §5）
    prev.peers[sessionId] = status;
    const now = Date.now();
    pruneRetention(prev.peers, now); // 顺带 retention 清理（CONTRACT §1.2 实现约束）
    prev.updatedAt = now;
    await writeFileAtomic(file, JSON.stringify(prev), { mode: 0o600 }); // dsh-atomic-write/lib/index.js:30-46（F15：同目录随机后缀 + wx + rename 原子替换 :35-41，mode 透传 :37-40，父目录 mkdir :31）
  }, { waitMs: 2000 }); // CONTRACT §1.2 实现约束原文：{ waitMs: 2000 }
}

/**
 * 创建存储工厂（拥有内存镜像 mirror；retention 常量 RETENTION_MS 为模块级，CONTRACT §5 / §9-A2）。
 * @returns {{ readPeerFile: Function, upsertPeer: Function, mirrorSet: Function, mirrorLoad: Function, mirrorRead: Function }}
 */
export function createStorage() {
  /** 内存镜像：`Map<GroupKey, Map<SessionId, PeerStatus>>`（CONTRACT §1.2 实现约束；PROPOSAL §6.4）。 */
  const mirror = new Map();

  /**
   * 发布后立即写入内存镜像（本进程自见，同步）。
   * @param {GroupKey} gk
   * @param {string} id
   * @param {PeerStatus} st
   * @returns {void}
   */
  function mirrorSet(gk, id, st) {
    let inner = mirror.get(gk);
    if (inner === undefined) {
      inner = new Map();
      mirror.set(gk, inner);
    }
    inner.set(id, st);
  }

  /**
   * 用一份完整组文件整体替换镜像中该组的条目（周期刷新/初始化用，避免残留过期 peer）。
   * @param {GroupKey} gk
   * @param {Record<string, PeerStatus>} peers
   * @returns {void}
   */
  function mirrorLoad(gk, peers) {
    const inner = new Map();
    if (peers !== null && typeof peers === "object") {
      for (const id of Object.keys(peers)) inner.set(id, peers[id]);
    }
    mirror.set(gk, inner);
  }

  /**
   * 同步读镜像快照（浅拷贝为普通对象，值仍为 PeerStatus 引用）。
   * @param {GroupKey} gk
   * @returns {Record<string, PeerStatus>} 未命中返回 {}
   */
  function mirrorRead(gk) {
    const inner = mirror.get(gk);
    return inner === undefined ? {} : Object.fromEntries(inner);
  }

  return { readPeerFile, upsertPeer, mirrorSet, mirrorLoad, mirrorRead };
}
