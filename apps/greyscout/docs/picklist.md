# Pick List Feature

## Requirements

* Members shall be able to make their own pick lists on their accounts  
* Leads shall be able to view aggregation of all user picklists (democratic picklist)  
* Leads shall be able to maintain a “team picklist” which is the official picklist for the team.   
  * There is only 1 team picklist, and the leads can collaborate on it  
* The picklist should be a compact list view of rows containing team number, team name, and a robot picture. If a user taps/clicks on the row, the view should expand to show a bigger version of the robot picture, and any stats / scout comments about the team.  
  * The stats/comments should come from match scouting and pit scouting.  
  * Any comments should be attributed to the user who commented on the team so they can be asked for any clarification

## Overview

The Pick List feature allows scouts and lead members to collaboratively rank teams attending the active event. It includes three views:

| Tab | Who can edit | Description |
|---|---|---|
| **My List** | All logged-in members | Each user's personal ranking of event teams |
| **Democratic** | Read-only | Computed aggregate of all personal lists |
| **Team List** | Leads & Admins only | Official shared team ranking |

---

## User Guide

### Accessing the Pick List

Navigate to **Pick List** in the nav bar (or go to `/picklist`). You must be logged in.

### Reordering Teams

On the **My List** or **Team List** tab, drag the `⠿` handle on the left of any row to change that team's rank. Click **Save List** when finished.

### Unranked Teams ([issue #34](https://github.com/Team973/greyscout/issues/34))

Teams with no tier assigned yet live in the **Unranked** section, rendered
separately from the ranked tiers (S through DNP) rather than as just another
row list:
- **Layout**: on desktop (≥1000px, same breakpoint as the app-wide
  `isMobile`/`minWidthForDesktop` switch — bumped from 820px to 1000px
  alongside this issue, since the desktop nav bar's item count no longer
  fit below that width; see `src/lib/constants.ts`), ranked tiers stack in
  a left column and
  Unranked renders in a fixed-width (360px) column on the right, so the
  two are visible side by side while sorting; below that width both stack
  vertically, Unranked last — same as before.
- **Card style**: each unranked team is a big square grid card
  (`PicklistUnrankedCard.vue`); collapsed it shows only the robot photo,
  team number, and watchlist star — deliberately less information than a
  ranked row (no name, tier-vote stats, or picked checkbox), since the
  point of this view is fast visual triage of a large untriaged pool.
  Cards render **exactly 3 per row** (`.unranked-grid` is `display: flex;
  flex-wrap: wrap` with each card at `flex: 0 0 calc((100% - 20px) / 3)` —
  deliberately *not* CSS `display: grid`, see the SortableJS gotcha below).
  The collapsed photo uses `object-fit: contain` (not `cover`) so the full
  robot is always visible rather than cropped by the team-number bar below
  it.
- **Drag-and-drop still works both ways**: the Unranked grid is a
  `vuedraggable` list in the same `group="picklist"` as every ranked tier,
  so a team can be dragged from Unranked into any tier, or dragged back
  out of a tier into Unranked, exactly like dragging between two ranked
  tiers. Drag starts from a small `⠿` handle badge in the card's top-left
  corner (`handle=".unranked-card-handle"`, matching the `handle` pattern
  the other 6 tier lists already use) — clicking the rest of the card
  instead expands it (see below).
- **Clicking a card** (anywhere but the handle/watch star) expands it to a
  roughly 3×3-card footprint showing the full photo, name, aggregated match
  stats, and scout comments — the same data a ranked row's expanded view
  shows. Click again to collapse.
- **Gotcha #1**: the card's `<img>` must have `draggable="false"` — without
  it, starting a pointer-drag on top of the photo (which fills most of the
  square) can be hijacked by the browser's own native image-drag-out
  gesture instead of being picked up by SortableJS's fallback drag
  handling, silently preventing the card from ever starting a sortable
  drag. Ranked rows never hit this because their drag handle is a small
  text/emoji span (`.picklist-drag-handle`), never the photo itself.
