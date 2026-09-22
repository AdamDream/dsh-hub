# env-delivery-path.md — how the force-on variables reach a newly launched Firefox

Read-only investigation on this host, 2026-09-22. No config edited, no process restarted, no browser
launched. Every claim below is grounded in a **local artifact read on this host** (path + line quoted)
or in a **locally installed man page**. Web sources were not needed for this file.

### Confidence tags

| Tag | Meaning |
|---|---|
| **[LOCAL]** | Established from a file/command **on this host** — reproducible by you. |
| **[INCONCLUSIVE]** | Not established. Explicitly flagged; no guess offered. |

`web_search` is **broken in this session** (subscription error) and was never used here. Nothing in this
file depends on a web fetch — **it is entirely [LOCAL] except the two items marked [INCONCLUSIVE] inside
§2 and §4.** In particular, the `[URL-ONLY]` claims that carry the precedence argument in
`policy-research-sources.md` are **not** needed for any conclusion below.

**Question:** which mechanism actually delivers `ACCESSIBILITY_ENABLED=1`, `GNOME_ACCESSIBILITY=1` and
`GTK_MODULES=...:gail:atk-bridge` to a newly launched Firefox — and which candidate mechanisms are
**provably not** the path?

---

## 1. VERDICT (short)

Two independent, **both-active** delivery paths exist, plus one hardcode that bypasses both:

| # | Mechanism | Delivers | Status |
|---|---|---|---|
| **A** | **`/etc/environment` → systemd user instance**, via the systemd-shipped symlink `/usr/lib/environment.d/99-environment.conf -> /etc/environment` | `ACCESSIBILITY_ENABLED`, `GNOME_ACCESSIBILITY` | **ACTIVE — primary path to Firefox** |
| **B** | **`/etc/environment.d/*.conf` → systemd user instance** (`90atk-adaptor.conf`, `90qt-a11y.conf`) | `GTK_MODULES`, `QT_ACCESSIBILITY` | **ACTIVE** (but see §6: `GTK_MODULES` is inert for Firefox) |
| **C** | **`/usr/bin/firefox` line 72 hardcodes `GNOME_ACCESSIBILITY=1`** | `GNOME_ACCESSIBILITY` | **ACTIVE, but only for shell/wrapper launches — NOT the GUI launcher** |
| **D** | **`/etc/profile` lines 41-42** (TEC block) | `ACCESSIBILITY_ENABLED`, `GNOME_ACCESSIBILITY` | ACTIVE for **login shells only**; redundant with A |
| **E** | `~/.config/environment.d/` | — | **PROVABLY NOT the path — directory does not exist** |
| **F** | `/var/lib/snapd/environment/` | — | **PROVABLY NOT the path — directory is empty** |
| **G** | GTK `settings.ini` `gtk-modules=` | — | **PROVABLY NOT the path — no user settings.ini; system one has no such key** |
| **H** | `/snap/firefox/8863/firefox.launcher` (snap's own launcher) | — | **PROVABLY NOT the path for these vars — grep finds none** |

**Bottom line:** for a **Firefox launched from the desktop GUI**, the delivering mechanism is **A**
(systemd user instance reading `/etc/environment`). For a **Firefox launched from a shell**, both **A**
and **C** apply. The snap wrapper (**F/H**) and GTK settings (**G**) are **not** involved.

---

## 2. Mechanism A — **[LOCAL]** — `/etc/environment` reaches the systemd user instance

**Evidence 1: the symlink exists.** systemd's own `environment.d(5)` man page (installed at
`/usr/share/man/man5/environment.d.5.gz`) lists `/etc/environment` in its SYNOPSIS and states:

> *"For backwards compatibility, a symlink to `/etc/environment` is installed, so this file is also
> parsed."*

and describes the effect as:

> *"Configuration files in the environment.d/ directories contain lists of environment variable
> assignments passed to services started by the systemd user instance.
> `systemd-environment-d-generator(8)` parses them and updates the environment exported by the systemd
> user instance."*

