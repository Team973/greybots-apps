# Workshop

The shop management app (issue #114): a ticket tracker, a plan for each shop
session, and milestones with burnup charts. It uses the same greybots-apps account as the other apps, with its
own role (`workshop_role`), managed from the shared People page.

## Pages

| Page | Who | What |
| --- | --- | --- |
| My tasks (`/`) | everyone | How many shop sessions are left before the team's next event, then the next shop session (your tickets in its plan, and its checklists), then your checklists with steps to do, then your other open tickets. |
| Tickets | everyone | Every ticket, filterable by status, person, milestone, and component. Members and above open and edit them. |
| Ticket (`/tickets/:number`) | everyone | One ticket, with its details in a sidebar. Members and above click a field to edit it (each change saves straight away). Leads add it to upcoming sessions' plans. Leads and admins close it (complete, duplicate, or won't do) or reopen it. No comments, on purpose. |
| Sessions | everyone | The schedule as a calendar (7am to midnight, scrolling inside a fixed height), by week, three days, or month. Sessions are shop sessions (orange) or driver practice (blue). Its Key dates row holds the team's competition events and, in their own colour, key milestones (see below). The month view shows each day's highlights, most important first: competition, then key milestones, then sessions. Leads add one-off or weekly sessions, drag to move them, and cancel them, and set each session's type and shop boss. |
| Session (`/sessions/:id`) | everyone | A session's plan, with its details in a sidebar (as on a ticket): leads click the shop boss to change it. It starts from the previous session's unfinished tickets; leads add, remove, and reorder. Also its checklists; leads add them. |
| Checklists | everyone | The team's checklist templates (members and above write and edit them, and archive old ones), and every checklist on a session that isn't signed off yet. |
| Checklist (`/checklists/:id`) | everyone | A checklist on a session: tick off steps in any order (each shows who did it and when), hand steps to people, and sign it off. See below for who can do what. |
| Milestones | everyone | Progress, burnup, and forecasts for each milestone; leads add, edit, and close them, move tickets between them, and pick which forecasts everyone sees. |
| Dashboard | everyone | Burnup charts over any set of tickets (some milestones, some components, or both). Leads add, edit, reorder, and remove them. |
| Setup | leads | The components tickets are tagged with. |
| People | leads | The shared user management page. |

Observers can see everything and change nothing.

## How the rules are kept

The rules live in the database (`supabase/migrations/20261019120000_workshop_app.sql`,
less GreyPoints, which `20261111120000_workshop_remove_greypoints.sql` took out),
so they hold whatever client writes. The app mirrors them so it only offers
what will be accepted:

- **Tickets.** Members and above open and edit tickets. A ticket moves To do → In progress or Closed; In progress → To do, Overdue, or Closed; Overdue → To do or Closed (the ticket page only offers those). Only leads and admins
  close or reopen one, and a closed ticket can't be edited until it's
  reopened. Nothing is deleted.
- **Session plans.** `workshop_seed_session_plan()` carries the previous
  session's unfinished tickets into a session the first time anyone opens it
  (on My tasks or the session page). Leads can run it again to pull in
  anything added to the previous session since.

