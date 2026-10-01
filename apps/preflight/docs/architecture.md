# Preflight architecture

Preflight is Team 973's pit crew coordination app. It's built to run on a pit
laptop or tablet for days at a time **with no internet**, and to sync with
the shared greybots-apps Supabase project whenever a connection is available.

## Offline-first model

- **App shell**: an installable PWA (`vite-plugin-pwa`, Workbox `generateSW`).
  The service worker precaches every built asset, so once a device has loaded
  Preflight one time it can start and run with no network at all. Google
  Fonts are runtime-cached on first load.
- **Data**: everything lives in IndexedDB (via Dexie, `src/lib/db.ts`). The UI
  always reads and writes the local database. It never waits on the network.
- **Sync**: a background loop (`src/stores/sync-store.ts`) pushes local edits
  and pulls remote changes every minute, on reconnect, a few seconds after
  any local edit, and on demand from the status chip in the nav bar.
- **Updates**: a new deployed version is downloaded in the background, and a
  "new version available" banner lets the user choose when to reload. An
  update never interrupts someone mid-task.
- Preflight calls `navigator.storage.persist()` at startup so the browser
  doesn't evict data under storage pressure. Settings shows whether the
  browser granted this.

### Secure context requirement

Service workers, `crypto.subtle` (PIN hashing), and `crypto.randomUUID` only
work in a secure context: **HTTPS or `http://localhost`**. That means
Preflight can't be served to a tablet over plain `http://<laptop-ip>:port`.
Supported ways to run it:

1. **Hosted (web build)**: open the Vercel deployment once while online,
   then install it (Chrome/Edge "Install app", iPad "Add to Home Screen").
   After that it runs entirely from the device.
2. **Desktop (pit laptop / kiosk)**: `npm run serve:preflight` builds the
   desktop target and serves it at `http://localhost:4173`. Load it once, and
   the service worker keeps it available even if the server stops.

### Build targets

The build target is set at build time by `VITE_DEPLOY_TARGET`
(`isDesktopBuild` in `src/lib/constants.ts`):

- **Web** (the default; what Vercel builds): there is no setup screen. Every
  browser is a personal device, so first launch goes straight to sign-in, or
  to Home if the user is already signed in.
- **Desktop** (`--mode desktop`, which loads `.env.desktop`): first launch
  shows the Kiosk vs. Personal choice (`/setup`). Used for the pit laptop
  or kiosk.

## Device modes

On a desktop build, each device picks a mode on first launch (`/setup`). Web
builds are always in web mode. The choice is stored in the `meta` table and
can only be changed with **Settings → Reset device**, which wipes all local
data.

### Kiosk (shared device)

- Crew members sign in by tapping their name and entering a 4–8 digit PIN.
  Authentication is 100% local, with no network involved.
- Kiosk users live in the local `kioskUsers` table and are **never synced**.
  PINs are salted and hashed with PBKDF2-SHA256 (`src/lib/kiosk-users.ts`).
  This is a convenience lock for a shared tablet, not strong security. A
  short PIN can be brute-forced by anyone who copies the database.
- Setup creates the first admin. Admins manage crew members (add, change
  role, reset PIN, remove) and device settings. The device must always have
  at least one admin.
- The device auto-locks after a configurable idle period (default 10 min),
  and the Lock button returns to the sign-in screen. The signed-in kiosk user
  is kept in `sessionStorage`, so a page reload doesn't sign them out, but
  closing the tab or app does.
- **Syncing**: a kiosk admin can *link* a lead- or admin-role greybots-apps
  account under Settings → Sync. That Supabase session is the device's sync
  credential. Crew members never see it, and locking the device doesn't sign
  it out. Records written in kiosk mode should record the local user's name
  for attribution (e.g. an `updated_by_name` column).

### Web (personal device)

- Sign in with a greybots-apps account (the same email and password as
  GreyScout). Signing in needs internet the first time.
- After that, the Supabase session persisted by `supabase-js` plus a cached
  profile (name and role, from the shared `User` table) let the user keep
  working offline. The profile refreshes whenever the app starts online.
- Preflight doesn't provision `User` rows. Accounts without one are treated
  as `observer`. GreyScout owns account provisioning.

### Roles

Both modes use the same `admin > lead > member > observer` ladder
(`src/lib/roles.ts`). Use `session.hasRole('lead')` in components and
`meta.minRole` on routes.