**Evidence 2: that symlink is present on this host.**
```
$ ls -la /usr/lib/environment.d/99-environment.conf
lrwxrwxrwx 1 root root 16  7月 28 23:04 /usr/lib/environment.d/99-environment.conf -> /etc/environment
$ diff <(cat /etc/environment) <(cat /usr/lib/environment.d/99-environment.conf)
IDENTICAL content
```
So the file `/usr/lib/environment.d/99-environment.conf` whose contents are
`##TEC_BEGIN## export ACCESSIBILITY_ENABLED=1 export GNOME_ACCESSIBILITY=1 ##TEC_END##` **is literally
`/etc/environment`**, published to systemd under an `environment.d` name. It is not a second copy.

**Evidence 3: no higher-precedence `99-environment.conf` exists to override it.**
```
/etc/environment.d/99-environment.conf        (no such file)
/run/environment.d/99-environment.conf        (no such file)
/usr/local/lib/environment.d/99-environment.conf (no such file)
/usr/lib/environment.d/99-environment.conf    present (the symlink)
```
Per the same man page, precedence is `/etc/` > `/run/` > `/usr/local/lib/` > `/usr/lib/`; nothing
overrides it.

**Evidence 4: the user manager really does export them.**
```
$ systemctl --user show-environment | grep -E 'ACCESSIBILITY|GTK_MODULES|QT_ACCESS'
GTK_MODULES=gail:atk-bridge
QT_ACCESSIBILITY=1
ACCESSIBILITY_ENABLED=1
GNOME_ACCESSIBILITY=1
```
This is a **read-only, unprivileged** query (`systemctl --user`, uid 1001) — no root needed.

**Evidence 5: Firefox is downstream of that user manager.** Process ancestry of the running browser:
```
9042 firefox  <- 4139 gnome-shell <- 3736 systemd --user <- 1 init
```

**Also note a second, redundant PAM path.** `pam_env` reads `/etc/environment` at session setup. On this
host `pam_env` is `required` in the graphical-session stacks:
```
/etc/pam.d/gdm-launch-environment:7: session required  pam_env.so readenv=1
/etc/pam.d/gdm-password:21:         session required  pam_env.so readenv=1
/etc/pam.d/login:48:                session required  pam_env.so readenv=1   (console login)
```
Both A and this PAM path read the **same** `/etc/environment` file, so the variables land in the session
twice over. Removing one would not be enough — which is exactly why the runbook never touches `/etc`.

> **Caveat (INCONCLUSIVE):** I could not verify *empirically* which of the two (systemd-generator vs PAM)
> put the variables into the **running** `systemd --user` instance, because
> `/proc/3736/environ` is `Permission denied` for an unprivileged same-uid process here
> (`ptrace_scope=1`; see §5). Both mechanisms read the same file and both are configured, so the
> practical answer — "*/etc/environment* is the source" — is certain even though the last hop is not
> pinned. No claim here depends on which hop it was.

---

## 3. Mechanism B — **[LOCAL]** — `/etc/environment.d/*.conf` (the GTK/Qt block)

All `.conf` files actually present, read verbatim:
```
--- /etc/environment.d/90atk-adaptor.conf
GTK_MODULES=${GTK_MODULES:+$GTK_MODULES:}gail:atk-bridge

--- /etc/environment.d/90qt-a11y.conf
QT_ACCESSIBILITY=1

--- /etc/environment.d/90qtwebengine-dictionaries-path.conf
QTWEBENGINE_DICTIONARIES_PATH=/usr/share/hunspell-bdic/

--- /usr/lib/environment.d/990-snapd.conf
PATH=$PATH:/snap/bin
XDG_DATA_DIRS=${XDG_DATA_DIRS:-/usr/local/share/:/usr/share/}:/var/lib/snapd/desktop

--- /usr/lib/environment.d/99-environment.conf   <-- symlink to /etc/environment (mechanism A)
```
`GTK_MODULES` and `QT_ACCESSIBILITY` reach the session this way and appear in
`systemctl --user show-environment`. **But see §6 — `GTK_MODULES` does nothing for Firefox.**

