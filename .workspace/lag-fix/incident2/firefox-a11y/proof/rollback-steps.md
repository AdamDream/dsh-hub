# rollback-steps.md — Is the environment force-enabling Firefox's accessibility tree?

**Scope:** user-scoped, instantly revertible diagnostics on Ubuntu 24.04 / X11 / uid 1001 /
Firefox 155.0.1 (snap, rev 8863). Every step below is **read-only or user-scoped and revertible**.
Nothing here edits `/etc/environment`, `/etc/environment.d/*`, any policy file, or any root-owned
file. Nothing here restarts, kills, or launches anything on your behalf.

**The question under test:** `/etc/environment` exports `ACCESSIBILITY_ENABLED=1` and
`GNOME_ACCESSIBILITY=1`, and `/etc/environment.d/90atk-adaptor.conf` forces
`GTK_MODULES=...:gail:atk-bridge` into every session. Does that force the Gecko accessibility tree on,
and is that a real performance cost?

> **Headline local finding (step 1b):** of those three variables, **only `GNOME_ACCESSIBILITY` is read by
> Firefox.** `libxul.so` contains that literal but **not** `GTK_MODULES` and **not**
> `ACCESSIBILITY_ENABLED`. So the `GTK_MODULES` line that the original hypothesis blamed is **inert for
> Firefox** — it matters for other GTK apps, and `ACCESSIBILITY_ENABLED` matters for **Chrome**. There is
> also a **hardcoded `GNOME_ACCESSIBILITY=1` in `/usr/bin/firefox`** (step 6) that defeats the naive
> version of the A/B test.

**All commands are run by you, as your normal user, in your own terminal.**
Prefer doing the `about:*` steps first (steps 2-5) — they are pure observation.

### Confidence tags used for every step below

| Tag | Meaning |
|---|---|
| **[LOCAL]** | Grounded in a file/command **on this machine** (shipped `omni.ja`, `greprefs.js`, `systemctl --user show-environment`, `dpkg -V`, local man pages). Certain; you can reproduce it. |
| **[URL-ONLY]** | Grounded only in a source fetched over HTTP. Marked **INCONCLUSIVE (web-derived, not locally verifiable)** — must be confirmed by observation (the step says how). |
| **[INCONCLUSIVE]** | Not established. No guess is offered. |

> **Note on tooling:** the `web_search` tool is **broken in this session** (every call failed with a
> subscription error) and was never used as a source. The load-bearing facts here are **[LOCAL]**; the
> few **[URL-ONLY]** items are flagged individually and each has an empirical confirmation built into
> its step.

| Legend | Meaning |
|---|---|
| **Action** | the exact thing you do/run |
| **Expected** | what a *positive* result looks like (and what a negative one means) |
| **Revert** | how to put the machine back exactly as it was |
| **Risk** | `none` = observation only · `low` = user-scoped, revertible in seconds |
| **Source** | the citation backing the claim (see `../raw/policy-research-sources.md` for the confidence ledger, and `../raw/env-delivery-path.md` for the step 1b detail) |

---

## Step 0 — Record the baseline first (otherwise you cannot tell "fixed" from "unchanged") — **[LOCAL]**

**Action.** In your own terminal, capture the current state before touching anything:
```bash
mkdir -p ~/a11y-diag && cd ~/a11y-diag
date -Is > baseline.txt
# 1. what a NEWLY launched GUI app inherits (no root needed):
systemctl --user show-environment | grep -E 'ACCESSIBILITY|GTK_MODULES|QT_ACCESSIBILITY' >> baseline.txt
# 2. your own preferences:
{ gsettings get org.gnome.desktop.interface toolkit-accessibility
  gsettings get org.gnome.desktop.a11y.applications screen-reader-enabled; } >> baseline.txt
# 3. is the AT-SPI bus even up, and does it think a11y is on?
systemctl --user show-environment | grep -c . >> baseline.txt
gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
      --method org.freedesktop.DBus.Properties.GetAll org.a11y.Status >> baseline.txt
```
**Expected.** `systemctl --user show-environment` prints `ACCESSIBILITY_ENABLED=1`,
`GNOME_ACCESSIBILITY=1`, `GTK_MODULES=gail:atk-bridge` (and on this host also `QT_ACCESSIBILITY=1`);
both `gsettings` calls print `false`; the `GetAll` call prints
`{'IsEnabled': <false>, 'ScreenReaderEnabled': <false>}`.

> This mismatch — **env says ON, preferences and the a11y bus say OFF** — is the actual anomaly.
> It is already established on this host (see `../raw/user-browser-a11y-baseline.txt`).

**Revert.** `rm -rf ~/a11y-diag` (the directory is yours; nothing else was touched).
**Risk.** none.
**Source.** `pam_env(8)` for `/etc/environment`; host observation for the `systemctl --user` output.

