/**
 * jsonl-sink.js — 有界 JSONL 落盘器（U-LD1 的文件出口实现）
 *
 * 硬性设计要求（w20 audit §2.3 W-1 / §4.3 P-3 + 本次任务纪律）：
 *  - **不得无限增长**：硬顶 = `maxBytes × maxFiles`（默认 8 MiB × 3 = 24 MiB）。
 *    任何时刻目录内该 sink 的文件总字节数不超过硬顶。
 *  - **不得阻塞主线程**（宿主主线程已被 w06 实测钉在 84–95%）：**写**走
 *    `createWriteStream` 异步；**轮转只做 rename/unlink**（元数据操作，代价与文件大小无关）。
 *  - **`write()` 永不抛**：`Logger._method` 里 `exporter.export(message)` **没有** try/catch
 *    （`cordis/lib/index.js:484`）⇒ 本 sink 抛错会污染产品侧调用点。
 *  - **不丢日志（正常与风暴负载下）**：轮转**不等待** `stream.end()`（POSIX 下 rename 后旧 fd
 *    继续写入同一 inode ⇒ 旧流里已缓冲的数据仍落到"旧"文件里，语义正确），因此**没有内存队列**，
 *    也就不会在"warn 风暴"下丢行（早期实现用异步队列，实测 600 行连写丢 542 行 ⇒ 已废弃）。
 *    只有当轮转**本身失败**时，才为守住硬顶而丢弃并计数。
 *  - **单行有界**：超过 `maxLineBytes` 的行截断并标记（避免单个巨型 arg 撑爆一行）。
 *
 * 轮转规则（明确、可复核）：
 *   files: <file>（当前）, <file>.1, <file>.2 … <file>.(maxFiles-1)
 *   触发：`bytes > 0 && bytes + lineBytes > maxBytes`
 *   动作：unlink(<file>.(maxFiles-1)) → 依次 rename .(n) → .(n+1) → rename <file> → <file>.1
 *         → 立即新建 <file>（bytes 归零），旧 stream 异步 `end()` 收尾（登记在 draining 里）
 *   `maxFiles === 1` ⇒ 不轮转，改为 unlink 后重开（truncations++），仍然有界。
 */
import { createWriteStream, mkdirSync, openSync, renameSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';

function fileSize(p) {
  try { return statSync(p).size; } catch { return 0; }
}

/** 把一行裁到 maxLineBytes 字节以内（按 UTF-8 字节计，尾部保留标记）。 */
export function clampLine(line, maxLineBytes) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= maxLineBytes) return { line, clamped: false, bytes: buf.length };
  const marker = `…[clamped ${buf.length - maxLineBytes}B]`;
  const keep = Math.max(0, maxLineBytes - Buffer.byteLength(marker));
  const kept = buf.subarray(0, keep).toString('utf8');
  const out = kept + marker;
  return { line: out, clamped: true, bytes: Buffer.byteLength(out) };
}

export class JsonlSink {
  constructor(options) {
    this.dir = options.dir;
    this.path = path.join(options.dir, options.file);
    this.maxBytes = Math.max(1024, Number(options.maxBytes) || 8 * 1024 * 1024);
    this.maxFiles = Math.max(1, Number(options.maxFiles) || 3);
    this.maxLineBytes = Math.max(256, Number(options.maxLineBytes) || 8192);

    this.bytes = 0;
    this.written = 0;
    this.dropped = 0;
    this.errors = 0;
    this.clamped = 0;
    this.rotations = 0;
    this.truncations = 0;
    this.closed = false;
    this.stream = null;
    this.draining = 0;
    this.lastError = null;

    try {
      mkdirSync(this.dir, { recursive: true });
      this.bytes = fileSize(this.path);
      this.#open();
    } catch (error) {
      this.errors++;
      this.lastError = String(error?.message ?? error);
    }
  }

  get hardCeilingBytes() {
    return this.maxBytes * this.maxFiles;
  }