- **Gotcha #2 — the real cause of "drag from Unranked doesn't stick, and
  then no list drags at all"**: `PicklistUnrankedCard.vue`'s template used
  to open with a template-level HTML comment placed *before* the root
  `<div class="unranked-card">`. Vue compiles a component template with a
  comment as a root-level sibling into a **fragment root** (comment node +
  div, joined by whitespace text nodes), not a single element. vuedraggable
  captures each list item's `vnode.el` to attach `__draggable_context` (the
  data its `onDragStart` reads via `getUnderlyingVm`) — for a fragment
  root, that `.el` is the fragment's anchor node, not the real card div, so
  every Unranked card silently ended up with no drag context at all.
  Starting *any* drag on *any* Unranked card (same-list reorder or
  cross-list) then threw `Cannot read properties of null (reading
  'element')` inside vuedraggable's internal `onDragStart`, before it ever
  reached the point of moving the item or emitting `@start` — which is why
  the move never stuck, autoscroll (driven off `@start`/`@end`, see
  `PicklistView.vue`) never kicked in, and the exception corrupted
  vuedraggable's shared module-level drag state badly enough that every
  other list on the page stopped responding to drags too, until reload.
  **The fix — and the rule going forward — is that a component with a
  single-root template used inside a `vuedraggable` `#item` slot must
  never have a comment (or any other node) as a template-level sibling of
  that root**; put explanatory comments in the `<script>` block instead.
- **Gotcha #3**: a card's
  width comes from `PicklistView.vue`'s `.unranked-grid > .unranked-card`
  rule, which only matches while the card is an actual DOM child of
  `.unranked-grid`. But cross-list dragging in the same SortableJS `group`
  doesn't just show a visual clone — it **actually moves the real dragged
  element** into whichever list you're currently hovering over, live, as
  part of previewing the drop position. The instant it's moved into a
  ranked tier's `.tier-section-body` (a `flex-direction: column` list whose
  children stretch to full width by default), the parent-scoped width rule
  stops matching, the card has no width of its own, and `aspect-ratio: 1`
  blows its height up to match — visually, the dragged photo balloons to
  fill almost the entire tier column while dragging. The fix is a
  self-contained fallback `max-width: 140px` directly on `.unranked-card`
  in `PicklistUnrankedCard.vue` itself (lower priority than the parent's
  grid rule via specificity, so it only kicks in once the card has actually
  left `.unranked-grid`). This is also why the section briefly considered
  and reverted CSS `display: grid` for the layout instead of `flex-wrap`:
  grid was a red herring — the size-loses-on-reparent bug reproduced either
  way, and flex-wrap is also just more predictable with SortableJS's
  index/swap math in general.

### Expanding a Team Row

Tap or click any team row to expand it. The expanded view shows:
- A full-size robot photo (if one has been uploaded)
- Aggregated match stats (averages and max values from scouting data)
- All scout comments from both match scouting and pit scouting, each attributed to the scout who wrote it

### Saving

