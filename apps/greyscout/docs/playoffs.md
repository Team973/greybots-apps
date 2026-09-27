# Playoffs Alliance Tracker ([issue #64](https://github.com/Team973/greyscout/issues/64))

## Requirements

* A dedicated **Playoffs** page tracks the 8 alliances (up to 4 teams each) as they get picked during an event, and shows the double-elimination bracket.
* Leads and admins can edit alliances and record bracket results. Members and observers can view but not edit.
* Alliances are edited with drag and drop from a pool of the event's unpicked teams (condensed view: robot photo + team number).
* A team placed on an alliance is marked **picked** on the pick list.
* Past events can be viewed, like the pick list's prior-event filter.

## User Guide

Open **Alliance Selection → Playoffs** in the menu (or go to `/playoffs`).

### Building alliances

Drag teams by their **⠿ handle** (the rest of a team card scrolls the page instead, which matters on touch screens) from **Available Teams** into an alliance's slots (Captain, Pick 1, Pick 2, Backup — position is just the order in the alliance). Drag between alliances, within an alliance to reorder, or back to the pool to remove a team. An alliance holds at most 4 teams; to swap a team into a full alliance, drag one out first. The pool has a search box (team number or name).

Every change saves immediately — there is no Save button. If a save fails, a message with a **Retry** button appears and the on-screen state is kept.

### Recording results

Click an alliance in a bracket match to mark it the winner; click it again to clear. A match can only be decided once both alliances are known. Winners and losers advance automatically per the bracket below, and changing an earlier result clears any downstream results that depended on it.

| Match | Alliances | Winner → | Loser → |
|---|---|---|---|
| 1 | 1 vs 8 | 7 | 5 |
| 2 | 4 vs 5 | 7 | 5 |
| 3 | 2 vs 7 | 8 | 6 |
| 4 | 3 vs 6 | 8 | 6 |
| 5 | L1 vs L2 | 10 | out |
| 6 | L3 vs L4 | 9 | out |
| 7 | W1 vs W2 | 11 | 9 |
| 8 | W3 vs W4 | 11 | 10 |
| 9 | L7 vs W6 | 12 | out |
| 10 | L8 vs W5 | 12 | out |
| 11 | W7 vs W8 | Finals | 13 |
| 12 | W10 vs W9 | 13 | out |
| 13 | L11 vs W12 | Finals | out |
| Finals | W11 vs W13 | champion | out |

The bracket is laid out like the [official FIRST bracket graphic](https://www.chiefdelphi.com/uploads/default/original/4X/e/1/4/e14247465434b84b66c1f6b3aeb050918933caa4.png): round columns, upper bracket over lower bracket, red/blue rows, and a line from each match to where its winner advances (losers are labeled, e.g. "Loser of M8"). Its matchups differ from the issue text in two places, and the graphic wins: Match 3 is Alliance 2 vs 7 and Match 4 is Alliance 3 vs 6 (the issue had them swapped), and Match 12 is W10 (red) vs W9 (blue). The finals are best 2 out of 3 in real life; the tracker records a single winner (the champion) between the winner of Match 11 and the winner of Match 13.

### Picked status on the pick list

Placing a team on an alliance adds it to the event's picked set on the pick list (the same `picked_team_numbers` the pick list's checkbox edits); removing a team from every alliance unmarks it. The merge is done against the current server-side picked set, so manual checkbox changes on the pick list aren't clobbered. Resetting the playoffs unmarks all alliance teams.

### Viewing a prior event

**View prior event** (any role) loads that event's saved alliances/bracket read-only, using that event's own team roster. **Clear Filter** returns to the current event.

## Roles

| Role | View | Edit |
|---|---|---|
| Observer | ✓ | |
| Member | ✓ | |
| Lead / Admin | ✓ | ✓ |

The route allows every role; editing is gated in the UI (`authStore.isLead`) and enforced in the database by row-level security on `Playoffs`.

## Database Schema

### `Playoffs` table (one row per event)

| Column | Type | Notes |
|---|---|---|
| `event_id` | text, PK | FK → `Event` |
| `alliances` | jsonb | array of 8 arrays of team numbers; index 0 = alliance 1 |
| `match_winners` | jsonb | `{"<match number>": <winning alliance number>}`; finals is match 14 |
| `updated_by` | uuid | FK → `User`, defaults to `auth.uid()` |
| `updated_at` | timestamptz | |

RLS: any authenticated user can read; only `lead`/`admin` (checked against `"User".role`) can insert/update.

## Source Files

| File | Purpose |
|---|---|
| `src/views/PlayoffsView.vue` | Page: alliance drag and drop, team pool, past-event filter, save status |
| `src/components/PlayoffsBracket.vue` | Bracket columns; click to record winners |
| `src/components/PlayoffsTeamChip.vue` | Condensed team card (photo + number) |
| `src/lib/playoffs-bracket.ts` | Bracket topology and the pure logic deriving matchups from recorded winners |
| `src/lib/playoffs-query.ts` | Supabase read/upsert |
| `src/stores/playoffs-store.ts` | State, saving, picked-list sync |
| `src/lib/drag-autoscroll.ts` | Drag autoscroll (same approach as the pick list; see its comment) |
| `supabase/migrations/20260918120000_add_playoffs.sql` | Table + RLS |
