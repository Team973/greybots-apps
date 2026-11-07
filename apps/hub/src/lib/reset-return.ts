import { hubApps } from '@/lib/apps';

// Where to send someone once they've reset their password: back to the app
// that sent them to the hub's "forgot password" page (see
// @greybots/common/lib/hub). It's remembered on this device between asking
// for the email and opening its link, rather than put in the link, so the
// link stays the plain /reset-password address Supabase allows.

const returnKey = 'greybots_reset_return';

export interface ResetReturn {
    url: string;
    appName: string;
}

// Only a greybots app's own address; anything else is ignored, so the hub
// can't be used to bounce people to another site. Local dev servers are
// allowed in development.
export function toResetReturn(raw: unknown): ResetReturn | null {
    if (typeof raw !== 'string' || !raw) return null;
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return null;
    }
    const app = hubApps.find((a) => new URL(a.url).origin === url.origin);
    if (app) return { url: url.toString(), appName: app.name };
    const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:';
    if (import.meta.env.DEV && isLocal) return { url: url.toString(), appName: `the app at ${url.host}` };
    return null;
}

export function rememberResetReturn(value: ResetReturn | null) {
    try {
        if (value) localStorage.setItem(returnKey, value.url);
        else localStorage.removeItem(returnKey);
    } catch {
        // Blocked storage: the person just ends up on the hub's home page.
    }
}

export function recallResetReturn(): ResetReturn | null {
    try {
        return toResetReturn(localStorage.getItem(returnKey));
    } catch {
        return null;
    }
}
