import { onScopeDispose, ref, watch } from 'vue';

export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface AutosaveOptions<T> {
    // Debounce after the last change before saving.
    delay?: number;
    // Save automatically when `source` changes. When false, call `trigger()`
    // yourself (e.g. on blur), for fields where saving every pause is wrong.
    watchSource?: boolean;
    // Only autosave while this is true (e.g. editing an existing record).
    enabled: () => boolean;
    // Return an error message to block the save and show it instead.
    validate?: (value: T) => string | null;
}

// Saves an edit form automatically: debounced while typing, only when the
// values actually changed since the last save, and flushed on close.
export function useAutosave<T>(source: () => T, save: (value: T) => Promise<unknown>, options: AutosaveOptions<T>) {
    const state = ref<AutosaveState>('idle');
    const error = ref<string | null>(null);
    let baseline = '';
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight: Promise<void> | null = null;

    const snapshot = () => JSON.stringify(source());

    async function run() {
        timer = null;
        const value = source();
        const serialized = JSON.stringify(value);
        if (serialized === baseline) {
            if (state.value === 'pending') state.value = 'saved';
            return;
        }
        const invalid = options.validate?.(value) ?? null;
        if (invalid) {
            error.value = invalid;
            state.value = 'error';
            return;
        }
        state.value = 'saving';
        try {
            await save(value);
            baseline = serialized;
            error.value = null;
            // A newer edit may have queued another save meanwhile.
            state.value = timer ? 'pending' : 'saved';
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e);
            state.value = 'error';
        }
    }

    function schedule(delay = options.delay ?? 600) {
        if (!options.enabled() || snapshot() === baseline) return;
        if (timer) clearTimeout(timer);
        state.value = 'pending';
        timer = setTimeout(() => (inflight = run().finally(() => (inflight = null))), delay);
    }

    // Save now (e.g. on blur or after filling fields programmatically).
    function trigger() {
        schedule(0);
    }

    // Finish any pending or in-flight save; call before closing the form.
    // Compares against the last save rather than relying on a queued timer,
    // since the change watcher may not have fired yet for the latest keystroke.
    async function flush() {
        if (timer) clearTimeout(timer);
        timer = null;
        await inflight;
        if (options.enabled() && snapshot() !== baseline) {
            inflight = run().finally(() => (inflight = null));
            await inflight;
        }
    }

    // Call after loading the form's values so they aren't saved back unchanged.
    function reset() {
        if (timer) clearTimeout(timer);
        timer = null;
        baseline = snapshot();
        state.value = 'idle';
        error.value = null;
    }

    if (options.watchSource !== false) {
        watch(source, () => schedule(), { deep: true });
    }
    onScopeDispose(() => {
        if (timer) clearTimeout(timer);
    });

    return { state, error, trigger, flush, reset };
}
