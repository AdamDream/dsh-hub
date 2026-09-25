// 复刻 dsh-tool-skill/lib/index.js:338-341 catalogDescription 的归一化与计量
function catalogDescription(value, maxLength) {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return { normalized, len: normalized.length,
    out: normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`,
    truncated: normalized.length > maxLength };
}
const cands = JSON.parse(process.argv[2]);
for (const [i, c] of cands.entries()) {
  const r = catalogDescription(c, 500);
  console.log(`--- 候选${i + 1}: len=${r.len} ${r.truncated ? "❌超限" : "✅合格"}`);
  console.log(`   wc -m(字符)=${[...r.normalized].length}  wc -c(字节)=${Buffer.byteLength(r.normalized)}`);
  if (r.truncated) console.log(`   实际发布(截断后): ${r.out}`);
}
