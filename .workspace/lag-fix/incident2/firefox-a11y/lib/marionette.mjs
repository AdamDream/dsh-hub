/*
 * marionette.mjs — minimal WebDriver/Marionette client (protocol 3) used for a
 * SECOND, in-browser self-proof of Gecko's accessibility state.
 *
 * Why chrome scope: `about:support`'s accessibility information is not readable
 * from content script, but in chrome scope we can ask Gecko directly whether the
 * accessibility service is instantiated.  In Gecko the `@mozilla.org/
 * accessibilityService;1` component is registered by a11y::PlatformInit(), which
 * only runs when the accessibility engine is actually enabled for the process
 * (pref accessibility.force_disabled / platform env).  So:
 *
 *   getService(...) returns  -> the accessibility engine IS up
 *   getService(...) throws   -> it was never initialised
 *
 * Calling getService has no side effect when the component is absent (it throws
 * NS_ERROR_FACTORY_NOT_REGISTERED), so the probe cannot itself switch
 * accessibility on.
 */
import net from 'node:net';

function frame(obj) {
  const s = JSON.stringify(obj);
  return `${Buffer.byteLength(s)}:${s}`;
}

export function marionetteReadback({ port, timeoutMs = 8000, script = null }) {
  const probe = script || `
    let out = {};
    try { out.pref_force_disabled = Services.prefs.getIntPref("accessibility.force_disabled"); /* INT pref: getBoolPref throws NS_ERROR_UNEXPECTED */ }
    catch (e) { out.pref_force_disabled_err = String(e); }
    try {
      Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService);
      out.a11yService = "REGISTERED";
    } catch (e) { out.a11yService = "ABSENT"; out.a11yServiceErr = String(e.name || e); }
    try { out.appName = Services.appinfo.name; out.appVersion = Services.appinfo.version; } catch (e) {}
    try {
      out.env = {
        ACCESSIBILITY_ENABLED: Services.env.get("ACCESSIBILITY_ENABLED"),
        GNOME_ACCESSIBILITY: Services.env.get("GNOME_ACCESSIBILITY"),
        GTK_MODULES: Services.env.get("GTK_MODULES"),
      };
    } catch (e) { out.envErr = String(e); }
    return out;
  `;

  return new Promise((resolve) => {
    const out = { port, ok: false, error: null, result: null, chromeScopeTried: true, hello: null };
    const sock = net.connect({ host: '127.0.0.1', port }, () => { /* wait for hello */ });
    let buf = '';
    let stage = 'hello';
    let msgId = 1;
    const done = (e) => {
      if (e) out.error = out.error || String(e);
      try { sock.destroy(); } catch { /* gone */ }
      resolve(out);
    };
    const timer = setTimeout(() => { out.error = out.error || 'timeout'; done(); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { out.error = e.code || e.message; clearTimeout(timer); done(); });
    sock.on('data', (chunk) => {
      buf += chunk;
      for (;;) {
        const i = buf.indexOf(':');
        if (i < 0) break;
        const len = Number(buf.slice(0, i));
        if (!Number.isFinite(len)) { clearTimeout(timer); return done('bad frame'); }
        if (buf.length < i + 1 + len) break;
        const payload = buf.slice(i + 1, i + 1 + len);
        buf = buf.slice(i + 1 + len);
        let msg = null;
        try { msg = JSON.parse(payload); } catch { /* ignore */ }
        if (stage === 'hello') {
          out.hello = msg;
          stage = 'session';
          sock.write(frame([0, msgId++, 'WebDriver:NewSession', { capabilities: {} }]));
          continue;
        }
        if (stage === 'session') {
          out.session = Array.isArray(msg) ? { error: msg[2], resultId: !!msg[3] } : msg;
          stage = 'script';
          sock.write(frame([0, msgId++, 'WebDriver:ExecuteScript', {
            script: probe, args: [], sandbox: 'system', newSandbox: false, scriptTimeout: 5000,
          }]));
          continue;
        }
        if (stage === 'script') {
          const err = Array.isArray(msg) ? msg[2] : null;
          const res = Array.isArray(msg) ? msg[3] : null;
          if (err) {
            out.error = JSON.stringify(err).slice(0, 300);
            /* retry once in content scope so we can at least tell "chrome scope
               refused" apart from "browser never came up" */
            stage = 'content';
            sock.write(frame([0, msgId++, 'WebDriver:ExecuteScript', {
              script: 'return { title: document.title, loc: location.href };',
              args: [], sandbox: null, newSandbox: true, scriptTimeout: 5000,
            }]));
            continue;
          }
          out.result = res && res.value !== undefined ? res.value : res;
          out.ok = true;
          clearTimeout(timer);
          return done();
        }
        if (stage === 'content') {
          out.contentFallback = Array.isArray(msg) ? (msg[3]?.value ?? msg[3]) : msg;
          clearTimeout(timer);
          return done();
        }
      }
    });
  });
}
