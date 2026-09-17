/** tiny assert harness */
export let failures = 0;
export let checks = 0;
export function check(cond, label, extra = "") {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ FAIL: ${label}${extra ? ` (${extra})` : ""}`);
  } else {
    console.log(`  ✓ ok: ${label}`);
  }
}
export function summary(name) {
  console.log(`\n[${name}] ${checks - failures}/${checks} checks passed`);
  return failures === 0;
}
