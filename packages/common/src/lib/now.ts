import { onScopeDispose, ref, watch, type Ref } from 'vue';

// The app's clock. Normally the real time; for testing, an app can shift it
// (e.g. to replay an event day that's already past) with setClockOffset().
const clockOffsetMs = ref(0);

export function setClockOffset(ms: number) {
    clockOffsetMs.value = ms;
}

export function clockOffset(): Ref<number> {
    return clockOffsetMs;
}

// "Now" on the app's clock, in epoch milliseconds. Use this (not Date.now())
// for anything the user sees or that's compared against schedule times.
export function clockNow(): number {
    return Date.now() + clockOffsetMs.value;
}

// The app clock as a ref that ticks every `intervalMs`, for countdowns and
// "started 12m ago" labels. Jumps immediately when the clock is shifted.
export function useNow(intervalMs = 1000): Ref<number> {
    const now = ref(clockNow());
    const timer = setInterval(() => (now.value = clockNow()), intervalMs);
    const stop = watch(clockOffsetMs, () => (now.value = clockNow()));
    onScopeDispose(() => {
        clearInterval(timer);
        stop();
    });
    return now;
}

// "45s", "12m", "1h 5m".
export function formatElapsed(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return `${Math.max(0, Math.floor(ms / 1000))}s`;
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Stopwatch-style "MM:SS", or "H:MM:SS" past an hour.
export function formatClock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