- **Observers** (accounts not yet made members) can open only the pit
  display; every other route sends them there, and it offers Sign out
  instead of Exit. So the display has something to show, the tables it reads
  are readable by any signed-in account. Tasks and notes aren't.
- **Members** get every page except Pit setup.
- **Leads and admins** also get Pit setup, and are the only ones who can
  change shared settings and the schedule.

**Roles are per app.** An account's row in the shared `User` table has
`role` (its role in GreyScout) and `preflight_role` (its role here), so
someone can be a scouting lead and only an observer in the pit. Preflight
reads `preflight_role`, and its database policies check it.

Both apps show the same People table (`UserManagement` in
`@greybots/common`, with the rules in `lib/user-roles.ts`): everyone with an
account and their role in each app, each changeable from either app. A role
is changed by someone with enough authority *in the app the role is for*:
promote up to your own level anyone below you, and only admins demote. The
database enforces this (`enforce_user_profile_update`); the dropdowns only
offer what it will accept. In Preflight it's under Settings and needs a
connection and a server session; on a kiosk that's the linked account, so
only kiosk admins see it. Kiosk crew members (local PIN users) are separate
and still managed under Crew.

### Navigation

The nav bar (`src/components/NavBar.vue`) shows the page links as a strip.
When the strip can't show every link (a phone, a narrow window, or a role
with many pages), it collapses to a hamburger menu that drops down below the
bar. This is measured, not tied to a screen width: the strip stays in the
layout, invisible, so the bar knows the moment the links fit again. The sync
status and Lock / Sign out are always on the bar itself.

## Sync engine

`src/lib/sync/engine.ts`, driven by `useSyncStore`.

- **Push**: rows with `_dirty = 1` are upserted to Supabase in batches. The
  dirty flag is cleared only if the row wasn't edited again while the push
  was in flight.
- **Pull**: rows where `synced_at` is greater than the saved per-table cursor,
  paged in `synced_at` order. Each pull re-reads the last 60 s before the
  cursor to catch rows from late-committing transactions. Merging is
  idempotent, so the overlap is safe.
- **Conflicts**: last write wins by the client-set `updated_at`. On pull, a
  dirty local row newer than the remote row is kept and pushed next time. On
  push, the server trigger (below) ignores an incoming row older than what
  the server already has, and the next pull brings the newer row down.
- **Deletes** are soft (`deleted = true`) so they propagate to other devices.
- Sync only runs with a Supabase session: the web user's own session, or a
  kiosk's linked account. Otherwise the status chip shows "Not linked".

### Adding a synced table

1. **Migration** (`supabase/migrations/…`, and mirror it in
   `supabase/database/schemas/prod.sql`):

   ```sql
   -- Shared helper; already created by 20260929120000_add_preflight_schedule.sql.
   CREATE OR REPLACE FUNCTION public.preflight_sync_row() RETURNS trigger
   LANGUAGE plpgsql AS $$
   BEGIN
     -- Last-write-wins: drop an incoming update older than the stored row.
     IF TG_OP = 'UPDATE' AND NEW.updated_at < OLD.updated_at THEN
       RETURN NULL;
     END IF;
     -- Server-assigned pull cursor. clock_timestamp(), not now(), so rows in
     -- one transaction still get distinct, increasing values.
     NEW.synced_at := clock_timestamp();
     RETURN NEW;
   END $$;

   CREATE TABLE public."PreflightExample" (
     id uuid PRIMARY KEY,
     updated_at timestamptz NOT NULL,
     deleted boolean NOT NULL DEFAULT false,
     synced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
     updated_by_name text,
     -- ...feature columns...
   );
   CREATE INDEX ON public."PreflightExample" (synced_at);
   CREATE TRIGGER preflight_sync_row BEFORE INSERT OR UPDATE ON public."PreflightExample"
     FOR EACH ROW EXECUTE FUNCTION public.preflight_sync_row();

   ALTER TABLE public."PreflightExample" ENABLE ROW LEVEL SECURITY;
   -- + select/insert/update policies based on the caller's User.role
   ```

2. **Client**: add a `SyncedRecord` subtype, register it in
   `src/lib/sync/registry.ts`, and bump `schemaVersion` in `src/lib/db.ts`.
3. **Read** with `useLiveQuery(() => activeRecords<T>('table').toArray(), [])`.
   It re-renders automatically when sync pulls new rows.