> **Why `systemctl --user show-environment` and not `printenv`?** `/etc/environment` is read by the
> **PAM `pam_env` module at session setup**, not by an arbitrary already-open shell. So `printenv` in a
> terminal that did not come from a login session can legitimately differ. `systemctl --user show-environment`
> asks the systemd **user manager** — the process every GUI app on this desktop descends from — what it
> will hand to new children. ([pam_env(8)](https://man7.org/linux/man-pages/man8/pam_env.8.html)).
> The *exact* import path from PAM into the systemd user manager on this build is **INCONCLUSIVE**, but
> the *effect* is directly observable and is what matters here.

---

## Step 1 — Map the environment to your real Firefox process tree (proves it reaches Firefox) — **[LOCAL]**

**Action.**
```bash
ps -o pid=,ppid=,cmd= -C firefox | head
# then walk the parents of the Firefox PID (example uses 9042 — substitute yours):
p=$(pgrep -o -f '/snap/firefox/.*/usr/lib/firefox/firefox'); echo "firefox pid=$p"
while [ "$p" != "1" ] && [ -n "$p" ]; do ps -o pid=,ppid=,cmd= -p "$p" | cut -c1-110; p=$(ps -o ppid= -p "$p" | tr -d ' '); done
```
**Expected.** The chain is `firefox ← gnome-shell ← systemd --user ← init(1)`. Because Firefox is a
descendant of `systemd --user`, it inherits exactly the environment that step 0 printed. On this host
the observed chain is `9042 firefox ← 4139 gnome-shell ← 3736 systemd --user ← 1 init`.

**Note (important, saves you a dead end).** Do **not** try `cat /proc/<firefox-pid>/environ` or
`ls -l /proc/<firefox-pid>/fd`: on this host that returns `Permission denied`. Reason: Firefox runs
under the AppArmor profile `snap.firefox.firefox (enforce)` while your shell is `unconfined`, and
`/proc/sys/kernel/yama/ptrace_scope` is `1`. This is expected, not a fault, and it is why step 4 uses
D-Bus instead.

**Revert.** none needed (read-only).
**Risk.** none.
**Source.** host observation; `GetConnectionUnixProcessID` D-Bus method; snap/AppArmor confinement.

---

## Step 1b — Which mechanism actually delivers the variables — **[LOCAL] fully resolved**

See `../raw/env-delivery-path.md` for the full evidence. Summary:

**Active delivery paths (all confirmed on this host):**
- **A. `/etc/environment` → systemd user instance.** systemd ships the symlink
  `/usr/lib/environment.d/99-environment.conf -> /etc/environment` (byte-identical; the local
  `environment.d(5)` man page explains: *"For backwards compatibility, a symlink to `/etc/environment`
  is installed, so this file is also parsed"*, and that these are *"passed to services started by the
  systemd user instance"*). This carries `ACCESSIBILITY_ENABLED` and `GNOME_ACCESSIBILITY`.
- **B. `/etc/environment.d/*.conf`** — `90atk-adaptor.conf` → `GTK_MODULES`, `90qt-a11y.conf` →
  `QT_ACCESSIBILITY`. Delivered, but see the caveat below.
- **C. `/usr/bin/firefox` line 72 hardcodes `GNOME_ACCESSIBILITY=1`** before `exec /snap/bin/firefox`
  (and `dpkg -V` proves this file was modified after installation). Only applies to **wrapper/shell**
  launches — the GUI menu entry calls `/snap/bin/firefox` directly and never touches it.
- **D. `/etc/profile` lines 41-42** export the two variables inside a `##TEC_BEGIN##` block. Only runs
  for **login shells**; redundant with A.

**Provably NOT the delivery path:** `~/.config/environment.d/` (does not exist);
`/var/lib/snapd/environment/` (exists but is an **empty directory**); `~/.config/gtk-3.0/settings.ini`
(does not exist — and `/etc/gtk-3.0/settings.ini` has no `gtk-modules=` key); any systemd **user unit**
exporting them (no drop-ins in `~/.config/systemd/user/`); any `/etc/profile.d/*a11y*` or `*access*`
script (none exist).
`systemctl show-environment` (system scope, no root needed here) shows only `LANG` and `PATH` —
so this is **user-scope, not system-scope**.

**Which of them actually matters for Firefox [LOCAL]:** of the three variables force-fed to the session,
only **`GNOME_ACCESSIBILITY`** is read by Firefox — `libxul.so` contains that literal but **not**
`GTK_MODULES` and **not** `ACCESSIBILITY_ENABLED`. So the `90atk-adaptor.conf` GTK_MODULES line that the
hypothesis blamed is **inert for Firefox** (`GTK_MODULES` matters for other GTK apps; `ACCESSIBILITY_ENABLED`
matters for **Chrome**). See `../raw/env-delivery-path.md` §6.

**Action.** This step is descriptive — the read-only verification commands are in
`../raw/env-delivery-path.md` and in this runbook's step 0: `ls`, `cat`, `grep`,
`systemctl --user show-environment`, `man environment.d`.
**Expected.** `systemctl --user show-environment` lists `ACCESSIBILITY_ENABLED`, `GNOME_ACCESSIBILITY`,
`GTK_MODULES` (and `QT_ACCESSIBILITY`); `/usr/lib/environment.d/99-environment.conf` is a symlink to
`/etc/environment`; `/usr/bin/firefox` line 72 reads `GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"`;
`~/.config/environment.d/` does not exist.
**Revert.** none — nothing on this step changes any state.
**Risk.** none.

**Source.** **[LOCAL]** `/usr/share/man/man5/environment.d.5.gz`; the symlink and `diff`; all `/etc`
files quoted; `systemctl --user show-environment`; `strings` on both browsers' binaries.
**[INCONCLUSIVE]:** which single hop (systemd generator vs PAM) put the variables into the *running*
`systemd --user` instance — `/proc/3736/environ` is unreadable (`ptrace_scope=1`). Both read the same
file, so the *source* is certain and the last hop is not.

---

## Step 2 — `about:support`: read the **Accessibility** section — **[LOCAL] verified**

**Action.** In Firefox, open a new tab and go to `about:support` (or menu → Help → Troubleshooting
Information). Scroll to the **Accessibility** section near the bottom of the page.

**Expected — read from the payload this machine actually runs.** These are not from memory or from
documentation: they were extracted from
`/snap/firefox/8863/usr/lib/firefox/omni.ja` on this host, and the section has **exactly two rows**:

| Row label on screen | Property read in `Troubleshoot.sys.mjs` | What it means |
|---|---|---|
| **Activated** | `Services.appinfo.accessibilityEnabled` | `true` = the Gecko accessibility service **is actually running right now** (an AT-SPI tree exists and events are being fired). This is the row that matters. `false` = no a11y tree. |
| **Prevent Accessibility** | `Services.prefs.getIntPref("accessibility.force_disabled")` | The **raw integer** of the pref, rendered as `data.forceDisabled || 0`, so an unset pref shows **`0`**. |

Two further local facts that make the reading unambiguous:
- The static markup contains **only** those two rows (`aboutSupport.xhtml` lines 665-682, tbody with two `<tr>`).
- A third row, **"Accessibility Instantiator"**, is created by JS **only if** `data.instantiator` is
  truthy (`aboutSupport.js` lines 1471-1475, `$("a11y-instantiator").hidden = false`). On Linux it
  normally never appears.

So the positive finding you are looking for is: **`Activated` = `true` while `Prevent Accessibility` = `0`,
with `toolkit-accessibility` = `false`.**

**Revert.** none (pure read).
**Risk.** none.
**Source.** **[LOCAL]** shipped payload, verbatim:
```
modules/Troubleshoot.sys.mjs:922-933   -> data.isActive / data.forceDisabled / data.instantiator
chrome/toolkit/content/global/aboutSupport.js:1467-1476
chrome/toolkit/content/global/aboutSupport.xhtml:665-682
localization/en-US/toolkit/about/aboutSupport.ftl:121-125
  121:a11y-title = Accessibility
  122:a11y-activated = Activated
  123:a11y-force-disabled = Prevent Accessibility
```
Confirm the section exists per Mozilla's own docs too: [SUMO](https://support.mozilla.org/en-US/kb/use-troubleshooting-information-page-fix-firefox)
*[URL-ONLY]* — but SUMO never lists the row names, so the labels above rest on the local payload.

> **No longer INCONCLUSIVE.** An earlier draft of this runbook flagged the row wording as unverified
> because SUMO does not enumerate rows. That gap is now closed from the local payload: this machine's
> Firefox 155.0.1 shows **"Activated"** and **"Prevent Accessibility"**. If your page differs, trust the
> page and report it — but the strings above are what the shipped en-US locale contains.

---

## Step 3 — `about:config`: `accessibility.force_disabled` — **[LOCAL] default; [URL-ONLY] semantics

**Action.** Open `about:config` (accept the warning), search for `force_disabled`.

**Expected [LOCAL].** You find `accessibility.force_disabled`, and the shipped default on this machine is
**`0`** — read directly out of the payload being executed:
```
$ unzip -p /snap/firefox/8863/usr/lib/firefox/omni.ja greprefs.js | grep -n accessibility
220:pref("accessibility.force_disabled", 0);
```
In a clean profile the row shows the default and **no user-set value**. If it is already `1` or `-1`,
someone or something already changed it — stop and note that.

**Full semantics — confidence varies by sub-claim:**

| Value | Meaning | Confidence |
|---|---|---|
| `-1` | **force enable** — enable accessibility even if there is no client. On some platforms (e.g. Android) platform events can't be fired in that case, but the Gecko accessibility code still runs. | **[URL-ONLY]** |
| `0` | **auto (default)** — enable accessibility only if an accessibility client is detected. | **[URL-ONLY]** for the prose; **the default *value* `0` is [LOCAL]** |
| `1` | **force disable** — disable accessibility even if a client attempts to enable it. | **[URL-ONLY]** |

**Is it live, or does it need a restart?** Documented as **live** — *"Changes to this pref are picked up
without a restart: setting it to 1 shuts accessibility down, and setting it to -1 starts it up."* This is
**[URL-ONLY]** (**INCONCLUSIVE** as to local verification — the shipped `greprefs.js` strips comments, so
the prose is not on this machine). **However, you can settle it locally in 10 seconds:** set the pref to
`1`, do **not** restart Firefox, and watch whether **Activated** on `about:support` flips to `false`.
Step 7 does exactly that. Treat the live behaviour as *confirmed by your own observation*, not by this
citation.

**Does `1` beat an exported `GNOME_ACCESSIBILITY=1`? — INCONCLUSIVE, do not assume.**
A source path suggests it does: `a11y::ShouldA11yBeEnabled()` checks the force-disabled state *before*
reading `GNOME_ACCESSIBILITY`. But I **cannot verify the ordering from anything on this machine** — that
logic is compiled into `libxul.so` and I will not guess. **What is [LOCAL]** is weaker but real:
- the literal `GNOME_ACCESSIBILITY` **is** present in `/snap/firefox/8863/usr/lib/firefox/libxul.so`
  (so Gecko does read that exact variable), and
- the literal `accessibility.force_disabled` **is** present in the same file, and
- `GTK_MODULES` and `ACCESSIBILITY_ENABLED` are **absent** from it.

→ **Your empirical test is step 7.** If `Activated` flips to `false` with no restart, the pref does win
on this machine. If it does not flip, it does not — and that is a real, useful negative result.

**Revert.** In `about:config`, click the **reset/undo** button (⟲) on the
`accessibility.force_disabled` row to drop the user value and return to default `0`; or right-click →
*Reset*. Verify with step 2 that **Activated** returns to its previous value.
*(A pref you never changed needs no revert. Do not leave it at `1` — that disables accessibility for real.)*

**Risk.** low — a **per-user, profile-scoped** pref, reverted in one click. It does **not** touch
`/etc/environment` and needs no admin rights.
**Caveat:** if an enterprise policy locks this pref, reset will not stick — check step 4 first.

**Source.** **[LOCAL]** shipped `greprefs.js` line 220 (default = `0`); `strings` evidence on `libxul.so`.
**[URL-ONLY] / INCONCLUSIVE:** the `-1/0/1` prose and the "no restart" sentence, from Mozilla's
`modules/libpref/init/all.js` comment block
(https://searchfox.org/firefox-main/source/modules/libpref/init/all.js#461) — web-derived, not locally
verifiable, because `greprefs.js` strips comments. Behaviour to be confirmed by observation in step 7.

---

## Step 4 — Check for an enterprise policy that might lock the pref — **[LOCAL], negative**

**Action.** Re-run these read-only checks for yourself, and — most importantly — ask Firefox itself:
```bash
for f in /etc/firefox/policies/policies.json \
         /snap/firefox/8863/usr/lib/firefox/distribution/policies.json \
         /snap/firefox/8863/usr/lib/firefox/browser/distribution/policies.json \
         /var/snap/firefox/common/policies.json \
         /var/snap/firefox/current/policies.json ; do
  printf '%-62s ' "$f"; [ -e "$f" ] && echo EXISTS || echo absent; done
find /snap/firefox/8863 -name 'policies.json'      # expect: nothing
ls -la /snap/firefox/8863/usr/lib/firefox/distribution/
```
Then in Firefox open **`about:policies`** and read the **Active** tab.

**Expected (verified on this host).** All five paths **absent**; `find` returns **nothing**; the snap's
`distribution/` directory exists but holds only `distribution.ini`, `extensions/`, `searchplugins/`
(no policy file). And `about:policies` → Active should be empty.

**Conclusion [LOCAL]:** **no `policies.json` exists anywhere on this machine**, so nothing local is
locking `accessibility.force_disabled`. The pref is **yours to change and revert**.

**If instead** `about:policies` shows a `Preferences` policy touching `accessibility.force_disabled`,
then the value is **locked by IT policy**: `about:config` will refuse to change it, and step 3's revert
will not stick. **Do not fight it.** Skip step 3, keep the diagnostic value of steps 2/5/6, and raise it
with IT. (Mozilla's admin reference uses exactly this pref — value `1` — as its worked example, so this
is a realistic scenario, though no such policy exists here today.)

**Revert.** none (read-only).
**Risk.** none.
**Source.** **[LOCAL]** `ls`/`find` results above.
**[URL-ONLY] / INCONCLUSIVE:** the documented Linux policy locations (`firefox/distribution`, or
system-wide `/etc/firefox/policies`) and the `Preferences`-policy locking semantics, from
https://mozilla.github.io/policy-templates/ and
https://firefox-admin-docs.mozilla.org/reference/policies/preferences/ — web-derived; I cannot locally
test how a hypothetical policy would behave. The *absence* of any policy file is **[LOCAL]** and certain.

---

## Step 5 — Detect whether Firefox is on the AT-SPI accessibility bus (no root, no debugger) — **[LOCAL]**

This is the independent, non-`about:support` confirmation. GTK/Mutter apps export an AT-SPI tree over a
**private** D-Bus, `/run/user/1001/at-spi/bus_1` — separate from your session bus. Your user owns it, so
you can query it unprivileged.

**Action.**
```bash
ADDR="unix:path=/run/user/1001/at-spi/bus_1"
# (a) is the a11y bus alive and who thinks a11y is on?
gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
      --method org.freedesktop.DBus.Properties.GetAll org.a11y.Status
# (b) map EVERY peer on the bus to a PID, then look for Firefox's PID:
FWPID=$(pgrep -o -f '/snap/firefox/.*/usr/lib/firefox/firefox'); echo "firefox pid = $FWPID"
for n in $(dbus-send --bus="$ADDR" --print-reply --dest=org.freedesktop.DBus \
             /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null \
           | grep -o '":1\.[0-9]*"' | tr -d '"'); do
  pid=$(dbus-send --bus="$ADDR" --print-reply --dest=org.freedesktop.DBus /org/freedesktop/DBus \
          org.freedesktop.DBus.GetConnectionUnixProcessID string:$n 2>/dev/null | tail -1 | awk '{print $2}')
  [ "$pid" = "$FWPID" ] && echo ">>> FIREFOX IS ON THE A11Y BUS: $n -> pid $pid"
done
```
**Expected (verified on this host).** (a) prints
`{'IsEnabled': <false>, 'ScreenReaderEnabled': <false>}` — i.e. the a11y bus itself agrees with your
`false` preferences. The loop prints
`>>> FIREFOX IS ON THE A11Y BUS: :1.25 -> pid 9042`. **A Firefox PID appearing on this bus means Gecko
has built and is serving an accessibility tree** — the environment won, the bus/GSettings did not.

Confidence **[LOCAL]**: this was executed on this host, and `:1.25 → 9042` and `:1.59 → 303448` (Chrome)
were both observed. The mechanism claim (that a bus peer is a served a11y tree) is the interpretation,
and the *observation* is what you should rely on.

**Interpretation.**
- Firefox PID present on the a11y bus → a11y tree is live (consistent with step 2 `Activated` = `true`).
- Firefox PID **absent** → no AT-SPI tree; the environment did **not** take effect and the a11y hypothesis
  is falsified for that launch.

**Revert.** none (read-only D-Bus queries; they do not change Firefox's state).
**Risk.** none.
**Source.** **[LOCAL]** commands executed and results observed on this host; supporting mechanism
(force-disabled/env ordering in `accessible/atk/Platform.cpp`) is **[URL-ONLY] / INCONCLUSIVE** and is
not required for this step's conclusion.

---

## Step 6 — A/B test: launch Firefox **without** the environment variables (no files edited) — **[LOCAL]**

> ### ⚠ READ THIS FIRST — there is a hardcode that defeats the obvious version of this test
> `/usr/bin/firefox` is a shell wrapper, and on this machine its **last line** reads:
> ```
> 72: GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"
> ```
> The variable is set **inside the wrapper**, so `env -u GNOME_ACCESSIBILITY firefox …` does **NOT**
> remove it when `firefox` resolves to that wrapper — it gets put straight back. Worse, this file has been
> **modified after installation** by the site's management agent:
> ```
> $ dpkg -S /usr/bin/firefox      ->  firefox: /usr/bin/firefox
> $ dpkg -V firefox               ->  ??5??????   /usr/bin/firefox     (md5 mismatch = modified)
> $ md5sum /usr/bin/firefox       ->  2ee34784f247a3149b3c9a3acc4f526e
> ```
> The snap's **own** launcher is clean — `grep -E "GNOME_ACCESSIBILITY|ACCESSIBILITY|GTK_MODULES"
> /snap/firefox/8863/firefox.launcher` returns nothing.
>
> **Therefore you must call the snap entry point directly:** `/snap/bin/firefox`, not `firefox`.

**Action.** Use a throwaway profile so your real profile is untouched, and call `/snap/bin/firefox`:
```bash
/snap/bin/firefox -CreateProfile "a11ydiag $HOME/a11y-diag/profile"
env -u GNOME_ACCESSIBILITY -u ACCESSIBILITY_ENABLED -u GTK_MODULES -u QT_ACCESSIBILITY \
    /snap/bin/firefox --new-instance -P a11ydiag --no-remote
```
In that window, check **`about:support` → Accessibility → Activated** (step 2) and re-run step 5's
peer→PID mapping against the new Firefox PID.

**Expected.** If the environment is the driver: with the variables stripped, **`Activated` = `false`**
and the new Firefox PID does **not** appear on the a11y bus — while your normally-launched Firefox
profile still shows `true` / is on the bus. That contrast is the cleanest available proof.

If `Activated` is still `true` without the variables, the environment is **not** the driver — look at
`toolkit-accessibility`, the a11y bus `IsEnabled`, or an AT client/extension.

> **Why `/snap/bin/firefox` is the right entry point:** it is a symlink to `/usr/bin/snap`, i.e. the
> normal snapd launch path, and the GNOME menu entry uses it too
> (`/var/lib/snapd/desktop/applications/firefox_firefox.desktop` line 6: `Exec=/snap/bin/firefox %u`).
> So this is the same path your desktop uses — you are only removing the variables from the environment.

**Revert.** Close that window. Then remove the throwaway profile and its directory:
```bash
rm -rf "$HOME/a11y-diag/profile"
```
(`-CreateProfile` writes only inside your own `$HOME`; `about:profiles` also lists it if you prefer the UI.)

**Risk.** low — new isolated profile under `$HOME`, no system file touched, no service restarted.
Leave your existing Firefox running; `--new-instance -P a11ydiag --no-remote` keeps the two separate.
**Note:** this does **not** modify or bypass the injected wrapper — it simply avoids invoking it.
**Source.** **[LOCAL]** `/usr/bin/firefox` line 72; `dpkg -V firefox`; `/snap/firefox/8863/firefox.launcher`;
`/var/lib/snapd/desktop/applications/firefox_firefox.desktop`. See `../raw/env-delivery-path.md` §4.

---

## Step 6b — IMPORTANT: Chrome does **not** behave like Firefox here — **[LOCAL] core, [URL-ONLY] mechanism**

If the lag you are chasing also shows up in **Chrome**, do not reuse step 3 or step 7 — they are
Firefox-only. On this host `/opt/google/chrome/chrome` **does** contain the literal
`ACCESSIBILITY_ENABLED`, while Firefox's `libxul.so` does **not**. Chromium's own source shows why it
matters: `AtkUtilAuraLinux::ShouldEnableAccessibility()` iterates
`{"ACCESSIBILITY_ENABLED", "GNOME_ACCESSIBILITY", "QT_ACCESSIBILITY"}` and returns **immediately**
on the first one that is exactly `"1"` (enable) or `"0"` (disable) — so the exported
`ACCESSIBILITY_ENABLED=1` decides Chrome's answer by itself, before the a11y bus or GSettings are even
consulted. **For Chrome, the exported variable from `/etc/environment` is the direct cause**, and Chrome
has no `about:config` and no `accessibility.force_disabled` equivalent.

**Action (Chrome-side A/B, user-scoped).** Launch a throwaway Chrome profile with the variable stripped
in that process only:
```bash
google-chrome --user-data-dir="$HOME/a11y-diag/chrome-profile" \
  --no-first-run --no-default-browser-check &
# then, for the contrast run, close it and relaunch with the env neutralised IN THAT PROCESS ONLY:
env -u ACCESSIBILITY_ENABLED -u GNOME_ACCESSIBILITY -u QT_ACCESSIBILITY \
  google-chrome --user-data-dir="$HOME/a11y-diag/chrome-profile" \
  --no-first-run --no-default-browser-check &
```
Confirm the result the same way as step 5: check whether the Chrome PID is present on
`/run/user/1001/at-spi/bus_1` in each run (`dbus-send --bus=... GetConnectionUnixProcessID`). A Chrome
PID that appears in the first run and not the second is direct evidence the environment variable is
turning Chrome's a11y tree on.

**Expected.** If `ACCESSIBILITY_ENABLED=1` is the driver: the Chrome PID is on the a11y bus in run 1 and
absent in run 2, and any measured lag differs correspondingly.

**Revert.** Close the window and `rm -rf "$HOME/a11y-diag/chrome-profile"`. Nothing outside `$HOME`
changed; your normal Chrome profile and your Firefox are untouched.
**Risk.** low — throwaway profile under `$HOME`, no system file edited, no service restarted.
**Source.** Chromium
[`atk_util_auralinux.cc` lines 30-35 and 125-136](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/ui/accessibility/platform/atk_util_auralinux.cc#125);
host `strings` comparison in `../raw/ff_binary_env_strings.txt` (TABLE 1a vs TABLE 1b).
Chromium's own statement that a11y costs performance:
[Accessibility Performance Measurements](https://chromium.googlesource.com/chromium/src/+/main/docs/accessibility/browser/perf.md).

> **INCONCLUSIVE:** I did **not** establish whether any Chrome-side switch reliably *forces a11y off*
> against `ACCESSIBILITY_ENABLED=1`. Verify empirically with the throwaway profile above; do not assume
> a flag wins.

---

## Step 7 — The one-line mitigation (per-user, live, instant revert, FIREFOX ONLY) — **[LOCAL] pref; [URL-ONLY] semantics, confirm empirically

If step 2/5 confirmed the a11y tree is live and you want to measure the payoff, the single safest lever is
the pref from step 3 — **not** an edit to `/etc/environment`.

**Action.** In `about:config`, set `accessibility.force_disabled` to **`1`** and **do not restart Firefox**.
Then re-measure the lag you care about, keeping your step-0 baseline for comparison.

**Expected — and this doubles as the local test of the [URL-ONLY] semantics.** `about:support` →
**Activated** flips to **`false`** **without any restart**; the Firefox PID disappears from the
AT-SPI bus (step 5); and the measured lag/system load improves **if and only if** a11y was the cause.
If the lag does not move, the a11y tree was **not** the bottleneck — record that negative result.

> **This step is the empirical substitute for the unverifiable citation.** The claim "`1` outranks an
> exported `GNOME_ACCESSIBILITY=1`, and takes effect without a restart" is **[URL-ONLY] / INCONCLUSIVE**
> — it cannot be checked from any file on this machine. Watching **Activated** flip (or not flip) is how
> you settle it here. If it does **not** flip, the pref does not win on this build, and you should say so
> rather than assume.

**Revert.** `about:config` → reset (⟲) `accessibility.force_disabled` → back to default `0`; confirm
**Activated** returns to `true`. This restores the exact prior behaviour, because the pref was unset
beforehand.
**Risk.** low for the diagnostic, **but note**: while it is set to `1`, accessibility is genuinely off —
if any assistive tooling is actually in use (Orca, screen magnifier, speech control, an AT-dependent
extension), it **will not work** during the test. Revert immediately after measuring. Per-user only; no
admin rights; nothing outside your Firefox profile changes.

---

## Company-policy framing (read this before you change anything)

**What is per-user, reversible, and needs NO admin rights — safe to do even under an
"accessibility must remain available" IT policy, because you never remove anyone's *capability* and you
revert:**

- Steps 0, 1, 2, 4, 5 — pure observation (`about:support`, `about:policies`, `systemctl --user
  show-environment`, read-only D-Bus queries, `ps`). No state change at all.
- Step 6 — launching a *separate* Firefox instance with variables stripped, in a **throwaway profile**.
  The override exists only inside that one process; your normal Firefox and every other app keep the
  policy-mandated environment. Nothing on disk outside `$HOME` changes.
- Step 6b — the same idea for Chrome with `--user-data-dir` pointing at a throwaway profile. Also
  process-scoped and `$HOME`-scoped. (Note: on this machine Chrome is a traditional `.deb` install at
  `/opt/google/chrome/chrome` owned by `google-chrome-stable`, not a snap. `/etc/apparmor.d/chrome`
  exists, but the running Chrome process reports label `chrome (unconfined)`, whereas Firefox reports
  `snap.firefox.firefox (enforce)` — so Chrome is **not** subject to the snap/AppArmor restriction that
  blocks `/proc/<firefox-pid>/environ` reads. See step 1.)
- Step 7 — `accessibility.force_disabled` set to `1` in **your own profile**, then reverted. It is a
  user preference, not a machine setting. It is also trivially discoverable and undoable by you.
  **Firefox only — this pref does not exist in Chrome.**

**What needs IT / root — do NOT do this yourself:**

- Editing `/etc/environment` (removing `ACCESSIBILITY_ENABLED=1` / `GNOME_ACCESSIBILITY=1`) — root-owned
  system file, and it is exactly the artifact your IT policy likely *deliberately* placed. Note it is
  **doubly wired in**: `pam_env` reads it at login *and* systemd reads it through the symlink
  `/usr/lib/environment.d/99-environment.conf`. Changing it is a policy violation, not a user preference.
- Editing or adding `/etc/environment.d/*.conf`, including `90atk-adaptor.conf` — root-owned.
- Editing `/etc/profile` (the `##TEC_BEGIN##` block at lines 28-43 exports the two variables to login
  shells) — root-owned, agent-managed.
- **Editing `/usr/bin/firefox`** — root-owned, and notably it has **already been modified** from the
  packaged version (`dpkg -V firefox` → `??5??????`). Restoring or altering it fights the management
  agent and is an IT matter, not a user workaround.
- Adding a system-wide `/etc/firefox/policies/policies.json`, or changing an existing policy. Also
  pointless: a policy restores/locks the pref, it does not hand you a user-level control.
- Installing to or modifying `/snap/firefox/**`.

**One more thing worth telling IT, not fixing yourself:** the three files the same agent touched are
`/etc/environment` (2026-08-10), `/etc/profile` and `/usr/bin/firefox` (both 2026-09-22, ~5 s apart), all
carrying the same `##TEC_*##` markers. If the "accessibility must be on" policy is deliberate, the
wrapper hardcode is redundant with the environment and arguably unintentional — an IT-side question, and
your step 2/5/7 evidence is what makes the question concrete.

**The distinction to hold onto:** *a Firefox preference is per-user and one click from default; a file
under `/etc` is machine-wide, root-owned, and a change of policy.* This runbook deliberately keeps you
entirely in the first category. If your finding needs the environment changed to be fixed, that is an IT
conversation backed by your step 2/5/7 evidence — not something to do unilaterally.

---

## What would FALSIFY the "environment forces the a11y tree" hypothesis

1. **`about:support` → Accessibility → Activated = `false`** while the variables are demonstrably
   inherited (step 0/1). → The environment is not activating the Gecko a11y tree.
2. **Firefox PID absent from `/run/user/1001/at-spi/bus_1`** (step 5). → No AT-SPI tree exists to cost
   anything.
3. **Step 6 shows `Activated` still `true`** after stripping `GNOME_ACCESSIBILITY` in a fresh profile
   launched via `/snap/bin/firefox` (bypassing the `/usr/bin/firefox` hardcode). → Something other than
   the environment (an AT client, the a11y bus `IsEnabled`, `toolkit-accessibility`, or an extension) is
   driving activation.
4. **Step 7 flips `Activated` to `false` but the lag is unchanged.** → The a11y tree is real but is *not*
   the bottleneck; the cost lies elsewhere (e.g. compositing/scaling). This is the most important
   falsifier: it separates "a11y is on" from "a11y is expensive".
5. **Step 7 does not flip `Activated` at all** (with no restart) → the pref does **not** outrank the
   environment on this build, i.e. the [URL-ONLY] precedence claim is falsified for this host. That is a
   real result: it means the only remaining user-scoped lever is step 6's wrapper bypass.
6. Set `-1` (force enable) and observe no change in cost, while `1` also shows no change → a11y state is
   irrelevant to the measured degradation.
7. **The Firefox lever works but the Chrome lag is unchanged** (or the reverse). Because the two browsers
   read different variables — Firefox only `GNOME_ACCESSIBILITY`, Chrome also `ACCESSIBILITY_ENABLED` —
   a fix that works for one is not evidence about the other. Treat them as two separate hypotheses with
   two separate tests (steps 6 and 6b).

**Conversely, the hypothesis is supported (not proven) if all of these hold:** `Activated = true` while
`toolkit-accessibility = false`; Firefox PID on the a11y bus; `Activated` flips to `false` the moment
`force_disabled = 1`; and the lag improves in the same step and returns when you reset the pref.

---

## Open items / not claimed

**Resolved during the local re-grounding (no longer open):**
- ~~Exact on-screen wording of the about:support rows~~ → **RESOLVED [LOCAL]**: "Activated" and
  "Prevent Accessibility", from the shipped en-US locale in the payload this machine runs. The static
  table has exactly two rows. (See step 2.)
- ~~Death of the `policies.json` question~~ → **RESOLVED [LOCAL]**: no `policies.json` exists anywhere on
  this machine. (See step 4.)
- ~~Environment delivery mechanism unknown~~ → **RESOLVED [LOCAL]**: `/etc/environment` via systemd's
  `99-environment.conf` symlink, plus `/etc/environment.d/*.conf`, plus a TEC-injected hardcode in
  `/usr/bin/firefox`. (See step 1b and `../raw/env-delivery-path.md`.)

**Still INCONCLUSIVE, and why (`web_search` was unavailable in this session, so these were not
re-verifiable beyond a single URL fetch — and none of them is checkable from files on this machine):**
- The **prose definitions of `-1` / `0` / `1`** and the **"no restart"** statement, from Mozilla's
  `all.js` comment block. `greprefs.js` strips comments, so the prose is not present locally.
  → **INCONCLUSIVE (web-derived, not locally verifiable).** The *default value `0`* and the pref's
  existence **are [LOCAL]**. Step 7 settles the behaviour empirically.
- The **precedence of the pref over `GNOME_ACCESSIBILITY`**. The C++ is compiled into `libxul.so` and I
  will not guess from a web page. → **INCONCLUSIVE.** Step 7 and falsifier #5 turn it into an observable.
- **Which hop** (systemd-environment-d-generator vs PAM) put the variables into the running
  `systemd --user` instance. `/proc/3736/environ` is unreadable here (`ptrace_scope=1`, mode `0400` yet
  EACCES for an unrelated same-uid process) → **not obtainable**; I do not guess. The *source*
  (`/etc/environment`) is certain, the last hop is not.
- **`accessibilityInstantiator` is always empty on Linux** — only a web source (`XP_WIN` guard) suggests
  it. **INCONCLUSIVE**; does not affect the two visible rows.
- **Whether a policy-locked pref can be overridden by a user-scoped `mozilla.cfg`/autoconfig** —
  **INCONCLUSIVE**; no policy exists locally to test against. If `about:policies` shows an active policy,
  treat the pref as not user-revertible.
- **Whether `force_disabled=1` truly outranks the environment in the shipped 155 build**, and **whether
  any Chrome switch forces a11y off against `ACCESSIBILITY_ENABLED=1`** — both **INCONCLUSIVE**; steps 7
  and 6b are verify-don't-assume tests.
- `strings` evidence that `GTK_MODULES`/`ACCESSIBILITY_ENABLED` are absent from `libxul.so` is strong but
  circumstantial (absence of a literal ≠ proof nothing reads it) → high-confidence, not proof.
- **No step here verifies the *performance* claim itself.** Steps 2/5 establish a11y state; step 7 is
  where the cost question gets answered, and a negative result there is a legitimate outcome.
- Whether the running Firefox (pid 9042) was launched via the injected wrapper or the clean GUI path was
  **not** proven (would require a live launch) — but it is a `gnome-shell` child and the menu entry uses
  `/snap/bin/firefox`, so the hardcode most likely did not apply to it. **INCONCLUSIVE.**
