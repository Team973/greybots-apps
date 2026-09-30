import { liveQuery, type Subscription } from 'dexie';
import { onScopeDispose, ref, watch, type Ref, type WatchSource } from 'vue';

// Reactive view of an IndexedDB query: re-runs whenever the tables it read
// change (including changes written by a sync pull).
//
// Dexie only re-runs a query when a table it *read* changes, so if the query
// depends on Vue state (e.g. "items for the active event"), pass that state as
// `deps`. The query is re-subscribed whenever it changes. Otherwise a query
// that first ran with no event (and so read no tables) would never update.
export function useLiveQuery<T>(querier: () => T | Promise<T>, initial: T, deps?: WatchSource): Ref<T> {
    const result = ref(initial) as Ref<T>;
    let subscription: Subscription | null = null;

    const subscribe = () => {
        subscription?.unsubscribe();
        subscription = liveQuery(querier).subscribe({
            next: (value) => { result.value = value; },
            error: (err) => console.error('Live query failed:', err)
        });
    };

    if (deps) watch(deps, subscribe, { immediate: true });
    else subscribe();

    onScopeDispose(() => subscription?.unsubscribe());
    return result;
}
