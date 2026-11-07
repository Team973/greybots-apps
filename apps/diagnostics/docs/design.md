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

**Tests:** `npm run test:diagnostics` from the repo root (`npm test` here) runs `test/*.test.ts`: each bundled with esbuild, with the app's `@shared` and `@main` aliases, and run with Node (`test/run.mjs`). They're plain asserts over code that doesn't need Electron: signal matching, library items and the starters, energy and pies, poses and records (from data logs written by `test/wpilog-writer.ts`), match phases and faults, Driver Station logs, the roboRIO console's framing. They're type-checked with the main process's code (`tsconfig.node.json`), and run in Diagnostics CI and before every release.

**Releasing** (`.github/workflows/diagnostics-release.yaml`): on GitHub, Actions → **Diagnostics release** → **Run workflow**, on `main`. It takes the next patch, minor or major version after the last release (`diagnostics-v*` tags; the first goes up from `package.json`'s), or an exact version, and can be marked a prerelease. It runs the unit tests, type-checks and packages the app on Windows, macOS and Linux with that version, and only when all three pass does it tag the commit and publish a GitHub Release with the installers, with notes listing the app's commits since the last release and how to install an unsigned build. A failure anywhere leaves no tag and no release. `package.json`'s version isn't changed in the repository: the release's version is set for its build only.

## Robot connection settings

Kept in `settings.json` in the app's per-user folder (`%APPDATA%\Greybots Diagnostics`, `~/.config/Greybots Diagnostics`, `~/Library/Application Support/Greybots Diagnostics`). How to reach the robot (team number, a set address, mDNS) is edited on the Download page, the rest on the Settings page. The type and its validation are in `src/shared/settings.ts`.

Both pages save each change as it's made (`src/renderer/src/settings-draft.ts`): a switch or a choice at once, a text or number box once typing pauses (600 ms). A change with something wrong with it shows why and isn't saved until it's put right; the top of the page says which.

| Setting | Default | Meaning |
| --- | --- | --- |
| `teamNumber` | 973 | Used to work out the robot's addresses. |
| `addressMode` | `team` | `team`: use the team's addresses. `manual`: use `manualAddress`. |
| `manualAddress` | (empty) | An IP address or hostname, for a bench network or a simulator. |
| `mdnsEnabled` | on | Whether to also look for the robot by its mDNS name. The operating system resolves the name (Windows 10 and later, macOS, and Linux with Avahi do). Finding coprocessors by mDNS is still to come ([#91](https://github.com/Team973/greybots-apps/issues/91)). |
| `autoOffload` | on | Whether to offload the robot's logs as soon as it shows up. |
| `offloadDays` | 7 | Only logs recorded in this many days are pulled; older ones are left where they are. 0 pulls everything. |
| `ctreLicenseAccepted` | off | Whether CTRE's licence was accepted, so owlet can be downloaded to read Hoot logs. Set only by the Settings page's accept button. |
| `dataDirectory` | (empty) | Where data is kept. Empty means the default folder. |
| `shortcuts` | Ctrl+K, Ctrl+Shift+K | Keyboard shortcuts that work on any page (`src/shared/shortcuts.ts`): the robot's live signals, and a simulator's. Set on the Settings page by clicking one and pressing the keys (with Ctrl, Alt or Cmd); Backspace turns one off. Two actions can't share keys. |

In team mode the robot is looked for at `10.TE.AM.2` (973 → `10.9.73.2`), at `roboRIO-<team>-FRC.local` when mDNS is on, and at the USB address `172.22.11.2` (`src/shared/robot-address.ts`).

**Check connection** on the Download page tries a TCP connection from the main process to each address on the NetworkTables port (5810) and the SSH port (22). It only says whether something answered; it doesn't speak either protocol yet.

## Local storage layout

Everything the app pulls off the robot or works out is kept under one data folder: `Documents/GreybotsDiagnostics` by default, changeable in Settings. Changing it doesn't move existing data. The folders are created on launch (`src/main/storage.ts`); names and path helpers are in `src/shared/storage-layout.ts`.

```
<data folder>/
  logs/<robot>/<yyyy-mm-dd>/<source>/<original file name>
  results/<kind>/<id>.json
  notes/<log>.json
  library/<kind>/<id>.json
  reports/<id>.json
  models/<model>/config.json, model.glb, model_0.glb, ...
  index/
  README.txt
```

- **`logs/`** holds files exactly as they came off the robot, under their original names, and they are never edited. `<source>` is where the file came from: `roborio`, `driver-station`, `ctre-hoot`, `coprocessor-<name>`, `custom-<name>`. The day is the local date the file was recorded.
- **`results/`** holds what the app computes from the logs (match summaries, test runs), one JSON file each. Results can always be rebuilt from `logs/`.
- **`notes/`** holds notes people add while reviewing a log, one file per log, named for its path under `logs/` (see Log review). Unlike `results/`, these can't be rebuilt.
- **`library/`** holds saved views, report templates and auto reports (`<kind>` is `view`, `template` or `pipeline`), one file each, shared with the team when signed in (see Reports).
- **`reports/`** holds reports made from logs, each with the data it shows, so it reads the same later.
- **`models/`** holds robot models for the 3D robot plot, one folder each, as AdvantageScope keeps them (see Other plots).
- **`index/`** records what has been offloaded and what each file belongs to: `index/offloaded.json` (see Log offload).

Which event, match, or test run a log belongs to is recorded in the index, not in its path. That is often only known after the file is pulled (from FMS data inside the log, or from timestamps), and a path that had to change afterwards would mean moving files that are meant to stay put.

The folder is self-contained: copying it backs it up or moves it to another computer.

## Pages

- **Signals** (what the app opens on): logs and live signals, plotted, with a field, the console, pies and the robot in 3D in tabs beside the chart; saved views.
- **Reports:** reports by log, report templates, and auto reports (automatic report generation).
- **Download** (`/download`; it was called Offload, and `/offload` still goes there): the robot's connection (how to reach it, where it's looked for, Check connection) and downloading its logs.
- **Storage:** the data folder, importing logs, and every log here: downloaded or imported, 10 to a page, sorted by when it last changed or by match (event, then practice, qualification and elimination, then number), either way.
- **Settings:** automatic download and how far back, the data folder, keyboard shortcuts, CTRE's licence, and the team account.

## Log download

The Download page shows how a download is going. It was called Offload; the code, settings (`autoOffload`, `offloadDays`), pipelines' `onOffload` and `index/offloaded.json` keep that name, so nothing saved needed changing. The work is done in the main process (`src/main/offload-service.ts`, `src/main/offload/`).

**Finding the robot.** Every 10 seconds the app checks the SSH port at each robot address (the same addresses as Check connection). When the robot appears, and `autoOffload` is on, it downloads. It downloads once per appearance: a robot that stays connected isn't downloaded from again until it goes away and comes back, or someone presses **Download now**. Every address is tried at once, and the robot is taken to be at USB as soon as USB answers, without waiting for the radio's address and mDNS name to time out (`find-robot.ts`). **Download now** just after the robot was found (within 10 s) goes straight to where it was found.

**Starting straight away.** Downloading used to list every folder on the robot (one at a time), check every file against the data folder, and only then start pulling; a robot with a folder per Hoot session took a long time to start, with nothing on the page meanwhile. Now:

- Folders are listed six at a time, and each folder's files are checked and queued as soon as it's listed. Four workers pull from the queue as files arrive, so the first file starts while the rest are still being listed.
- The logs folders are listed once for data logs and Hoot logs together (they used to be listed once for each).
- Files already here are checked all at once rather than one after another.
- Driver Station logs (on this computer) are pulled alongside the robot's, not after. Both share one index, so neither writes over the other's entries.
- The scan of the data folder for auto reports (which logs are new) runs while the robot is found, not before.
- The page shows each stage: the addresses being tried, logging in, then for each part (the robot, Driver Station logs) the folders looked in, logs found and how many are new, while files are already being pulled. It asks for the status four times a second while a download runs.

**What is pulled.** From the roboRIO, over SFTP as `lvuser` (no password), with [ssh2](https://github.com/mscdex/ssh2):

| What | Where on the robot | Filed under |
| --- | --- | --- |
| WPILib data logs (`.wpilog`) | `/home/lvuser/logs` and `/u/logs` (USB drive), up to two folders down | `roborio` |
| CTRE Hoot logs (`.hoot`) | the same | `ctre-hoot` |
| The robot program's output (`.log`) | `/home/lvuser` | `roborio` |

On Windows, Driver Station logs (`.dslog`, `.dsevents`) are also copied from `C:\Users\Public\Documents\FRC\Log Files`, for when the pit laptop is also the driver station. They're filed under `driver-station`, with the robot's name.

Data logs still named `FRC_TBD_…` are skipped. WPILib renames a log once the Driver Station sets the robot's clock, so such a file is either still being written (and would be pulled again under its new name) or from a boot that never saw a Driver Station, with no times or match in it.

**Filing.** A file goes under the day it was recorded: from a data log's name (`FRC_20260315_142201_…`, in UTC), otherwise from its time on the robot. A roboRIO that hasn't been given the time by a Driver Station has a clock in 1970, so times before 2020 are taken as unknown and the file goes under the day it was downloaded. The robot's name is `frc<team>` in team mode and the address in manual mode.

**Matches.** Once FMS has told the robot which match it is, WPILib adds it to the data log's name (`…_CASJ_Q42.wpilog`). That event and match are recorded in the index. Associating other files (Driver Station and Hoot logs) with a match is still to come.

**Not pulling twice.** `index/offloaded.json` has one entry per offloaded copy: where it came from, its size and time there, and where it was put. A file is skipped when it's already on disk at the same size and time. A file that changed (still being written last time, or the program log on a new day) is pulled again; if it now belongs to a different day it gets a new copy, and the old one is kept. If the index is lost, files already in `logs/` are recognized by their size and not pulled again.

**Order and age.** Of what's been found so far, data logs are pulled first, then the robot program log, then Hoot logs; newest first within each. A robot can hold gigabytes of logs (team 973's held 6.4 GB in 230 files in October 2026, mostly Hoot logs of 100-250 MB each), so the small files with the most in them shouldn't wait behind those. Logs recorded more than `offloadDays` ago aren't pulled at all, so an old backlog doesn't hold up today's matches.

**Clearing the robot** (#139, `src/main/offload/clear.ts`). Downloading only reads from the robot. Afterwards, the Download page offers to clear the logs that download just pulled (data logs and Hoot logs, never the program's own log or Driver Station logs), and only those, for two hours or until the next download. It asks twice: **Clear from the robot…** opens the list, and its delete only works once **Yes, delete these logs from the robot** is ticked. The main process checks the request names that download and its count, then logs in again and checks each file before deleting it. A log stays on the robot when:

- it's still named `FRC_TBD_`;
- it's the newest log in its folder, or for Hoot logs (a folder per session, its logs written together) in the newest session: kept whole, since the newest file in every session would otherwise stay for good;
- it changed within 5 minutes of the newest log on the robot (the robot's clock may be unset, so its own latest file stands for now);
- it has changed on the robot since it was downloaded, or is gone;
- the copy on this laptop is missing or a different size.

A Hoot session folder left empty is removed (the logs folders themselves never are). The page says what was deleted, and each log left and why.

**Speed.** Four files are pulled at once. Over the radio, round trips are what's slow rather than bandwidth. ssh2's own read stream waits for each 32 KB chunk before asking for the next, so the app keeps 32 reads in flight per file instead (as ssh2's `fastGet` does) and puts the chunks back in order. The index is written at most once a second while files come in, and again at the end.

Measured in October 2026: against a local OpenSSH server the app's reader runs at 70-80 MB/s inside Electron, so the app isn't the limit. Against team 973's roboRIO over the radio it got 2.7 MB/s with one connection and only 3.2 MB/s with three, so the limit is shared (the link, or the robot's CPU while robot code runs) rather than one core per connection, and more connections aren't worth it. The roboRIO's SSH server has compression switched off. A faster cipher for the roboRIO's CPU (ChaCha20) would need ssh2's native add-on, since Electron's crypto library doesn't have it.

**Resuming.** A file is downloaded to `<name>.part` and renamed when complete. The index notes each download in progress, so if the connection drops, the next run carries on from the end of the `.part` file, provided the file on the robot hasn't changed. A download that started less than a second before the app stopped may not be noted yet; it starts over.

## Importing logs

Logs from anywhere (a teammate's laptop, a USB drive, a download) are filed into the archive on the Storage page: dropped on it, or picked with **Choose files…** or **Choose a folder…** (`src/main/import/`). Data logs, Hoot logs and Driver Station logs are taken, loose, in folders (eight deep), or in zip files, which are read as they are (`zip.ts`: stored and deflated files, zip64 too). Each goes where an offload would have put it, `logs/frc<team>/<day>/<source>/`, by the same day rules, and is recorded in the index (`origin: 'import'`). A file already there at the same size is skipped; a different file of the same name is left alone and reported.

**Which team.** A log rarely says outright, so, in order:

1. **Its path**, from what was dropped on: `frc973`, `roboRIO-973-FRC`, `team973`. The folders above what was dropped aren't looked at; a person's own folders say nothing about the log. `frc2015` to `frc2049` are taken as seasons.
2. **The log itself:** addresses on a robot's network are `10.TE.AM.x`, and robot code logs its cameras' and the Driver Station's. Team 973's Q39 data log has `10.9.73.11`, `.12`, `.13` and `.23`. The team seen most wins. Data logs and Driver Station logs are searched.
3. **A Hoot log's CANivore,** if its id was seen in a team's Hoot logs here or in the same import, or **the Hoot log it started with** (a robot's rio and CANivore logs start within a second of each other).
4. **Otherwise the team given** on the Storage page (Settings' team to start with), and the results say which logs that was.

Each file is copied into `index/importing/` first, since a zip's files can only be read through once, looked at, then moved into place. Driver Station logs don't name a team or an address, so they usually take the team given.

ssh2 has two optional native add-ons (faster ciphers and CPU detection). The build leaves them out (`electron.vite.config.ts`) and ssh2 uses its plain JavaScript code, so there's still nothing native to build for each system.

## Signals

One signal layer serves log review, live view, and automated tests (#92), so a dashboard works with any of them. The Signals page plots it from offloaded data logs.

**The Signals page.** The chart is the main part, with the log's signals beside it.

- **Picking a log:** newest first, by when each was recorded: the time in its name, unless that's days away from the file's time on the robot (kept in the offload index), as when a Hoot log is named with the roboRIO's unset clock (`2024-12-18`). Then the robot's time (`trustedTime`, `src/shared/offload.ts`). Downloaded files keep the robot's time as their own.
- **Filtering the list:** an **Event** (from the match in each log's name, e.g. MTTD) and **Real matches only** (practice, qualification and playoff matches: logs FMS named; Driver Station logs on their own don't say, so they're left out). Kept between visits. The open log stays in the list either way. `src/shared/log-filter.ts`.
- **Deleting a log** (🗑 beside the list, after asking): its data log, Hoot logs and Driver Station logs go to the Recycle Bin (the Trash), and its notes, cached Hoot exports and index entries are removed. A Driver Station log another log also has is kept. Nothing remembers what was deleted, so a log still on the robot comes back with the next download.
- **The signal list** is one tree of the signals' own paths. A folder holding only one folder is shown as one (`Robot / robot`), each folder shows how many signals it holds, and the filter opens everything that matches. The top level starts open.
- **Adding signals:** drag a signal onto the chart. While dragging, there's a drop zone for each axis (L1, L2, … and R1, …), for a new left or right axis, and for the top and bottom bands (only the bands, for text). The zone under the pointer is highlighted. Clicking a signal adds it to L1.
- **Axes:** L1 is next to the plot and L2 outside it, and the same on the right. Each axis fits the values of its signals in the span shown, and is labelled with their units. An axis with nothing left on it goes away.
- **Bands:** text signals (subsystem states) are drawn as bands of labelled spans in the signal's colour, above the plot or below it. Any other signal can go in a band too, to show a number as states: a 0/1 flag as false/true (true darker), or a mode number. A value repeated is one span.
- **Under the chart:** a list of what's plotted, with each signal's colour, its axis or band (changeable, including to a new axis), and its value: the latest while following live, otherwise at the right edge of the span shown. **Show** adds its min, max or mean over the span shown; the choice is kept between visits. Four signals show before the list scrolls. Rows can be dragged onto the chart to move them. The eye beside each hides it from the chart for now (and an axis left with nothing shown goes too); it stays in the list with its value.
- **Values in the signal list:** each signal in the tree shows its value too, at the same moment as the list under the chart, a few times a second at most. They're read for just the rows showing (`readValues`). A Hoot signal's shows once it's been exported (plotted), since exporting is slow.
- **Room:** the sidebar can be hidden to a thin strip, and the log's details at its top folded away to give the signal list more room. Both are kept between visits.
- **Zoom:** scroll to zoom around the pointer, Shift+scroll to pan, drag across the plot to zoom to that span, and double-click (or **Show all**) to see everything. Zoom buttons do the same. Each change re-reads only the span shown, at about two points a pixel, so zooming in shows full detail.
- **Hover:** shows every signal's value at that moment (the last value at or before it).
- **Pinning a moment:** a click on the chart pins that moment with a dashed line, and its values stay in their own readout at the bottom of the plot while hover reads elsewhere (with how far it is from the pin) and, live, while the chart moves along. Once the moment's out of view, its readout keeps the values last seen. A click elsewhere moves it; its ✕ or Escape lets it go. Clicks and double-clicks are told apart from pointer-ups rather than the browser's click events, which don't fire while the chart redraws under the pointer (live).
- **Copying as an image:** the copy button (Material's two-sheets icon) puts the chart on the clipboard as a PNG, for pasting into a PR or a message: a caption naming the log and span, the chart (with any pinned readout), and a legend of every signal with its colour and value. It's drawn off screen (`src/renderer/src/chart-image.ts`): the chart's own SVG, with the page's styles copied onto it, on a canvas at twice the size for sharpness, with the caption, readout and legend drawn around it. So nothing on the page moves while it's made, and it's the same however the page is scrolled. The main process only puts it on the clipboard, and only a PNG.
- **Warnings:** opening a log warns when DogLog's queue filled up (its `QueueRemainingCapacity` reached 0), since DogLog drops values while it's full.
- **Colours:** up to 8 signals, in the reference palette's fixed order. A signal keeps its colour while it's on the chart. Clicking a colour in the list under the chart picks another palette colour or any colour; the choice is kept by signal, between visits, so the signal gets it back when added again. Any colour picked is the same in both themes. Light and dark each have their own steps, validated against the card colours. Three of the light ones are under 3:1 against white, so every signal is also named in the list under the chart.
- **What's kept:** the log or live session open, the signals plotted (axes, bands, colours, which are hidden) and the span shown are kept going to another page and back, and saved for the next time the app opens (`src/renderer/src/stores/plot-store.ts`). Live sessions follow again when returned to. An earlier live run is gone once the app closes, so the newest log opens instead. Saving charts by name, and reports of several charts, are dashboards (#95).

**Reading data logs.** `src/main/signals/wpilog.ts` reads WPILib data logs (`.wpilog`, [format](https://github.com/wpilibsuite/allwpilib/blob/main/wpiutil/doc/datalog.adoc)) in plain TypeScript, with no Node or Electron. `structs.ts` decodes `struct:` values (Pose2d, team-defined structs) from the schemas the log carries: nested structs, fixed arrays, enums, and bitfields. A 15 MB log of about 1M values opens in about 250 ms. The log is held in memory whole, one at a time.

**The catalog** (`src/shared/signals.ts`, built by `src/main/signals/log-source.ts`) is built from what the log holds, not hard-coded, so team-defined subsystem metrics show up on their own. Each signal has:

- **A key:** the entry's name, such as `/Robot/robot/shooter/state`.
- **A subsystem:** the first path segment after container segments such as DogLog's `/Robot/robot/`, AdvantageKit's `RealOutputs/`, and `SmartDashboard/`.
- **A display name:** the rest of the path.
- **Its type and kind:** number, boolean, string, or other.
- **A unit:** from the metadata (DogLog's `unit`, NetworkTables' `properties.unit`), or from how the name ends (`MPS` is m/s, `Rot` is rot, `Deg` is °). Fields of WPILib's geometry structs have known units: a translation in m, a rotation in rad.
- **How many values it has:** DogLog creates entries that may never get a value.

Each numeric field of a struct, and each element of a numeric array (up to 32), becomes its own signal, keyed by path: `…/pose/translation/x`.

**Time series.** `read(key, { start, end, maxPoints })` gives times in seconds from the log's first value, and values as numbers (booleans are 0 and 1) or strings. It also gives min, max, and mean over every value in the range. Past `maxPoints`, it keeps each stretch's smallest and largest value, so spikes and dips still show. When the log has DataLogManager's `systemTime`, the catalog also gives when the log started by the clock. Live signals (below) offer the same `catalog()` and `read()`.

**Values hold until the next one.** WPILib's log entries, which DogLog writes through, skip a value equal to the last one, so a signal only has a record when it changes. A motor stopped at 0 for five minutes is one record. So:

- the chart draws every signal as steps, with the last value held to the end of the log;
- stats count the value carried into a span from before it;
- the mean is weighted by how long each value held, not by how many times it was logged.

Few records for a signal usually means it rarely changed, not that data is missing.

**Built-in groups.** Power, CAN / motor controllers, Robot performance, and Drivetrain, with the metrics listed in the requirements (§3.2), are found by name patterns (`builtInGroups`), so no robot code is assumed. They were tuned on team 973's logs (DogLog, CTRE swerve). A log summary carries them for dashboards and match summaries (#95, #97); the Signals page lists signals by path instead.

**What's not in data logs.** Team 973's data logs carry battery, CAN bus, rails, CPU temperature, gyro, poses, and module targets. Motor temperatures, currents, and faults are in the CTRE Hoot logs (below).

## CTRE Hoot logs

Hoot logs (`.hoot`) are CTRE's format for what Phoenix devices report: TalonFXs, CANcoders, and the Pigeon, with about 110 signals per TalonFX at up to 250 Hz. They're read with CTRE's **owlet** tool, which converts them to `.wpilog` for the signal framework. AdvantageScope reads them the same way (`src/main/electron/owletInterface.ts` there).

**Getting owlet.** CTRE's licence says owlet "may be re-distributed only with expressed permission from the Company", so it isn't in our installer. Instead, each computer downloads it from CTRE:

- **Accepting the licence:** on the Settings page, the person accepts [CTRE's licence](https://raw.githubusercontent.com/CrossTheRoadElec/Phoenix-Releases/refs/heads/master/CTRE_LICENSE.txt). That records `ctreLicenseAccepted`, which only this step can set.
- **What's downloaded:** CTRE's index (`https://redist.ctr-electronics.com/index.json`) lists builds, each checked against CTRE's SHA-1. The app gets the newest build for each stable *compliancy*, and for any compliancy the Hoot logs here need. A Hoot log can only be read by the owlet of the compliancy that wrote it, recorded in the log's byte 70.
- **Where it goes:** the app's per-user folder (`owlet/`). From then on it works offline.
- **Updates:** the app checks CTRE for newer builds at start and every 6 hours.

**Exporting only what's plotted.** Converting a whole Hoot log is too big: 52 MB of Hoot became 1.09 GB of `.wpilog`. Instead (`src/main/hoot/`):

- **Signal list:** `owlet --scan` lists a log's signals (about a second), and `--check-pro` says whether it has a Phoenix Pro device. Without one, owlet only exports some signals, and the Signals page says so.
- **Plotting a signal** exports just that signal (`-s <ids>`): about 6 s for a 52 MB log, since owlet reads the whole log each time. Signals asked for within 250 ms of each other share one export. Progress shows on the Signals page.
- **The cache:** scans and exports are kept under `results/hoot/<hash of the log's path>/`, with a `manifest.json`, and start afresh if the Hoot log or the owlet changes. The folder names are short on purpose: owlet can't write past Windows' 260-character path limit, and Hoot log names are long.
- **One owlet at a time:** each run reads a whole log.
- **Cut-off logs:** a Hoot log whose end is cut off (the robot switched off while logging) makes owlet fail after writing everything before that. That output is used, with a note.

**Sessions.** The Signals page's log list is of sessions: a data log and the Hoot logs from the same match or time. A Hoot log goes with the data log of the same robot and match, or, outside a match, the one whose name time is within 2 minutes of its own. Hoot logs with no data log are sessions of their own. A Hoot log's signals sit under `Hoot rio` or `Hoot CANivore 17E61D98` in the signal tree. The name is the same in every match, so a chart keeps its signals when the match changes.

**One timeline.** Hoot times count from when the Hoot log started; data log times from when the robot program started. Team 973's Q39 logs were 27 s apart. Each Hoot log is put on the data log's timeline (or, without one, the first Hoot log's):

- **By the first enable:** the Hoot log's `RobotEnable` against the data log's first enable signal (`DS:enabled`, `DriverStation/Enabled`, or code's own `isAutoEnabled` / `isTeleopEnabled`).
- **Precision:** a few hundredths of a second, as close as the robot code logs its enable. On Q39, both Hoot logs came out at +16.27 s, and a motor's current rises at the same moment as the enable in both logs.
- **By the file names' times**, to the second, if either enable is missing, or if the two methods disagree by more than 2 minutes (different enables).
- **On screen:** the Signals page says which method was used.

A Hoot signal's type and unit come from owlet's export, so the list guesses them from the name until the signal is first read.

## Live signals

The Signals page's list starts with two live sessions: **the robot**, and **a simulator on this computer**. Either shows the signals robot code publishes to NetworkTables as they change, on the same chart as logs. From any page, **Ctrl+K** opens the robot's and **Ctrl+Shift+K** the simulator's, unless changed in Settings. DogLog publishes everything it logs under `/Robot`. `src/main/live/`:

- **Connecting:** the robot's addresses (the same as Check connection) are tried at once on port 5810, and the first in order that answers is used. A simulator is `127.0.0.1`. Until one answers, the page says so and keeps trying every 1.5 s.
- **The protocol:** NetworkTables 4 (`nt4-client.ts`), over Node's own WebSocket, with a small MessagePack reader (`msgpack.ts`). It asks for every topic and every change (`all`), not only the latest each period, so nothing between two reads is missed. NT4 version 4.0 is used rather than 4.1, which needs WebSocket pings Node can't send; a dead connection is found by time sync replies stopping for 6 s instead.
- **Time:** seconds since connecting, by the robot's clock (NT4's server time). A value set before connecting starts at 0, since that's what was holding.
- **What's kept** (`live-source.ts`): the last 10 minutes of every topic, and the value still holding before that. Struct values are decoded with the schemas the robot publishes under `/.schema/`, and struct fields and array elements are signals of their own, as in a data log.
- **Dropouts:** what was kept stays through a dropout, and the connection comes back on its own. The signal list stays as it was, dimmed and marked stale, with each signal's last value.
- **A new run:** if the robot's clock went back (robot code restarted), a new run starts on a new timeline. Until it's had 1.5 s to say what it has, the last run's list stands (with the new run's signals added as they come), so the list doesn't empty and refill.
- **Letting go:** the window asks for the connection's state ten times a second while it's showing a live session. When it stops for 15 s (another page, another session, closed), the connection is closed.
- **Earlier runs:** a run isn't thrown away when a new one starts or the connection is let go. The last three are kept, until the app closes, as **Earlier live runs** in the log list: any signal in them can be plotted after the fact, as from a log, before the robot's logs are pulled. Coming back to a robot whose clock carried on (it wasn't restarted) picks its run up again.

**Following.** While live, the chart shows the last 30 s up to now and moves along. Scrolling the wheel, or Zoom in and Zoom out, show more or less of the latest and keep following; **Show all** (or double-click) follows everything kept. Shift+scrolling back, or dragging across the chart, holds it still to look at something; **Follow live**, or Shift+scrolling back to now, follows again. New signals appear in the list as robot code first publishes them.

**Testing without a robot.** Team 973's robot code runs in simulation (`./gradlew simulateJavaRelease` in the robot repo, with `ROBOT_SIM_NO_GUI=1` for no window) and publishes the same `/Robot` signals. Its `test/` tools enable it through the simulated Driver Station.

## Other plots

The Signals page's chart has tabs (#144): the line chart's, then one for each other plot open, in the same space. **+** at the end opens another (up to six): a 2D field, the console, a pie chart, or the robot in 3D; ✕ on its tab closes it. The line chart's tab is always there. Each plot shows the moment the chart does (the pin, the playhead while playing back, or now when following live) over the span it shows, so the zoom buttons and playing back work on every tab. The tabs are kept with the chart (through other pages and restarts) and in saved views; a view saved before them leaves the plots as they are. Each has its settings, and a signal dragged from the list onto one is added to it. `src/shared/plots.ts`, `src/renderer/src/components/PlotTabs.vue`, `PanelView.vue` and `*Panel.vue`.

**Whole values.** A line needs numbers, but a pose is a struct and a trajectory a list of them. `readRecords` sends a signal's values whole (structs as their fields, arrays as lists) over a span, with the one holding at its start, at most 20,000 (the latest kept). A plot that shows the moment (the 3D robot, and the field's robots, points and trails) reads a window around it instead of the whole span (`poseWindow`): over a long span the 20,000 kept are only the latest, so playing a long log from the start used to show no robot. The window moves 30 s at a time, so playing back reads again every 30 s rather than every frame, and it is read again as the span moves while following live. Paths are still read over the span. Data logs and live sessions have them; Hoot and Driver Station signals don't. Poses are read from WPILib's `Pose2d`, `Pose3d`, `Translation2d`, `Translation3d` and lists of them, and Field2d's `double[]` (x, y, degrees for each).

**2D field.** WPILib's field images, by season (2022 to 2026; the season's picked from when the log was recorded), with where each field is in its image and its size from WPILib's JSON. WPILib's images are drawn from the red end, so they're turned 180° to put each element where WPILib's coordinates (and its AprilTag layouts) have it: the blue wall at x = 0. **Turn** turns the whole view 90° at a time. Each pose is drawn as a **robot** (a square of the robot's size with a coloured border, a fill as solid as chosen, and a mark at the front, with a trail of where it's been), a **path** (a trajectory's poses; for one pose, where it went over the span), or **dots**. Pointing at the field says where that is in metres.

**Console.** What the robot code printed, over the span, with the line at the moment shown marked and kept in sight; clicking a line pins its moment. From a data log it's `console`, which WPILib's DataLogManager logs. Live from the robot, it's the roboRIO's console (TCP port 1741, as the Driver Station and RioLog get it; `src/main/live/net-console.ts`), added to the live session as `console` so the same plot works on both. A simulator has none. Errors and warnings are coloured; lines can be filtered and copied.

**Pie charts.** Over the span shown, either each number's share of their total, or how long one signal held each of its values (time in each state, mode or zone; the value carried in from before the span counts). Shares are of the numbers as they are (their means times the span: amp-seconds for currents), or of **energy**: each current times a voltage, added up over time, in watt-hours, with the average power (the same as reports' energy pies; the voltage is one signal, the battery's, or each current's own `…Voltage`). A slice is a signal, or a named group of them added up (a subsystem's motors), up to 24, with a total under them. A pie can be named, for its tab. Shares' slices take the palette's colours in a fixed order by slice, so they don't change as the span moves; past the palette, the smallest are grey, each still its own slice. States past eight are folded into Other. The **Energy** starter view has the battery on the chart and energy by motor and by subsystem in two pie tabs.

**3D robot** (three.js). The robot's pose (a `Pose2d` or `Pose3d`) places it on the season's field, or a plain grid. Its model is a folder as AdvantageScope keeps them, so a team's models work in both: `config.json` (`rotations`, applied in order, then `position`, to stand the model on the field the WPILib way; and for each moving part, `zeroedRotations` and `zeroedPosition`), `model.glb` (the robot) and `model_0.glb`, `model_1.glb`, ... (the parts, posed by a `Pose3d[]` signal relative to the robot). **Add a model** copies a model's folder into the data folder's `models/`; with none, a box the size of a robot shows. Drag to turn the view, right-drag to move it, scroll to zoom; **Follow** keeps the robot in the middle. The field and the 3D view can be copied as images.

## Log review

The Signals page is also where a log is reviewed (#94): what happened in it is found, marked along the top of the chart, and listed under it.

**Events** (`src/main/signals/events.ts`) are found by the signals' names, the way WPILib, DogLog, AdvantageKit and CTRE log them, so they turn up for any robot without the app knowing its code:

| Kind | From |
| --- | --- |
| Enable and mode | The Driver Station's own record (`DS:enabled`, AdvantageKit's `DriverStation/Enabled`, or a Driver Station log), else CTRE's `RobotMode` in a Hoot log, else robot code's own flags (`isAutoEnabled`, `isTeleopEnabled`) |
| Brownouts | `.../BrownedOut` true; a Driver Station log's brownout flag |
| CAN | `CANBus/ReceiveErrorCount` and `TransmitErrorCount` above 0; `OffCount` and `TxFullCount` going up; a Hoot log's `CANBusIsUp` false. The CANivore's (a signal named for it, or its Hoot log) are all errors |
| Device faults | Every CTRE device's `Fault_*` and `StickyFault_*` signals in the Hoot logs (`faultSeverity`). Current limits (stator and supply) are information, routine: the motor doing as it was told. Otherwise a motor controller's (TalonFX, ...) are warnings, sticky or not: motors fault often, a current limit holding, and the robot carries on. The Pigeon's are errors, sticky or not: everything is driven and aimed by its heading. Any other device's (a CANcoder) is an error while it's set, and a warning once only the sticky one is (that stays set until cleared, so says only that it happened, maybe before the log) |
| Loop overruns | "Loop time of … overrun" in the console |
| Network | NetworkTables clients leaving (console); the Driver Station going away (`DS:IsDSAttached` in a Hoot log); a Driver Station log's robot lost (an error if it was enabled) and a poor link while enabled (half the packets lost, or a 100 ms trip) |
| Alerts | WPILib Alerts (`Alerts/errors`, `warnings`, `infos`) and DogLog's faults, from when each appears until it goes |
| Console | Other `Error` and `Warning` lines, and the errors and warnings in a Driver Station's `.dsevents`; ones that differ only in numbers or past their first 40 characters are one event, titled with `#` where the numbers differ |
| Subsystem states | Text signals named `state` (or `currentState`, `wantedState`, ...): each change, titled with the subsystem (the name above it) and the new state |
| Driver input | Booleans under a controller (`driverStick/`, `operatorController/`, `joystick0/`, ...), each from press to release; WPILib's and AdvantageKit's joystick button bits |

- **Merging:** the same event less than 2 s apart is one, with a count and its span (overruns loop after loop, a fault that flickers).
- **Severity:** errors (red), warnings (amber) and information (grey); notes are purple. Information other than enables, states and driver input is routine (current limits, Team 973's Q39 had hundreds): hidden unless **Routine too** is ticked.
- **Many and ordinary:** subsystem states and driver input are listed only once their kinds are picked (Q39 has 323 state changes and 44 presses). Which subsystems and buttons matter to a team comes with dashboards (#95).
- **Hoot logs:** device faults need owlet to export about 450 signals from each Hoot log, which takes about 12 s the first time a log is opened (once for both of a match's Hoot logs, kept like any export). Until then the list says it's still looking; everything else shows at once.

**Match phases.** Auto and teleop are where the robot was enabled in each mode; in a match (a match name, or FMS attached per the Hoot log), the last 30 s of teleop is the endgame (`endgameSeconds` in `src/shared/events.ts`, 2026's game). They're shaded behind the chart, and times show with the phase clock ("Teleop 1:05").

**Moving about.** Clicking an event (in the list, or its mark on the chart) pins its time and brings it into view. **Previous** and **Next** (or `[` and `]`) step through the errors and warnings shown, from the one picked, the pin, or the edge of the span shown. Which kinds show is kept between visits.

**Field heatmaps.** A pose on the 2D field can be drawn as a **Heatmap** (`src/shared/field-heat.ts`), a point cloud over the span shown: a point for each sample, where the pose was then, weighted by time spent there, by a counter's rise there, or carrying a signal's value (its average there). Drawn, the points pile up in bins three pixels across, each spread a little over its neighbours (a small Gaussian), so where they're thick is a hotspot and a lone point is faint but there (`heatDensity`, `binShares`). The signal is picked beside it, or by clicking a number in the signal list while the field's tab is shown.

**Playing back.** Play (or Space) moves the pin through the log at 0.25× to 8×, and the chart moves along to keep it in sight. **The tape** (`TimeTape.vue`) under every tab is coloured and named by what the robot was doing (`tapeSegments`: disabled, auto, teleop, endgame, or enabled outside a match's phases), in two parts. A thin **overview** of the whole log has the span shown as a window: drag it to move the span, drag its edges to widen or narrow it, click elsewhere to move it there. Under it the **tape** proper, a strip of film, is the span shown, zoomed as the line chart is: scroll on it to zoom about the pointer (as gently as the line chart: by how far it scrolled), Shift+scroll to pan, double-click (or **Show all**) for the whole log. The span is the line chart's, so zooming either zooms the other, and the field's paths and heatmaps follow it. Clicking or dragging on the tape (or the arrow keys, Shift for a second; + and - zoom) pins that moment, and the line chart's span moves to keep it in sight. There is one moment for the whole page: the line chart's pin, the field, the 3D robot and the console all show it, whichever tab it was picked on. With nothing pinned, the other tabs show the right edge of the span, and the tape marks that. The values under the chart are at the pin when there is one.

**Copying the events.** **Copy as image** puts the events listed on the clipboard as a PNG, the way the chart's copied (`src/renderer/src/events-image.ts`): a caption naming the log, the counts and which kinds are shown, then every event listed, not just those scrolled into view, so filter to what matters first. Past 200 events the rest are counted.

**Notes** are added at the pin (or the middle of the span shown), changed and deleted from the list, and kept in the data folder (`src/main/notes-store.ts`). The first line is the note's title. Live sessions and earlier live runs can't have notes, since they aren't kept.

**Min, max and mean of a range:** Shift+drag across the chart picks a range (shaded, with its length), and the stats columns are of it, read at full detail, until **use the span shown** or Escape (after the pin). Picking one shows the stats columns if they were off. A plain drag still zooms.

### Post-match monitors

Automatic checks over a log (`src/shared/monitors.ts`), run once per log's data log in the main process, and again when its enabled and auto spans change (`sessionMonitors`, `signals-service.ts`). Each steps through the log every 20 ms within its gate, and raises an alarm when its condition holds for its persistence. Alarms are events of the kind **Monitors** (warnings; a surf near miss is information), so they show on the Signals page's events and chart, and count in reports' errors and warnings and the Reports cards' flags. Every bound is in `monitorSettings`:

| Monitor | Signal | Alarm | Persistence | Gate |
| --- | --- | --- | --- | --- |
| Paired-motor imbalance | stator current of 60/61 (intake rollers), 50/52 (intake arm), 58/59 (shooter); 40/41 are two mechanisms, left out | more than 30% and 10 A apart | 1 s | enabled, the pair running (either over 5 A) |
| Intake arm twist | `intakeArm/leftMinusRightMotorRot` | over 2.0 rotations | 500 ms | enabled |
| Swerve module outlier | each drive motor's current and velocity against the other modules' | over 2× their median (current also over 5 A) | 1 s | enabled, median commanded module speed over 1 m/s |
| Path tracking (position) | `driveWithTrajectory/X` and `Y Position Error` | over 0.3 m | 500 ms | auto; a value over 0.1 s old doesn't count (it's only logged while following a path) |
| Path tracking (heading) | `Theta Position Error` (radians: its largest is about π) | over 10° | 500 ms | auto |
| Wheel slip | how far each module's wheel turned (`Drive Motor/positionRot`) against how far swerve kinematics says it should have gone for how the robot moved, over the last second | wheel faster by over 0.5 m/s | 500 ms | enabled, moving |
| Wheel drag | the same | wheel slower by over 0.5 m/s | 500 ms | enabled, moving |
| Vision pose disagreement | each camera's own measurement (MegaTag2 for where, MegaTag1 for which way; under 0.5 s old, not (0, 0)) against the fused pose | over 0.5 m or 10° | 1 s | enabled |
| Surf detection | pitch and roll | over 8° | 150 ms | enabled, the fused pose in the pile zone |

The pose is logged about 5 times a second, so speeds are taken between samples at least 0.2 s apart; a jump faster than 6 m/s is a reset, not motion. Wheel slip and drag use swerve kinematics (`moduleSpeed`, `wheelGaps`): each module's expected travel is the robot's travel in its own frame plus its turn about its centre at the module's place (`monitorSettings.slip.modules`, from `RobotInfo`: mod0 front left, mod1 front right, mod2 back left, mod3 back right), so a robot spinning in place has fast wheels and no slip. They compare **travel** (each drive motor's position, read at the pose's moments, times `metresPerRotation`, DRIVE_GEAR_RATIO × π × WHEEL_DIAMETER_METERS) rather than speeds: the wheel speeds are logged only about as often as the pose, so a snapshot can't stand for a hard acceleration between samples, while a position includes everything in between. Fitting each module's place from the logs put each within a few centimetres of `RobotInfo`'s, and the logs' metres per rotation within 1.5% of the config's. The longest alarms (seconds, a diagonal pair, one slipping and one dragging) line up with surfs: the robot up on the pile, one corner's wheel in the air. They compare with odometry because vision moves the fused pose in jumps; comparing each camera's own estimator (`…LLOnly`) instead found mostly its drift between measurements.

**Surfing** (the robot riding up on the fuel pile). A tilt with the fused pose in the pile zone (`surf.pile`, a guess for now: the fuel in the middle of the field) is confirmed within 0.5 s by wheel slip (a module unlike odometry, or the modules more than 0.5 m/s apart) or path error over 0.3 m and rising: a **surf**, else a **near miss** (kept apart: they show how close it came). Each is auto (with how many seconds in) or teleop, and says what explains it: the intake rollers' speed against target (roller bog), the commanded spin (in auto, from 1 to 4 s in), and the yaw kick (how fast it turned against how fast it was told to). A command it can't reach isn't a hit (autos ask for up to 2,500°/s and turn about 100°/s), so "hit?" is only marked when it turned more than told, or the other way, by over 150°/s. On CAVEN1 Q21, Q27 and Q39 it finds the auto surfs 1.7 to 2.5 s in, with 571 to 777°/s commanded.

### Vision System

For each camera the robot reads (`providers/llLeft` …), from the counters it logs, which only go up (`src/shared/vision.ts`): frames **used** (`data received`), **thrown out** (`rejected gyro not level`, `too spinny`, `needs init`, …, by why), **no targets** (`rejected no tags`) and **no sample data** (`rejected stale heartbeat`, `no data`); the share used of the frames it had targets in; a heatmap of the four over time (a cell a second, each as solid as its share of that second's frames; hovering a cell marks its second across every camera's rows and shows all of that column's counts in one readout, as the charts' hover does; clicking it pins that moment for the charts and the field below, and the moment pinned, from either, is marked down the heatmap). Under the cameras, two context bands: **Match** (auto, teleop, endgame, disabled) and **Field zone**: the alliance's own zone, the neutral zone or the other's, and left or right as its drivers see it (right striped). The alliance is taken from where the robot was when auto started (`allianceFrom`), since the logs don't record it; the zones end at each hub's line (`fieldZones`, 4.63 m from each wall: check against the game manual); and its measurements against the fused pose (average and largest distance), with the pose disagreement alarms. Each measurement is kept in the report (MegaTag 2's x and y, MegaTag 1's heading where it gave one, and how far each was from the fused pose), with the fused pose over the span, so the report draws two charts, **distance** (metres) and **heading** (degrees) from the fused pose, one line per camera, zoomed and pinned together. Below them, the field (`FieldCanvas.vue`, which the Signals page's field panel draws with too) at the moment pinned: the fused pose as a robot with its last two seconds behind it, and each camera's latest measurement (up to half a second old) as an outline in its colour, with a table of where each put the robot and how far off it was. Above the charts, **where each camera had valid targets**: each camera's frames used as a point cloud, a point for each rise of its counter where the fused pose was then (`validHeat`), overlaid on one field in the camera's colour on one scale, each camera shown or hidden by its button. Clicking either chart picks the moment; until then it's the largest disagreement, which is what the PDF shows. Reports made before this have no charts or field. On mttd P5 the cameras used 89 to 96% of the frames they had targets in.

### Driver Station logs

The Driver Station writes a `.dslog` while it's open (a record every 20 ms) and a `.dsevents` beside it (`src/main/signals/ds-log.ts`). Both are version 4: a LabVIEW time, then big-endian records.

- **Signals:** trip time, packet loss, battery voltage, roboRIO CPU, CAN use (and Wi-Fi and bandwidth when the Driver Station fills them in, which it only does on a field), each while the robot was there; and as flags or a band, whether it was there, enabled, the mode, brownout and the watchdog. They're under **DS log** in the signal list.
- **What's not read:** each record ends with power distribution data (33 bytes for a CTRE PDP), whose packing isn't documented and couldn't be checked; its length is skipped. Other types (REV's PDH) are measured from the file.
- **Dropped packets:** a record with nothing from the robot is usually one packet that didn't arrive, many times a match. Up to 0.25 s of them takes the record before's mode, so a match isn't split into hundreds of enables; past that, the robot was lost.
- **.dsevents:** the robot's errors and warnings (with where they came from: a CTRE device's name and bus heads the message, so each device's are their own), its printed lines, and the Driver Station's own coded messages, less the ones a DS log says already (lost communication, 44004) or that say nothing (time since boot, radio detection). It writes them down every 2 s or so, so repeats up to 5 s apart are one event. "FMS Connected: Qualification - 12" makes it a match, for the endgame. With a data log that has the robot's console, the robot's messages here (a copy) are left out.
- **Which logs:** only ones a robot was connected to (most are the Driver Station open with no robot). One goes with a data log of the same robot that started while it was being written, or within a minute before; the rest are sessions of their own ("DS log only"), listed in a group of their own below the other logs: Team 973 has 170 of them. Each is read whole once and kept by size and time.
- **Lining up:** by the first enable in both, if that's within 120 s of what the clocks say, otherwise by the clocks (the data log's `systemTime` against the DS log's own start). With a data log, the DS log doesn't stretch the timeline (it runs while the Driver Station's open, often many minutes either side), and only its events in the timeline are listed.
- **Checked:** against Team 973's DS logs (297, 2024–2026: practice and the pit, none on a field) and a copy of one shifted onto Q39 to test pairing. A real match's FMS line and a REV PDH log weren't available.

## Reports

Reports are made quickly from matches and tests (#148). Their parts are kept in the library (`src/shared/library.ts`), checked and cleaned whenever they're read or received (`library-check.ts`).

**Saved views.** **Views** on the Signals page saves the chart as it is (its signals, axes, bands, colours, which are hidden, and which kinds of event show) by name, with the span it shows: the whole log, or the match, autonomous, teleop or endgame. Bringing one back works on any log, and live. The list puts first the views whose signals are most here ("4/5 here"), and finds them by name or by any part of a signal's path.

**Finding signals** (`src/shared/signal-match.ts`). A view or template names signals as the log it was made from did. In another log each is found, in order:

1. by the same name;
2. by the same end of the path: the most trailing parts in common, if no other signal has as many, and at least two (unless the name is one part). Simulation logs `/Robot/robot/drive/speedXMPS` for what the robot logs as `/Robot/drive/speedXMPS`; that's two parts in common, and found. `state` alone is everywhere, and isn't.

**Robot mappings** were dropped (November 2026): they were slow to work through and not used. Signals are found by name and path end only. Mappings already saved in a data folder or the team's library stay there unread.

**Report templates** say what a report is of and what it shows:

- **Of:** the whole match (first enable to last, or the whole log without one), **while the robot is enabled** (every span it was enabled in any mode, merged across drops of up to 2 s; not the time it sat disabled), autonomous only, teleop only, or wherever chosen signals all hold (a test mode: `isTestEnabled` true, say).
- **Sections:** headings and text; a summary (the log, the span, the phases, errors, warnings, brownouts, the battery's lowest and average); charts, copied in from saved views (with the view's span when the log has that phase); stats tables (min, max and mean over the span, weighted by how long each value held, across all its stretches); pie charts, of each slice's share of the total over the span (a slice is a signal, or a named group of them added up: a motor's supply current, say, or a subsystem's motors), either of the signals as they are (their averages times the span: amp-seconds for currents) or of **energy** in watt-hours: each current times a voltage, each held until its next value and added up over time, with the average power beside it. The voltage is one signal for all (the battery's), or each current's own supply voltage, the signal beside it named `…Voltage` for `…Current`, as TalonFXs log theirs in Hoot logs; events, of chosen kinds, errors and warnings only or not; **monitors** (their results: each one's alarms, or that it found none, or that the log hasn't its signals), all of them or those chosen; and **vision system** (see Vision System below).
- A template can be for one robot only. Made from a report (**Make a template from it**), it's the template the report was made from, as it was then.

**Reports** (`src/main/reports.ts`) are made by hand (Reports → Run a report, or a card's run button) or by auto reports. Making one waits for Hoot logs to line up and for their faults, then reads everything it shows once and keeps it: each line at about 1200 points. A report says what it couldn't find. Every report starts with its **problems**: the errors and warnings in its span that its own sections check (`reportProblems`). Those are the events its events sections list (of the kinds each picks), and the alarms of the monitors its monitors and vision sections show; its summary counts the same. So the Vision System report flags only the cameras, and the log's device faults (the Hoot logs', the robot code's, the Driver Station's) and every monitor go to the reports that list the log's errors and warnings: the Match Report, Match Review and the match-phase ones such as Autonomous. An events section can be **power only** (`isPowerEvent`): brownouts, and faults, alerts and messages about the battery, voltage, supply current, breakers or reboots. Power Analysis lists only those, not wheel slip, surfing or the cameras. One can be **Pigeon and CANivore only** (`isPigeonCanivoreEvent`): the Pigeon's faults and the CANivore's bus down, errors and buffer full; the Match Report has one, with the CANivore's use and buffer-full count and the Pigeon's supply voltage and temperature. Events sections further down list what's left (one of only errors and warnings isn't shown again). Reports made before this take their problems from their events sections. A pie with more slices than the palette has colours keeps the largest in colour and the rest grey, each still its own slice, all listed beside it. **Save as PDF** prints the whole report laid out for paper: drawn in a hidden window the width of a Letter page (`/print/report/<id>`, `PrintReportView.vue`), in the light theme whatever the app's, with tables ruled as printed ones are, sections and tables kept whole on a page where they fit, headings kept with what follows them, and the report's name and page numbers along the bottom. Nothing in the app's own window changes while it's made.

**Running reports on many logs.** Run a report (Reports tab) runs one template, or all of them, on the logs selected from the list below it: tick each card, or narrow the list with the filter and **Select all N shown**; **Deselect all** clears the selection (including logs the filter now hides). **All templates** (the default) runs every template that applies to each log's robot instead of one. Reports a log already has are left out unless **Regenerate reports a log already has** is on; when some are, a **Regenerate N existing** button beside Run turns it on, and the Run button says how many it regenerates ("Run 12 reports on 3 logs (8 regenerated)"). A regenerated report replaces the one before. A log's reports run at once, three logs at a time.

**Reports by log.** The Reports tab lists logs as cards, full width, newest first (`src/shared/report-cards.ts`). Each card has the log's match (or name), when it was recorded, its robot, and its reports, each a link by its template's name ("Autonomous", not "Autonomous · mttd P5, Nov 6, 7:09 PM": the card shows the match and time) that opens the report. Flags at the foot of the card count the errors (red) and warnings (amber) its reports found, each problem once however many reports found it, with their titles on hover. A grey flag says how many signals its reports were missing. Errors and warnings are kept in each report's summary (`ReportSummary.problems`), so the list doesn't read whole reports. The cards can be filtered by a search (the log and its reports' names), an **Event**, **Real matches only** and **Only logs with reports**; that last is on by default, so the page opens on the logs that have been analyzed. A log missing reports has a button at its card's top right, always in the same place: **Run 3 reports**, or **Run 2 more** when it has some. It runs one report from each template that applies to the log's robot and hasn't made one for it (`missingTemplates`), all at once, and several cards can run at once; the card fills in as each is made. Clicking a card opens that log on its own: its reports with each one's flags, every error and warning with which reports found it (each once, with a ×N chip when found more than once, `groupProblems`: the reports themselves list each with its time; the flags' hover text groups them the same way), **Open in Signals** (which opens the Signals page with **← Back to reports**, back to where it was opened from), the run button, and **Re-run all N reports**, which runs every template that applies to the log again, replacing the reports it has. **← Back** and the trail above (Reports › log › report) go back; each step in is a step in the history, so the mouse's back button works too. A log that's been deleted keeps a card (dashed) while it has reports. 60 cards show at a time, then **Show more**.

**Auto reports** (Reports → Auto reports, headed Auto report generation; they're `pipeline`s in the code and the library, which keeps saved and shared ones working) run reports on new logs by themselves. After a download or an import, the logs that weren't there before are matched against each auto report that's on: offloaded, imported or both; these robots (or any); these kinds of match, or logs that aren't one (or any). Every template runs (one saved for one robot only on that robot's logs): which ones isn't chosen. Each report says it's by "Auto report: <its name>". They run in the background, a log's reports at once and three logs at a time (the main process keeps the three logs used last open, so reports on them don't take turns loading); **Lately** on the Auto reports tab lists what they ran or why they couldn't. An auto report can also be run by hand on any log.

There's **one auto report configuration** (`theAutoReport`: the first made; libraries from before could hold several, and the others are kept but not run). Its tab is the configuration itself, saved as it's changed: an **On** switch (orange when on, grey when off), which new logs (downloaded, imported), **when several new logs come at once** (a backlog after a long time away: run on all of them, on the newest only, or not at all), which kinds of match, and which robots. It runs every template. Choices are pills, orange with a tick when picked. **Run it now on** runs it on any one log.

**Progress and cancelling.** While reports run (Run a report, a card's run button, auto reports, or reports run again after a log grew), a panel at the top of the Reports page adds them all up: a bar, "N of M done", what's running now, and **Cancel**. Cancel stops everything: what hasn't started doesn't, and each report already running stops at its next step (waiting for Hoot logs, exporting signals, each section) without being saved (`cancelReports`: each report notes a count when it starts and stops once it changes). Reports already finished are kept.
**Where reports are kept, exporting and importing.** Each report is a JSON file in the data folder, `reports/<id>.json`: the template as it was, the log's label, robot and match, the spans, the data its charts and tables read, and the errors and warnings it found, so it shows without its log. **Export all reports** (Reports by log) asks for a folder and makes `Diagnostics reports <date time>` in it: a PDF of each report ("mttd Q12 - Match Review.pdf", drawn as Save as PDF draws one), each report's JSON under `reports/`, and a README. **Import reports** reads report JSON files back (from an export, or another computer's data folder): each is checked (`isReport`, `src/shared/report-files.ts`) before it goes in the data folder; one already here is skipped, and a newer run of the same report replaces an older one.
**Logs that grew, and one report of each.** A log still being written when it was downloaded (the robot's active log) is pulled again once it has grown, at the next download. Its reports then run again from the template each was run with, after what's held of its files in memory is dropped (`rerunReports`; listed in Lately as "Run again (the log grew)"). Only the newest report from each template for each log is kept (`duplicateReports`): running one again replaces the one before, and duplicates already there go when the list is next read.

**Starters.** **Add the starters** (Templates) adds a view for each of #95's starter dashboards (Pit Health, Drivetrain, Shooter, Electrical, Match Review, Controls Debug, Automated Test, Battery Health); the **Path Tracking** view (X and Y position error, and heading error, in auto); five templates: **Match Report** (now with every monitor) (Pit Health, Battery Health and the mechanisms together: is the robot ready for the next match?), **Match Review**, **Autonomous** (with path tracking error: the chart, stats, and the path and surf monitors), **Vision System**, and **Power Analysis** (each motor's and each subsystem's share of the energy drawn while the robot is enabled, in watt-hours: from the robot code's supply currents times the battery's voltage, and again from the Hoot logs alone, each TalonFX's own supply voltage and current, its motors found by CAN id; on Q39 the two come to 52.0 and 50.9 Wh); and an auto report for qualification matches, off until it's turned on (`src/shared/starters.ts`). They're named as Team 973's code logs things, and have fixed ids, so adding them again adds nothing. A starter nobody has changed (still stamped by "Starter" as first added) is brought up to date when the starter changes, when the app starts (`starterRevisions`, `outdatedStarter`): Power Analysis now covers only the time the robot is enabled; Autonomous and Match Report have the monitors. One someone has changed is left as they made it. Starters added since (`newStarters`: Path Tracking, Vision System) are put in a library that has the starters, once (`library/offered-starters.json` remembers), so one someone deletes stays deleted.

**Sharing with the team** (`src/main/cloud-sync.ts`). Signed in to a greybots-apps account (Settings → Team account), the library is kept the same as the team's in Supabase (`DiagnosticsLibraryItem`, `supabase/migrations/20261101120000_diagnostics_library.sql`). Reports and notes aren't shared.

- **Who:** Diagnostics has its own role (`diagnostics_role`), given on the People page like the others, and started at each person's Preflight role. Observers get the library; members and above add to it and change it; only leads and admins delete shared items. The database enforces all three.
- **When:** at start, a few seconds after any change, every five minutes, and on **Sync now**.
- **How** (`src/shared/library-sync.ts`): an item in the cloud only is brought here; one here only, never synced, is sent; one here only that was synced before was deleted by a lead, and is deleted here; one changed on one side takes that side's copy, and one changed on both the copy changed last.
- **The session** is kept in the app's own folder, encrypted with the system's keychain where there is one. Supabase is reached from the main process only: the window's content security policy still allows no other site.

## Installers

`npm run dist:diagnostics` builds an installer for the computer it's run on into `apps/diagnostics/release`. The Diagnostics CI workflow does this on Windows, Linux and macOS for every change and attaches the three installers to the workflow run:

| System | Installer |
| --- | --- |
| Windows | `.exe` (NSIS installer, per user, no admin rights needed) |
| Linux | `.AppImage` |
| macOS | `.dmg`, for Apple silicon and for Intel |

Nothing is code signed. Windows shows a SmartScreen warning on install ("More info" → "Run anyway"), and macOS refuses to open the app until it's allowed under System Settings → Privacy & Security. Signing needs paid certificates and is a later decision.

## Left open

- **The rest of log offload** is [#140](https://github.com/Team973/greybots-apps/issues/140): coprocessor and vision logs, custom paths, more match association, Hoot conversion, and reporting to Preflight (#103). Clearing logs off the robot is #139.
- **Hoot logs (#142):** the data log reader keeps an object per value, which is fine for single-signal exports (about 136,000 values each) but not for exporting many signals at once. Per-entry typed arrays would fix that.
- **Signals still to come (#92):** scaling (a value's multiplier or offset, set per signal).
- **The rest of the live view** is [#146](https://github.com/Team973/greybots-apps/issues/146): the metric groups of §3.2 as a default "Pit Health" dashboard (with dashboards, #95), and signals that aren't in NetworkTables.
- **The rest of log review (#94):** automated test steps as events come with the tests (#100); syncing notes to other computers with Preflight's data sharing (#103); picking which subsystems and buttons a team cares about with dashboards (#95); a DS log's power distribution currents, once their packing can be checked.
- **Reports (#148):** the Diagnostics migration is applied to the team's database, but sign-in and sync haven't been tried against it yet.
- **Other plots (#144):** the live console is only from a roboRIO (a simulator's goes to its terminal), and hasn't been tried against one. The 3D robot's moving parts haven't been tried with a log that has them. Plots aren't in reports yet.
- **The index format.** Offload keeps one JSON file, and signals are read from the log each time it's opened. A store for computed results (match summaries, trends) comes with #97 and #98.
- **How this app and Preflight share data** is [#103](https://github.com/Team973/greybots-apps/issues/103).
- **Sign-in.** The app has none: it works with no internet and holds nothing private. If #103 syncs through Supabase, it will need the account link Preflight's kiosk mode uses.
- **Updates.** There is no auto-update; a new version is installed by hand from a CI run.
