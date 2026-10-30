# Greybots Diagnostics: design

The robot diagnostics app ([tracking issue #104](https://github.com/Team973/greybots-apps/issues/104)). It runs on the pit laptop next to Preflight, talks to the robot directly, and keeps what it pulls off the robot on that computer. This document records the decisions made when it was scaffolded ([#102](https://github.com/Team973/greybots-apps/issues/102)).

## Why it isn't part of Preflight

Preflight is a web app, and a browser can't do what diagnostics needs: mDNS discovery, SFTP/FTP log offload from the roboRIO and coprocessors, plain `ws://` NetworkTables connections, and running robot tests. A desktop app has none of those limits.

## Stack: Electron

Electron, with a Vue 3 window and a TypeScript main process.

- **One language.** The robot-network code (mDNS, SFTP, log parsing) is TypeScript like the rest of this repo. The alternative considered, Tauri, would put that code in Rust: a second language to maintain and a Rust toolchain on every build machine.
- **Proven for this job.** AdvantageScope does NT4, `.wpilog`, and roboRIO log download on the same stack.
- **Reuses `@greybots/common`**: styles, themes, and input components.
- **Runs on Windows, Linux and macOS** from one codebase.
- The cost is a large install (about 110 MB). That doesn't matter on a pit laptop.

It lives at `apps/diagnostics` in this monorepo, built with [electron-vite](https://electron-vite.org) and packaged with [electron-builder](https://www.electron.build).

## How the code is split

```
src/shared/     Types and plain logic both sides use. No Node, no DOM.
src/main/       The main process: files, network, windows. Node.
src/preload/    The bridge. Exposes window.diagnostics to the window.
src/renderer/   The window: a Vue app, like the other apps here.
```

The window is treated as a web page: `contextIsolation` and `sandbox` are on and `nodeIntegration` is off, so it has no Node access. Everything it needs from the computer goes through one typed interface, `DiagnosticsApi` in `src/shared/ipc.ts`:

1. Add the function to `DiagnosticsApi` and its name to `ipcChannels`.
2. Implement it in `handlers` in `src/main/index.ts`.
3. Call it from the window as `window.diagnostics.<name>()`.

The preload script builds itself from `ipcChannels`, so it doesn't need editing.

All packages are `devDependencies`, on purpose. electron-vite bundles everything the app needs into `out/`, and electron-builder packages only that. Anything listed under `dependencies` would also be copied into the installer as `node_modules`, which goes wrong with this repo's hoisted workspace install. A package with native code (one that can't be bundled) will need this revisited.

Electron is pinned to an exact version in `package.json` because electron-builder requires it.

## Robot connection settings

Kept in `settings.json` in the app's per-user folder (`%APPDATA%\Greybots Diagnostics`, `~/.config/Greybots Diagnostics`, `~/Library/Application Support/Greybots Diagnostics`), edited on the Settings page. The type and its validation are in `src/shared/settings.ts`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `teamNumber` | 973 | Used to work out the robot's addresses. |
| `addressMode` | `team` | `team`: use the team's addresses. `manual`: use `manualAddress`. |
| `manualAddress` | (empty) | An IP address or hostname, for a bench network or a simulator. |
| `mdnsEnabled` | on | Whether to also look for the robot by its mDNS name. The operating system resolves the name (Windows 10 and later, macOS, and Linux with Avahi do). Finding coprocessors by mDNS is still to come ([#91](https://github.com/Team973/greybots-apps/issues/91)). |
| `autoOffload` | on | Whether to offload the robot's logs as soon as it shows up. |
| `offloadDays` | 7 | Only logs recorded in this many days are pulled; older ones are left where they are. 0 pulls everything. |
| `dataDirectory` | (empty) | Where data is kept. Empty means the default folder. |

In team mode the robot is looked for at `10.TE.AM.2` (973 → `10.9.73.2`), at `roboRIO-<team>-FRC.local` when mDNS is on, and at the USB address `172.22.11.2` (`src/shared/robot-address.ts`).

**Check connection** on the Overview page tries a TCP connection from the main process to each address on the NetworkTables port (5810) and the SSH port (22). It only says whether something answered; it doesn't speak either protocol yet.

## Local storage layout

Everything the app pulls off the robot or works out is kept under one data folder: `Documents/GreybotsDiagnostics` by default, changeable in Settings. Changing it doesn't move existing data. The folders are created on launch (`src/main/storage.ts`); names and path helpers are in `src/shared/storage-layout.ts`.

```
<data folder>/
  logs/<robot>/<yyyy-mm-dd>/<source>/<original file name>
  results/<kind>/<id>.json
  index/
  README.txt
```

- **`logs/`** holds files exactly as they came off the robot, under their original names, and they are never edited. `<source>` is where the file came from: `roborio`, `driver-station`, `ctre-hoot`, `coprocessor-<name>`, `custom-<name>`. The day is the local date the file was recorded.
- **`results/`** holds what the app computes from the logs (match summaries, test runs), one JSON file each. Results can always be rebuilt from `logs/`.
- **`index/`** records what has been offloaded and what each file belongs to: `index/offloaded.json` (see Log offload).

Which event, match, or test run a log belongs to is recorded in the index, not in its path. That is often only known after the file is pulled (from FMS data inside the log, or from timestamps), and a path that had to change afterwards would mean moving files that are meant to stay put.

The folder is self-contained: copying it backs it up or moves it to another computer.

## Log offload

The Logs page shows offload status and the offloaded files. The work is done in the main process (`src/main/offload-service.ts`, `src/main/offload/`).

**Finding the robot.** Every 10 seconds the app checks the SSH port at each robot address (the same addresses as Check connection). When the robot appears, and `autoOffload` is on, it offloads. It offloads once per appearance: a robot that stays connected isn't offloaded from again until it goes away and comes back, or someone presses **Offload now**.

**What is pulled.** From the roboRIO, over SFTP as `lvuser` (no password), with [ssh2](https://github.com/mscdex/ssh2):

| What | Where on the robot | Filed under |
| --- | --- | --- |
| WPILib data logs (`.wpilog`) | `/home/lvuser/logs` and `/u/logs` (USB drive), up to two folders down | `roborio` |
| CTRE Hoot logs (`.hoot`) | the same | `ctre-hoot` |
| The robot program's output (`.log`) | `/home/lvuser` | `roborio` |

On Windows, Driver Station logs (`.dslog`, `.dsevents`) are also copied from `C:\Users\Public\Documents\FRC\Log Files`, for when the pit laptop is also the driver station. They're filed under `driver-station`, with the robot's name.

Data logs still named `FRC_TBD_…` are skipped. WPILib renames a log once the Driver Station sets the robot's clock, so such a file is either still being written (and would be pulled again under its new name) or from a boot that never saw a Driver Station, with no times or match in it.

**Filing.** A file goes under the day it was recorded: from a data log's name (`FRC_20260315_142201_…`, in UTC), otherwise from its time on the robot. A roboRIO that hasn't been given the time by a Driver Station has a clock in 1970, so times before 2020 are taken as unknown and the file goes under the day it was offloaded. The robot's name is `frc<team>` in team mode and the address in manual mode.

**Matches.** Once FMS has told the robot which match it is, WPILib adds it to the data log's name (`…_CASJ_Q42.wpilog`). That event and match are recorded in the index. Associating other files (Driver Station and Hoot logs) with a match is still to come.

**Not pulling twice.** `index/offloaded.json` has one entry per offloaded copy: where it came from, its size and time there, and where it was put. A file is skipped when it's already on disk at the same size and time. A file that changed (still being written last time, or the program log on a new day) is pulled again; if it now belongs to a different day it gets a new copy, and the old one is kept. If the index is lost, files already in `logs/` are recognized by their size and not pulled again.

**Order and age.** Data logs are pulled first, then the robot program log, then Hoot logs; newest first within each. A robot can hold gigabytes of logs (team 973's held 6.4 GB in 230 files in October 2026, mostly Hoot logs of 100-250 MB each), so the small files with the most in them shouldn't wait behind those. Logs recorded more than `offloadDays` ago aren't pulled at all, so an old backlog doesn't hold up today's matches.

**Speed.** Four files are pulled at once. Over the radio, round trips are what's slow rather than bandwidth. ssh2's own read stream waits for each 32 KB chunk before asking for the next, so the app keeps 32 reads in flight per file instead (as ssh2's `fastGet` does) and puts the chunks back in order. The index is written at most once a second while files come in, and again at the end.

Measured in October 2026: against a local OpenSSH server the app's reader runs at 70-80 MB/s inside Electron, so the app isn't the limit. Against team 973's roboRIO over the radio it got 2.7 MB/s with one connection and only 3.2 MB/s with three, so the limit is shared (the link, or the robot's CPU while robot code runs) rather than one core per connection, and more connections aren't worth it. The roboRIO's SSH server has compression switched off. A faster cipher for the roboRIO's CPU (ChaCha20) would need ssh2's native add-on, since Electron's crypto library doesn't have it.

**Resuming.** A file is downloaded to `<name>.part` and renamed when complete. The index notes each download in progress, so if the connection drops, the next run carries on from the end of the `.part` file, provided the file on the robot hasn't changed. A download that started less than a second before the app stopped may not be noted yet; it starts over.

ssh2 has two optional native add-ons (faster ciphers and CPU detection). The build leaves them out (`electron.vite.config.ts`) and ssh2 uses its plain JavaScript code, so there's still nothing native to build for each system.

## Installers

`npm run dist:diagnostics` builds an installer for the computer it's run on into `apps/diagnostics/release`. The Diagnostics CI workflow does this on Windows, Linux and macOS for every change and attaches the three installers to the workflow run:

| System | Installer |
| --- | --- |
| Windows | `.exe` (NSIS installer, per user, no admin rights needed) |
| Linux | `.AppImage` |
| macOS | `.dmg`, for Apple silicon and for Intel |

Nothing is code signed. Windows shows a SmartScreen warning on install ("More info" → "Run anyway"), and macOS refuses to open the app until it's allowed under System Settings → Privacy & Security. Signing needs paid certificates and is a later decision.

## Left open

- **The rest of [#91](https://github.com/Team973/greybots-apps/issues/91)**: coprocessor and vision logs (and finding coprocessors by mDNS), custom paths, associating logs other than data logs with matches, and reporting offload status to Preflight (#103).
- **The index format.** Offload keeps one JSON file. Whether results need something like SQLite is decided with the signal framework (#92).
- **How this app and Preflight share data** is [#103](https://github.com/Team973/greybots-apps/issues/103).
- **Sign-in.** The app has none: it works with no internet and holds nothing private. If #103 syncs through Supabase, it will need the account link Preflight's kiosk mode uses.
- **Updates.** There is no auto-update; a new version is installed by hand from a CI run.