4. **Write** only through `saveRecord` / `deleteRecord`
   (`src/lib/sync/local-repo.ts`). They set the bookkeeping fields and
   schedule a push.

## Overview and the pit flow

The landing page (`/`, members and above) changes layout with the robot's
status, which moves through a fixed cycle:

```
Inbound --(Robot arrived)--> Pending: checklist 1 ... N --> Robot Ready
   ^                          |        ^                         |
   |                     (Repairs)  (back / pre-match)           |
   |                          v        |                         |
   |                       Repair in progress                    |
   +--(Match over, or automatic when the match ends)-- Away <--(Robot departed)
```

- **Inbound:** a big "Robot arrived" button, with tasks and the schedule.
- **Pending:** the active checklist with its steps, and a separate panel for
  the active step: its instructions and who holds each role. Steps are done
  strictly in order (one Done button for the active step; Undo for the last
  one). Finishing a checklist loads the next, and the count-up timer resets.
  After the last checklist, the robot is Ready. Tasks stay available.
- **Repair in progress** (red): from any checklist, "Repairs" stops the flow
  immediately, with no prompt. The repair screen is a compact red strip
  (time in repair, plus the ways out) above the repair log, whose inline row
  logs a repair and starts it at once, with tasks beside it. Afterwards
  the pit goes back to the interrupted checklist (same run, so its checked
  steps are kept) or straight to the pre-match checklist (the one flagged
  pre-match on Pit setup, else the last checklist).
- **Practice field:** a side trip, offered only once the robot is clear of
  post-match and not in repairs: on the pre-match checklist (or a later one)
  or Robot Ready. A big "Practice field" button beside Repairs (or beside
  "Robot departed" when Ready) starts the practice field checklist, which
  runs like any other (Pending). Finishing it puts the robot *At practice
  field*; "Back from practice field" then starts the pre-match checklist from
  the top in a new run, since the robot has been driven. From the practice
  checklist, "Back to pre-match" does the same without going.
- **Robot Ready / Away:** the status banner (with "Robot departed" or "Match
  over"), the schedule strip, and tasks. (The `CountdownTimer` component is
  in `@greybots/common` but not shown for now.)
- **Smart steps** (`src/lib/checklists/smart.ts`): a step can have a
  condition. "Swap bumpers" (`bumper_swap`) compares our alliance in the last
  match played with the next match on the TBA schedule. When the color
  doesn't change, the step is checked off as *skipped* (grayed out, with the
  reason) and counts as complete. Skips are computed, not stored, so they
  follow schedule changes; when the schedule can't tell (e.g. before the
  first match), the step stays a normal step. `bumper_hint` never skips: it
  only says whether swapping now is worth it (used by the practice field
  checklist, where either color will do).

How it's stored:

- **Status** (`PreflightRobotStatusLog`, `src/lib/robot-status/`): an
  append-only log; the newest entry is the current status, so devices never
  overwrite each other. Arriving starts a *run* (`run_id`). Each checklist
  is its own Pending entry (`checklist_index`), which is what resets the
  timer. Departing records the match the robot left for (`match_key`). A
  Pending entry for the practice field checklist has `checklist_id =
  'practice'` instead of an index, and `practice` is the status while the
  robot is at the practice field.
- **Automatic Inbound:** `effectiveStatus()` shows Away as Inbound once that
  match has ended. This is computed, not written, so no device writes
  transitions in the background. The only transitions written automatically
  are the ones the person checking the last step causes, and
  `advanceChecklist` skips if another device already advanced.
- **Checklist steps** (`PreflightChecklistCheck`, `src/lib/checklists/checks.ts`):
  one row per checked step per run (who and when). Its id is derived from
  run + checklist + step, so devices converge.
- **Configuration** (`src/lib/checklists/config.ts`, edited on **Pit setup**,
  `/pit-setup`, leads/admins): the pit roles roster (role → assignee) and one
  standard checklist sequence (checklists → steps with instructions and
  roles), stored as the `pit_roles` and `checklist_sequence` settings. Steps
  reference roles, so reassigning a role updates every checklist. The
  standard roles are Pit Lead, Mechanical, Electrical, Programming, Battery,
  and Drive Team; Pit setup offers any that the roster is missing. "Load
  suggested checklists" seeds both from the requirements doc.
