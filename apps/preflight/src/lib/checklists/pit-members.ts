import { computed } from 'vue';
import { listKioskUsers } from '@/lib/kiosk-users';
import { useLiveQuery } from '@/lib/live-query';
import { getPitRoles } from './config';

// Names to offer when assigning work: everyone on the pit roles roster, plus
// this device's kiosk crew. Assignees are free text, so anyone else can be
// typed in too.
export function usePitMembers() {
    const roles = useLiveQuery(getPitRoles, []);
    const crew = useLiveQuery(listKioskUsers, []);
    return computed(() => {
        const names = new Set<string>();
        for (const role of roles.value) if (role.assignee.trim()) names.add(role.assignee.trim());
        for (const user of crew.value) names.add(user.name);
        return [...names].sort((a, b) => a.localeCompare(b));
    });
}
