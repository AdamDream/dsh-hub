# policy-research-sources.md — sources & confidence ledger

Companion to `../proof/rollback-steps.md`. Host: Ubuntu 24.04, uid 1001, Firefox 155.0.1 (snap rev 8863),
Chrome 153.0.8010.52. Investigation date 2026-09-22.

## METHOD NOTE — read this first (important)

`web_search` is **BROKEN in this session** — every call failed with *"An active OpenCode Go subscription
is required to use Go models."* It was never a source for this research, so **no claim below rests on a
`web_search` result.**

Instead, two evidence bases were used:
1. **LOCAL ARTIFACTS (primary, and stronger).** Files read directly on this host — the shipped
   `omni.ja` payload's own JS/markup/FTL, shipped `greprefs.js`, locally installed man pages,
   `systemctl --user show-environment`, `dpkg -V`, `/proc` attributes. These are *the actual software and
   configuration this machine runs*, not documentation about some version.
2. **URLs fetched with `curl`** (HTTP 200, bodies inspected). The `web_search` tool being down does not
   affect `curl`; these fetches succeeded and their content was read.

**Per your instruction, every claim below carries an explicit confidence tag:**

| Tag | Meaning |
|---|---|
| **[LOCAL]** | Established from a file/command **on this host**. Highest confidence; independently reproducible by you. |
| **[URL]** | Established from a URL fetched with `curl` in this session (200 + content read). **Independently corroborated by [LOCAL]** where noted. |
| **[URL-ONLY]** | From a fetched URL but **not** corroborated locally. If you require local-only grounding, treat as **INCONCLUSIVE (web-derived, not locally verifiable)**. |
| **[INCONCLUSIVE]** | Not established. Explicitly flagged; no guess is offered. |

