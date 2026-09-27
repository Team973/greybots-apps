# Auto Path Feature

Implements [issue #14](https://github.com/Team973/greyscout/issues/14): scouts can draw a
team's autonomous path on a field map, save it, and later preview how up to
three teams' autos fit together on the same alliance. [Issue #32](https://github.com/Team973/greyscout/issues/32)
added editor/viewer polish (fullscreen, auto-play, a robot-photo marker) and
merged the old separate "Match Preview" page into a single **Strategy**
view (`/strategy`) with three modes — Preview, Auto Edit, and Whiteboard —
described below.

## Overview

| Piece | Where |
|---|---|
| Drawing a path | **Team Analysis** → "Auto Paths" section, below Pit Scouting |
| Viewing/flipping a saved path | Same section — each saved path is a card with its own alliance/side "view as" toggle |
| Combining several teams' autos | **Strategy** (`/strategy`, formerly "Match Preview") → Preview mode — one combined field showing all 6 teams at once |
| Drawing a new auto path in match context | **Strategy** → Auto Edit mode |
| Freehand whiteboard strategy per match | **Strategy** → Whiteboard mode (see "Strategy Mode (Whiteboard)" below) |

The field background is the real 2026 field overlay
(`src/assets/2026-field.png`, provided by the team). It depicts the field
in a fixed physical orientation — red alliance wall on the image's left,
blue on the right — plus off-field context (numbered starting zones,
human player stations) outside the actual playing-field rectangle. Every
consumer of a path only depends on the normalized `[0, 1]` point
coordinates described below, not the image directly, so re-exporting a
higher-res or corrected version of the field art later only means
replacing that PNG and re-measuring `FIELD_BOUNDS` in
`AutoPathCanvas.vue` (see below).

---

## Data model

### `AutoPath` table

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` (PK, identity) | |
| `created_at` / `updated_at` | `timestamptz` | Default `now()` |
| `event` | `text` | Event id, e.g. `"2026cc"` |
| `scouted_by` | `uuid` | FK → `User.user_id`, default `auth.uid()` |
| `team_number` | `smallint` | |
| `name` | `text` | Scout-provided name, renameable |
| `alliance` | `text` | `"red"` or `"blue"` — the alliance the path was **drawn** as |
| `side` | `text` | `"left"` or `"right"` — the starting side it was **drawn** as |
| `path` | `jsonb` | Array of `{ x, y, t }` points, `x`/`y` in `[0, 1]` in the frame described below, `t` the point's recorded time as a `[0, 1]` fraction of the path's normalized duration (see "Timing" below). `t` is optional — paths saved before [issue #35](https://github.com/Team973/greyscout/issues/35) don't have it |
| `is_default` | `boolean` | This team's default auto for Match Preview to pre-select (see below) |

A partial unique index, `autopath_default_unique` on `(team_number, event)
WHERE is_default = true`, enforces at most one default per team per event
— `setAutoPathDefault()` in `auto-path-query.ts` clears any existing
default for that team/event before setting a new one, so it never
conflicts with that index.

Migrations: [`supabase/migrations/20260823120000_add_autopath.sql`](../supabase/migrations/20260823120000_add_autopath.sql)
(table + RLS) and [`20260824000000_add_autopath_default.sql`](../supabase/migrations/20260824000000_add_autopath_default.sql)
(`is_default` + the unique index). Both were pushed live via
`supabase db push --linked` and confirmed in `supabase migration list`.
The declarative schema at `supabase/database/schemas/prod.sql` was updated
by hand to match, since this environment had no Docker daemon available to
run `supabase db diff` locally — if you add further schema changes,
cross-check them against the live database directly (per the known
pgdelta cache bug making `db diff --linked` unreliable on its own).

**RLS policies** (mirrors `PitData`, plus delete since the issue calls
that out explicitly):
- `SELECT`: any authenticated user
- `INSERT`: `scouted_by = auth.uid()`
- `UPDATE` / `DELETE`: any authenticated user (team-wide edit model, same
  as pit scouting corrections — not owner-restricted)

### Coordinate frame — and why alliance and side are handled in different places

A path is stored in a frame anchored to its own recorded alliance/side:
- `x`: `0` = "my" own wall, `1` = the far/opposing wall
- `y`: `0` = "my" own left edge, `1` = "my" own right edge

By construction this frame is **alliance-agnostic**: `(0.1, 0.1)` means
"started near my own wall, near my own left" whichever alliance "my"
refers to. The same numbers are valid input for placing the path under
*either* alliance — alliance never has to change the stored numbers.
**Side is the only thing that's a real mirror within this frame:**
`transformPath()` in [`src/lib/2026/auto-path-field.ts`](../src/lib/2026/auto-path-field.ts)
takes `(points, fromSide, toSide)` and flips `y` (`1 - y`) when the side
differs, leaving `x` untouched. It has no alliance parameter at all.

All alliance-based repositioning happens in exactly one place:
`AutoPathCanvas.vue`, because it alone has to deal with the fact that
there's only **one** fixed field image (`2026-field.png`) — red is always
physically drawn on its left, blue always on its right, it doesn't
re-render per alliance. Its internal `toView()`/`fromEvent()` rotate a
point 180° (`x, y → 1-x, 1-y`) whenever `displayAlliance` is blue, since
blue's own-relative origin sits at the diagonally opposite corner of that
fixed image from red's, then rescale into the sub-rectangle of the PNG
that the actual playing-field boundary occupies (`FIELD_BOUNDS` —
measured directly from the pixels: the field's black border spans
roughly `x:[1048,6943]`, `y:[171,3068]` of the 7992×3240 source image; the
image has margin around that for off-field labels/zones). If the field
art is ever replaced, re-measure that rectangle and update `FIELD_BOUNDS`
to match.

**Do not reintroduce an alliance-based rotation in `transformPath()`.**
An earlier version did exactly that (matching the field's real point
symmetry), and it's tempting — but every caller that calls `transformPath`
*and* then passes the result into `AutoPathCanvas` with a matching
`display-alliance` was rotating the point twice, which cancels out
exactly on an alliance change and made the alliance flip look like it did
nothing. `AutoPathCanvas`'s rotation, driven solely by its
`display-alliance` prop, is already a complete, self-contained "show this
own-relative path as if it belonged to alliance X" — it doesn't care what
alliance a point was actually recorded under. Callers (`AutoPathCard`,
Match Preview) rely on exactly that: they pass a path's raw stored points
straight through — optionally side-mirrored via `transformPath` — and let
`display-alliance` alone decide where it lands on the image.

---

## Components

| File | Purpose |
|---|---|
| [`src/components/AutoPathCanvas.vue`](../src/components/AutoPathCanvas.vue) | The field SVG, background image is `src/assets/2026-field.png`. Two rendering blocks that can now render *simultaneously*: a read-only multi-path overlay (`layers` prop: `[{ key, points, color, alliance, photoUrl?, delayFraction? }]`, each layer carrying its own alliance so red and blue combine on one canvas — see "Strategy Preview" below) and a single editable/viewable path (`points`/`color`/`editable` props), the latter used both standalone (Editor/Card) and as the "draw a new path in context" overlay in Auto Edit mode. Drawing uses Pointer Events (`touch-action: none`) so mouse, touch, and pen all work the same way. Also owns per-point time recording and time-relative playback (see "Timing" below), and a `robotPhotoUrl`/`layers[].photoUrl`-driven marker (a `MARKER_PHOTO_SIZE`-square clipped photo instead of a circle, falling back to the circle when no photo is synced). Has **no fullscreen logic of its own** — that lives in `FullscreenTile.vue`, one level up (see below). `stopAnimation()` deliberately does not reset `animProgress` on stop, so the marker stays parked wherever playback left it (its final position on natural completion, or wherever it was when manually stopped) instead of snapping back to the start; only `startAnimation()` resets progress, for a fresh play-through. |
| [`src/components/AutoPathTimeline.vue`](../src/components/AutoPathTimeline.vue) | The scrub/timing-adjustment bar rendered below the canvas in the editor — see "Timing" below. |
| [`src/components/FullscreenTile.vue`](../src/components/FullscreenTile.vue) | Generic fullscreen wrapper: a `<div>` + toggle button using the Fullscreen API on itself, exposed via a default `<slot>`. Wraps an entire tile's content (heading, dropdowns, canvas, buttons) in `AutoPathEditor.vue`, `AutoPathCard.vue`, and `StrategyView.vue`'s combined Preview/Auto Edit/Whiteboard tile, so fullscreen covers every control for whichever mode is active — not just an inner canvas. |
| [`src/components/AutoPathEditor.vue`](../src/components/AutoPathEditor.vue) | Create/edit form: name, alliance/side dropdowns, the canvas, the timeline, Reset/Save/Cancel/Delete — wrapped in `FullscreenTile`. Reuses `submitScoutData`/`updateScoutData` from `data-submission.ts` (same as pit scouting) so a failed save enqueues into the existing offline-queue FAB instead of a bespoke path. Auto-plays ~1.2s after the most recent point is drawn (a `watch` on `points` with a debounce timer) — there's no true "done drawing" signal in the data model (pointer-up is deliberately just a pause, see "Continuous-path drawing" below), so idle time is the practical stand-in for "fully drawn." |
| [`src/components/AutoPathCard.vue`](../src/components/AutoPathCard.vue) | Read-only list card for Team Analysis: renders a saved path plus an alliance/side "view as" toggle (backed by `transformPath`), a default-auto badge/button, and an Edit button — wrapped in `FullscreenTile`. Takes a `teamNumber` prop to fetch that team's robot photo for the marker. |
| [`src/components/ColorSwatchPicker.vue`](../src/components/ColorSwatchPicker.vue) | Click-to-pick row of color blocks (`choices: {key, text, hex}[]`, index-based `v-model`) — used in `StrategyView.vue`'s Red/Blue Alliance tiles so a scout can choose a team's color from a fixed 8-color palette instead of a text dropdown. |
| [`src/lib/2026/auto-path-field.ts`](../src/lib/2026/auto-path-field.ts) | `transformPath()`, the alliance/side dropdown choice lists, and the timing helpers `pointTime()`/`pathTimeColor()` shared by the canvas and timeline. |
| [`src/lib/auto-path-query.ts`](../src/lib/auto-path-query.ts) | Supabase queries: `fetchTeamAutoPaths`, `fetchAutoPathById`, `deleteAutoPath`, `setAutoPathDefault`. |
| [`src/lib/robot-photo-query.ts`](../src/lib/robot-photo-query.ts) | `fetchRobotPhotoUrl(teamNumber)` — single-team robot photo lookup for the playback marker. `null` on failure/absence so callers fall back to the flat-color circle. |

The editor, card, and Match Preview overlay canvases all render at `large`
size (`AutoPathCanvas`'s `large` prop drops its `max-width` cap entirely),
so each fills the available content width on desktop instead of being
capped at a small thumbnail size.

### Continuous-path drawing

Per the issue, a path must render as continuous even if the scout's
real-world drawing wasn't (finger lifted and replaced mid-draw on a touch
screen). `AutoPathCanvas` implements this by never clearing its point
buffer on pointer-up — every stroke just keeps appending to the same
ordered point array, which is rendered as one `<polyline>`. "Reset" in the
editor is the only way to clear it.

### Timing ([issue #35](https://github.com/Team973/greyscout/issues/35))

Playback used to move the marker at constant speed along the path's arc
length, taking `duration` (20s) end to end regardless of how the scout
actually drew it. It's now **time-relative**: each point carries its own
recorded time (`t`, `[0,1]` fraction of the normalized duration), and
`markerAtTime()` in `AutoPathCanvas.vue` interpolates between points by
that recorded time, not by distance — a stretch the scout drew quickly
plays back quickly, a stretch drawn slowly (e.g. a scoring action) plays
back slowly, independent of how much on-field distance either covers.

- **Recording.** `AutoPathCanvas` tracks each point's *active* elapsed
  drawing time in a parallel `drawTimestamps` array (raw ms, not yet
  normalized) — active meaning the clock only runs while the pointer is
  down, pausing across a lift/resume between strokes (a lift is a
  recording pause per "Continuous-path drawing" above, not something the
  robot did, so it shouldn't inject dead time into the pacing). Every
  emitted point is normalized on the fly: `t = drawTimestamps[i] /
  drawTimestamps[last]`, so the saved path's `t`s always span exactly
  `[0, 1]` — this is what "normalized to a 20-second standard duration"
  means: the *shape* of the pacing is recorded, and it's stretched or
  compressed to fill `duration` at playback time (`t * duration`),
  regardless of how many real seconds the scout spent drawing.
- **Resuming a path.** If drawing resumes on top of points that already
  have a `t` (continuing after a lift, or continuing to draw on a loaded
  saved path), `resyncTimestamps()` reconstructs an assumed elapsed-ms
  baseline from the existing `t`s (`t * duration`) so the new strokes'
  timing stays on a comparable scale before everything gets re-normalized.
- **Legacy paths.** Points saved before this existed have no `t`.
  `pointTime()` in `auto-path-field.ts` falls back to even spacing by
  index in that case, so old paths still animate (roughly their old
  constant-speed behavior) instead of breaking. `transformPath()` passes
  `t` through unchanged (via `{ ...p }`) — don't reintroduce a hand-picked
  `{ x, y }` there, it'll silently drop timing again.
- **Rainbow rendering, fixed by point order.** `AutoPathCanvas`'s
  `time-gradient` prop (on for the editor only, off for cards/Match
  Preview, which still use one flat `color` per path) renders the path as
  many short colored segments instead of one `<polyline>`, hue driven by
  each segment's midpoint **rank** — `((i-1) + i) / 2 / (len-1)` — via
  `pathTimeColor()` (red at the start → violet at the end). Deliberately
  **not** driven by each point's recorded `t`: coloring by rank means "the
  red part of the path" always means the same stretch of drawing, however
  its timing gets edited on the timeline below — the path's colors never
  repaint. The animated marker's color follows suit via `rankAtTime()` (the
  inverse of `markerAtTime()` — given the current time progress, what
  fixed-rank color is that point in the path currently colored?), so the
  marker's color always matches the segment it's visibly passing through
  even after a non-uniform timing edit. The editor's canvas always has
  `time-gradient` on, so a scout sees the same fixed coloring while
  drawing, adjusting timing, and previewing.
- **Start/End labels (flat-color viewer only).** The rainbow gradient
  already shows direction at a glance (red = start, violet = end), so
  `AutoPathCanvas` only draws an end-point dot and "Start"/"End" text labels
  (`labelPos()`) when `time-gradient` is *off* — the flat single-`color`
  viewer used by `AutoPathCard`/Match Preview has no such built-in cue.
- **The timeline editor** (`AutoPathTimeline.vue`, rendered below the
  canvas once `points.length > 2`): a horizontal bar that answers "how many
  seconds does each (fixed) color take?", modeled as resizable regions
  rather than draggable points — an earlier dot-based version (drag a small
  floating circle to re-time the point under it) was hard to land a precise
  drag on and had the two-neighbor clamping logic in `dragHandleTo` right
  next to your finger/cursor, which read as "unexpected" behavior; a
  region's own border is both a much bigger drag target and a much more
  legible one, since you're visibly grabbing the edge of the thing you're
  resizing.
  - **Regions** (`regions`, one per pair of adjacent boundaries in
    `handleIndices`): positioned and *widthed* by real time (`left`/`width`
    from the boundary points' own `t`s, so a region's width literally is
    how many seconds that stretch takes) and rendered as a `linear-gradient`
    sampled at several stops across the region's own point-rank span (not
    one flat midpoint color — a flat color only matches the canvas's
    per-point coloring at the region's exact middle, drifting further off
    at the edges the wider the region is; multiple gradient stops keep each
    inter-stop hop small enough that the RGB-space interpolation CSS
    gradients do stays visually indistinguishable from `pathTimeColor`'s
    HSL-based hue sweep). Adjacent regions share a boundary point's exact
    color as their touching gradient stop, so they meet with no visible
    seam — the whole bar reads as one continuous rainbow that exactly
    matches the canvas above it, stretching or compressing as regions are resized.
  - **Draggable bounds** (`interiorBounds`): a divider rendered at the
    border between two regions — a wide (~16px) invisible hit area
    centered on the boundary's time position, with a slim visible line in
    the middle, so a drag is easy to land without needing to hit a small
    exact point. Dragging one resizes both neighboring regions
    (`rescaleRange()` on each) without changing either region's color:
    "red for 4 seconds" always means the same red stretch of the path,
    just currently taking 4 seconds. The two `rescaleRange()` calls split
    the point range at `cur.pointIndex + 1`, not `cur.pointIndex` — the
    dragged boundary's own point is the shared edge between the two
    ranges, and only the *first* call may touch it. An earlier version had
    the second call start at `cur.pointIndex` too, so it read back the
    value the first call had just written as its own "old" reference
    instead of the true original — silently corrupting both the boundary's
    saved time and every point after it. This is why the boundary's
    persisted `t` must be checked against what it was dragged to, not just
    that the UI *looks* right immediately after dragging.
  - Dragging is also clamped to a `MIN_REGION_T` (~500ms of the 20s
    duration) on either side of the boundary being moved, not just enough
    to prevent inverting past a neighbor. A region allowed to shrink
    arbitrarily thin gives `requestAnimationFrame` — which only samples
    `animProgress` every ~16ms during playback — too few frames to render
    through it, so the marker visibly teleports across that stretch instead
    of gliding. (An earlier fix for the same symptom added a CSS
    `transition` on the marker's `cx`/`cy` to fake a glide; that was
    reverted — it desynced the marker's rendered *position* from its color
    and from the timeline's scrub bar, which both still update instantly
    off the same `animProgress`, since only position was artificially
    delayed. Capping how thin a region can get fixes the root cause instead
    of papering over it.)
  - The bound set starts at 10 roughly-equal regions by point count (exposing every raw drawn point —
    there can be hundreds — as its own region would be unusable) but isn't
    fixed — double-click a region to split it (adds a bound at the point
    nearest the clicked time), double-click a bound to remove it (merges
    its two regions back into one). The bar's own far-left/far-right edges
    are the two absolute end anchors (`t=0`/`t=1`) and aren't rendered as
    interactive bounds at all — there's no region beyond them to resize.
  - **The scrub thumb and the ruler below the bar** (`tickSeconds`,
    1-second resolution, major/labeled every 5s) are also positioned by
    real time, same as the regions and bounds — the ruler itself never
    moves regardless of any edit, it's just seconds.
  - Dragging a bound only re-seeds `handleIndices` (the set of point
    indices with a bound) from scratch when `points.length` itself changes
    (still drawing) — never by proportionally remapping the *existing*
    indices, which was tried first and silently collapsed bounds onto each
    other after enough small growth steps (rounding error compounds over
    ~one recompute per drawn point in a stroke). A custom split/merge only
    "sticks" once the scout has stopped drawing and the point count stops
    changing, matching the normal draw-first-then-adjust workflow.
- **Play preview while editing.** `AutoPathEditor.vue` has its own Play/Stop
  button (mirroring `AutoPathCard.vue`'s), wired to the same canvas via
  `:playing`/`@finished`. Its `previewProgress` binding
  (`canvasPreviewProgress`) passes through the timeline's scrub value only
  while *not* playing — `AutoPathCanvas` treats any non-null
  `previewProgress` as taking priority over the play animation, so without
  this guard the scrub thumb (which defaults to `0`, not `null`) would
  permanently pin the marker and the play animation would never visibly move.
  `AutoPathCanvas` also emits a `progress` event every animation frame
  (alongside updating its own internal `animProgress`); the editor forwards
  that straight into `scrubProgress`, so the timeline's white scrub bar
  visibly tracks along in real time while playing, instead of sitting
  frozen whereever it was last left from manual scrubbing — from the
  timeline's own view, playback and scrubbing are the same "where is the
  white bar" state, just driven by a different source.
- **Timing edits are disabled while playing.** `AutoPathTimeline` takes a
  `disabled` prop (`AutoPathEditor` passes `isPlaying`) that ignores bound
  drag/split/merge and manual scrubbing, and a `disabled` watcher cleanly
  drops any drag/scrub already in progress the instant playback starts.
  Editing the same points the canvas is actively animating out from under
  the edit was the original source of the timeline feeling "glitchy" and
  getting stuck — the bounds dim and the hint text swaps to say playback is
  in progress; pressing stop hands editing back.

---

## Team Analysis integration

`TeamAnalysisView.vue` order is Charts → Scout Comments → Pit Scouting →
Auto Paths (Comments was moved above Pit Scouting). The Auto Paths section
follows the exact same view/add/edit mode pattern already used for pit
scouting (`autoPathFormMode: 'view' | 'add' | 'edit'`). Saved paths render
as a list of `AutoPathCard`s, each assigned a color from a small fixed
palette (cycled by list position, first slot orange) so multiple paths
stay visually distinguishable even though only one renders at a time here.

### Default auto

Each team can mark one saved path as their default, via a "Set as Default"
button on its card (`AutoPath.is_default`, see Data Model above). Rules,
enforced in `AutoPathCard.vue`/`TeamAnalysisView.vue`:
- **A team with only one saved path always shows that path as the
  default**, whether or not `is_default` is actually set in the database —
  `AutoPathCard`'s `isOnlyPath` prop (`teamAutoPaths.length === 1`, passed
  down from `TeamAnalysisView`) drives this, so scouts never have to
  manually flag a team's sole auto.
- **There is no "unset default."** Once a path is default (explicitly or
  because it's the only one), the only way to change it is to set a
  *different* path as default — `setAutoPathDefault()` clears the old one
  as part of setting the new one. The "Set as Default" button simply
  doesn't render on whichever path is already effectively default.

## Strategy view (`/strategy`, formerly Match Preview)

`MatchPreviewView.vue` originally existed but was effectively dead — its nav
links were commented out in `NavBar.vue`, **and its route was registered
at `/match`, silently shadowed by Match Scouting's identical `/match`
route.** Both were fixed early on: the route moved to `/match-preview`, and
the nav links were uncommented. The old per-alliance "highlights" stat tile
was removed — it never actually rendered anything, since its data source
(`getAllianceOverview`'s `highlightColumns`) is an empty stub — along with
the now-dead `teamsData` aggregation, `queryEventData`/`aggregateData`
calls, and `allianceHighlights`/`getTeamNumbers` methods that fed it.

[Issue #32](https://github.com/Team973/greyscout/issues/32) renamed the view
to `StrategyView.vue` at route `/strategy` ("Strategy" in the nav) and added
a 3-way mode toggle (`strategyMode: 'preview' | 'autoEdit' | 'whiteboard'`)
above the team-assignment tiles. Match number entry, schedule auto-fill
(`applyScheduleTeams`/`queryMatchTeams`), and Manual Team Selection are
unchanged and apply across all three modes.

### One shared tile for all three modes

Preview, Auto Edit, and Whiteboard all render inside **one** `FullscreenTile`
(mode toggle at the top, mode-specific content below) rather than separate
tiles — switching modes never means scrolling away from the field, and
fullscreen covers whichever mode's controls are currently showing. The
field itself is full tile width (`.autopath-canvas-full`); per-slot controls
render in **two columns below it** (red left, blue right — still lined up
by alliance) rather than flanking/narrowing the canvas. Note: the shared
`.data-tile` class is a centered flex column (`align-items: center`), which
shrink-wraps block children to their content width by default —
`align-self: stretch` on the specific full-width sections
(`.autopath-canvas-full`, `.autopath-side-by-side`, `.strategy-board-content`)
opts them back into filling the tile.

### Preview mode

Replaces the old two-canvas (one per alliance) layout with a **single
combined canvas** showing all 6 teams' autos at once:
- One control group per slot (in the two-column layout above): which saved
  auto path to preview, which side to view it as, and a **Delay (s)**
  `NumberInput` — a visualization-only stagger, not persisted to the DB (no
  "delay" column exists on `AutoPath`). A delayed layer's marker stays
  parked at its start point until its delay fraction of the animation has
  elapsed, then plays its remaining path compressed into the remaining
  time — see `layer.delayFraction` handling in `AutoPathCanvas`'s
  `animatedLayerMarkers`. This is a deliberate simplification (total
  playback `duration` doesn't extend for delayed layers).
- Two **Show Red / Show Blue** switches (`Switch.vue`, same pattern as
  Manual Team Selection), plus the single **Play/Stop** button, sit below
  the field (not above it) and filter which alliance's layers are included
  in the `combinedLayers` computed before it's handed to the canvas.
- To combine both alliances on one canvas, `layers[]` entries gained a
  per-entry `alliance` field, and `AutoPathCanvas.toView()`/`pointsToPolyline()`
  now accept an optional per-call alliance override (defaulting to the
  `display-alliance` prop) instead of relying solely on one canvas-wide
  prop. This keeps the architectural invariant from "Coordinate frame"
  above intact — alliance-based rotation still happens in exactly one
  place (`toView`), just parameterized per layer instead of per canvas.
  Side, unlike alliance, is still a real mirror applied via `transformPath`
  before points reach the canvas.
- Each of the 6 slots has a **user-chosen color** (`ColorSwatchPicker.vue`
  in the Red/Blue Alliance tiles, backed by a fixed 8-color palette — red,
  orange, yellow, green, blue, purple, magenta, white — defaulting to the
  first 6 for automatic distinctness). `StrategyView.slotColor(slot)` looks
  up the chosen color's hex by index; this replaced the earlier fixed
  per-alliance palette approach.
- Each layer also carries an optional `photoUrl` (fetched per slot via
  `fetchRobotPhotoUrl` whenever that slot's team changes) so the combined
  canvas's markers show robot photos too, same as the single-path viewer.

### Auto Edit mode

Draws a brand-new auto path in place, in the context of the Preview mode's
read-only layers. This needed `AutoPathCanvas`'s template to stop
treating `layers` and `editable`/`points` as mutually exclusive — they now
render as two independent blocks, so a read-only multi-team overlay and one
actively-drawn path can be shown simultaneously. A slot selector picks which
of the 6 teams the new path belongs to (driving `display-alliance` and
`alliance` for the save); Side and Path Name fields sit alongside it. Saving
mirrors `AutoPathEditor.save()` exactly — `submitScoutData(data, autoPathTable)`,
falling back to the same `queueStore.enqueue('scout_data', ...)` offline
path on failure — then refreshes that slot's dropdown via
`loadAutoPathChoices()` and clears the draw canvas.

**Default naming** (`autoEditDefaultName()`): `` `Match ${matchNumber} Path` ``
when teams are schedule-driven (not manually selected) and a match number
is entered; **blank** when Manual Team Selection is on, since a hand-picked
match number may not correspond to a real scheduled match, so naming from it
would be misleading — the scout types their own name instead. A `watch` on
`matchNumber`/`manualTeamSelection` (`refreshAutoEditDefaultName()`) keeps
the name in sync as either changes, but only while the current name still
equals the *last auto-applied* default (`previousAutoEditDefault`) — so it
won't clobber a name the scout has already typed over.

---

## Strategy Mode (Whiteboard)

The third mode: a freehand whiteboard for match strategy, one board per
match (`event` + `match_number`), auto-saved on every edit. Deliberately
**not** built on `AutoPathCanvas` — the data model and drawing semantics are
different enough (non-continuous per-team strokes, no timing/playback) that
sharing would fight that component's continuous-path architecture. Scope
for v1 (per product decision when implementing issue #32): freehand
strokes only, no text/action annotations.

### Data model

New `StrategyBoard` table (migrations
[`20260828120000_add_strategyboard.sql`](../supabase/migrations/20260828120000_add_strategyboard.sql)
+ [`20260828120500_add_strategyboard_unique.sql`](../supabase/migrations/20260828120500_add_strategyboard_unique.sql),
same RLS/grant pattern as `AutoPath`):

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` (PK, identity) | |
| `created_at` / `updated_at` | `timestamptz` | Default `now()` |
| `event` | `text` | |
| `match_number` | `smallint` | |
| `scouted_by` | `uuid` | FK → `User.user_id`, default `auth.uid()` |
| `board` | `jsonb` | Array of `{ slot, strokes: {x,y}[][] }` — see below |

A real (non-partial) unique index, `strategyboard_match_unique` on
`(event, match_number)`, enforces exactly one board per match — unlike
`AutoPath`'s "at most one default," every match gets at most one board, no
clear-before-set dance needed.

**No alliance-relative reframing.** Unlike `AutoPath`, a strategy board's
points are drawn directly onto the real, fixed-orientation field (red
always left, blue always right in `2026-field.png`) — there's no
"own-relative + `toView` flip" concept to replicate, since a board isn't
reused across alliances/sides the way a single team's auto path is.
`StrategyCanvas.vue` places points with the same `FIELD_BOUNDS` math as
`AutoPathCanvas`, just without any alliance parameter at all.

**Non-continuous, per-team strokes.** `board` is keyed by slot (0-5, same
slot numbering as Preview/Auto Edit), each holding an array of independent
strokes (`{x,y}[][]`) rather than one flat point array. This is the literal
inverse of `AutoPathCanvas.onPointerUp`'s "never clear the buffer" behavior
(see "Continuous-path drawing" above): `StrategyCanvas.onPointerDown`
starts a *new* stroke for the active slot; `onPointerUp` really does end
it. No per-point timing (`t`) — there's no playback in Whiteboard mode.

### Components and flow

- [`src/lib/strategy-query.ts`](../src/lib/strategy-query.ts) —
  `fetchStrategyBoard(eventId, matchNumber)` → `{id, board}` or
  `{id: null, board: []}` if none exists yet. No bespoke insert/update; like
  every other domain, writes reuse `submitScoutData`/`updateScoutData` from
  `data-submission.ts`.
- [`src/components/StrategyCanvas.vue`](../src/components/StrategyCanvas.vue) —
  the field SVG + drawing logic described above. Emits `update:board` with
  the whole updated array on every new point; owns no persistence itself.
- [`src/components/StrategyBoard.vue`](../src/components/StrategyBoard.vue) —
  the mode-level component: team/slot selector + palette (same
  `autoPathSlotColorsRed`/`Blue` as Preview/Auto Edit, for visual
  consistency across all three modes), a per-team "Clear Strokes" button
  (necessary given strokes have no other undo once drawn), and the
  debounced (~800ms) auto-save watcher on `board`. First save for a match
  needs the new row's `id` for subsequent updates — since
  `submitScoutData` doesn't return inserted data, it re-calls
  `fetchStrategyBoard` once right after a successful first insert.
- Offline support: `useOfflineQueueStore`'s `QueueItem['type']` union gained
  `'strategy_board'`, with the same dedup-on-enqueue pattern as the
  `picklist_*` types (keyed by `event` + `match_number` instead of
  `userId`/`eventId`), and `OfflineQueue.vue` registered a retry handler for
  the new type (identical shape to the existing `scout_data` handler, since
  the payload is the same `{table, data, id}`).

---

## Verification

- `npm run type-check` and `npm run build` pass after every change in this
  doc.
- Both migrations were pushed to the linked Supabase project via
  `supabase db push --linked` and confirmed applied with
  `supabase migration list` (no Docker daemon was available in this
  environment to run `supabase db diff` locally beforehand — the SQL was
  instead hand-reviewed against the existing `PitData`/`PickList`
  migrations for syntax before pushing).
- **Not done:** live browser verification through the Claude-in-Chrome
  extension (it wasn't connected in this environment) — the user tested
  interactively in their own browser instead, which is how the bugs fixed
  above (alliance flip canceling out, the Match Preview crash on an event
  with no match data, the dead stat tile) were actually found. Still worth
  a manual pass before considering this fully done: pointer/touch drawing
  feel on a real mobile device in particular hasn't been confirmed by
  either party yet.

**Timing (issue #35)** was verified live via Claude-in-Chrome: drew a path
with deliberately slow-then-fast pacing, confirmed the saved `t`s were
monotonic `[0,1]` and matched the drawn pacing, confirmed a handle drag
persisted correctly, and confirmed scrub/play both landed the marker at the
expected point via `markerAtTime`. Also confirmed two pre-existing
(`t`-less) saved paths still load and play without error under the
even-spacing fallback. One caveat found along the way: dispatching
synthetic `PointerEvent`s with a fabricated `pointerId` from a JS console
(as opposed to real input, or the browser-automation tool's own drag
action) throws inside `setPointerCapture()`, silently aborting the
drag-start handler — real user input never hits this, so it's a testing
artifact rather than a product bug, but worth knowing if you reach for the
same shortcut later.

A later pass fixed the `rescaleRange()` double-processing bug described
above (the boundary's saved `t` didn't match where it was dragged to) and
re-verified it two ways: a standalone numeric replay of `dragHandleTo`'s
exact logic against known before/after values (no browser needed), and live
via Claude-in-Chrome — drew a 12-point path (the drawing tool's synthetic
clicks each register as two points, pointerdown + a same-position
pointermove — harmless, just denser than a real single click, and not
something worth "fixing" since real input isn't affected), dragged an
interior bound to a specific target time, saved, and confirmed via
`supabase db query --linked` that the persisted point's `t` matched the
drag target exactly. The same session also confirmed, by reading the live
Vue component's `fill` style during playback against an independent
recompute of `pathTimeColor(rankAtTime(...))`, that the marker's color
stays exactly in sync with the timeline/canvas rainbow at every instant —
this was checked specifically because the CSS-transition marker-smoothing
approach mentioned above had briefly broken that sync before being reverted
in favor of the `MIN_REGION_T` fix.

**Issue #32** (editor polish + Strategy view merge) was verified live via
Claude-in-Chrome, logged in as the test account: drew and saved an auto
path, confirmed auto-play fires ~1.2s after drawing pauses (both in the
Editor and again on opening an existing path for edit — a byproduct of
`points` being the only available "changed" signal, not something worth
adding a one-shot flag to suppress), confirmed the robot-photo marker
renders as a clipped square in both the Editor and Card and in the
Strategy view's combined multi-layer canvas. On Strategy: confirmed the
combined red+blue canvas places multiple layers correctly (including one
path re-alliance-flipped and side-flipped), confirmed Show Red/Show Blue
independently hide their alliance's layers, confirmed Auto Edit renders
read-only context layers and an editable overlay simultaneously and saves
a new path end-to-end (dropdown refresh, offline-queue fallback path
unexercised but code-identical to `AutoPathEditor.save()`), and confirmed
Whiteboard mode's non-continuous per-team strokes render as disconnected
polylines, auto-save (debounced, "Saved" status shown), and persist across
a full page reload for two different teams simultaneously. Migrations were
pushed via `supabase db push --linked` (see "Data model" above).

One environment-specific caveat: the Fullsceen API's `requestFullscreen()`
call rejects with `TypeError: not granted` when triggered by the
browser-automation tool's synthetic click in this environment, even though
`document.fullscreenEnabled` is `true` — most likely a transient-user-
-activation quirk of that automation path rather than an app bug (the
click handler and element reference were confirmed correct by inspection).
Worth a real click from an actual user to confirm end to end. This caveat
carried over unchanged when fullscreen moved from `AutoPathCanvas` to
`FullscreenTile`.

**A follow-up round of user-testing feedback** on the Strategy view (still
issue #32) was implemented and verified the same way: robot photo markers
enlarged then rescaled to a final `MARKER_PHOTO_SIZE = 38` (3x the original
16px, then 0.8x of that 48px); confirmed a played-out path's marker stays
parked at its actual final point after `finished` fires (previously
`stopAnimation()` reset `animProgress` to 0, snapping it back to the start)
— verified by an explicit Play → wait-for-full-duration → screenshot cycle,
since idle-triggered auto-play doesn't exist in Auto Edit mode (only in
`AutoPathEditor.vue`). Confirmed the merged single-tile mode toggle
(Preview/Auto Edit/Whiteboard together), the full-width field with two-column
per-slot controls below it, the `ColorSwatchPicker` swatches (default 6
distinct colors, 2 spare), and both `autoEditDefaultName()` branches (schedule
mode → `"Match 12 Path"`; Manual Team Selection → blank) — the latter tested
against a **real live match's data** (Warren Warbots/Bear Metal/etc., match
12) already synced from the team's own TBA schedule, not synthetic test data.

One implementation snag worth noting for future `<script setup>` +
`<script lang="ts">` files in this codebase: a plain `const` declared at the
top of `<script setup>` is **not** visible from the separate Options-API
`<script lang="ts">` block the way an *imported* binding is — imports are
real ES-module top-level bindings, but a `<script setup>`-local `const`
compiles into that block's `setup()` closure, a different scope the Options
block's methods can't reach. (`COLOR_CHOICES` hit exactly this as a
`ReferenceError` at runtime, despite `vue-tsc`/`vite build` both passing
cleanly — the type-checker and bundler don't catch this class of
cross-block scoping mistake.) Fix: declare such constants in the plain
`<script lang="ts">` block instead (same place as `VIEW_W`/`FIELD_BOUNDS` in
`AutoPathCanvas.vue`), and add them to `data()` if the template also needs
them, mirroring how `SIDE_CHOICES` (an actual import) is handled.

## Future work

- Per-path thumbnail caching if the auto-path list grows long enough that
  re-rendering N inline SVGs becomes a visible cost.
- Undo (not just full Reset) while drawing.
- Re-measure `FIELD_BOUNDS` if `2026-field.png` is ever swapped for a
  corrected or higher-res export.
- Strategy Preview's per-slot delay is a visualization-only approximation
  (a delayed layer's remaining path is compressed into the remaining
  playback time rather than the total duration extending) — revisit if
  scouts want literal absolute-time delay instead.
- Strategy Mode (Whiteboard) is freehand-only for v1; text/action
  annotations (e.g. "defend 973") were explicitly deferred, per product
  decision when implementing issue #32.
- The timeline's drag/double-click handle interactions haven't been
  confirmed on a real touch device — `touch-action: none` is set, but
  double-tap-to-add/remove in particular may need real hardware to
  validate (see the `setPointerCapture` caveat above for why simulating
  this from a script isn't reliable).
