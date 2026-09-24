/*
 * png-read.mjs — minimal, dependency-free PNG decoder (8-bit, non-interlaced).
 *
 * WHY: neither `pngjs` nor `sharp` is importable from
 * /home/CNS2026495165/playwright_scratch/node_modules (only playwright +
 * playwright-core are installed there), so the pixel diff decodes PNG itself:
 * chunk walk -> zlib.inflateSync(IDAT) -> per-scanline unfilter (types 0..4) ->
 * RGBA8. Interlaced / 16-bit / palette PNGs are rejected loudly instead of being
 * silently mis-decoded.
 */
import zlib from 'node:zlib';

export function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG (bad signature)');
  let off = 8, ihdr = null, interlace = 0;
  const idat = [];
  let plte = null, trns = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], compression: data[10], filter: data[11], interlace: data[12],
      };
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  if (interlace !== 0) throw new Error(`interlaced PNG unsupported (interlace=${interlace})`);
  if (ihdr.bitDepth !== 8) throw new Error(`bitDepth ${ihdr.bitDepth} unsupported (expected 8)`);
  const { width, height, colorType } = ihdr;
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!bpp) throw new Error(`colorType ${colorType} unsupported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  if (raw.length < (stride + 1) * height) throw new Error(`IDAT too short: ${raw.length} < ${(stride + 1) * height}`);

  const out = Buffer.allocUnsafe(stride * height);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[rp++];
    const cur = rp;          // index into `raw`  (filtered bytes, +1 filter byte per row)
    const o = y * stride;    // index into `out`  (unfiltered, no filter bytes)
    const prev = o - stride; // previous row IN OUT COORDINATES (raw rows are shifted by y+1)
    if (ft === 0) {
      raw.copy(out, o, cur, cur + stride);
    } else if (ft === 1) {
      for (let x = 0; x < stride; x++) out[o + x] = (raw[cur + x] + (x >= bpp ? out[o + x - bpp] : 0)) & 0xff;
    } else if (ft === 2) {
      for (let x = 0; x < stride; x++) out[o + x] = (raw[cur + x] + (y > 0 ? out[prev + x] : 0)) & 0xff;
    } else if (ft === 3) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? out[o + x - bpp] : 0;
        const b = y > 0 ? out[prev + x] : 0;
        out[o + x] = (raw[cur + x] + ((a + b) >> 1)) & 0xff;
      }
    } else if (ft === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? out[o + x - bpp] : 0;
        const b = y > 0 ? out[prev + x] : 0;
        const c = (x >= bpp && y > 0) ? out[prev + x - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        out[o + x] = (raw[cur + x] + pr) & 0xff;
      }
    } else throw new Error(`bad filter type ${ft} at row ${y}`);
    rp += stride;
  }

  // ---- expand to RGBA8 (rows are independent scanlines, no row padding at 8-bit)
  const rgba = Buffer.allocUnsafe(width * height * 4);
  if (colorType === 6) {
    out.copy(rgba);
  } else if (colorType === 2) {
    for (let i = 0, j = 0; i < width * height; i++) { rgba[j++] = out[i * 3]; rgba[j++] = out[i * 3 + 1]; rgba[j++] = out[i * 3 + 2]; rgba[j++] = 255; }
  } else if (colorType === 0) {
    for (let i = 0, j = 0; i < width * height; i++) { const g = out[i]; rgba[j++] = g; rgba[j++] = g; rgba[j++] = g; rgba[j++] = 255; }
  } else if (colorType === 4) {
    for (let i = 0, j = 0; i < width * height; i++) { const g = out[i * 2]; rgba[j++] = g; rgba[j++] = g; rgba[j++] = g; rgba[j++] = out[i * 2 + 1]; }
  } else if (colorType === 3) {
    if (!plte) throw new Error('palette PNG without PLTE');
    for (let i = 0, j = 0; i < width * height; i++) {
      const p = out[i] * 3;
      rgba[j++] = plte[p]; rgba[j++] = plte[p + 1]; rgba[j++] = plte[p + 2];
      rgba[j++] = trns && out[i] < trns.length ? trns[out[i]] : 255;
    }
  }
  return { width, height, colorType, channels: 4, data: rgba };
}
