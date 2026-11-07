# Developing in greybots-apps

How we work in this repo: the change workflow, the checks to run, and the
things that are easy to get wrong. For setup and the list of apps, see the
[readme](readme.md). Each app's own design lives in its docs (for example
`apps/preflight/docs/architecture.md` and `apps/diagnostics/docs/design.md`).

## The workflow

Every change goes through a pull request. Nobody pushes to `main` directly.

1. **Start from an up-to-date `main`.**
   ```bash
   git checkout main
   git pull --ff-only
   ```
2. **Branch.** Name the branch after the app and the change, for example
   `preflight/manual-matches` or `fix/pit-display-timer-overlay`. Keep one
   change per branch; an unrelated fix gets its own branch and PR.
3. **Make the change, and check it.** Run the checks for the app you touched
   (see [Checks](#checks)) and try the change in the running app, not just
   the build. If the change affects how an app works, update its docs in the
   same branch.
4. **Commit.** The subject line names the app and says what changed, in
   plain words:
   ```
   Preflight: stop the pit timer covering the whole pit display
   ```
   Add the issue number when there is one: `Diagnostics: offload logs from
   the robot (#91)`. In the body, explain why: the cause of a bug, or what the
   change makes possible.
5. **Push and open a PR** against `main`. `gh` works well for this:
   ```bash
   git push -u origin <branch>
   gh pr create --repo Team973/greybots-apps --base main --title "<same as the commit>" --body-file <file>
   ```
   (A body file avoids quoting trouble in Git Bash.) The description says
   what changed and why, anything a reviewer should know (removed behavior,
   data that's affected, limitations), and how it was tested, including what
   **wasn't** tested. Put "WIP" in the title of a PR that isn't ready: the
   WIP check fails until it's removed.
6. **Code review.** Someone other than the author reads the PR before it's
   merged. Claude Code's `/code-review` is a useful first pass but doesn't
   replace a person. The CI check for the app (see [CI](#ci)) must pass.
   Fix review comments with new commits on the same branch.
7. **Merge** with **Squash and merge**, so each PR is one commit on `main`
   titled `<PR title> (#<number>)`. GitHub deletes the branch afterwards.
8. **After merging,** pull `main` again before starting the next change. If
   the PR added a database migration, apply it (see
   [Database changes](#database-changes)).

## Checks

Run these from the repo root before opening a PR:

| App | Type-check | Build | Tests |
|---|---|---|---|
| GreyScout | `npm run type-check` | `npm run build` | — |
| Preflight | `npm run type-check:preflight` | `npm run build:preflight` | — |
| Workshop | `npm run type-check:workshop` | `npm run build:workshop` | — |
| Hub | `npm run type-check:hub` | `npm run build:hub` | — |
| Diagnostics | `npm run type-check:diagnostics` | `npm run build:diagnostics` | `npm run test:diagnostics` |

A change to `packages/common` can break every app, so type-check all of
them.

GreyScout's `apps/greyscout/dist/` is tracked in git. After building it,
put it back so the build output doesn't end up in your commit:
```bash
git checkout -- apps/greyscout/dist/ && git clean -fd apps/greyscout/dist/
```

The `lint` and `format` scripts exist, but there's no ESLint or Prettier
config in the repo yet, so they don't run.

### Trying the change

Start the app's dev server (see the readme). For Preflight, `npm run
serve:preflight` runs the production build with the offline service worker
on http://localhost:4173, which is the way to check offline behavior.

For anything visible, look at it in the browser. A clean build doesn't mean
the page is right.

## CI

Each app has a GitHub Actions workflow that runs on PRs touching that app
(or `packages/common`, `package.json` or `package-lock.json`) and on pushes
to `main`:

- **Preflight, Workshop, Hub CI:** `npm ci` and the app's build (which
  type-checks).
- **Diagnostics CI:** unit tests and the installer build.
- GreyScout has no CI workflow yet, so run its checks yourself.

## Deploys and releases

- **Web apps** (GreyScout, Preflight, Workshop, Hub) deploy on Vercel when
  `main` changes, and each PR gets a preview deployment. Each app's
  `vercel.json` calls `scripts/vercel-ignore-build.sh` with the paths it
  depends on, so a change that doesn't touch an app doesn't rebuild it.
  If an app gets a new dependency outside its own folder, add the path
  there.
- **Diagnostics** is released by running the **Diagnostics release**
  workflow by hand (Actions → Diagnostics release → Run workflow). It builds
  every platform and tags the commit only when all of it passes.
- **Data:** the **Nightly Data Update** workflow syncs events and teams from
  TBA every night, and **Update Match Schedule** refreshes one event's
  schedule on demand.

## Database changes

All apps share one Supabase project, in `supabase/`.

- A schema change is a new migration in `supabase/migrations/`, named
  `<YYYYMMDDHHMMSS>_<what>.sql`. In the same PR, update
  `supabase/database/schemas/prod.sql` by hand to match. It's the readable
  source of truth for the schema.
- Write migrations to be safe on live data: check whether a table already
  has real data before changing it, and prefer adding or renaming over
  dropping.
- Apply migrations **after the PR is merged**, from an up-to-date `main`:
  ```bash
  supabase db push --linked --dry-run   # shows what would be applied
  supabase db push --linked
  supabase migration list --linked      # local and remote should match
  ```
  A "failed to cache migrations catalog" message at the end of `db push` is
  harmless. `supabase db diff` needs Docker; without it there's no local
  check, so review new SQL carefully.
- Every app is offline-first or caches data, so a new column must work with
  rows (and devices) that don't have it yet.

## Secrets and credentials

- Never commit credentials. `apps/greyscout/util/private_credentials.json`
  is gitignored and must stay that way.
- The TBA API key lives only in the `TBA_API_KEY` Supabase secret, which the
  `tba-proxy` Edge Function uses. Apps call that function instead of TBA
  directly.

## Gotchas

- **Scoped styles leak into a child's root element.** In Vue, a child
  component's root element also gets the parent's scoped-style attribute,
  so a class on that root can match the parent's selectors. Avoid generic
  root classes in shared components (`display`, `panel`, ...). This is
  what made the pit timer cover the whole pit display (#158).
- **The page scrolls inside `#app`, not the window.** Custom scroll code must
  target `document.getElementById('app')`.
- **Supabase errors aren't `Error` objects.** Show `error.message`, not
  `String(error)`.
- **Default rows need stable ids.** Anything seeded from a template
  (Preflight milestones, suggested checklists) derives its id from a stable
  key, so devices converge on the same rows. Keep a key when changing what
  it holds, or existing events get duplicates.
- **Matches are linked by `match_key`.** Tasks, repairs, notes, batteries
  and the robot status in Preflight look matches up by key, so every match
  needs one, including ones added by hand (`manual_<id>`).