- **Checklists** (`20261117120000_workshop_checklists.sql`). Separate from
  tickets. A template is a list of steps; members and above write them
  (`workshop_save_checklist_template()` saves a template's steps all at once).
  Leads and admins add a copy of one to a session with an owner
  (`workshop_add_checklist()`), and every step starts out assigned to the
  owner. Editing the template later doesn't change copies already on
  sessions.
  - The owner or an admin hands any step to another member. A lead or admin
    can change the owner; the steps the old owner had and hadn't done go to
    the new one.
  - A step's assignee, the owner, or an admin ticks it off (or unticks it);
    the database records who and when.
  - Once every step is done, the owner or an admin signs it off. Nothing on a
    signed-off checklist changes until they undo the sign-off.
  - Leads and admins take a checklist off a session, unless it's signed off.
    Observers can't own a checklist or be given a step.

A repeating schedule is stored as a `WorkshopSessionSeries`, but its sessions
are ordinary `WorkshopSession` rows made when the series is, so each can be
moved or cancelled on its own. "This and following" applies a change (or a
cancellation) to the rest of the series from that session on.

## Burnups and forecasts

A burnup has a scope line (tickets meant to get done, so not duplicates or
won't-dos) and a done line. Each milestone has one, and the Dashboard holds
more: each dashboard chart covers the tickets in **any** of its milestones and
tagged with **any** of its components (an empty list doesn't filter, so a
chart with neither covers every ticket).

Every burnup can show two forecasts. Leads turn either or both on (**Forecasts…**
under a milestone's chart, or a dashboard chart's **Edit**), and everyone sees
the ones that are on. Each carries both lines forward and marks the date they
meet:

- **Plan:** the lead's estimate of tickets closed and opened a week.
- **Sessions:** tickets closed per shop session over the last N sessions (N
  set per chart, 4 by default), carried forward session by session over the
  schedule, then at the recent spacing past its end. Tickets opened per
  session is either set by the lead (0 by default, so only the closure rate
  is forecast) or measured from the same sessions.

If tickets aren't closing faster than they're added, the lines don't meet and
the page says so. The settings are columns on `WorkshopMilestone` and
`WorkshopDashboardChart` (`20261112120000_workshop_burnup_forecasts_and_dashboard.sql`
and `20261113120000_workshop_session_forecast_open_rate.sql`).

## Events

The team's competition events come from GreyScout's `Event` table, which the
**Nightly Data Update** workflow fills from The Blue Alliance with the events
team 973 is registered for, this year's and next year's
(`apps/greyscout/util/event_info.py`). Workshop only reads them: My tasks
counts the shop sessions left before the next one (sessions that haven't
ended and start before its first day), and the Sessions page shows them in
the calendar's all-day row and in Coming up. Nothing to enter by hand; an
event TBA doesn't list won't appear.

## Key milestones and shop bosses

`20261119120000_workshop_key_dates_and_shop_boss.sql`.

- **Key milestones** (`WorkshopKeyDate`) are dates leads and admins mark on
  the schedule ("Robot reveal", "Drive team practice"): a day or a run of
  days, with a name and notes. They go in the calendar's Key dates row after
  the competition events, in teal with a lighter fill so the events stay the
  boldest thing there, and in Coming up. Leads drag across the row (or use
  Add milestone) to add one, drag one to move it, and tap it to change or
  remove it. They're only dates: ticket milestones (the Milestones page) are
  separate.
- **Session type** (`WorkshopSession.kind`): a shop session or driver
  practice, picked in the session dialog. Only shop sessions count as shop
  time: sessions and hours left before an event, burnup session forecasts,
  the next session on My tasks, and the sessions a ticket can be added to.
  A plan carries over from the previous *shop* session, skipping driver
  practice, and driver practice doesn't carry anything over.
- **Shop boss** (`WorkshopSession.shop_boss`): who runs a session. It's in
  the session page's sidebar, where leads and admins click it to change it
  (it saves straight away, like a ticket's owner). They can also set it in
  the session dialog, where "this and following" carries it through a
  series. A new session starts with whoever ran the latest one.
  The migration gave every existing session Allen Bailey (matched by name).

## Part sorter

Hidden for now: its route is commented out in `router.ts` and its link taken
out of `NavBar.vue`, so `/part-sorter` goes to My tasks. The page and its files
are kept.

Finds the bolts in a photo with a small neural network (ONNX Runtime Web, on
the phone's GPU where the browser allows, else its CPU), then measures and
groups them with C++ compiled to WebAssembly. Nothing leaves the phone.
Design, results and trade-offs: [docs/part-sorter-design.md](docs/part-sorter-design.md).

- `src/lib/partSorter/seg.onnx` is the network, trained on SAM 2's masks of
  sample photos (`vision/tools/seg_colab.ipynb`).
- `src/lib/partSorter/part-sorter.{js,wasm}` is the C++ in `vision/`, built by
  `scripts/build-part-sorter.sh` (Docker). Both are committed, so the dev
  server and Vercel need neither PyTorch nor Emscripten. After changing the
  C++, rebuild and commit; `scripts/build-part-sorter.sh --check` says if the
  committed module is stale.
- The camera needs https (or localhost). "Use a photo" works anywhere.
- `vercel.json` serves `/part-sorter` cross-origin isolated so the network
  can use several CPU threads; the dev server doesn't, so locally it runs on
  one thread. "Speed and details" on the page has a speed test and a report
  to copy.

## Not here yet

- **Attendance.** The issue asks for an hours leaderboard with a cutoff line.
  That needs the team's attendance system linked up.
- **Parts tracker / inventory.** Still to be designed (see also #89, pit
  inventory in Preflight).

## Deployment

Create a Vercel project from this repo with **Root Directory = `apps/workshop`**
(framework preset: Vite). `vercel.json` handles the SPA rewrite. Add its
address to the Supabase project's allowed redirect URLs (Authentication → URL
Configuration) so registration and password reset emails link back here, and
set `VITE_WORKSHOP_URL` on the hub if the address isn't
`https://greybots-workshop.vercel.app`.

## Commands (from the repo root)

| Command | What it does |
| --- | --- |
| `npm run dev:workshop` | Vite dev server. |
| `npm run build:workshop` | Type-check and production build. |
| `npm run type-check:workshop` | Type-check only. |
