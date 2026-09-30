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

1. **Hosted (recommended)**: open the Vercel deployment once while online,
   then install it (Chrome/Edge "Install app", iPad "Add to Home Screen").
   After that it runs entirely from the device.
2. **Local on a laptop**: `npm run serve:preflight` builds the app and serves
   it at `http://localhost:4173`. Load it once, and the service worker keeps
   it available even if the server stops.

## Device modes

Each device picks a mode on first launch (`/setup`). The choice is stored in
the `meta` table and can only be changed with **Settings → Reset device**,
which wipes all local data.

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
   -- Shared helper; create it once, with the first synced table.
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
| `npm run dev:preflight` | Vite dev server with HMR. The service worker is disabled in dev. |
| `npm run build:preflight` | Type-check and production build. |
| `npm run serve:preflight` | Build, then serve at http://localhost:4173 with the service worker active. Use this to test offline behavior. |
| `npm run type-check:preflight` | Type-check only. |
