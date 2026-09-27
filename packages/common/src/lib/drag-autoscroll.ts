import { onUnmounted } from 'vue';

// The whole SPA scrolls inside #app (position: fixed + overflow: auto in
// main.css), not the window, and SortableJS's built-in autoscroll is
// unreliable here — so this runs a self-contained requestAnimationFrame loop
// off a draggable's @start/@end events. Same approach as PicklistView.vue's
// drag autoscroll (see that file for the full write-up), and the defaults
// below are that file's exact values: speed grows in proportion to how far
// into the edge zone the pointer is. One addition: with nestedScrollSelector,
// a matching scrollable element under the pointer (e.g. the Playoffs team
// pool on desktop) scrolls when the pointer nears *its* top or bottom edge,
// before falling back to scrolling the page. Sortable's ghost has
// pointer-events: none, so elementFromPoint sees what's underneath it.
export interface AutoscrollOptions {
    /** No scrolling until the pointer is within this many px of an edge. */
    sensitivity?: number;
    /** px/frame right at the sensitivity boundary. */
    minSpeed?: number;
    /** px/frame right at the very edge. */
    maxSpeed?: number;
    /** CSS selector of a nested scroll container that should also autoscroll. */
    nestedScrollSelector?: string;
}

export function useDragAutoscroll(options: AutoscrollOptions = {}) {
    const sensitivity = options.sensitivity ?? 80;
    const minSpeed = options.minSpeed ?? 12;
    const maxSpeed = options.maxSpeed ?? 135;

    let pointerX: number | null = null;
    let pointerY: number | null = null;
    let rafId: number | null = null;
    let container: HTMLElement | null = null;
    let lastFrameTime: number | null = null;
    let carry = 0;
    let previousScrollBehavior = '';

    // The min/max speeds are PicklistView's, which it feeds to a per-frame
    // scrollBy under #app's `scroll-behavior: smooth`. What the user actually
    // sees there is not those numbers: measured with a scrollBy per animation
    // frame at 12/60/135 px per frame, Firefox scrolls at a steady 0.111
    // (= 1/9) of the nominal px/frame * 60 — 80, 398 and 896 px/s, linear in
    // the requested speed — whereas Chrome stays at a flat ~180 px/s whatever
    // is requested. This scrolls instantly (see startAutoscroll) at that same
    // 1/9 rate in every browser, so the feel is Firefox's on the pick list.
    const EFFECTIVE_SPEED_RATIO = 1 / 9;

    // Speeds are per 60fps frame, scaled by real elapsed time so the scroll
    // rate is the same on 30/60/120Hz displays (iOS Low Power Mode caps
    // animation frames at 30fps, which would otherwise halve the speed).
    const FRAME_MS = 1000 / 60;
    const MAX_FRAME_MS = 50; // don't lurch after a stalled frame

    // Scroll by a fractional amount, keeping the sub-pixel remainder for the
    // next frame — browsers round scroll offsets differently.
    const scrollByAmount = (el: HTMLElement, amount: number) => {
        const total = amount + carry;
        const whole = Math.trunc(total);
        carry = total - whole;
        if (whole !== 0) el.scrollBy(0, whole);
    };

    const trackPointer = (evt: any) => {
        const point = evt.touches ? evt.touches[0] : evt;
        pointerX = point.clientX;
        pointerY = point.clientY;
    };

    // Speed (px/frame, signed) for a pointer at `pos` within [start, end]:
    // 0 outside the edge zones, growing toward the edge, negative near the start.
    const edgeSpeed = (pos: number, start: number, end: number, zone: number) => {
        const fromStart = pos - start;
        const fromEnd = end - pos;
        const speedForDepth = (depth: number) => minSpeed + (maxSpeed - minSpeed) * depth;
        if (fromStart < zone) return -speedForDepth(1 - Math.min(1, Math.max(0, fromStart) / zone));
        if (fromEnd < zone) return speedForDepth(1 - Math.min(1, Math.max(0, fromEnd) / zone));
        return 0;
    };

    // The opted-in nested scroll container under the pointer, if any.
    const findInnerScrollable = (x: number, y: number): HTMLElement | null => {
        if (!options.nestedScrollSelector) return null;
        const el = document.elementFromPoint(x, y);
        return (el?.closest(options.nestedScrollSelector) as HTMLElement | null) ?? null;
    };

    const tick = (now: number) => {
        const elapsed = lastFrameTime == null ? FRAME_MS : Math.min(now - lastFrameTime, MAX_FRAME_MS);
        lastFrameTime = now;
        const scale = (elapsed / FRAME_MS) * EFFECTIVE_SPEED_RATIO;

        if (pointerX != null && pointerY != null && container) {
            const inner = findInnerScrollable(pointerX, pointerY);
            let scrolledInner = false;

            if (inner) {
                const rect = inner.getBoundingClientRect();
                const speed = edgeSpeed(pointerY, rect.top, rect.bottom, Math.min(sensitivity, rect.height / 4));
                const canScroll = speed < 0
                    ? inner.scrollTop > 0
                    : speed > 0 && inner.scrollTop + inner.clientHeight < inner.scrollHeight - 1;
                if (canScroll) {
                    scrollByAmount(inner, speed * scale);
                    scrolledInner = true;
                }
            }

            if (!scrolledInner) {
                const speed = edgeSpeed(pointerY, 0, window.innerHeight, sensitivity);
                if (speed !== 0) scrollByAmount(container, speed * scale);
            }
        }
        rafId = requestAnimationFrame(tick);
    };

    function startAutoscroll() {
        stopAutoscroll(); // in case a previous drag never reported its end
        pointerX = null;
        pointerY = null;
        lastFrameTime = null;
        carry = 0;
        container = (document.getElementById('app') || document.scrollingElement || document.documentElement) as HTMLElement;
        // #app has `scroll-behavior: smooth` (main.css). Chrome and Safari then
        // start a fresh smooth-scroll animation on every scrollBy — one per
        // frame here — each restarting from a standstill, so the page crawls
        // at a fraction of the intended speed (Firefox applies them
        // cumulatively, which is why it looked fine). Scroll instantly for the
        // duration of the drag, then put the original behavior back.
        previousScrollBehavior = container.style.scrollBehavior;
        container.style.scrollBehavior = 'auto';
        document.addEventListener('pointermove', trackPointer);
        document.addEventListener('touchmove', trackPointer, { passive: true });
        document.addEventListener('mousemove', trackPointer);
        rafId = requestAnimationFrame(tick);
    }

    function stopAutoscroll() {
        document.removeEventListener('pointermove', trackPointer);
        document.removeEventListener('touchmove', trackPointer);
        document.removeEventListener('mousemove', trackPointer);
        if (rafId != null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (container) container.style.scrollBehavior = previousScrollBehavior;
        pointerX = null;
        pointerY = null;
        lastFrameTime = null;
        container = null;
    }

    onUnmounted(stopAutoscroll);

    return { startAutoscroll, stopAutoscroll };
}
