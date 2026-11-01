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

The Settings page saves each change as it's made: a switch or a choice at once, a text or number box once typing pauses (600 ms). A change with something wrong with it shows why and isn't saved until it's put right; the top of the page says which.

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

**Check connection** on the Offload page tries a TCP connection from the main process to each address on the NetworkTables port (5810) and the SSH port (22). It only says whether something answered; it doesn't speak either protocol yet.

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

## Pages

- **Signals** (what the app opens on): logs and live signals, plotted.
- **Offload:** the robot's connection (where it's looked for, Check connection) and offloading from it.
- **Storage:** the data folder, importing logs, and every log here: offloaded or imported, 10 to a page, sorted by when it last changed or by match (event, then practice, qualification and elimination, then number), either way.
- **Settings.**

## Log offload

The Offload page shows offload status. The work is done in the main process (`src/main/offload-service.ts`, `src/main/offload/`).

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

- **The signal list** is one tree of the signals' own paths. A folder holding only one folder is shown as one (`Robot / robot`), each folder shows how many signals it holds, and the filter opens everything that matches. The top level starts open.
- **Adding signals:** drag a signal onto the chart. While dragging, there's a drop zone for each axis (L1, L2, … and R1, …), for a new left or right axis, and for the top and bottom bands (only the bands, for text). Clicking a signal adds it to L1.
- **Axes:** L1 is next to the plot and L2 outside it, and the same on the right. Each axis fits the values of its signals in the span shown, and is labelled with their units. An axis with nothing left on it goes away.
- **Bands:** text signals (subsystem states) are drawn as bands of labelled spans in the signal's colour, above the plot or below it. Any other signal can go in a band too, to show a number as states: a 0/1 flag as false/true (true darker), or a mode number. A value repeated is one span.
- **Under the chart:** a list of what's plotted, with each signal's colour, its axis or band (changeable, including to a new axis), and its value: the latest while following live, otherwise at the right edge of the span shown. **Show** adds its min, max or mean over the span shown; the choice is kept between visits. Four signals show before the list scrolls. Rows can be dragged onto the chart to move them.
- **Values in the signal list:** each signal in the tree shows its value too, at the same moment as the list under the chart, a few times a second at most. They're read for just the rows showing (`readValues`). A Hoot signal's shows once it's been exported (plotted), since exporting is slow.
- **Room:** the sidebar can be hidden to a thin strip, and the log's details at its top folded away to give the signal list more room. Both are kept between visits.
- **Zoom:** scroll to zoom around the pointer, Shift+scroll to pan, drag across the plot to zoom to that span, and double-click (or **Show all**) to see everything. Zoom buttons do the same. Each change re-reads only the span shown, at about two points a pixel, so zooming in shows full detail.
- **Hover:** shows every signal's value at that moment (the last value at or before it).
- **Pinning a moment:** a click on the chart pins that moment with a dashed line, and its values stay in their own readout at the bottom of the plot while hover reads elsewhere (with how far it is from the pin) and, live, while the chart moves along. Once the moment's out of view, its readout keeps the values last seen. A click elsewhere moves it; its ✕ or Escape lets it go. Clicks and double-clicks are told apart from pointer-ups rather than the browser's click events, which don't fire while the chart redraws under the pointer (live).
- **Warnings:** opening a log warns when DogLog's queue filled up (its `QueueRemainingCapacity` reached 0), since DogLog drops values while it's full.
- **Colours:** up to 8 signals, in the reference palette's fixed order. A signal keeps its colour while it's on the chart. Clicking a colour in the list under the chart picks another palette colour or any colour; the choice is kept by signal, between visits, so the signal gets it back when added again. Any colour picked is the same in both themes. Light and dark each have their own steps, validated against the card colours. Three of the light ones are under 3:1 against white, so every signal is also named in the list under the chart.
- **What's kept:** the chart survives going to another page and back (`src/renderer/src/stores/plot-store.ts`). Saving charts, and reports of several charts, are dashboards (#95).

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
- **Dropouts:** what was kept stays through a dropout, and the connection comes back on its own. If the robot's clock went back (robot code restarted in a simulator), the timeline starts afresh.
- **Letting go:** the window asks for the connection's state ten times a second while it's showing a live session. When it stops for 15 s (another page, another session, closed), the connection is closed.

**Following.** While live, the chart shows the last 30 s up to now and moves along. Scrolling the wheel, or Zoom in and Zoom out, show more or less of the latest and keep following; **Show all** (or double-click) follows everything kept. Shift+scrolling back, or dragging across the chart, holds it still to look at something; **Follow live**, or Shift+scrolling back to now, follows again. New signals appear in the list as robot code first publishes them.

**Testing without a robot.** Team 973's robot code runs in simulation (`./gradlew simulateJavaRelease` in the robot repo, with `ROBOT_SIM_NO_GUI=1` for no window) and publishes the same `/Robot` signals. Its `test/` tools enable it through the simulated Driver Station.

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
- **The rest of the live view (#93):** the metric groups of §3.2 as a default "Pit Health" dashboard (with dashboards, #95), and signals that aren't in NetworkTables (CTRE devices' own status, the PDH) unless robot code publishes them.
- **The index format.** Offload keeps one JSON file, and signals are read from the log each time it's opened. A store for computed results (match summaries, trends) comes with #97 and #98.
- **How this app and Preflight share data** is [#103](https://github.com/Team973/greybots-apps/issues/103).
- **Sign-in.** The app has none: it works with no internet and holds nothing private. If #103 syncs through Supabase, it will need the account link Preflight's kiosk mode uses.
- **Updates.** There is no auto-update; a new version is installed by hand from a CI run.
