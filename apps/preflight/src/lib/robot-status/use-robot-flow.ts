import { computed, type Ref } from 'vue';
import { useNow } from '@greybots/common/lib/now';
import {
    getChecklistSequence,
    getPitRoles,
    getEndOfDayChecklist,
    getPracticeChecklist,
    getStartOfDayChecklist,
    type ChecklistDef,
    type ChecklistSequence,
    type PitRole
} from '@/lib/checklists/config';
import { useLiveQuery } from '@/lib/live-query';
import type { ScheduleItem } from '@/lib/schedule/types';
import { effectiveStatus, listStatusHistory, type RobotStatusEntry } from './robot-status';

// Live state of the pit flow for an event: status history, the effective
// status right now (including the automatic Away -> Inbound), and the
// checklist configuration.
export function useRobotFlow(eventKey: Ref<string>, matches: Ref<ScheduleItem[]>) {
    const now = useNow(1000);
    // Null until loaded, so screens don't flash the "no history" default.
    const history = useLiveQuery<RobotStatusEntry[] | null>(() => listStatusHistory(eventKey.value), null, eventKey);
    const sequence = useLiveQuery<ChecklistSequence>(getChecklistSequence, { checklists: [] });
    const roles = useLiveQuery<PitRole[]>(getPitRoles, []);
    // The checklists the flow runs at fixed points.
    const practice = useLiveQuery<ChecklistDef | null>(getPracticeChecklist, null);
    const startOfDay = useLiveQuery<ChecklistDef | null>(getStartOfDayChecklist, null);
    const endOfDay = useLiveQuery<ChecklistDef | null>(getEndOfDayChecklist, null);

    const loaded = computed(() => history.value !== null);
    const latest = computed(() => history.value?.[0] ?? null);
    const effective = computed(() => effectiveStatus(latest.value, matches.value, now.value));
    const elapsedMs = computed(() => (effective.value.since ? now.value - Date.parse(effective.value.since) : null));

    return { now, history, loaded, latest, effective, elapsedMs, sequence, roles, practice, startOfDay, endOfDay };
}