> **Bottom line on confidence:** the load-bearing claims — the `force_disabled` default, its three
> values, the "no restart" behaviour, the `about:support` row names and the exact properties they read,
> the absence of any `policies.json`, and the whole environment delivery path — are all **[LOCAL]**.
> The claims that remain **[URL-ONLY]** are peripheral (the a11y-vs-env precedence ordering in the C++
> source, the Chromium variable list, SUMO's section list) and are flagged as such.

---

## 1. `accessibility.force_disabled` — shipped default **[LOCAL]**

**Primary local evidence** — the preference as actually shipped in the payload being run:

```
$ unzip -p /snap/firefox/8863/usr/lib/firefox/omni.ja greprefs.js | grep -n accessibility
220:pref("accessibility.force_disabled", 0);
```

`greprefs.js` is the built default-preference file. **The shipped default on this machine is `0`.**

Related lines extracted from the same file (shipped defaults, for reference):
`accessibility.warn_on_browsewithcaret=true`, `accessibility.browsewithcaret_shortcut.enabled=true`,
`accessibility.typeaheadfind=true`, `…manual=true`, `…timeout=4000`.

**Build-provenance cross-check:** `greprefs.js` carries preprocessor markers `//@line 439/443/455/459/461
"$SRCDIR/modules/libpref/init/all.js"`, and `accessibility.force_disabled` sits between the `//@line 461`
marker and the next one. So the file you are reading is the compiled form of Mozilla's
`modules/libpref/init/all.js`, and its line numbers are the *generated* ones, not the source ones.

- **[URL] Semantic prose (the three values + the "no restart" sentence)** — Mozilla `all.js` comment block:
  https://searchfox.org/firefox-main/source/modules/libpref/init/all.js#461 (pref at `#470`).
  **Not reproducible locally**, because **`greprefs.js` strips comments** — the shipped file contains only
  the `pref(...)` lines (verified: the `//@line` markers survive, the prose does not). Therefore the
  *prose definitions* of `-1 / 0 / 1` and the *"picked up without a restart"* statement are
  **[URL-ONLY]**.
  → **INCONCLUSIVE (web-derived, not locally verifiable):** the exact wording of the three value
  semantics and the explicit live-pref sentence. The **value of the default (`0`) and the existence of the
  pref are [LOCAL] and certain.**

- **[URL-ONLY] The three discrete states** — `accessible/base/Platform.h` enum
  `ePlatformIsForceEnabled=-1, ePlatformIsEnabled=0, ePlatformIsDisabled=1`:
  https://searchfox.org/firefox-main/source/accessible/base/Platform.h#28
  → supports "only three meaningful values exist; values are clamped", but **INCONCLUSIVE** as to
  local verification (enum is compiled into `libxul.so`, not readable as text — only the *pref name*
  string was confirmed present there by `strings`).

- **[URL-ONLY] Live behaviour implementation** — `nsAccessibilityService.cpp#2317` (`PrefChanged`:
  `ePlatformIsDisabled` → `accService->Shutdown()`), observer registration at `#2268`, clamp in
  `ReadPlatformDisabledState` at `#2305`:
  https://searchfox.org/firefox-main/source/accessible/base/nsAccessibilityService.cpp#2317
  → **INCONCLUSIVE** locally (C++ not present in the payload as text). *Behaviour* can be confirmed
  empirically by the user via runbook step 7 (set `1`, watch **Activated** flip without a restart) —
  that empirical check is the locally-verifiable substitute for this citation.

## 2. Does `force_disabled=1` win over an exported `GNOME_ACCESSIBILITY=1`?

- **[URL-ONLY, and the single most important unverified claim]** `a11y::ShouldA11yBeEnabled()` checks the
  force-disabled state **before** reading the environment: pref check at
  https://searchfox.org/firefox-main/source/accessible/atk/Platform.cpp#232 (returns `false` for
  `ePlatformIsDisabled` at line 234), env read at `#242`, `sAccEnv = "GNOME_ACCESSIBILITY"` declared at
  `#151`. Gate that skips loading the ATK bridge: `a11y::PlatformInit()` at `#76`.
  → **INCONCLUSIVE (web-derived, not locally verifiable).** I **cannot** prove the ordering from local
  artifacts: the logic is compiled into `libxul.so` and I have no decompiler, and I must not guess.
  **What IS [LOCAL]:** the string `GNOME_ACCESSIBILITY` **is** present in the shipped
  `libxul.so` (so Gecko does reference that exact variable), and `accessibility.force_disabled` **is**
  present as a literal. The *precedence* between them is not locally established.
  → **The runbook therefore treats this as a hypothesis to be confirmed empirically by step 7, not as an
  established fact.** Do not rely on the pref winning until you have watched **Activated** flip.

## 3. `about:support` — Accessibility section, exact properties **[LOCAL]**

All of the following was extracted from the **shipped payload on this host**. Use `unzip -l` / `unzip -p`
against `/snap/firefox/8863/usr/lib/firefox/omni.ja`.

**Where the files are (they are in the *toolkit* omni.ja — the one directly under `.../firefox/`, NOT the
`browser/` one):**
```
$ unzip -l /snap/firefox/8863/usr/lib/firefox/omni.ja | grep -iE "aboutSupport|Troubleshoot"
   15364  localization/en-US/toolkit/about/aboutSupport.ftl
   36507  modules/Troubleshoot.sys.mjs
   68334  chrome/toolkit/content/global/aboutSupport.js
   27449  chrome/toolkit/content/global/aboutSupport.xhtml
```

**(a) What Firefox actually reads — `modules/Troubleshoot.sys.mjs` lines 922-933 [LOCAL]:**
```js
  accessibility: function accessibility(done) {
    let data = {};
    data.isActive = Services.appinfo.accessibilityEnabled;
    // eslint-disable-next-line mozilla/use-default-preference-values
    try {
      data.forceDisabled = Services.prefs.getIntPref(
        "accessibility.force_disabled"
      );
    } catch (e) {}
    data.instantiator = Services.appinfo.accessibilityInstantiator;
    done(data);
  },
```
So exactly three properties: `Services.appinfo.accessibilityEnabled`,
`Services.prefs.getIntPref("accessibility.force_disabled")`, `Services.appinfo.accessibilityInstantiator`.

