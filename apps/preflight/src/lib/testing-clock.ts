import { clockNow, clockOffset, setClockOffset } from '@greybots/common/lib/now';

// Testing mode: an admin can pretend it's a different date/time on this
// device (e.g. to replay an event day that's already over and check the
// schedule-driven features). The clock keeps ticking from the pretend time.
// Stored per device; anything recorded meanwhile (status changes, checked
// steps, task times) uses the pretend time, so test on a test event.

const storageKey = 'preflight_clock_offset';

export function loadTestingClock() {
    try {
        const saved = Number(localStorage.getItem(storageKey));
        if (Number.isFinite(saved) && saved !== 0) setClockOffset(saved);
    } catch {
        // Storage unavailable: real time.
    }
}

// Pretend it's `at` (epoch ms) right now.
export function setPretendTime(at: number) {
    const offset = at - Date.now();
    setClockOffset(offset);
    try {
        localStorage.setItem(storageKey, String(offset));
    } catch {
        // Storage unavailable; lasts until reload.
    }
}

export function resetClock() {
    setClockOffset(0);
    try {
        localStorage.removeItem(storageKey);
    } catch {
        // Nothing to clear.
    }
}

export function isClockShifted(): boolean {
    return clockOffset().value !== 0;
}

export { clockNow };
