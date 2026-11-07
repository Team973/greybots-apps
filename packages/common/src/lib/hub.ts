// The hub (apps/hub) is the one place every greybots app sends people to
// reset a forgotten password: it sends the reset email, the email's link
// comes back to it, and the new password is chosen there. The other apps
// only link to it.

// "https://example.com/" -> "https://example.com"
const clean = (url: string) => url.trim().replace(/\/+$/, '');

// Override with VITE_HUB_URL (in a deployment's environment, or a .env.local
// for development, e.g. VITE_HUB_URL=http://localhost:5176).
export const hubUrl: string = clean(import.meta.env.VITE_HUB_URL || 'https://greybots.vercel.app');

/**
 * The hub's "forgot password" page. `returnTo` is where to send the person
 * once their new password is saved (normally this app's sign-in page); the
 * hub only goes back to a greybots app's address.
 */
export function hubForgotPasswordUrl(returnTo?: string): string {
    const url = new URL(`${hubUrl}/forgot-password`);
    if (returnTo) url.searchParams.set('return', returnTo);
    return url.toString();
}

/**
 * A reset link from before the hub handled resets lands on an app's own
 * /reset-password page. Send it on to the hub's, keeping the sign-in in the
 * link (the `#access_token=…` part, or `?code=…`), so it still works.
 */
export function forwardResetLinkToHub(returnTo?: string): void {
    const url = new URL(`${hubUrl}/reset-password`);
    new URLSearchParams(window.location.search).forEach((value, key) => url.searchParams.set(key, value));
    if (returnTo) url.searchParams.set('return', returnTo);
    url.hash = window.location.hash;
    window.location.replace(url.toString());
}
