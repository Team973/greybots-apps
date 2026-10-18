# Workshop

The shop management app (issue #114): a ticket tracker, a plan for each shop
session, milestones with burnup charts, and GreyPoints, the team's rewards
program. It uses the same greybots-apps account as the other apps, with its
own role (`workshop_role`), managed from the shared People page.

## Pages

| Page | Who | What |
| --- | --- | --- |
| My tasks (`/`) | everyone | The next shop session and your tickets in its plan, then your other open tickets, and your points. |
| Tickets | everyone | Every ticket, filterable by status, person, milestone, and component. Members and above open and edit them. |
| Ticket (`/tickets/:number`) | everyone | One ticket. Leads and admins close it (complete, duplicate, or won't do) or reopen it. No comments, on purpose. |
| Sessions | everyone | The shop schedule as a calendar. Leads add one-off or weekly sessions, drag to move them, and cancel them. |
| Session (`/sessions/:id`) | everyone | A session's plan. It starts from the previous session's unfinished tickets; leads add, remove, and reorder. |
| Milestones | everyone | Progress and forecast for each milestone; leads add, edit, and close them and move tickets between them. |
| GreyPoints | everyone | Your balance and history, and the season and all-time leaderboards. Leads give recognitions; admins adjust. |
| Rewards | everyone | The marketplace. Members redeem; leads add rewards and hand them over. |
| Setup | leads | The components tickets are tagged with, and the fixed GreyPoints values. |
| People | leads | The shared user management page. |

Observers can see everything and change nothing.

## How the rules are kept

The rules live in the database (`supabase/migrations/20261019120000_workshop_app.sql`),
so they hold whatever client writes. The app mirrors them so it only offers
what will be accepted:

- **Tickets.** Members and above open and edit tickets. Only leads and admins
  close or reopen one, and a closed ticket can't be edited until it's
  reopened. Nothing is deleted.
- **Bounties** come from a fixed list (5, 10, 25, 50, 100). They're set by a
  lead or admin who isn't the ticket's owner or an assignee. If whoever set a
  bounty later becomes the owner or an assignee, the bounty is cleared and
  someone else has to set it again. The closer can settle the bounty while
  closing, under the same rule.
- **Payouts** happen only when a ticket is closed as complete: the assignees
  split the bounty equally (remainders go a point each to the first
  assignees); an owner who isn't an assignee takes 10% (at least 1) off the
  top; with no assignees the owner gets all of it. Reopening a ticket takes
  its points back.
- **Recognitions** are fixed values per level (shout-out 10, team recognition
  25, MVP 50), given by leads and admins to someone other than themselves.
- **Rewards.** `workshop_redeem_reward()` checks the balance and stock and
  records the redemption in one step, so two at once can't overspend. A
  redemption waits for a lead to hand the reward over; cancelling one (by a
  lead, or by the person while it's waiting) returns the points.
- **Session plans.** `workshop_seed_session_plan()` carries the previous
  session's unfinished tickets into a session the first time anyone opens it
  (on My tasks or the session page). Leads can run it again to pull in
  anything added to the previous session since.

The balance, season, and all-time totals come from the `WorkshopPointBalance`
view. The season is the calendar year.

A repeating schedule is stored as a `WorkshopSessionSeries`, but its sessions
are ordinary `WorkshopSession` rows made when the series is, so each can be
moved or cancelled on its own. "This and following" applies a change (or a
cancellation) to the rest of the series from that session on.

## Not here yet

- **Attendance.** The issue asks for an hours leaderboard with a cutoff line,
  and for shop hours to earn GreyPoints. That needs the team's attendance
  system linked up; the points ledger already has an `attendance` kind for it.
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
