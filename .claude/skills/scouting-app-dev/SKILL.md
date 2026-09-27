---
name: scouting-app-dev
description: Conventions and workflow for developing GreyScout, Team 973's FRC scouting web app (Vue 3 + Pinia + Supabase, with a Python/uv util/ toolkit for TBA sync). Use for any feature work, bug fixes, or schema changes in this repo.
---

# GreyScout development

FRC Team 973's scouting app: match scouting, pit scouting, team analysis, and
a drag-and-drop pick list. Frontend is Vue 3 (mostly Options API, some
`<script setup>`) + Pinia + Vue Router, backed by Supabase (Postgres, RLS,
Storage). The app lives at `apps/greyscout/` in an npm-workspaces monorepo;
generic/reusable Vue code (base UI components, charts, theming, the Supabase
client) lives in `packages/common/` and is imported as `@greybots/common/...`.
The `supabase/` project (migrations, schema, Edge Functions) stays at the
repo root so any future app can share it. A separate `apps/greyscout/util/`
directory is a Python/uv toolkit that syncs event/team/robot-photo data from
The Blue Alliance into Supabase.

## Workflow rules

- **Only commit when the user explicitly says "commit this"** (or equivalent).
  Never commit proactively after finishing a task — report what changed and
  wait.
- **Only push when the user explicitly says "push it"** (or equivalent), even
  if a commit was just made. Each push needs its own explicit go-ahead.
- Before considering a frontend change done: run `npm run type-check` and
  `npm run build` (from the repo root — these proxy to the `apps/greyscout`
  workspace), then revert the build output — it's git-tracked:
  `git checkout -- apps/greyscout/dist/ && git clean -fd apps/greyscout/dist/`.
- For UI changes, live-test with the claude-in-chrome browser tools rather
  than just trusting the build: log in, navigate, screenshot, verify, then
  log out. Test account: `test@greybots.com` / `test973` (role: member).
  There's also a live dev server (`npm run dev`, port 5173) with HMR — edits
  via the Edit tool land in the running page automatically, no rebuild needed
  for live testing.
- If Chrome is genuinely shared with the user's own testing session (they'll
  say so explicitly), be more cautious with login/logout cycles and
  destructive drag-and-drop tests against real data — ask if unsure, unless
  they've said it's fine to disrupt their session.
- Never test destructive or reordering UI actions against the real/default
  production event's Team List or other shared data without checking first —
  prefer a personal list, a test account, or confirming with the user.
- `gh` is not installed in this environment (Windows/git-bash) — there's no
  fallback to `gh pr create`. To push and open a PR: `git push -u origin
  <branch>` still works over the existing SSH remote and prints a
  `.../pull/new/<branch>` compare URL; hand that URL to the user (with a
  suggested title/description) to open the PR themselves, or drive it via
  claude-in-chrome browser tools if they're connected — don't attempt a raw
  GitHub API call without a token (none is set in this environment either).

## Data model conventions

- Scouting forms (`apps/greyscout/src/lib/2026/match-scouting-form.ts`,
  `apps/greyscout/src/lib/2026/pit-scouting-form.ts`) return an array of
  `{ key, name, components: [{ key, label, type, options, defaultValue,
  value, required, error }] }`. `parseScoutData()` in
  `apps/greyscout/src/lib/data-submission.ts` flattens this to
  `db_data[section.key + "_" + component.key] = value` for the DB insert.
  `validateForm()` in the same file handles required-field validation per
  component `type` (text/textarea, radio, number, dropdown) — a component
  type that doesn't have a validation branch there silently never blocks
  submission.
- Every shared input component (`TextInput.vue`, `TextAreaInput.vue`,
  `Dropdown.vue`, `RadioButtons.vue`, `Number.vue`) needs both a `required`
  and an `error` prop wired through to the underlying `md-*` element for
  required-field styling/validation to actually show — adding `required` to
  a form schema entry does nothing visually if the component itself doesn't
  accept/forward that prop.
- Form submissions are tied to the submitting user via `scouted_by`
  (`auth.uid()` default) rather than a free-text scout-name field — pull the
  scout's display name from the `User` table via that FK when attributing
  comments/data.
- Match/pit scouting submissions use the offline-first pattern: on submit
  failure, the payload goes into `useOfflineQueueStore`'s localStorage-backed
  queue (`greyscout_offline_queue`), retryable later via the `OfflineQueue.vue`
  FAB/drawer. Reuse this pattern (not QR codes or other ad hoc mechanisms)
  for any new offline-capable submission flow.
