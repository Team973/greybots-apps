import { liveQuery } from 'dexie';
import { onScopeDispose, ref, type Ref } from 'vue';

// Reactive view of an IndexedDB query: re-runs whenever the underlying
// tables change (including changes written by a sync pull).
export function useLiveQuery<T>(querier: () => T | Promise<T>, initial: T): Ref<T> {
    const result = ref(initial) as Ref<T>;
    const subscription = liveQuery(querier).subscribe({
        next: (value) => { result.value = value; },
        error: (err) => console.error('Live query failed:', err)
    });
    onScopeDispose(() => subscription.unsubscribe());
    return result;
}
