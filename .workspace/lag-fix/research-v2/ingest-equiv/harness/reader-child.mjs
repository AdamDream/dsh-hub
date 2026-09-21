import { DatabaseSync } from "node:sqlite";
const [dbPath, timeout] = process.argv.slice(2);
try {
	const c = new DatabaseSync(dbPath);
	if (Number(timeout) > 0) c.exec(`PRAGMA busy_timeout = ${timeout}`);
	const n = c.prepare("SELECT COUNT(*) AS c FROM usage_events").get().c;
	c.close();
	process.stdout.write(`OK c=${n} timeout=${timeout}`);
} catch (e) {
	process.stdout.write(`FAIL timeout=${timeout} code=${e.code} errcode=${e.errcode} msg=${e.message}`);
}
