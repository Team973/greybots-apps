# Users

This document outlines users, their login workflow, and the various roles available. See [login.md](./login.md) for the login, forgot-password, and reset-password flows in detail.

## Registration Page

The user registration page (`/register`) asks for the user's name, email, and password. Registration uses Supabase Auth (`supabase.auth.signUp`) as the backend, storing the submitted name in the auth user's metadata.

The `User` table in the database holds user profile information — name, role, and other permission levels — separately from Supabase's own `auth.users` table.

- If the Supabase project has email confirmation enabled, no session exists immediately after signup, so the `User` profile row can't be created yet (it would fail the insert policy below, which requires `auth.uid()`). In that case the row is created automatically the first time the user successfully logs in (see [Role Management](#role-management)).
- If email confirmation is disabled, the profile row is created immediately after signup.
- Either way, the user's `name` is carried over from the signup form via the auth metadata, so it's never lost regardless of which path provisions the row.

## Login Page

See [login.md](./login.md).

## User Roles

Users each have one of the following roles, as assigned to them in the `User` table's `role` column:

1. Admin - a power user who has access to everything, including development settings and behind the scenes stuff with the website
2. Lead - a user who has access to all non-development related settings
   1. Scout Lead
   2. Strat Lead
   3. Drive Coach
3. Member - a user who has limited access based on the scope of their role
   1. Individual scouts
4. Observer - a read-only user. They are only able to read the data on the website, and cannot contribute to the data. This user type is not allowed to see the picklist
   1. Parents

The `role` column only stores the four top-level values (`admin`, `lead`, `member`, `observer`) — the sub-roles listed above (Scout Lead, Strat Lead, Drive Coach, Individual Scouts, Parents) are organizational labels for how a team assigns Leads/Members/Observers, not distinct states the app tracks or enforces.

New accounts always start as **Observer**, regardless of how the profile row was provisioned.

## Account Page

The account page (`/account`) shows the current user's name and role, and a "People" section for role management. Write access throughout the app (Data Upload, Team Analysis, etc.) is derived from `role` — anyone who isn't an Observer can write — so there's no separate write-access indicator to show here.

### Role Management

The People section lists every user (name + role) and, next to each row other than the current user's own, offers a dropdown of roles the current user is allowed to promote or relegate that person to. Only valid transitions are shown:

- Admins can appoint any user with a lower role to be a Member, Lead, or an Admin
- Leads can promote any user with a lower role to Member or Lead
- Members can promote any user with a lower role to Member
- Only Admin users can relegate (demote) other users

This logic is duplicated for UX purposes in `AccountView.vue` (`allowedRoles()`), but the **actual authorization boundary lives in the database** — a `BEFORE UPDATE` trigger on `User` (see below) enforces the same rules independent of the client, so a modified or malicious client can't bypass it. Users cannot change their own role through this mechanism (the UI never renders a control for your own row, and the trigger's rank comparison rejects it even if attempted directly).

---

## Database Schema

### `User` table

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` (PK) | References `auth.users(id)` |
| `created_at` | `timestamptz` | Default `now()` |
| `role` | `text` | `NOT NULL`, default `'observer'`. `CHECK` constrained to `'admin' \| 'lead' \| 'member' \| 'observer'` |
| `name` | `text` | Nullable; set at registration from the signup form |

**RLS policies:**
- `SELECT`: any authenticated user can read all rows (needed for the People list)
- `INSERT`: a user may only insert their own row (`user_id = auth.uid()`), and only with `role = 'observer'` — self-registering as anything higher is rejected
- `UPDATE`: open at the RLS layer (`USING (true) WITH CHECK (true)`); actual authorization is enforced by the trigger below

**Trigger — `enforce_user_profile_update` (`BEFORE UPDATE`):**

Runs on every update to `User` and:
- Looks up the acting user's current role via `auth.uid()`
- If `role` is changing, computes rank (`observer`=0, `member`=1, `lead`=2, `admin`=3) for the actor, the row's old role, and its new role, then requires:
  - **Promotion** (`new_rank > old_rank`): actor's rank must exceed the target's old rank, and the new rank can't exceed the actor's own rank
  - **Relegation** (`new_rank < old_rank`): actor must be `admin`
  - Otherwise the update is rejected with a Postgres exception
- If `name` is changing, the acting user must be the row owner (`auth.uid() = user_id`)
- Calls with no auth context (`auth.uid() IS NULL`, e.g. service-role/server-side jobs) bypass these checks entirely

---

## Source Files

| File | Purpose |
|---|---|
| [`src/views/RegisterView.vue`](../src/views/RegisterView.vue) | Registration form — name/email/password, `supabase.auth.signUp` |
| [`src/views/AccountView.vue`](../src/views/AccountView.vue) | Profile display + People section (role management) |
| [`src/lib/user-query.ts`](../src/lib/user-query.ts) | `fetchAllUsers` / `updateUserRole` Supabase queries |
| [`src/stores/auth-store.ts`](../src/stores/auth-store.ts) | `role`, `userName`, `roleRank`, auto-provisioning on first login, `isAdmin`/`isLead`/`isMember`/`isObserver` getters |
| [`src/router/router.ts`](../src/router/router.ts) | `/register`, `/account` routes |
| [`supabase/database/schemas/prod.sql`](../supabase/database/schemas/prod.sql) | `User` table, `enforce_user_profile_update` trigger, RLS policies (source of truth — see [general-requirements.md](./general-requirements.md)) |

---

## Future Work

- **Sub-role tracking**: Scout Lead / Strat Lead / Drive Coach and Individual Scouts / Parents are currently just descriptive labels, not stored anywhere — a team that wants to distinguish them would need a new column.
- **Self-service name editing**: there's no UI to change your own name after registration, though the database already permits it (`User.name`, self-only).
- **Account deactivation/removal**: no way to deactivate or delete a user from the People section.
- **Audit log**: role changes aren't recorded anywhere beyond the row's current state — no history of who promoted/demoted whom.