There is also a legacy X11 path for the Qt variable only:
```
/etc/X11/Xsession.d/90qt-a11y:6:  QT_ACCESSIBILITY=1
/etc/X11/Xsession.d/90qt-a11y:11: dbus-update-activation-environment --verbose --systemd QT_ACCESSIBILITY
```

---

## 4. Mechanism C — the TEC-injected hardcode in `/usr/bin/firefox` — **[LOCAL]**

This is the most important local finding of the whole investigation, and it changes step 6 of the runbook.

```
$ awk 'NR==72' /usr/bin/firefox
GNOME_ACCESSIBILITY=1 exec /snap/bin/firefox "$@"
```
The distribution's Firefox wrapper script **explicitly sets `GNOME_ACCESSIBILITY=1`** and then execs the
snap. So any launch that goes through `/usr/bin/firefox` re-imposes the variable **inside the launching
process**, regardless of the caller's environment.

**Proof it is not the packaged file — it has been modified:**
```
$ dpkg -S /usr/bin/firefox
firefox: /usr/bin/firefox
$ dpkg -V firefox
??5??????   /usr/bin/firefox        <-- md5 mismatch = modified after installation
$ md5sum /usr/bin/firefox
2ee34784f247a3149b3c9a3acc4f526e  /usr/bin/firefox
```

**Proof the snap's own launcher is clean:**
```
$ grep -n -E "GNOME_ACCESSIBILITY|ACCESSIBILITY|GTK_MODULES" /snap/firefox/8863/firefox.launcher
(no output — upstream snap launcher sets none of these)
```

**Provenance — a management agent ("TEC") made three edits within ~5 seconds:**
```
2026-08-10 16:38:32  /etc/environment          (TEC block, ##TEC_BEGIN##/##TEC_END##)
2026-09-22 10:01:58  /etc/profile              (TEC block at lines 28-43)
2026-09-22 10:02:03  /usr/bin/firefox          (wrapper modified; dpkg md5 mismatch)
```
Marker `##TEC_BEGIN##` also appears in `/etc/profile`, `/etc/environment`, and in the
`/etc/.OCular/data/...` agent tree (`LAgent`, `LMonitor`, plus kernel-module blobs), and the same string
`GNOME_ACCESSIBILITY=1` occurs in those agent binaries. So the injection is attributable to that agent,
and it touched **two** files on 2026-09-22 (profile + wrapper) in addition to the earlier
`/etc/environment` edit.

> **Remaining uncertainty (INCONCLUSIVE).** The *current* Firefox (pid 9042) is a child of
> `gnome-shell`, and the GNOME menu entry uses `/snap/bin/firefox` directly, so this process most likely
> did **not** get the hardcode. I did not try to prove which path launched it (that would need a live
> launch). Also, `/var/lib/dpkg/info/firefox.md5sums` was not compared line-by-line, so I state
> "modified relative to the packaged version" on the strength of `dpkg -V` alone.

**Consequence for testing — this invalidates one specific test pattern:**
`env -u GNOME_ACCESSIBILITY firefox …` does **NOT** remove the variable if `firefox` resolves via `PATH`
to `/usr/bin/firefox`, because line 72 puts it back. The test must call the snap entry point directly:
`env -u GNOME_ACCESSIBILITY /snap/bin/firefox …`.

---

## 5. `/proc/<pid>/environ` — not obtainable for other processes here — **[LOCAL]**

```
$ ls -la /proc/9042/environ
-r-------- 1 CNS2026495165 CNS2026495165 0 ... /proc/9042/environ
$ cat /proc/9042/environ
bash: /proc/9042/environ: 权限不够  (Permission denied)
```
Mode bits look readable (owner-only) and the owner **is** uid 1001, yet the read fails. Cause:
`/proc/sys/kernel/yama/ptrace_scope = 1`, plus a cross-profile ptrace check —
`/proc/9042/attr/current` says `snap.firefox.firefox (enforce)` while the invoking shell is `unconfined`.
As a control, `/proc/self/environ` reads fine, and the same denial hits
`/proc/3736/environ` (`systemd --user`, `unconfined`) and `/proc/9042/fd/*`.

