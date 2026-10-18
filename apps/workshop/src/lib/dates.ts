// Dates as the shop sees them: in this device's time zone.

const pad = (n: number) => String(n).padStart(2, '0');

// A Date as "YYYY-MM-DD" in local time (what <input type="date"> uses).
export function toDateString(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "YYYY-MM-DD" as local midnight.
export function parseDate(value: string): Date {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function addDays(value: string, days: number): string {
    const date = parseDate(value);
    date.setDate(date.getDate() + days);
    return toDateString(date);
}

export function today(): string {
    return toDateString(new Date());
}

// A date and an "HH:MM" wall-clock time, as an ISO timestamp.
export function combine(date: string, time: string): string {
    const [h, m] = time.split(':').map(Number);
    const at = parseDate(date);
    at.setHours(h, m, 0, 0);
    return at.toISOString();
}

// A timestamp's local "HH:MM".
export function toTimeString(iso: string): string {
    const at = new Date(iso);
    return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

// "Tue, Oct 14"
export function formatDay(value: string | Date): string {
    const date = typeof value === 'string' ? (value.length === 10 ? parseDate(value) : new Date(value)) : value;
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

// "Oct 14, 2026"
export function formatDate(value: string): string {
    const date = value.length === 10 ? parseDate(value) : new Date(value);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// "6:00 PM"
export function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// "Tue, Oct 14 · 6:00 PM – 9:00 PM"
export function formatSessionTime(startsAt: string, endsAt: string): string {
    return `${formatDay(startsAt)} · ${formatTime(startsAt)} – ${formatTime(endsAt)}`;
}

export const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