Click the **Save List** button at the top-right of the list. If you are offline, the save is enqueued locally (see [Offline Behaviour](#offline-behaviour)).

### Democratic View

The democratic tab shows a read-only ranking computed from all personal lists submitted so far. Teams are ranked by their aggregate score: each list contributes `(list_length - rank)` points per team. Higher score = higher democratic ranking.

### Resetting the Team List from Democratic Results

On the **Team List** tab, leads/admins can click **↺ Reset from Democratic** to overwrite the current team list with the current democratic ranking as a starting point, then continue reordering from there. This immediately saves — it's a real overwrite, not a staged draft — so use it when you want to discard the team list's current order, not to preview the democratic results. The button is disabled when no personal lists have been submitted yet (nothing to copy).

### Viewing a Scout's List ([issue #56](https://github.com/Team973/greyscout/issues/56))

On the **My List** tab, admins see a "View scout's list" dropdown above the
tab description, listing every member/lead/admin by name. Selecting a scout
swaps the list to a read-only view of that scout's personal picklist for the
current archetype (Scorer/Defender) — no drag handles, no Save List bar, no
picked checkbox. Click **✕ Clear Filter** (or pick "My List" from the
dropdown) to go back to your own editable list. Switching the Scorer/Defender
archetype tab while a filter is active re-fetches the selected scout's list
for that archetype, since a personal list is stored per archetype.

The filtered list is held entirely separately from the admin's own personal
list state, so applying or clearing the filter never touches or risks saving
over the admin's own draft.

### Viewing a Prior Event's Pick List ([issue #58](https://github.com/Team973/greyscout/issues/58))

On the **Democratic** and **Team List** tabs, leads and admins see a "View
prior event" dropdown above the tab description, listing every other event
(newest first) via a searchable dropdown. Selecting an event swaps that tab
to a read-only view of the selected event's Democratic ranking or Team List
for the current archetype (Scorer/Defender) — no drag handles, no Save List
bar, no picked checkbox or watchlist star, since none of those reflect a
past event's actual outcome. Click **✕ Clear Filter** (or pick "Current
Event" from the dropdown) to return to the live current event. Switching
the Scorer/Defender archetype, or between the Democratic and Team List
tabs, while a prior event is selected re-fetches that event's data, since
both the team roster and vote stats are archetype-specific and the Team
List vs. Democratic grouping differ.

A prior event has an entirely different attending-teams roster than the
current event, so the filtered view resolves team names/photos and match
card status from that event's own data — never the current event's — to
avoid misattributing a team number that happens to also attend the current
event. This filter only applies to the Democratic/Team List tabs; a
personal list is per-user and per-event, so viewing a *scout's* history is
out of scope here (see the scout filter above, issue #56, for viewing
another scout's *current*-event list).

### Per-Team Rank Stats

Rows on the **Democratic** and **Team List** tabs show four numbers next to each team, summarizing where that team landed across every scout's personal list: **Hi** (highest/best rank any scout gave it), **Lo** (lowest/worst rank), **Avg** (mean rank), and **Med** (median rank). A team no scout has picked yet shows "No picks yet" instead. These numbers reflect the *raw rank position* a team received (1st, 2nd, …) in each personal list — not the democratic score used to order the Democratic tab itself, so a team can have a strong average rank while still sitting lower in the democratic order if fewer scouts included it. This is meant to help leads judge consensus (or disagreement) while building the team list — it isn't shown on **My List**, since a single list has no variance to summarize.

---

## Offline Behaviour

GreyScout is designed to be usable in low-connectivity environments (e.g. competition pit areas with poor WiFi).

- When the device goes offline, a **banner** appears below the nav bar.
- Saving a pick list while offline **enqueues the save** in `localStorage` under the key `greyscout_offline_queue`.
- A **floating action button (FAB)** in the bottom-right corner shows the count of pending items.
- Clicking the FAB opens a drawer where each queued item can be retried individually or all at once.
- Items are retried automatically when the browser regains connectivity (via the **Retry All** button — the user still clicks it manually to confirm).

---

## Roles

| Role | Personal list | Democratic view | Team list |
|---|---|---|---|
| `observer` | ❌ hidden | ❌ hidden | ❌ hidden |
| `member` | ✅ read/write | ✅ read | ❌ hidden |
| `lead` | ✅ read/write | ✅ read | ✅ read/write |
| `admin` | ✅ read/write | ✅ read | ✅ read/write |

Roles are stored in the `User` table under the `role` column (see [users.md](./users.md)). Observers cannot see the pick list at all — the whole feature is hidden for that role.

---

## Database Schema

### `PickList` table

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` (PK, default `gen_random_uuid()`) | |
| `user_id` | `uuid` | Nullable for team list |
| `event_id` | `text` | e.g. `"2025cafr"` |
| `type` | `text` | `"personal"` or `"team"` |
| `team_numbers` | `integer[]` | Ordered list of team numbers |
| `created_at` | `timestamptz` | Default `now()` |
| `updated_at` | `timestamptz` | Updated on each save |

**Unique constraints:**
- `(user_id, event_id, type)` for personal lists
- `(event_id, type)` for the team list

**Recommended RLS policies:**
- `SELECT`: authenticated users can read all rows
- `INSERT/UPDATE`: user can only write rows where `user_id = auth.uid()` (personal) or `role IN ('lead','admin')` (team)

### `User` table

See [users.md](./users.md) for the full `User` table schema, roles, and role-management rules.

---

## Source Files

| File | Purpose |
|---|---|
| [`src/views/PicklistView.vue`](../src/views/PicklistView.vue) | Main picklist page — tabs, draggable list, expand/collapse, the desktop two-column ranked/Unranked layout |
| [`src/components/PicklistUnrankedCard.vue`](../src/components/PicklistUnrankedCard.vue) | Big square grid card for the Unranked section — collapsed shows photo/number/watch-star, click to expand to full stats/comments; drag via the `⠿` handle badge |
| [`src/stores/picklist-store.ts`](../src/stores/picklist-store.ts) | Pinia store: list state, CRUD actions, democratic computation |
| [`src/lib/picklist-query.ts`](../src/lib/picklist-query.ts) | All Supabase queries for the picklist feature |
| [`src/stores/offline-queue-store.ts`](../src/stores/offline-queue-store.ts) | Persistent offline save queue (localStorage) |
| [`src/components/OfflineQueue.vue`](../src/components/OfflineQueue.vue) | Global offline banner + FAB + retry drawer |
| [`src/stores/auth-store.ts`](../src/stores/auth-store.ts) | Expanded with `role`, `userId`, `isLead`, `isAdmin` |

---

## Future Work

- **Auto-retry on reconnect**: currently manual; could auto-trigger using `window.addEventListener('online', ...)` in the store.
- **Conflict resolution**: if two leads edit the team list simultaneously, the last save wins. A version/timestamp check could detect conflicts.
- **Notes per team**: add a per-team free-text notes field to the picklist entry.
- **Export**: allow leads to export the team picklist as a CSV or printable sheet.