  #open() {
    // ⚠️ **必须用同步 fd**，不能只给路径：`createWriteStream(path)` 的 open() 是**异步**的
    //    （下一 tick），而轮转（rename/unlink）是同步的 ⇒ 若在旧流的 open 落定之前轮转，
    //    旧流会把**重命名后的路径**重新打开（甚至重新创建），于是新老两个流写进同一个 inode：
    //    实测症状 = `.1/.2` 为 0 字节、当前文件涨到 125 KB（31 次"轮转"全部失效）。
    //    同步 openSync 拿到 fd 后，fd 与 inode 立即绑定，轮转对旧流不再有竞态。
    //    代价：每次挂载/轮转各 1 次 O(1) 元数据 syscall（不是按行同步写盘，P-3 的禁令针对的是后者）。
    let fd;
    try {
      fd = openSync(this.path, 'a');
    } catch (error) {
      this.errors++;
      this.lastError = `open failed: ${String(error?.message ?? error)}`;
      throw error;
    }
    this.stream = createWriteStream(this.path, { fd, flags: 'a', autoClose: true });
    this.stream.on('error', (error) => {
      this.errors++;
      this.lastError = String(error?.message ?? error);
    });
    // 注意：`fs.WriteStream` **没有** `unref()`（实测 typeof === 'undefined'）⇒ 打开的 fd 会
    // 让事件循环保持存活，唯一保证它被回收的机制就是本插件 effect 的 cleanup（`sink.close()`）。
  }

  /** 写一条记录。**永不抛**。返回是否真的写入（false = 被策略丢弃）。 */
  writeRecord(record) {
    if (this.closed === true) { this.dropped++; return false; }
    try {
      const raw = typeof record === 'string' ? record : JSON.stringify(record);
      if (typeof raw !== 'string') { this.dropped++; return false; }
      const c = clampLine(raw, this.maxLineBytes);
      if (c.clamped) this.clamped++;
      const line = c.line + '\n';
      const size = Buffer.byteLength(line);
      if (size > this.maxBytes) { this.dropped++; return false; }   // 单行超过整文件上限：丢弃，绝不无限增长
      return this.#offer(line, size);
    } catch (error) {
      this.errors++;
      this.lastError = String(error?.message ?? error);
      return false;
    }
  }

  /** 唯一写入口：超限先轮转；轮转失败则丢弃以守住硬顶。 */
  #offer(line, size) {
    if (this.bytes > 0 && this.bytes + size > this.maxBytes) {
      this.#rotateSync();
      if (this.bytes > 0 && this.bytes + size > this.maxBytes) { this.dropped++; return false; }
    }
    return this.#emit(line, size);
  }

  #emit(line, size) {
    try {
      if (this.stream === null || this.stream.destroyed === true) return false;
      this.stream.write(line);
      this.bytes += size;
      this.written++;
      return true;
    } catch (error) {
      this.errors++;
      this.lastError = String(error?.message ?? error);
      return false;
    }
  }

  /**
   * **同步**轮转：只做 rename/unlink + 换流，不等待旧流 `end()`。
   * POSIX 语义：rename 之后旧 fd 仍指向同一 inode ⇒ 旧流里已缓冲的数据依旧落到被重命名的
   * 文件里，不丢；新数据立即写入新文件。因此本路径**无需内存队列**。
   */
  #rotateSync() {
    const old = this.stream;
    try {
      if (this.maxFiles === 1) {
        try { unlinkSync(this.path); } catch (error) { if (error?.code !== 'ENOENT') { this.errors++; this.lastError = `unlink: ${error.code}`; } }
        this.truncations++;
      } else {
        try { unlinkSync(`${this.path}.${this.maxFiles - 1}`); } catch (error) { if (error?.code !== 'ENOENT') { this.errors++; this.lastError = `unlink oldest: ${error.code}`; } }
        for (let i = this.maxFiles - 2; i >= 1; i--) {
          try { renameSync(`${this.path}.${i}`, `${this.path}.${i + 1}`); } catch (error) { if (error?.code !== 'ENOENT') { this.errors++; this.lastError = `shift .${i}: ${error.code}`; } }
        }
        try { renameSync(this.path, `${this.path}.1`); } catch (error) { if (error?.code !== 'ENOENT') { this.errors++; this.lastError = `rotate: ${error.code}`; } }
        this.rotations++;
      }
      this.stream = null;
      this.bytes = 0;
      this.#open();
    } catch (error) {
      this.errors++;
      this.lastError = String(error?.message ?? error);
      if (this.stream === null) { try { this.#open(); } catch { /* ignore */ } }
      return false;
    } finally {
      if (old !== null && old !== void 0 && old.destroyed !== true) {
        this.draining++;
        try {
          old.end(() => { this.draining = Math.max(0, this.draining - 1); });
        } catch { this.draining = Math.max(0, this.draining - 1); }
      }
    }
    return true;
  }

  /** 关闭：end 当前流（收尾流由回调自行递减）。幂等，永不抛。 */
  close() {
    if (this.closed === true) return { alreadyClosed: true };
    this.closed = true;
    try {
      const stream = this.stream;
      this.stream = null;
      if (stream !== null && stream.destroyed !== true) stream.end();
      return { closed: true, draining: this.draining };
    } catch (error) {
      this.errors++;
      this.lastError = String(error?.message ?? error);
      return { closed: false, error: this.lastError };
    }
  }

  stats() {
    return {
      path: this.path,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
      maxFiles: this.maxFiles,
      hardCeilingBytes: this.hardCeilingBytes,
      written: this.written,
      dropped: this.dropped,
      clamped: this.clamped,
      rotations: this.rotations,
      truncations: this.truncations,
      errors: this.errors,
      lastError: this.lastError,
      draining: this.draining,
      closed: this.closed,
    };
  }
}
