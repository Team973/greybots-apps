import { onScopeDispose, watchEffect } from 'vue';

const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

// Calls onIdle after `minutes()` of no user input while `enabled()` is true.
// Used to auto-lock shared kiosk devices.
export function useIdleLock(enabled: () => boolean, minutes: () => number, onIdle: () => void) {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reset = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        if (enabled() && minutes() > 0) timer = setTimeout(onIdle, minutes() * 60_000);
    };

    for (const event of activityEvents) window.addEventListener(event, reset, { passive: true });
    watchEffect(reset);

    onScopeDispose(() => {
        if (timer) clearTimeout(timer);
        for (const event of activityEvents) window.removeEventListener(event, reset);
    });
}
