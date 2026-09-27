// @ts-nocheck

import { defineStore } from 'pinia';
import { fetchWatchlist, addToWatchlist, removeFromWatchlist } from '@/lib/watchlist-query';

export const useWatchlistStore = defineStore('watchlist', {
    state() {
        return {
            eventId: null as string | null,
            watchedTeamNumbers: [] as number[],
            loaded: false
        };
    },
    getters: {
        isWatched(state) {
            return (teamNumber: number) => state.watchedTeamNumbers.includes(Number(teamNumber));
        }
    },
    actions: {
        async loadWatchlist(eventId: string) {
            this.eventId = eventId;
            this.loaded = false;
            this.watchedTeamNumbers = await fetchWatchlist(eventId);
            this.loaded = true;
        },

        // Optimistically flips the local state, then reverts if the write fails.
        // Returns the error object or null on success.
        async toggleWatch(eventId: string, teamNumber: number) {
            const num = Number(teamNumber);
            const wasWatched = this.watchedTeamNumbers.includes(num);

            if (wasWatched) {
                this.watchedTeamNumbers = this.watchedTeamNumbers.filter((n) => n !== num);
            } else {
                this.watchedTeamNumbers = [...this.watchedTeamNumbers, num];
            }

            const error = wasWatched
                ? await removeFromWatchlist(eventId, num)
                : await addToWatchlist(eventId, num);

            if (error) {
                // Revert the optimistic update.
                this.watchedTeamNumbers = wasWatched
                    ? [...this.watchedTeamNumbers, num]
                    : this.watchedTeamNumbers.filter((n) => n !== num);
            }

            return error;
        }
    }
});
