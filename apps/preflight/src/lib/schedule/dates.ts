// Helpers for the schedule's local-time date handling. The calendar shows
// times in the device's timezone, which is the event's timezone for devices
// at the event.

function pad(n: number) {
    return String(n).padStart(2, '0');
}

// "YYYY-MM-DD" for a Date, in local time.
export function toDateString(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Value for an <input type="datetime-local">.
export function toLocalInput(iso: string): string {
    const d = new Date(iso);
    return `${toDateString(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Parses a "YYYY-MM-DD" date as local midnight (not UTC, which `new Date()` does).
export function parseLocalDate(date: string): Date {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
    const d = parseLocalDate(date);
    d.setDate(d.getDate() + days);
    return toDateString(d);
}

export function isValidDateRange(start: string, end: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;
}

export function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDateRange(start: string, end: string): string {
    const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    const s = parseLocalDate(start).toLocaleDateString([], opts);
    return start === end ? s : `${s} – ${parseLocalDate(end).toLocaleDateString([], opts)}`;
}

// True when the device isn't in the event's timezone, so times may look off.
export function isDifferentTimezone(timezone: string | null): boolean {
    if (!timezone) return false;
    return Intl.DateTimeFormat().resolvedOptions().timeZone !== timezone;
}