- Anyone member and above drives the flow; leads/admins also get a manual
  override (and everyone sees the history) under "Status history".
- **Tasks** (`PreflightTask`): members and above add, reorder, start, and
  check off tasks; finished tasks appear on the Schedule calendar under the
  "Tasks" filter. Each task has an owner (`assignee`), shown in every task
  list ("Unassigned" when nobody has it), and anyone can claim a task with
  "Assign to me" in its dialog.
- **Status log order:** entries are ordered by when they were written
  (`updated_at`), not by `set_at`, the time shown to people. Testing mode or
  a drifting device clock can make a newer entry's `set_at` look older.

### People

Anywhere work is assigned (task and repair owners, pit roles), the person is
chosen with `PersonPicker`, a searchable dropdown. Names can't be typed in
freely. The list (`src/lib/people.ts`) is:

- everyone with a greybots-apps account (the shared `User` table). After a
  sync, a device with a server session saves the names locally (refreshed at
  most every 10 minutes, and at once when a kiosk is linked), so the list
  keeps working offline. A kiosk needs its linked account for this: `User`
  is only readable when signed in.
- plus this device's kiosk crew, the people actually in the pit. A kiosk that
  has never been online, or was never linked, offers only them.

The stored value is the person's name. A name saved earlier that's no longer
in the list stays selectable on that record.

### Checklists

`src/lib/checklists/`. Two kinds of checklist are configured on Pit setup:

- **Pit checklists:** the standard sequence above, run on the Overview every
  pit visit (the `checklist_sequence` setting).
- **Practice field checklist:** the one built-in checklist (the
  `practice_checklist` setting, id `practice`), run from the Overview as
  described above. Until it's edited it's a suggested one: swap in a charged
  battery, bumpers installed (with the swap hint), spool packed, and driver
  station ready, the last two for Programming.
- **Other checklists:** started by hand from the Checklists page
  (`/checklists`) when needed, e.g. start of day, a bumper swap, or a
  subsystem deep dive (the `adhoc_checklists` setting). Each run is a
  `PreflightChecklistRun` row holding a snapshot of the checklist, so editing
  the template later doesn't change a run in progress or the history.

Both are run by the same component (`ChecklistRunner`), and both record their
checked steps as `PreflightChecklistCheck` rows under a `run_id`.

- **What a step records** (`input`): just a check, free text (e.g. driver
  feedback), pass or fail, or the battery going in the robot. The value is
  stored in the check's `value`. A battery step also assigns that battery to
  the run's match (see Batteries), and a failed step is marked in the list.
  It starts on the recommended battery (`recommendBattery()`): the next
  active battery in number order after the one installed most recently,
  wrapping to the lowest. Confirming is one tap; another battery can be
  picked or scanned instead.
