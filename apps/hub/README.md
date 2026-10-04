# Greybots hub

The one address to remember: a landing page with a big button for each
greybots app (GreyScout, Preflight), plus the shared sign-in, registration,
and People page.

- **Launcher** (`/`): behind the sign-in. It shows a button per app with your
  role in it, and a People button. An account that's still waiting for
  approval (or was deactivated) is told so here instead of seeing the apps.
- **Sign in / register / reset password**: the same greybots-apps account and
  the same shared components (`@greybots/common`) as the apps. Each app is its
  own site, so signing in here doesn't sign you in there.
- **People** (`/people`): the shared user management page, for anyone with a
  role in at least one app.

## Where the buttons point

`src/lib/apps.ts` lists the apps. Their addresses come from environment
variables, set in the deployment (or a `.env.local` for development):

| Variable | Default |
| --- | --- |
| `VITE_GREYSCOUT_URL` | `https://greyscout.vercel.app` |
| `VITE_PREFLIGHT_URL` | `https://greybots-preflight.vercel.app` |

## Deployment

Create a Vercel project from this repo with **Root Directory = `apps/hub`**
(framework preset: Vite). `vercel.json` handles the SPA rewrite.

For registration and password reset emails to link back here, add the hub's
address to the Supabase project's allowed redirect URLs (Authentication → URL
Configuration).

## Commands (from the repo root)

| Command | What it does |
| --- | --- |
| `npm run dev:hub` | Vite dev server. |
| `npm run build:hub` | Type-check and production build. |
| `npm run type-check:hub` | Type-check only. |