**Conclusion:** do **not** design any step around reading another process's environment. Use
`systemctl --user show-environment` (mechanism A evidence 4) instead — it is the unprivileged,
authoritative answer for "what will a newly launched app inherit".

---

## 6. Which of these actually matters FOR FIREFOX — **[LOCAL]**

Delivery is necessary but not sufficient — the variable must also be *read by Firefox*. Local binary
evidence (`raw/ff_binary_env_strings.txt`, produced independently by another worker on this host;
re-verified with `strings -a ... | grep -x`):

| Literal | In `/snap/firefox/8863/usr/lib/firefox/libxul.so` |
|---|---|
| `GNOME_ACCESSIBILITY` | **present** |
| `accessibility.force_disabled` | **present** |
| `atk_bridge_adaptor_init` | present |
| `GTK_MODULES` | **absent** |
| `ACCESSIBILITY_ENABLED` | **absent** |

So of the three variables being force-fed to the session:
- **`GNOME_ACCESSIBILITY=1`** — the one that Gecko reads. **This is the effective cause.**
- `GTK_MODULES=...:gail:atk-bridge` — **inert for Firefox.** (Mechanism B is delivered to the session but
  did not cause the Firefox a11y tree.)
- `ACCESSIBILITY_ENABLED=1` — **inert for Firefox**, but **live for Chrome**, whose binary *does* contain
  it. See `policy-research-sources.md` §6c.

Caveat: absence of a string literal in a stripped shared object is strong but circumstantial — it shows
the literal is absent, not that no other code path reads it. For Firefox the corroborating evidence is
the Gecko source path in §7 of the sources file.

---

## 7. One-line answers to the questions asked — **[LOCAL]**

- **`systemctl --user show-environment`** → yes, contains `ACCESSIBILITY_ENABLED`,
  `GNOME_ACCESSIBILITY`, `GTK_MODULES` (and `QT_ACCESSIBILITY`).
- **`~/.config/environment.d/`** → **does not exist**; not a path.
- **Snap-level override `/var/lib/snapd/environment`** → **is a directory and is empty**; not a path.
- **`/etc/profile.d/*a11y*` / `*access*`** → **none**. But `/etc/profile` itself lines 41-42 export the
  two variables (TEC block, lines 28-43). Note `/etc/profile` is a **login-shell** file, so
  non-login shells (and GUI launches) do not execute it — it is redundant with mechanism A, not the
  primary path.
- **systemd user unit exporting them** → **none**; `~/.config/systemd/user/` contains only
  `default.target.wants/` and `timers.target.wants/`, no drop-ins setting environment.
- **`systemctl show-environment` (system)** → **runs without root here** but shows only `LANG` and
  `PATH`; the accessibility variables are **not** in the system manager's environment, only in the
  **user** manager's. (So: user-scope, not system-scope.)
- **`~/.config/gtk-3.0/settings.ini`** → **does not exist**; `/etc/gtk-3.0/settings.ini` exists but has
  **no `gtk-modules=` line**. GTK settings are not a path.
- **Live session** → variables are live in this session's own environment
  (`GTK_MODULES=gail:atk-bridge GNOME_ACCESSIBILITY=1 ACCESSIBILITY_ENABLED=1`). For a process I do
  **not** own / am not related to, `/proc/<pid>/environ` is **not obtainable** (§5) — no guess offered.

---

## 8. Consequences for the runbook — **[LOCAL]**

1. **Step 6 must call `/snap/bin/firefox`, not `firefox`**, or mechanism C silently defeats the test.
2. The GUI path (`/snap/bin/firefox` via the menu entry) never applies the C hardcode, which is why the
   normal browser runs fine and only wrapper/shell launches are doubly forced.
3. Since **A, B, C and D all converge on `/etc/environment` + `/etc/environment.d` + one injected
   wrapper line**, the only *user-scoped, revertible* lever that survives all of them is Firefox's own
   `accessibility.force_disabled` pref (checked before the environment variable) — or, for a pure
   diagnostic, bypassing the wrapper as in (1). Everything that would remove the variables themselves
   requires root and is an IT/policy matter.
