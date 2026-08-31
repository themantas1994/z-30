# 🔄 Software Updates & Upstream Synchronisation

The **z-30 Amateur Radio Transceiver Suite** is developed on GitHub at
**[https://github.com/themantas1994/z-30](https://github.com/themantas1994/z-30)**.

---

## 📌 Commits, not versions

**z-30 has no release channels and no version to compare.** It is developed on `main`, and an
installation is either at the tip of `main` or some number of commits behind it. That number is
the whole of what the update mechanism reports, and `git` already tracks it exactly: a `git
fetch` and a count of the commits between `HEAD` and `origin/main`.

> **Correction (2026-08-31):** every earlier revision of this page described "two upstream
> update channels", Stable Releases and a Main Branch nightly, and the app carried a selector
> for them. Neither worked. Both the CLI updater and the web UI compared a hardcoded
> `1.0.0` against the newest release tag and the upstream `package.json` version - all three of
> which had been `1.0.0` since the repository was created - so the check answered "up to date"
> no matter how far behind the checkout was. The "development" channel compared against a
> hand-edited `CURRENT_COMMIT_SHA` that had itself gone stale. An installation two hundred
> commits behind was told it was current. Version strings nobody bumps are not version strings,
> and the channels they distinguished did not exist: there has only ever been `main`.

The version number that remains in `package.json` and `pyproject.toml` is packaging metadata.
Nothing in the update path reads it.

---

## 🖥️ 1. Updating from the app

**Click the Update button in the top navigation bar.** It shows how many commits behind
`origin/main` this installation is, lists what those commits are, and updates when you press
**Update now**.

When z-30 is started with the `z30` command, the native server is behind the page and does the
work itself:

1. `git fetch origin main` in the real checkout.
2. `git merge --ff-only origin/main`.
3. The result reports what changed, and the modal offers a reload when the interface moved.

**Fast-forward only.** The update either advances `HEAD` onto the upstream commit or refuses
and changes nothing. It cannot produce a merge commit, cannot leave a conflicted tree, and
cannot discard your work. It is refused, with the reason shown, when:

| Condition | Why |
| :--- | :--- |
| The working tree has uncommitted changes | A station that has patched its own copy is not something an Update button gets to overwrite. Commit or stash first. |
| The checkout has commits upstream does not | It cannot be fast-forwarded. Merge or rebase it by hand. |
| **The transmitter is keyed** | Replacing the served bundle and the Python sources under a running transmission, while the operator is on the air and not looking at the screen, is not something to do. Finish the slot first. |
| This is not a git checkout | A pip or distribution-package install updates through that package manager. |

The repository commits its built web bundle (`z30_dsp/web_dist/`), which is why the button
works on a station with no Node toolchain: once the fast-forward lands, the new interface is
already on disk and the browser only has to purge its caches and reload. Nothing is rebuilt by
default. When the Python package itself changed, the modal says so - restart z-30 so the server
runs the new code.

**Opened from static hosting or as a PWA with no native server behind it**, the modal can still
tell you how far behind you are - it compares the bundle's build-stamped commit against the
GitHub commits API - but it cannot update anything, says so, and gives you the one command to
run instead. The build stamp is injected by `vite.config.ts` from `git rev-parse HEAD` at build
time, so it cannot drift the way the hand-maintained constant did.

---

## ⚡ 2. Updating from the terminal (`z30 --update`)

The same `z30_dsp/git_sync` module, with a terminal front end. The button and the command can
never disagree about whether an installation is current, because they are the same code.

```bash
# Report status, then ask before fast-forwarding.
z30 --update

# Apply without asking.
z30 --update -y

# Report only, change nothing. Exits non-zero when behind, so a startup script
# or a cron job can act on it without parsing any output.
z30 --update --check

# Also refresh dependencies / rebuild the bundle from source, for a developer checkout.
z30 --update -y --reinstall
z30 --update -y --rebuild
```

Sample output:

```
==================================================================
      z-30 TRANSCEIVER - UPSTREAM SYNCHRONISATION
      https://github.com/themantas1994/z-30
==================================================================
Checking https://github.com/themantas1994/z-30 (main)...

Repository:    /home/pi/z-30
Branch:        main
Local commit:  cf06ee7
Upstream:      a91d3f2 (origin/main)

[!] 3 commits behind upstream:
      a91d3f2  fix(cat): release the pin the key actually drove
      7c1e044  feat(dsp): seed the dithered decode schedule
      2b90aa1  docs(wiki): correct the decoder schedule count

Fast-forward to a91d3f2 now? [Y/n]:
```

---

## 🔌 3. The local API

`z30_dsp/web_server.py` exposes the same information to the app over three endpoints, behind
the same token + `Origin` + `Host` triple check as every other `/api/` route (see
[13. Operating Safety, Compliance & Security](13-Operating-Safety-Compliance-&-Security.md)):

| Endpoint | Purpose |
| :--- | :--- |
| `GET /api/update/status?fetch=1` | How far behind upstream, what the pending commits are, whether a fast-forward would succeed. `fetch=0` answers from the last fetch without touching the network. |
| `POST /api/update/apply` | Starts the fast-forward in a worker thread. Returns immediately; refused with HTTP 409 while PTT is asserted, or if an update is already running. |
| `GET /api/update/progress` | The running log and the final outcome. Polled by the modal, so reloading the page mid-update reconnects to the running job instead of starting a second one. |

Every git invocation is an argument list, never a shell string - commit subjects and branch
names are attacker-influenceable on a repository anyone can open a pull request against.

---

## 🐧 4. Platform notes

The update *is* the fast-forward; the per-platform installer scripts exist to install
dependencies, not to update source. Re-run one only when dependencies changed - the updater
says so, or use `--reinstall`.

```bash
# Any platform, in the z-30 checkout:
git pull --ff-only origin main

# Then, only if dependencies changed:
./install_ubuntu.sh          # Ubuntu / Debian / Raspberry Pi OS
./install_arch.sh            # Arch / Manjaro / EndeavourOS  (or: makepkg -si)
./install_android_termux.sh  # Android Termux
run_windows.bat              # Windows 10 / 11
pip install --upgrade -e .   # Generic Python
```

See [09. Cross-Platform Build & Packaging](09-Cross-Platform-Build-&-Packaging.md) for what
each installer does.
