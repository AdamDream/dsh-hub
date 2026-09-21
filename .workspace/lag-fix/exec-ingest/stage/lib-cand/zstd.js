//#region lib/zstd.js
/**
 * Multi-frame Zstandard decoding for dsh session logs (AUDIT U04 / B1).
 *
 * dsh session artifacts (`~/.dsh/sessions/…/session.jsonl.zstd`) are NOT a
 * single zstd stream: the host (`@deepseek-ai/dsh-session-persistence-jsonl`)
 * appends one independently-compressed frame per durable event batch, so the
 * file is a concatenation of zstd frames. `zstdDecompressSync(整文件)` only
 * yields the FIRST frame (a few hundred bytes); correct decoding requires a
 * structural frame scan followed by per-frame decompression.
 *
 * The scan algorithm below is a faithful port of the host's
 * `scanZstdFrames(buffer)` (structure-identical, self-written): parse the
 * frame magic, frame-header descriptor, then the block-header loop, and return
 * every structurally complete frame range. A torn final frame (the writer may
 * be mid-append) yields `tornStart` instead of throwing; structurally corrupt
 * complete frames throw and are the caller's (U06) sync_state fingerprint
 * error path.
 *
 * Magic note: the frame magic is bytes 28 B5 2F FD; read via `readUInt32LE`
 * that is 0xFD2FB528 = 4247762216 (the host constant).
 * @module dsh-usage/zstd
 */

import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

/** Frame magic as readUInt32LE — `0x28B52FFD` little-endian. */
const ZSTD_MAGIC = 4247762216;

/**
 * Locate complete zstd frames without decompressing their blocks. Invalid
 * complete structure rejects; EOF inside the final frame returns its start as
 * `tornStart` (silently skipped by the caller).
 * @param {Buffer} buffer - complete bytes currently present in the artifact.
 * @returns {{frames: Array<{start: number, end: number}>, tornStart?: number}}
 *   complete frame ranges and an optional incomplete-final-frame start.
 */
export function scanZstdFrames(buffer) {
	const frames = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4) {
			return { frames, tornStart: start };
		}
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
			throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`);
		}
		offset += 4;
		if (offset === buffer.length) {
			return { frames, tornStart: start };
		}
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		if ((descriptor & 24) !== 0) {
			throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`);
		}
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
		const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		if (buffer.length - offset < remainingHeaderBytes) {
			return { frames, tornStart: start };
		}
		offset += remainingHeaderBytes;
		for (;;) {
			if (buffer.length - offset < 3) {
				return { frames, tornStart: start };
			}
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = (blockHeader >>> 1) & 3;
			const blockSize = blockHeader >>> 3;
			if (blockType === 3) {
				throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`);
			}
			const payloadBytes = blockType === 1 ? 1 : blockSize;
			if (buffer.length - offset < payloadBytes) {
				return { frames, tornStart: start };
			}
			offset += payloadBytes;
			if (lastBlock) break;
		}
		if (checksum) {
			if (buffer.length - offset < 4) {
				return { frames, tornStart: start };
			}
			offset += 4;
		}
		frames.push({ start, end: offset });
	}
	return { frames };
}

/**
 * Decode a buffer of concatenated zstd frames into plaintext.
 * @param {Buffer} buffer - complete file bytes.
 * @returns {{text: string, completeBytes: number, tornStart?: number}}
 *   concatenated UTF-8 plaintext of every complete frame; `completeBytes` =
 *   end offset of the last complete frame (the byte cursor for incremental
 *   reads); `tornStart` when a final frame was structurally incomplete.
 */
export function decodeZstdBuffer(buffer) {
	const { frames, tornStart } = scanZstdFrames(buffer);
	const parts = [];
	for (const frame of frames) {
		parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)));
	}
	const completeBytes = frames.length > 0 ? frames[frames.length - 1].end : 0;
	return {
		text: Buffer.concat(parts).toString("utf8"),
		completeBytes,
		tornStart,
	};
}

/**
 * Read + decode one dsh session artifact file (AUDIT U04).
 * @param {string} filePath - absolute path to `session.jsonl.zstd`.
 * @returns {{text: string, completeBytes: number, tornStart?: number}}
 */
export function decodeSessionFile(filePath) {
	return decodeZstdBuffer(readFileSync(filePath));
}

/**
 * Split decoded plaintext into JSON lines (blank lines dropped).
 * @param {string} text - concatenated frame plaintext.
 * @returns {string[]}
 */
export function splitJsonLines(text) {
	return text.split("\n").filter((line) => line.trim().length > 0);
}
//#endregion