- **Instances per match** (`instances.ts`): each run belongs to a match where
  that makes sense, which names it ("Qual 12 · Pre-match", "Qual 9 → Qual 12
  · Bumper swap") and is stored as the check's `match_key`. In the pit
  sequence, checklists before the pre-match one go with the match just played
  and the rest with the next match; "Belongs to" on Pit setup overrides this
  per checklist.
- **History:** the Checklists page lists every run at the event with its
  start and finish times and, per step, who did it, when, and what was
  recorded. Ad-hoc runs come from their run rows; runs of the pit sequence
  are rebuilt from the checks, with the start time from the robot status log.
- Steps that complete themselves from robot state (DS connected, logs
  offloaded) wait on the diagnostics integration (#103). Smart steps are the
  place to add them.

### Testing mode (admins)

Settings → Testing mode lets an admin pretend it's a different date and
time on that device, e.g. to replay an event day that's over and check the
schedule-driven features. The clock keeps ticking from the pretend time, and
an orange strip shows while it's shifted. Everything user-facing reads the
app clock (`clockNow()` / `useNow()` in `@greybots/common/lib/now`): the
now-lines, automatic Inbound, smart steps, and recorded times (status
changes, checked steps, task start and done). Sync bookkeeping
(`updated_at`, `synced_at`) always uses real time. Data recorded in testing
mode carries pretend times, so test on a test event.

## Schedule

The Schedule page (`/schedule`, members and above) is a Google Calendar-style
view of the whole event, built on FullCalendar's time grid.

- **Event settings** (lead/admin): TBA event key, team number (default 973),
  name, and first/last day. They're stored as the shared `active_event` row
  in `PreflightSetting`, so every device shows the same event. "Look up on
  TBA" fills in the name, dates, and timezone; everything can also be entered
  by hand while offline.
- **TBA matches** (`src/lib/schedule/tba-import.ts`): the `tba-proxy` Edge
  Function's `get_team_schedule` action returns the event and our team's
  matches. Each match becomes a `PreflightScheduleItem` whose id is derived
  from the TBA match key, so two devices importing at once converge on the
  same row. Blocks start at the actual, then predicted, then published time
  and last `matchBlockMinutes`. Only changed rows are written, and matches TBA
  drops are soft-deleted. Import runs from the "Import from TBA" button, when
  the event changes, and every 5 minutes on a lead/admin device with the
  schedule open and online. It needs a Supabase session (a kiosk's linked
  account works).
- **Match timing** (`src/lib/schedule/timing.ts`): each match has a
  published time, an estimate, an actual start, and a completion time (TBA's
  `post_result_time`). The estimate is, in order: a manual override for that
  match (set from the match on the calendar), the published time plus the
  manual field delay ("running 12 min behind", under **Match timing**), TBA's
  prediction, then the published time. The delay and overrides are the
  `match_timing` setting (lead/admin), so they work offline and sync to every
  device. `listScheduleItems()` moves each match to its estimate and attaches
  its `times`, so the calendar, countdowns, automatic Inbound, and smart steps
  all follow it. Feature code should read the schedule through that function,
  not the table.
- **Completion from GreyScout** (`src/lib/schedule/scouting.ts`): a match is
  also complete once it has scouting data, which usually arrives before TBA
  posts the result. After each sync, every device asks GreyScout's
  `MatchData` table which of our unfinished qualification matches have
  entries (matched on the event key and match number) and keeps the earliest
  submission time per match locally. TBA's result time wins when both exist.
  An Away robot goes back to Inbound as soon as its match is complete by
  either source, or its block on the calendar ends. A completion time only
  counts once the app clock has reached it, so replaying a past event in
  testing mode isn't cut short by data from that event's future.
- **Prep timing** (the `match_prep` setting): how long before a match to
  start prep and to leave for the queue. `matchDeadlines()` turns that into
  deadlines. The Overview (`NextMatchLine`) and the pit display show one
  labeled countdown (`matchCountdown()`): "Time to queue:" until queue time,
  then "Time to match:" until the match's estimated start.
- **Custom events** (lead/admin): drag across empty time to create, drag to
  move, drag the bottom edge to resize, and tap to edit or delete. Each one
  has a type (Event / Practice / Pit / Programming / Admin), which drives its color and the filter
  toggles. Matches can't be dragged; they're colored by our alliance.
- Times are shown in the device's timezone. A notice appears when that
  differs from the event's TBA timezone.
- **Event timeline** (`src/lib/schedule/milestones.ts`): milestones for the
  whole event (load-in through departure) are schedule items of kind
  `milestone`, each with a `phase` (event preparation, competition day,
  elimination tournament, event closeout). So they appear on the calendar,
  follow the type filters, and sync like any other item. The Schedule page's
  **Timeline** view lists them by phase. Leads/admins add the standard set
  from the requirements doc (ids are derived from the event and template key,
  so devices converge; planned times are only starting points), then add,
  rename, retime, reorder (neighbors trade start times), or delete them per
  event. `currentPhase()` gives the phase the event is in right now.
- A live query (`useLiveQuery`) must only await database calls. Awaiting
  anything else inside it (e.g. `uuidFromName`, which hashes) makes Dexie
  lose track of what the query read, and it stops updating. Compute such
  values outside the query.

## Stats

`/stats` (members and above; `src/lib/stats/pit-stats.ts`) shows how long the
pit takes and where the time goes. Nothing is stored for it: everything is
worked out from the robot status log, where the time in a state is the gap to
the next entry, and from the checked steps.

- A **turnaround** is one pit visit, from the robot coming in to it being
  ready. Its time is the time on the pit checklists plus the time in repairs.
  The practice field side trip (its checklist and being at the practice field)
  and time sitting Ready never count. A turnaround is only counted once the
  robot reached Ready.
- **Headline numbers:** average (and median) turnaround with and without
  repairs, average repair time, practice field prep time, and the average
  time on each checklist with repairs left out. A run of a checklist only
  counts once the pit moved on from it.
- **Each turnaround** is a stacked bar: post-match (every checklist before
  the pre-match one), repairs, pre-match (that checklist and any after).
- **Histograms** show how each of those times is spread.
- **Slowest steps:** a step's time is the gap from the step before it,
  counting only time spent on that checklist, so a repair in the middle isn't
  blamed on the next step.
- The chart colors (`.viz-root` in `base.css`) are a fixed three-series
  palette checked for color-blind separation in both themes. Stages are also
  named in a legend and available as a table, so color is never the only cue.

## Event script

`/script` (leads and admins; `src/lib/script/event-script.ts`) puts the
rest of the event on paper, for people who'd rather work from a printout.

- **One checklist per sheet**, so each can be handed to whoever is doing it.
- **Match pages:** for each match of ours that hasn't started yet (on the app
  clock), a sheet per pre-match checklist and a sheet per post-match one.
  With one of each, a match prints as the front and back of a page. The
  pre-match sheets have the match time, when to start prep and when to queue,
  our alliance, partners and opponents, and the pit checklists for that match
  with the smart parts already worked out: whether to swap bumpers and from
  which color to which, and which battery is next in the rotation. Which
  checklists are pre-match and which are post-match follows the same rule the
  Overview uses to tie a checklist to a match.
- **Blank checklists:** one page per checklist (the pit sequence, the practice
  field checklist, and the ad-hoc ones) with nothing filled in and the
  conditions spelled out, for playoffs and anything else that can't be known
  ahead.
- **Printing:** "Print / save as PDF" opens the browser's print dialog, which
  prints or saves a PDF. Only the sheets print (letter, one per page, black
  on white whatever the app theme). Steps that record something get a place
  to write it. It's built from what's on the device, so it works offline.
- Times are a snapshot: they're the estimates at the moment of printing.

## Pit display

`/display` (`src/views/PitDisplayView.vue`) is a full-screen, read-only
summary for a TV in the pit. (The requirements call this "kiosk mode"; here
"kiosk" already means the shared-device sign-in mode, so it's the *pit
display*.)

- The robot status fills the top third. Below it are widgets: next match,
  countdown, readiness (prep and queue deadlines, open repairs), current
  match, active checklist with progress, active repair, battery installed,
  pit responsibilities, and event phase. Sizes follow the viewport, and the
  type scales down as more rows of widgets are shown, so nothing scrolls.
- **Layouts per phase** (`src/lib/display/display.ts`, the `pit_display`
  setting): leads/admins choose and order the widgets for each event phase on
  Pit setup. The display follows the phase from the event timeline
  (`currentPhase()`), uses the default layout when there are no milestones,
  and can be pinned to one phase's layout.
- **Stays up:** it reads only the local database, so reloads and network
  drops don't affect it. The route is marked `bare` (no nav bar, and the kiosk
  idle lock is off while it's showing) and `kioskPublic` (on a kiosk it's
  reachable while the device is locked; on a personal device it needs a
  signed-in member). It asks the browser for a screen wake lock where
  that's supported.