**(b) How they are rendered — `chrome/toolkit/content/global/aboutSupport.js` lines 1467-1476 [LOCAL]:**
```js
  accessibility(data) {
    $("a11y-activated").textContent = data.isActive;
    $("a11y-force-disabled").textContent = data.forceDisabled || 0;

    const instantiator = data.instantiator;
    if (instantiator) {
      $("a11y-instantiator").hidden = false;
      $("a11y-instantiator").querySelector("td").textContent = instantiator;
    }
  },
```
Note `data.forceDisabled || 0` — an unset/failed pref renders as **`0`**.

**(c) The section's markup — `chrome/toolkit/content/global/aboutSupport.xhtml` lines 665-682 [LOCAL]:**
```html
      <h2 class="major-section" id="a11y" data-l10n-id="a11y-title"/>

      <table>
        <tbody>
          <tr>
            <th class="column" data-l10n-id="a11y-activated"/>
            <td id="a11y-activated">
            </td>
          </tr>
          <tr>
            <th class="column" data-l10n-id="a11y-force-disabled"/>
            <td id="a11y-force-disabled">
            </td>
          </tr>
        </tbody>
      </table>
```
**The static table has exactly TWO rows.** The instantiator row is not even in the markup — it is created
conditionally by the JS in (b).

**(d) The exact on-screen labels — `localization/en-US/toolkit/about/aboutSupport.ftl` lines 121-125 [LOCAL]:**
```
121:a11y-title = Accessibility
122:a11y-activated = Activated
123:a11y-force-disabled = Prevent Accessibility
124:a11y-handler-used = Accessible Handler Used
125:a11y-instantiator = Accessibility Instantiator
```
**Therefore, on this machine's Firefox 155.0.1, the Accessibility section shows exactly two rows,
labelled "Activated" and "Prevent Accessibility".** (A third row, "Accessibility Instantiator", would
appear only if `Services.appinfo.accessibilityInstantiator` were truthy.)

> **This resolves the previously-INCONCLUSIVE item.** My earlier draft flagged the row wording as
> unverified. It is now **[LOCAL] and certain**: the strings come from the payload being executed, not
> from documentation or memory.

- **[URL-ONLY, now redundant]** SUMO's section list (confirms an "Accessibility" section exists, does
  **not** name its rows): https://support.mozilla.org/en-US/kb/use-troubleshooting-information-page-fix-firefox
  (read via https://web.archive.org/web/20260720221302/… because support.mozilla.org serves a JS
  challenge to `curl`). Superseded by §3(d) above; no claim now depends on it.

- **[INCONCLUSIVE]** Whether the instantiator is *always* empty on Linux. Locally I can only show that
  the row is hidden when the value is falsy and that the l10n string exists. A `[URL]` source
  (`nsIXULRuntime.idl#254`, `accessible/base/Platform.h#68` `#if defined(XP_WIN)`) suggests Windows-only,
  but that is **[URL-ONLY]** → **INCONCLUSIVE**. Practical impact: none for this runbook, since the
  Linux-relevant rows are the two in (c)/(d).

## 4. Enterprise policy (`policies.json`) — **[LOCAL], and negative**

Every candidate path was tested with `ls`/`find` on this host:
```
/snap/firefox/8863/usr/lib/firefox/distribution/policies.json    absent
/snap/firefox/8863/usr/lib/firefox/browser/distribution/policies.json  absent
/etc/firefox/policies/policies.json                             absent
/etc/firefox/policies/                                          absent (directory does not exist)
/var/snap/firefox/common/policies.json                          absent
/var/snap/firefox/current/policies.json                         absent
$ find /snap/firefox/8863 -name 'policies.json'      -> (nothing)
```
The snap **does** have a `distribution/` directory, but it contains only `distribution.ini` (397 B),
`extensions/`, and `searchplugins/` — **no policy file**:
```
$ ls -la /snap/firefox/8863/usr/lib/firefox/distribution/
distribution.ini   extensions/   searchplugins/
```

