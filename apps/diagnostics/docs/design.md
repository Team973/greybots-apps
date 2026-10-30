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
| `mdnsEnabled` | on | Whether to find the robot and coprocessors by mDNS. Stored now; discovery itself is [#91](https://github.com/Team973/greybots-apps/issues/91). |
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
- **`index/`** records what has been offloaded and what each file belongs to.

Which event, match, or test run a log belongs to is recorded in the index, not in its path. That is often only known after the file is pulled (from FMS data inside the log, or from timestamps), and a path that had to change afterwards would mean moving files that are meant to stay put.

The folder is self-contained: copying it backs it up or moves it to another computer.

## Installers

`npm run dist:diagnostics` builds an installer for the computer it's run on into `apps/diagnostics/release`. The Diagnostics CI workflow does this on Windows, Linux and macOS for every change and attaches the three installers to the workflow run:

| System | Installer |
| --- | --- |
| Windows | `.exe` (NSIS installer, per user, no admin rights needed) |
| Linux | `.AppImage` |
| macOS | `.dmg`, for Apple silicon and for Intel |

Nothing is code signed. Windows shows a SmartScreen warning on install ("More info" → "Run anyway"), and macOS refuses to open the app until it's allowed under System Settings → Privacy & Security. Signing needs paid certificates and is a later decision.

## Left open

- **The index format** (JSON files or SQLite) is decided with log offload (#91) and the signal framework (#92), which know what has to be looked up.
- **How this app and Preflight share data** is [#103](https://github.com/Team973/greybots-apps/issues/103).
- **Sign-in.** The app has none: it works with no internet and holds nothing private. If #103 syncs through Supabase, it will need the account link Preflight's kiosk mode uses.
- **Updates.** There is no auto-update; a new version is installed by hand from a CI run.
