# Workshop

The shop management app (issue #114): a ticket tracker, a plan for each shop
session, and milestones with burnup charts. It uses the same greybots-apps account as the other apps, with its
own role (`workshop_role`), managed from the shared People page.

## Pages

| Page | Who | What |
| --- | --- | --- |
| My tasks (`/`) | everyone | The next shop session and your tickets in its plan, then your other open tickets. |
| Tickets | everyone | Every ticket, filterable by status, person, milestone, and component. Members and above open and edit them. |
| Ticket (`/tickets/:number`) | everyone | One ticket. Leads and admins close it (complete, duplicate, or won't do) or reopen it. No comments, on purpose. |
| Sessions | everyone | The shop schedule as a calendar. Leads add one-off or weekly sessions, drag to move them, and cancel them. |
| Session (`/sessions/:id`) | everyone | A session's plan. It starts from the previous session's unfinished tickets; leads add, remove, and reorder. |
| Milestones | everyone | Progress and forecast for each milestone; leads add, edit, and close them and move tickets between them. |
| Setup | leads | The components tickets are tagged with. |
| People | leads | The shared user management page. |

Observers can see everything and change nothing.

## How the rules are kept

The rules live in the database (`supabase/migrations/20261019120000_workshop_app.sql`,
less GreyPoints, which `20261111120000_workshop_remove_greypoints.sql` took out),
so they hold whatever client writes. The app mirrors them so it only offers
what will be accepted:

- **Tickets.** Members and above open and edit tickets. Only leads and admins
  close or reopen one, and a closed ticket can't be edited until it's
  reopened. Nothing is deleted.
- **Session plans.** `workshop_seed_session_plan()` carries the previous
  session's unfinished tickets into a session the first time anyone opens it
  (on My tasks or the session page). Leads can run it again to pull in
  anything added to the previous session since.

A repeating schedule is stored as a `WorkshopSessionSeries`, but its sessions
are ordinary `WorkshopSession` rows made when the series is, so each can be
moved or cancelled on its own. "This and following" applies a change (or a
cancellation) to the rest of the series from that session on.

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