**Conclusion [LOCAL]:** **no local `policies.json` exists on this host**, in the snap payload or in any
system location. Nothing local is locking `accessibility.force_disabled`. The authoritative live check
remains the user's own `about:policies` (runbook step 4).

- **[URL-ONLY]** Linux policy locations (`firefox/distribution`, or system-wide `/etc/firefox/policies`):
  https://mozilla.github.io/policy-templates/
- **[URL-ONLY]** The `Preferences` policy, its `Status: default|user|locked|clear` values, the supported
  `accessibility.` prefix, and the fact that Mozilla's own worked example is
  `"accessibility.force_disabled": {"Value": 1, ...}`:
  https://firefox-admin-docs.mozilla.org/reference/policies/preferences/
  → **INCONCLUSIVE (web-derived)**: I cannot locally prove that a hypothetical future policy would lock
  this pref. The runbook handles it defensively (it says: check `about:policies`; if a policy is active,
  treat as not user-revertible).

## 5. Environment delivery path — **[LOCAL]** (see `env-delivery-path.md` for full detail)

- **`environment.d(5)` local man page** (`/usr/share/man/man5/environment.d.5.gz`, systemd 255):
  quotes `/etc/environment` in its SYNOPSIS, states *"For backwards compatibility, a symlink to
  `/etc/environment` is installed, so this file is also parsed"*, and that these files are *"passed to
  services started by the systemd user instance."* **[LOCAL]**
- **The symlink exists and is byte-identical to `/etc/environment`:**
  `/usr/lib/environment.d/99-environment.conf -> /etc/environment`; `diff` reports IDENTICAL. **[LOCAL]**
- **`systemctl --user show-environment`** (unprivileged) exports `ACCESSIBILITY_ENABLED=1`,
  `GNOME_ACCESSIBILITY=1`, `GTK_MODULES=gail:atk-bridge`, `QT_ACCESSIBILITY=1`. **[LOCAL]**
- **`/usr/bin/firefox` line 72 hardcodes `GNOME_ACCESSIBILITY=1`** before `exec /snap/bin/firefox`, and
  `dpkg -V firefox` reports `??5??????  /usr/bin/firefox` (md5 mismatch → modified after install). The
  snap's own `firefox.launcher` sets none of these variables. **[LOCAL]**
- **`pam_env`** is `required` in `/etc/pam.d/gdm-launch-environment`, `gdm-password`, `login`. **[LOCAL]**
- **Provably NOT the path:** `~/.config/environment.d/` (does not exist), `/var/lib/snapd/environment/`
  (empty directory), `~/.config/gtk-3.0/settings.ini` (does not exist; system one has no `gtk-modules=`
  key), systemd user unit drop-ins (none), `/etc/profile.d/*a11y*` (none). **[LOCAL]**
- **[INCONCLUSIVE]** Which hop — systemd-environment-d-generator or PAM — put the variables into the
  running `systemd --user` instance. `/proc/3736/environ` is `Permission denied` (`ptrace_scope=1`, mode
  `0400` yet unreadable for an unrelated same-uid process). Both mechanisms read the same file, so the
  *source* is certain and the *last hop* is not. No claim depends on it.

## 6. Browser asymmetry: Chrome reads `ACCESSIBILITY_ENABLED`, Firefox does not — **[LOCAL] + [URL-ONLY]**

- **[LOCAL]** `strings` comparison on this host's binaries:
  `/snap/firefox/8863/usr/lib/firefox/libxul.so` contains `GNOME_ACCESSIBILITY`,
  `accessibility.force_disabled`, `atk_bridge_adaptor_init`; **does not** contain `GTK_MODULES` or
  `ACCESSIBILITY_ENABLED`. `/opt/google/chrome/chrome` **does** contain `ACCESSIBILITY_ENABLED`,
  `GNOME_ACCESSIBILITY`, `QT_ACCESSIBILITY`, `org.a11y.Bus`.
  (Independently reproduced in `ff_binary_env_strings.txt` TABLE 1a vs 1b, produced by another worker
  on this host — no contradiction.)
  Caveat: absence of a literal is strong but circumstantial evidence, not proof.
