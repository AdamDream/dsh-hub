/*
 * atspi.mjs — read-only AT-SPI2 accessibility-bus forensics.
 *
 * Why this is the strongest available self-proof that a *running* process has
 * its accessibility engine active: AT-SPI2 applications appear in the private
 * a11y bus registry only after the toolkit's accessibility bridge has embedded
 * the application (org.a11y.atspi.Socket.Embed).  A GTK/Gecko process that has
 * accessibility switched off never appears there at all.
 *
 * Everything here is a read-only D-Bus query against the user's existing a11y
 * bus.  It starts nothing, kills nothing, and writes nothing.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export function a11yBusAddress() {
  const uid = process.getuid();
  const dir = `/run/user/${uid}/at-spi`;
  try {
    const f = fs.readdirSync(dir).find((n) => n.startsWith('bus'));
    if (f) return `unix:path=${dir}/${f}`;
  } catch { /* fall through */ }
  const env = process.env.AT_SPI_BUS_ADDRESS;
  return env || null;
}

function dbus(address, dest, objPath, iface, method, extra = []) {
  try {
    return execFileSync('dbus-send', [
      '--print-reply', `--dest=${dest}`, objPath, `${iface}.${method}`, ...extra,
    ], { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address }, encoding: 'utf8', timeout: 8000 });
  } catch (e) {
    return `ERROR: ${(e.stderr || e.message || '').toString().trim().slice(0, 300)}`;
  }
}

/** Unique bus names registered as AT-SPI applications (registry children). */
export function registeredApps(address = a11yBusAddress()) {
  if (!address) return { address: null, apps: [], error: 'no a11y bus address' };
  const out = dbus(address, 'org.a11y.atspi.Registry', '/org/a11y/atspi/accessible/root',
    'org.a11y.atspi.Accessible', 'GetChildren');
  if (out.startsWith('ERROR')) return { address, apps: [], error: out };
  const apps = [...new Set((out.match(/string "(:1\.\d+)"/g) || []).map((s) => s.slice(8, -1)))];
  return { address, apps, error: null };
}

export function pidOfBusName(name, address = a11yBusAddress()) {
  const out = dbus(address, 'org.freedesktop.DBus', '/org/freedesktop/DBus',
    'org.freedesktop.DBus', 'GetConnectionUnixProcessID', [`string:${name}`]);
  const m = /uint32\s+(\d+)/.exec(out);
  return m ? Number(m[1]) : null;
}

/** busName for a pid currently registered as an AT-SPI app, or null. */
export function busNameForPid(pid, address = a11yBusAddress()) {
  const { apps } = registeredApps(address);
  for (const a of apps) if (pidOfBusName(a, address) === pid) return a;
  return null;
}

/**
 * Ask a registered application for its accessible root's name and role.
 * Returns null when the process is not on the bus or does not answer, which is
 * exactly the "no accessibility tree" signal we want to distinguish.
 */
export function accessibleRoot(busName, address = a11yBusAddress()) {
  /* AT-SPI2 exposes the accessible name as a D-Bus *property* (there is no
     GetName method); role and child count likewise.  ChildCount > 0 means the
     application object actually materialised a tree, not merely a bus name. */
  const name = dbus(address, busName, '/org/a11y/atspi/accessible/root',
    'org.freedesktop.DBus.Properties', 'Get', ['string:org.a11y.atspi.Accessible', 'string:Name']);
  const role = dbus(address, busName, '/org/a11y/atspi/accessible/root',
    'org.a11y.atspi.Accessible', 'GetRoleName');
  const children = dbus(address, busName, '/org/a11y/atspi/accessible/root',
    'org.freedesktop.DBus.Properties', 'Get', ['string:org.a11y.atspi.Accessible', 'string:ChildCount']);
  const clean = (s) => {
    if (s.startsWith('ERROR')) return s.slice(0, 200);
    const m = /string "(.*)"/.exec(s);
    if (m) return m[1];
    const r = /uint32\s+(\d+)/.exec(s);
    return r ? Number(r[1]) : s.trim().split('\n').pop().trim();
  };
  const cm = /int32\s+(\d+)/.exec(children);
  return { busName, name: clean(name), role: clean(role), childCount: cm ? Number(cm[1]) : null };
}