- Diagnostic warnings and automated test results aren't shown yet: they come
  from the diagnostics integration (#103).

## Repair and maintenance log

`PreflightRepair` (`src/lib/repairs/repairs.ts`; members and above) records
each repair or maintenance job: what, subsystem, component, robot, who's on
it, a status (open → in progress → done), and who reported, started, and
finished it and when. This is separate from the robot's *Repair in progress*
status, which only says the pit flow is paused.

- **Logged from:** the Repairs page (`/repairs`, the whole log including
  finished work), a checklist ("Log a repair for later" on the active step),
  the Repair screen's quick-add row (starts the repair at once), or a task
  ("Log as repair" in its dialog). `source`, `task_id`, and `run_id` record
  where it came from; repairs found in the pit default to the match just
  played (`match_key`).
- **Common repairs** (`src/lib/repairs/presets.ts`, the `repair_presets`
  setting): one-tap options shown when logging a repair, in the dialog and
  under the Repair screen's quick-add row. Each fills in what's being
  repaired and its subsystem, and belongs to a pit subteam (a pit role,
  picked with a searchable dropdown): the repair goes to whoever holds that
  role. Leads/admins edit the list on Pit setup; a suggested list is used
  until one is saved.
- **Surfaced:** repairs in progress show as a chip next to the robot status
  on the Overview in every state. In the Repair state, the repair log takes
  the main panel, with tasks beside it.
- `component` is free text until the parts inventory (#89) exists, and there's
  no link to test runs until the diagnostics integration (#103); "what was
  repaired between two tests" is answered by the timestamps for now.

## Batteries

`src/lib/batteries/batteries.ts`; members and above. Batteries belong to the
team, not to one event, so these tables aren't filtered by event.

- **Registry** (`PreflightBattery`): number, label, purchase date, and
  lifecycle status (active / suspect / retired). The id is derived from the
  number, so two devices registering battery 7 converge. The number can't be
  changed afterwards.
- **Measurements** (`PreflightBatteryMeasurement`): manual readings of
  resting voltage, internal resistance (mΩ), state of charge, capacity (Wh),
  and observations. Every value is optional; cards show the latest value of
  each. `source` is `manual` today, leaving room for charger telemetry.
- **Use** (`PreflightBatteryUse`): a battery going into the robot for a
  match or a test. The newest use with no `removed_at` is the installed
  battery, and installing one takes the previous one out. The installed
  battery shows as a chip next to the robot status on the Overview.
- **Pages:** `/batteries` is the grid of cards from the mockup;
  `/batteries/:number` has details, assignment, measurements, and history;
  `/batteries/labels` prints QR labels (`?only=<number>` for one).
- **QR:** labels encode `preflight:battery:<number>`, generated on the device
  (`qrcode`). "Scan label" decodes camera frames on the device (`jsQR`), so
  both work offline; typing the number is the fallback. The camera needs a
  secure context, like the rest of the app.
- **Printing:** the app scrolls inside a fixed `#app`, which would print only
  what's on screen. `base.css` has print rules that let the page flow and
  hide anything marked `.no-print`.

## Notes

The Notes page (`/notes`, members and above; `PreflightNote`,
`src/lib/notes/notes.ts`) holds quick, timestamped notes for the active
event. "+" creates a note at the top and opens it with the cursor in the
title; an open note saves automatically. Each note records who wrote it and
when (`noted_at`, on the app clock), can be dragged to reorder (a float
`sort_order`, like tasks), and can link to a match, a subsystem, and a robot.
Subsystem and robot are free text with suggestions (`src/lib/subsystems.ts`).

## Dialog conventions

- Dialogs use `AppDialog` and stay compact enough to fit a short screen
  (about 650 px) without scrolling: related fields share a row and notes are
  two lines. Quick-create presets are small chips that wrap (`.preset-chips`),
  so every option shows at once.
- **Creating** something uses an explicit Create/Save button. **Editing**
  something that already exists saves automatically with `useAutosave`
  (`src/lib/autosave.ts`): it saves about 600 ms after typing stops (or on
  blur, for fields where saving mid-typing is wrong, like the event key),
  only when values actually changed, blocks invalid values with an inline
  error, and flushes on close. `AutosaveStatus` shows Saving…/Saved.
- Give an editing dialog the **live** record (look it up by id from a live
  query), and write partial changes with `patchRecord`, which reads the
  stored row first. A copy captured when the dialog opened can be stale, and
  writing it back would undo other changes.

## Deployment

- **Vercel**: create a second Vercel project from this repo with **Root
  Directory = `apps/preflight`** (framework preset: Vite). `vercel.json`
  handles the SPA rewrite and makes sure `sw.js` and the manifest aren't
  cached by the CDN, so updates reach devices.
- **CI**: `.github/workflows/preflight-ci.yaml` type-checks and builds on
  every PR that touches `apps/preflight` or `packages/common`.
- Build output (`apps/preflight/dist`) is gitignored. Unlike GreyScout, it
  isn't committed.

## Commands (from the repo root)

| Command | What it does |
| --- | --- |
| `npm run dev:preflight` | Vite dev server (web target) with HMR. The service worker is disabled in dev. |
| `npm run dev:preflight-desktop` | Dev server for the desktop target (shows kiosk/personal setup). |
| `npm run build:preflight` | Type-check and production build (web target, as Vercel builds it). |
| `npm run build:preflight-desktop` | Type-check and production build for the desktop target. |
| `npm run serve:preflight` | Build the desktop target, then serve it at http://localhost:4173 with the service worker active. Use this to run a pit laptop or to test offline behavior. |
| `npm run type-check:preflight` | Type-check only. |