- **[URL-ONLY]** Chromium's `AtkUtilAuraLinux::ShouldEnableAccessibility()` and its three-variable list
  (`ACCESSIBILITY_ENABLED`, `GNOME_ACCESSIBILITY`, `QT_ACCESSIBILITY`), returning on the first exact
  `"1"`/`"0"`:
  https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/accessibility/platform/atk_util_auralinux.cc#125
  → **INCONCLUSIVE (web-derived)**: not locally verifiable (compiled into the Chrome binary). The
  **[LOCAL]** fact that the string `ACCESSIBILITY_ENABLED` exists in the Chrome binary and not in
  `libxul.so` is the locally-verifiable core of the claim.
- **[URL-ONLY]** Chromium's own statement that *"Accessibility support can have a negative impact on
  performance"*:
  https://chromium.googlesource.com/chromium/src/+/main/docs/accessibility/browser/perf.md
  → a general statement about Chromium, **not** a measurement on this host → **INCONCLUSIVE** as
  evidence about *this* machine's lag.

## 7. `/proc/<pid>/environ` is not obtainable here — **[LOCAL]**

`/proc/9042/environ` is mode `0400`, owner uid 1001 (the same uid), yet `cat` returns `Permission denied`.
`/proc/9042/attr/current` = `snap.firefox.firefox (enforce)` vs shell `unconfined`;
`/proc/sys/kernel/yama/ptrace_scope` = `1`. Control: `/proc/self/environ` reads fine; same denial for
`/proc/3736/environ` and `/proc/9042/fd/*`. Per your instruction this is reported as **not obtainable**
rather than guessed at.

## 8. Consolidated INCONCLUSIVE list

| # | Item | Why | Does it block the runbook? |
|---|---|---|---|
| 1 | Prose definitions of `-1/0/1` and the "no restart" sentence | `greprefs.js` strips comments → **[URL-ONLY]** | No — the *default `0`* and pref existence are **[LOCAL]**; behaviour is confirmed empirically by step 7 |
| 2 | `ShouldA11yBeEnabled()` check *ordering* (pref beats env) | C++ compiled into `libxul.so`; no decompiler | **Partly** — step 7 is designed to confirm or falsify it empirically |
| 3 | `accessibilityInstantiator` always empty on Linux | Only the `[URL]` `XP_WIN` guard suggests it | No — the two visible rows are what matter |
| 4 | Policy-lock behaviour for a hypothetical future `policies.json` | No policy file exists locally to test | No — step 4 checks `about:policies` live |
| 5 | Which hop (systemd generator vs PAM) delivered into `systemd --user` | `/proc/3736/environ` unreadable | No — the source file is settled |
| 6 | Chromium's exact var-precedence logic | Compiled into the Chrome binary | No — the Chrome test in step 6b is empirical |
| 7 | SUMO's row list | SUMO never listed rows; now moot | No — superseded by **[LOCAL]** §3 |
| 8 | Whether any Chrome switch forces a11y off against `ACCESSIBILITY_ENABLED=1` | Not investigated to a conclusion | No — step 6b is a verify-don't-assume test |

## 9. What would falsify the "environment forces the a11y tree" hypothesis

Unchanged in substance, and each test is **[LOCAL]**-checkable:
1. `about:support` → **Activated** = `false` while `GNOME_ACCESSIBILITY=1` is demonstrably inherited
   (`systemctl --user show-environment`) → environment is not activating the tree.
2. Firefox PID absent from `/run/user/1001/at-spi/bus_1` (peer→PID via `GetConnectionUnixProcessID`) →
   no AT-SPI tree exists.
3. Step 6 (bypassing the `/usr/bin/firefox` hardcode via `/snap/bin/firefox`) still shows
   **Activated** = `true` → something other than the environment drives activation.
4. Step 7 flips **Activated** to `false` but the lag is unchanged → **the a11y tree is real but is not
   the bottleneck.** The most important falsifier.
5. The Firefox lever works but the Chrome lag is unchanged (or vice versa) → two separate hypotheses;
   the two browsers do not read the same variables.