- When surfacing a Supabase error to the UI, use `error.message` — Supabase
  errors are plain objects (not `Error` instances), so `String(error)`
  produces `"[object Object]"`.
- To enforce "at most one X per group" (e.g. one default/active row per
  team, one personal picklist per user+event), use a partial unique index
  rather than app-only checking: `CREATE UNIQUE INDEX ... ON "Table"
  (group_col) WHERE (flag_col = true)`. See `picklist_personal_unique`/
  `picklist_team_unique` and `autopath_default_unique` in
  `supabase/database/schemas/prod.sql`. The app must still clear any
  existing flagged row *before* setting a new one (two statements, not
  atomic) since the index will otherwise reject the write.
- A file with both `<script setup>` and a plain `<script lang="ts">` block
  (the common pattern here, e.g. `PitScoutingForm.vue`, `AutoPathCard.vue`)
  compiles to one JS module — imports/consts declared in `<script setup>`
  are plain module-scope bindings, so the Options API block's `methods`/
  `computed`/`data()` can reference them directly (no `this.`) and the
  `<template>` can too. Only put something in `data()` if the *template*
  needs to read it as a reactive/bound value (e.g. exposing an imported
  choices array for `v-model`/`:choices`).

## Supabase schema changes

- Source of truth is the declarative schema at
  `supabase/database/schemas/prod.sql`, with generated migrations. When you
  add a migration, hand-update `prod.sql` to match in the same commit —
  don't rely on `db diff` to regenerate it here (see below).
- `supabase db diff` (linked or not) provisions a local shadow database via
  Docker, so it hard-fails with `LegacyDeclarativeShadowDbError` /
  `failed to inspect docker image` whenever Docker Desktop isn't running or
  installed — true in this environment. Don't loop on retrying it; there is
  no local-only validation path here. Instead, hand-review new SQL against
  the style of existing migrations, then apply for real (see below).
- Without Docker, the reliable no-Docker workflow is: `supabase login`
  (interactive — ask the user to run `! supabase login` themselves, then
  continue once they confirm), `supabase db push --linked` to apply
  migrations directly against the live project, and
  `supabase migration list` afterward to confirm the pushed version now
  shows the same value in both the `local` and `remote` columns.
- `supabase db diff --linked` (on a machine where Docker *is* available)
  additionally has a known stale pg-delta catalog cache bug and can report
  "No schema changes found" even when there are real diffs — **never trust
  it alone**. Cross-verify against the live database directly:
  `supabase db query --linked` against `information_schema.columns` /
  `information_schema.tables`.
- `supabase db push --linked` always prints a non-fatal
  "failed to cache migrations catalog" pgdelta cert error at the end — this
  is expected noise, not a real failure.
- `supabase migration repair --status applied/reverted <version> --linked`
  reconciles migration-history bookkeeping when it drifts from what's
  actually applied.
- Check whether a table already has real data before editing its schema —
  `db diff` can show a destructively-looking DROP/CREATE against live rows
  even when the intent is additive. If real season data is present, prefer
  renaming/archiving over drop-and-recreate.

## Known gotchas

- **The whole app scrolls inside `#app`, not the window.**
  `packages/common/src/styles/main.css` sets
  `#app { position: fixed; overflow: auto; }`, so `window.scrollBy()` /
  `document.scrollingElement` are silent no-ops. Any custom scroll logic
  (autoscroll, scroll-to-element, etc.) must target
  `document.getElementById('app')` (with a `document.scrollingElement` /
  `document.documentElement` fallback) instead of the window.
- vuedraggable/SortableJS's built-in autoscroll (`scroll-speed`,
  `scroll-sensitivity`, `scroll-fn` options) is unreliable in this app —
  a `scroll-fn` override was tried and silently did nothing in practice.
  The working pattern is a fully self-contained autoscroll: disable the
  built-in one (`:scroll="false"`), drive a `requestAnimationFrame` loop off
  the documented `@start`/`@end` events, track pointer position via
  `document`-level `pointermove`/`touchmove`/`mousemove` listeners, and
  scroll the real container (`#app`, see above) directly. See
  `apps/greyscout/src/views/PicklistView.vue` for the reference
  implementation.