export function childPids(pid) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch { return out; }
  for (const n of names) {
    try {
      const stat = fs.readFileSync(`/proc/${n}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (ppid === pid) out.push(Number(n));
    } catch { /* raced */ }
  }
  return out;
}

/** Descendants of pid, deepest last. Read-only /proc walk (never pgrep -f). */
export function descendants(pid) {
  const acc = [];
  const walk = (p) => { for (const c of childPids(p)) { acc.push(c); walk(c); } };
  walk(pid);
  return acc;
}

export function cmdlineOf(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
  } catch { return null; }
}

export function exeOf(pid) {
  try { return fs.readlinkSync(`/proc/${pid}/exe`); } catch { return null; }
}

/** Census of every live process whose /proc/<pid>/exe is a known browser. */
export function browserCensus() {
  /* /proc/<pid>/exe is NOT readable for processes that are not our descendants
     (yama ptrace_scope=1), so the census keys on the world-readable cmdline and
     on comm, and only reports exe when the kernel lets us resolve it. */
  const out = [];
  let names = [];
  try { names = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch { return out; }
  for (const n of names) {
    const pid = Number(n);
    const cmdline = cmdlineOf(pid) || '';
    let comm = '';
    try { comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { /* raced */ }
    if (!/firefox|chrome|chromium|headless_shell|Isolated Web Co|Web Content/.test(cmdline + ' ' + comm)) continue;
    out.push({ pid, comm, exe: exeOf(pid), cmdline: cmdline.slice(0, 200) });
  }
  return out;
}


/**
 * The TRUE process environment of one of OUR OWN child processes.
 * /proc/<pid>/environ is EACCES for processes we are not an ancestor of
 * (yama ptrace_scope=1) — which is why the user's Firefox cannot be read — but
 * our own launched instance IS readable, so this is both a real measurement and
 * a negative control proving the method works and the earlier EACCES was a
 * permission boundary, not a missing file.
 */
export function procEnviron(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
    const out = {};
    for (const kv of raw.split('\0')) {
      if (!kv) continue;
      const i = kv.indexOf('=');
      if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
    }
    return { readable: true, count: Object.keys(out).length, a11y: {
      ACCESSIBILITY_ENABLED: out.ACCESSIBILITY_ENABLED ?? null,
      GNOME_ACCESSIBILITY: out.GNOME_ACCESSIBILITY ?? null,
      GTK_MODULES: out.GTK_MODULES ?? null,
      QT_ACCESSIBILITY: out.QT_ACCESSIBILITY ?? null,
    }, HOME: out.HOME ?? null, hasDisplay: !!out.DISPLAY, gsettings: out.GSETTINGS_BACKEND ?? null };
  } catch (e) {
    return { readable: false, error: e.code || String(e) };
  }
}

/**
 * Walk an application's AT-SPI accessibility tree and count its nodes.
 *
 * This is the definitionally-correct measure of "how big is the accessibility
 * tree": it is the very object graph that assistive technology traverses.  It is
 * also entirely external (read-only D-Bus), so it cannot be confounded by
 * anything the page or Gecko reports about itself.
 *
 * Bounded by both a node cap and a wall-clock cap, so a pathological tree cannot
 * hang the audit; when a cap is hit the result is reported as ">= N (capped)"
 * rather than being silently truncated.
 */
export function walkTree(busName, { maxNodes = 4000, maxMs = 45000, sampleRoles = 12 } = {}) {
  const address = a11yBusAddress();
  const t0 = Date.now();
  const ROOT = '/org/a11y/atspi/accessible/root';
  const out = { busName, nodes: 0, leafish: 0, maxDepth: 0, capped: null, roleSamples: [], errors: 0, ms: 0 };
  const queue = [[ROOT, 1]];
  const seen = new Set([ROOT]);
  while (queue.length) {
    if (out.nodes >= maxNodes) { out.capped = 'maxNodes'; break; }
    if (Date.now() - t0 > maxMs) { out.capped = 'maxMs'; break; }
    const [path, depth] = queue.shift();
    out.nodes++;
    if (depth > out.maxDepth) out.maxDepth = depth;
    if (out.nodes <= sampleRoles) {
      const r = dbus(address, busName, path, 'org.a11y.atspi.Accessible', 'GetRoleName');
      const m = /string "(.*)"/.exec(r);
      if (m) out.roleSamples.push({ depth, role: m[1] });
    }
    const kids = dbus(address, busName, path, 'org.a11y.atspi.Accessible', 'GetChildren');
    if (kids.startsWith('ERROR')) { out.errors++; continue; }
    /* GetChildren returns an array of (busName, objectPath) structs; the object
       paths are what we recurse into.  Children of this application all live on
       the same bus name. */
    const paths = [...kids.matchAll(/object path "([^"]+)"/g)].map((m) => m[1]);
    if (!paths.length) { out.leafish++; continue; }
    for (const p of paths) {
      if (seen.has(p)) continue;
      seen.add(p);
      queue.push([p, depth + 1]);
    }
  }
  out.ms = Date.now() - t0;
  return out;
}
