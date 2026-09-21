import fs from 'node:fs';

const p = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-theme/experiments/theme-ab.mjs';
const lines = fs.readFileSync(p, 'utf8').split('\n');
const start = lines.findIndex((l) => l.startsWith('if (has("compare")) {'));
const end = lines.findIndex((l) => l.startsWith('const { chromium } = await import(LAUNCH);'));
if (start === -1 || end === -1) { console.error('boundaries not found', start, end); process.exit(1); }

const block = `if (has("compare")) {
	/* ---------------------------------------------------------------------------
	 * Verdict logic, per the coordinator's ruling:
	 *   PRIMARY  = relative drops measured in the same conditions (machine, scenario,
	 *              window length) plus the absolute guards that do not depend on the
	 *              contaminated cpuL batch (apply/s ceiling, rafP50 sentinel, node scale,
	 *              reconcile ratio);
	 *   REFERENCE = absolute values taken from that contaminated batch. Reported, and only
	 *              enforced with --enforce-reference.
	 * ------------------------------------------------------------------------- */
	const files = argv.slice(argv.indexOf("--compare") + 1).filter((a) => !a.startsWith("--"));
	if (files.length < 2) {
		console.error("--compare needs two result files: --compare BEFORE.json AFTER.json");
		process.exit(2);
	}
	const ENFORCE_REFERENCE = argv.includes("--enforce-reference");
	const before = JSON.parse(fs.readFileSync(path.resolve(files[0]), "utf8"));
	const after = JSON.parse(fs.readFileSync(path.resolve(files[1]), "utf8"));
	const thresholds = JSON.parse(fs.readFileSync(path.join(HERE, "experiments", "thresholds.json"), "utf8"));
	const primary = thresholds.primary;
	const reference = thresholds.reference;
	/* The instance count must come from a probe run that declared itself CAPTURED. */
	const instanceProbe = (() => {
		const wanted = ["instances-before.json", "instances-after.json"];
		for (const name of wanted) {
			const f = path.join(RAW, name);
			if (!fs.existsSync(f)) continue;
			const d = JSON.parse(fs.readFileSync(f, "utf8"));
			if (d.probeVersion >= 2) return { file: name, determination: d.determination, n1: d.agreement ? d.agreement.N1_stackFunctionObjects : null, n2: d.agreement ? d.agreement.N2_metaNodesInHead : null, n3: d.agreement ? d.agreement.N3_maxBurstSize : null };
		}
		return null;
	})();

	const rows = [];
	const referenceRows = [];
	let verdict = "PASS";
	const scen = [...new Set([...before.windows.map((w) => w.scenario), ...after.windows.map((w) => w.scenario)])];
	for (const s of scen) {
		const b = before.windows.filter((w) => w.scenario === s);
		const a = after.windows.filter((w) => w.scenario === s);
		if (!b.length || !a.length) continue;
		const avg = (list, f) => list.reduce((x, w) => x + (f(w) ?? 0), 0) / list.length;
		const r3v = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
		const drop = (bef, aft) => (bef === 0 || bef == null ? null : r3v((bef - aft) / bef));
		const bNodes = avg(b, (w) => w.nodes);
		const aNodes = avg(a, (w) => w.nodes);
		const sameScale = bNodes > 0 && Math.abs(aNodes - bNodes) / bNodes <= primary.p1_nodes.maxRelativeDelta;
		const excl = [...b, ...a].every((w) => w.concurrency.gateOutcome === "EXCLUSIVE");
		const row = {
			scenario: s,
			windows: { before: b.length, after: a.length },
			gateExclusive: excl,
			nodes: { before: r3v(bNodes), after: r3v(aNodes), sameScale },
			instances: { before: avg(b, (w) => w.instances), after: avg(a, (w) => w.instances) },
			applyPerS: { before: r3v(avg(b, (w) => w.applyPerS)), after: r3v(avg(a, (w) => w.applyPerS)), drop: null },
			applyMsPerS: { before: r3v(avg(b, (w) => w.profile.applyMsPerS)), after: r3v(avg(a, (w) => w.profile.applyMsPerS)), drop: null },
			busyMsPerS: { before: r3v(avg(b, (w) => w.profile.busyMsPerS)), after: r3v(avg(a, (w) => w.profile.busyMsPerS)), drop: null },
			taskMsPerS: { before: r3v(avg(b, (w) => w.cdp.TaskMsPerS)), after: r3v(avg(a, (w) => w.cdp.TaskMsPerS)), drop: null },
			recalcOverTask: { before: r3v(avg(b, (w) => w.recalcOverTask)), after: r3v(avg(a, (w) => w.recalcOverTask)) },
			applyOverBusy: { before: r3v(avg(b, (w) => w.applyShareOfBusy)), after: r3v(avg(a, (w) => w.applyShareOfBusy)) },
			rafOver50: { before: avg(b, (w) => w.raf.intervals.over50), after: avg(a, (w) => w.raf.intervals.over50), drop: null },
			rafPerS: { before: r3v(avg(b, (w) => w.raf.perS)), after: r3v(avg(a, (w) => w.raf.perS)) },
			rafP50: { before: r3v(avg(b, (w) => w.raf.intervals.p50)), after: r3v(avg(a, (w) => w.raf.intervals.p50)) },
			rafP99: { before: r3v(avg(b, (w) => w.raf.intervals.p99)), after: r3v(avg(a, (w) => w.raf.intervals.p99)) },
			reconcileRatio: { before: r3v(avg(b, (w) => w.reconcileRatio)), after: r3v(avg(a, (w) => w.reconcileRatio)) }
		};
		row.applyPerS.drop = drop(row.applyPerS.before, row.applyPerS.after);
		row.applyMsPerS.drop = drop(row.applyMsPerS.before, row.applyMsPerS.after);
		row.busyMsPerS.drop = drop(row.busyMsPerS.before, row.busyMsPerS.after);
		row.taskMsPerS.drop = drop(row.taskMsPerS.before, row.taskMsPerS.after);
		row.rafOver50.drop = drop(row.rafOver50.before, row.rafOver50.after);

		const fails = [];
		if (!excl) fails.push("a window in this pair was not EXCLUSIVE (gateOutcome != EXCLUSIVE) => INCONCLUSIVE");
		if (!sameScale) fails.push(\`DOM node count differs by more than \${primary.p1_nodes.maxRelativeDelta * 100}% (\${row.nodes.before} -> \${row.nodes.after}) => windows are not comparable (INCONCLUSIVE)\`);
		/* P0 */
		if (row.instances.after > primary.p0_instances.mustEqual) fails.push(\`P0: concurrent presenter instances = \${row.instances.after} (must be \${primary.p0_instances.mustEqual})\`);
		if (row.applyPerS.drop !== null && row.applyPerS.drop < primary.p0_applyPerS.dropMin) fails.push(\`P0: apply/s drop \${row.applyPerS.drop} < \${primary.p0_applyPerS.dropMin}\`);
		if (!(row.applyPerS.after <= primary.p0_applyPerS.maxAbsolute)) fails.push(\`P0: apply/s \${row.applyPerS.after} > \${primary.p0_applyPerS.maxAbsolute} (absolute)\`);
		if (row.applyMsPerS.drop !== null && row.applyMsPerS.drop < primary.p1_applyMsPerS.dropMin) fails.push(\`P1: applyMs/s drop \${row.applyMsPerS.drop} < \${primary.p1_applyMsPerS.dropMin}\`);
		if (row.rafOver50.drop !== null && row.rafOver50.drop < primary.p1_rafOver50.dropMin) fails.push(\`P1: rafOver50 drop \${row.rafOver50.drop} < \${primary.p1_rafOver50.dropMin}\`);
		/* rafP50 sentinel: absolute on purpose - the "nothing broke" gate */
		if (!(row.rafP50.after <= primary.p1_rafP50.sentinelMax && row.rafP50.after >= primary.p1_rafP50.sentinelMin)) fails.push(\`rafP50 \${row.rafP50.after} outside the \${primary.p1_rafP50.sentinelMin}-\${primary.p1_rafP50.sentinelMax} sentinel band (the fix introduced or masked frame trouble)\`);
		if (!(row.reconcileRatio.after >= primary.p1_reconcileRatio.min && row.reconcileRatio.after <= primary.p1_reconcileRatio.max)) fails.push(\`reconcileRatio \${row.reconcileRatio.after} outside \${primary.p1_reconcileRatio.min}-\${primary.p1_reconcileRatio.max} (instrument is not trustworthy)\`);
		/* Instance count from a self-validated probe, when one exists */
		if (instanceProbe && instanceProbe.determination !== "CAPTURED") fails.push(\`P0: the instance probe did not declare CAPTURED (determination=\${instanceProbe.determination}) - the instance number is not evidence\`);

		row.verdict = fails.length === 0 ? "PASS" : "FAIL";
		row.failures = fails;
		if (fails.length) verdict = "FAIL";
		rows.push(row);

		/* REFERENCE items - reported, enforced only on request. */
		const refFails = [];
		if (reference.recalcOverTask.enforce && !(row.recalcOverTask.after <= reference.recalcOverTask.max)) refFails.push(\`RecalcStyle/Task \${row.recalcOverTask.after} > \${reference.recalcOverTask.max}\`);
		if (reference.applyShareOfBusy.enforce && !(row.applyOverBusy.after <= reference.applyShareOfBusy.max)) refFails.push(\`applyMs/busyMs \${row.applyOverBusy.after} > \${reference.applyShareOfBusy.max}\`);
		if (reference.rafPerS.enforce && !(row.rafPerS.after >= reference.rafPerS.min)) refFails.push(\`raf/s \${row.rafPerS.after} < \${reference.rafPerS.min}\`);
		if (reference.rafP99.enforce && !(row.rafP99.after <= reference.rafP99.max)) refFails.push(\`rafP99 \${row.rafP99.after} > \${reference.rafP99.max}\`);
		if (reference.taskMsPerS.enforce && row.taskMsPerS.drop !== null && row.taskMsPerS.drop < reference.taskMsPerS.dropMin) refFails.push(\`Task/s drop \${row.taskMsPerS.drop} < \${reference.taskMsPerS.dropMin}\`);
		referenceRows.push({ scenario: s, values: { recalcOverTask: row.recalcOverTask, applyOverBusy: row.applyOverBusy, rafPerS: row.rafPerS, rafP99: row.rafP99, taskMsPerS: row.taskMsPerS }, provenance: "cpuL (contaminated batch)", enforced: ENFORCE_REFERENCE, failures: refFails });
		if (refFails.length) verdict = "FAIL";
	}

	const out = {
		generatedAt: new Date().toISOString(),
		before: files[0],
		after: files[1],
		enforceReference: ENFORCE_REFERENCE,
		instanceProbe,
		thresholdsPrimary: primary,
		thresholdsReference: reference,
		rows,
		referenceRows,
		verdict
	};
	fs.writeFileSync(path.join(RAW, \`compare-\${LABEL}.json\`), JSON.stringify(out, null, 2) + "\\n");
	for (const row of rows) {
		console.log(\`\\n=== \${row.scenario}  \${row.verdict}\${row.gateExclusive ? "" : "  [GATE NOT EXCLUSIVE]"}\`);
		console.log(\`    nodes \${row.nodes.before} -> \${row.nodes.after} (sameScale=\${row.nodes.sameScale})\`);
		console.log(\`    instances \${row.instances.before} -> \${row.instances.after}\`);
		console.log(\`    PRIMARY apply/s \${row.applyPerS.before} -> \${row.applyPerS.after}  drop=\${row.applyPerS.drop}\`);
		console.log(\`    PRIMARY applyMs/s \${row.applyMsPerS.before} -> \${row.applyMsPerS.after}  drop=\${row.applyMsPerS.drop}\`);
		console.log(\`    PRIMARY rafOver50 \${row.rafOver50.before} -> \${row.rafOver50.after}  drop=\${row.rafOver50.drop}\`);
		console.log(\`    SENTINEL rafP50 \${row.rafP50.before} -> \${row.rafP50.after}\`);
		console.log(\`    PRIMARY reconcileRatio \${row.reconcileRatio.before} -> \${row.reconcileRatio.after}\`);
		console.log(\`    ref (contaminated baseline, \${ENFORCE_REFERENCE ? "ENFORCED" : "not enforced"}): RecalcStyle/Task \${row.recalcOverTask.before} -> \${row.recalcOverTask.after}; applyMs/busyMs \${row.applyOverBusy.before} -> \${row.applyOverBusy.after}; raf/s \${row.rafPerS.before} -> \${row.rafPerS.after}; rafP99 \${row.rafP99.before} -> \${row.rafP99.after}\`);
		for (const f of row.failures) console.log(\`    FAIL: \${f}\`);
	}
	for (const r of referenceRows) if (r.failures.length) console.log(\`\\n    REFERENCE FAIL (\${r.scenario}, enforced): \${r.failures.join("; ")}\`);
	console.log(\`\\n=== BATCH VERDICT: \${verdict} ===\`);
	console.log(\`    primary criteria: relative drops + absolute guards (apply/s ceiling, rafP50 sentinel, node scale, reconcile ratio)\`);
	console.log(\`    reference criteria from the CONTAMINATED cpuL batch: \${ENFORCE_REFERENCE ? "enforced" : "reported only (pass --enforce-reference to enforce)"}\`);
	if (instanceProbe) console.log(\`    instance probe: \${instanceProbe.file} determination=\${instanceProbe.determination} N1=\${instanceProbe.n1} N2=\${instanceProbe.n2} N3=\${instanceProbe.n3}\`);
	else console.log("    instance probe: none found in raw/ (unit (0) must not be judged from this comparison alone)");
	process.exit(verdict === "PASS" ? 0 : 2);
}

`;

const next = lines.slice(0, start).concat(block.split('\n')).concat(lines.slice(end));
fs.writeFileSync(p, next.join('\n'));
console.log('compare block replaced; file lines =', next.length);