- Browser automation (`left_click_drag`, synthetic `dispatchEvent` sequences)
  does not reliably reproduce real held-drag physics for SortableJS —
  it's fine for confirming a drag reorder *works*, but not for validating
  autoscroll speed/feel. A rapid loop of synthetic mouse events dispatched
  via `javascript_tool` can also stall/freeze the tab (seen once when
  simulating a long held drag) — keep synthetic drag scripts short, and get
  the user to confirm real-device feel for anything speed/timing-sensitive.
- `apps/greyscout/util/private_credentials.json` must **never** be tracked in git — it's
  gitignored; don't remove that pattern, and never print its contents.
- `router.ts` has had duplicate route `path`s registered under different
  `name`s (e.g. Match Scouting and Match Preview both on `/match`) — vue-
  router silently resolves to whichever matching route appears first in
  the array, so the second one is just dead/unreachable with no error. If
  a page/feature seems inexplicably unreachable or a nav link does
  nothing, grep `router.ts` for its `path` before assuming the bug is in
  the component.
- No Python interpreter is available in this shell at all (`python`/
  `python3` hit the Windows Store's stub and no-op) — this is separate
  from the `util/` toolkit's own uv-managed Python (see below), which
  *is* real but must be invoked via `uv run python ...` from inside
  `util/`. For one-off tasks outside `util/` (e.g. inspecting a PNG's
  pixels to measure a boundary), use Node instead — `pngjs` is already
  present as a transitive dependency (via `node_modules/pngjs`) and can
  decode a PNG without adding anything to `package.json`. Run scripts as
  `.cjs` files from inside the repo root (not `/tmp`), since
  `package.json` has `"type": "module"` and plain `.js` there is parsed
  as ESM.
- When placing normalized/relative coordinates onto one fixed shared
  visual (e.g. `AutoPathCanvas.vue` drawing team-relative auto-path points
  onto the single real field image), keep the "make this alliance/frame-
  relative value physical" transform in exactly one place. It's easy to
  end up with two independently-reasonable-looking rotations/flips (one
  in a data-relabeling helper, one in the renderer) that compose back to
  a no-op — the exact bug that made an alliance-flip toggle visibly do
  nothing in the auto-path feature (see `apps/greyscout/docs/auto-paths.md`'s
  "Coordinate frame" section for the full writeup and the fix).

## Python util toolkit (`apps/greyscout/util/`)

- uv-managed (`uv run python main.py --mode event|offline|photos`,
  from inside `apps/greyscout/util/`). `pyproject.toml` has
  `[tool.uv] package = false` since the scripts import each other flatly
  (not as a package) — don't add a `[build-system]` table without also
  fixing those imports.
- The nightly GitHub Actions workflow
  (`.github/workflows/update_data.yaml`) uses `astral-sh/setup-uv` +
  `uv sync --locked` + `uv run`, and passes `TBA_CREDENTIALS`/
  `SUPABASE_CREDENTIALS` secrets via `env:` (not inlined into the `run:`
  shell line) so JSON quotes/braces in the secret survive shell parsing.
- `robot_photos.py` syncs TBA robot photos: only TBA's `imgur` media type is
  a reliable direct image URL (`avatar` is a team icon, `youtube` is video,
  `cd-thread` is a forum link, not an image). Images are resized/compressed
  with Pillow before upload to Supabase Storage, uploaded with
  `cache-control` + `upsert: true`.
- Inline `python -c "..."` one-liners via Bash can silently produce no
  output on this Windows/git-bash environment — write a script file and run
  it with `uv run python <file>.py` instead.
- The `SUPABASE_CREDENTIALS` GitHub secret is independent of the frontend's
  `supabaseProjectId`/publishable key in
  `packages/common/src/supabase/client.ts` (shared by every app in this
  monorepo) — when migrating Supabase projects, both must be updated
  together or the nightly sync silently starts hitting a stale/deleted
  project (DNS `ConnectError`).

## CSV import/export

- CSV parsing (Data Upload) uses `papaparse` with `skipEmptyLines: true`
  (a trailing blank line from Excel/Sheets exports otherwise produces a
  null-filled row that fails a not-null constraint on the whole batch).
- CSV export uses `Papa.unparse()` + a `Blob`/temporary `<a download>` link
  — see `exportTeamListCsv()` in `apps/greyscout/src/views/PicklistView.vue`
  for the pattern.
