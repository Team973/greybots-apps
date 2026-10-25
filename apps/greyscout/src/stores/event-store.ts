// TODO: fix types
// @ts-nocheck

import { defineStore } from "pinia";

import { defaultEventId } from '@/lib/constants';
import { getCurrentEventInfo, getEventOverride } from '@/lib/event-management';

export const useEventStore = defineStore('event', {
    state() {
        return {
            id: defaultEventId,
            name: "",
            // True when this device is viewing an event picked on the Event
            // Management page rather than the automatically chosen one.
            overridden: false,
            isUpdated: false
        }
    },
    getters: {
        eventId(): boolean {
            return this.id;
        },
        eventName(): String {
            return this.name
        },
        isOverridden(): boolean {
            return this.overridden;
        },
        isLoaded(): boolean {
            return this.isUpdated;
        }
    },
    actions: {
        async updateEvent() {
            this.isUpdated = false;
            const info = await getCurrentEventInfo();
            this.id = info.id;
            this.name = info.name;
            this.overridden = getEventOverride() === info.id;
            this.isUpdated = true;
        }
    }
});
