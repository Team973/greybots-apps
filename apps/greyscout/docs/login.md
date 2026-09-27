# Login

This document covers the login page and its two related flows: forgotten-password requests and setting a new password. See [users.md](./users.md) for registration and roles.

## Overview

Login uses Supabase Auth (email + password) directly — there's no custom `login` table. On successful login, `auth-store.checkUser()` looks up the matching row in the `User` table (see [users.md](./users.md)) to populate the user's name and role for the rest of the app.

## User Guide

### Logging In

Navigate to `/login`, enter email and password, and click **Log in**. A failed attempt shows the error message returned by Supabase (e.g. wrong password) inline on the form.

### Forgot Password

Click **Forgot password?** on the login page to switch to the reset-request form in place (no navigation). Enter the account's email and click **Send reset email**. This calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: <origin>/reset-password })`.

The confirmation message ("If that email is in our system, a reset link has been sent.") is shown regardless of whether the email actually matches an account, to avoid leaking which emails are registered.

### Resetting Your Password

Clicking the link in the reset email lands on `/reset-password`. Supabase's client automatically turns the link's token into a recovery session on page load. The user enters and confirms a new password, which is submitted via `supabase.auth.updateUser({ password })`. On success, the user is redirected to `/account`.

### Registering

If the user doesn't have an account yet, **Need an account? Register** links to `/register` — see [users.md](./users.md) for that flow.

---

## Operational Notes

- **Email confirmation**: this project has Supabase's "confirm email" requirement enabled, so a fresh signup can't log in (and its profile row can't be created) until the confirmation link is clicked. See [users.md](./users.md#registration-page) for how the app handles the delay.
- **Link prefetching**: some email providers (notably Gmail) prefetch/scan links in incoming mail, which can consume Supabase's single-use confirmation and recovery tokens before the user ever clicks them, surfacing as an `otp_expired` error even on a fresh email. This is an artifact of Supabase's magic-link design plus mail-provider link scanning, not a bug in this app.
- **Resend cooldown**: Supabase rate-limits how often it will re-send a confirmation/recovery email to the same address. A resend requested within the cooldown window returns success but silently reuses the still-pending (or already-expired) token rather than issuing a new one — if a link doesn't work, waiting before retrying is more reliable than immediately requesting another one.
- **Redirect URL allow-list**: `resetPasswordForEmail`'s `redirectTo` must match an entry in the Supabase project's Auth redirect allow-list, or the link will fail. Currently configured for local development (`http://localhost:5173/`) — add the production origin before relying on password reset in production.

---

## Source Files

| File | Purpose |
|---|---|
| [`src/views/LoginView.vue`](../src/views/LoginView.vue) | Login form + inline forgot-password request form |
| [`src/views/ResetPasswordView.vue`](../src/views/ResetPasswordView.vue) | New-password form for the `/reset-password` recovery link target |
| [`src/stores/auth-store.ts`](../src/stores/auth-store.ts) | `checkUser()` — session check, profile lookup/auto-provisioning |
| [`src/router/router.ts`](../src/router/router.ts) | `/login`, `/reset-password` routes |

---

## Future Work

- Surface the resend-cooldown behavior in the UI (e.g. disable "Send reset email" briefly after a send) instead of only in this doc.
- Password strength / confirmation-match validation is minimal (only "must match") — no complexity requirements are enforced client-side.
