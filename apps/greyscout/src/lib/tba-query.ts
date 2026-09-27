// @ts-nocheck
// Thin wrappers around the tba-proxy Supabase Edge Function, which holds the
// TBA API key (and, for the schedule refresh, a service-role Supabase key)
// server-side so neither ever reaches the browser.

import { supabase } from '@greybots/common/supabase/client';
import { tbaProxyFunction } from '@/lib/constants';

async function describeFunctionError(error, data) {
    if (data?.error) return data.error;
    if (!error) return 'Unknown error';
    try {
        if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.json();
            if (body?.error) return body.error;
        }
    } catch {
        // Body wasn't JSON (or already consumed) — fall through to the generic message below.
    }
    return error.message ?? String(error);
}

export async function refreshEventSchedule(eventId) {
    const { data, error } = await supabase.functions.invoke(tbaProxyFunction, {
        body: { action: 'refresh_schedule', event_id: eventId }
    });

    if (error || data?.error) {
        return { matchCount: 0, error: { message: await describeFunctionError(error, data) } };
    }

    return { matchCount: data?.matchCount ?? 0, error: null };
}

export async function fetchEventOprDpr(eventId) {
    const { data, error } = await supabase.functions.invoke(tbaProxyFunction, {
        body: { action: 'get_oprs', event_id: eventId }
    });

    if (error || data?.error) {
        throw new Error(await describeFunctionError(error, data));
    }

    // TBA keys OPRs/DPRs by team key ("frc973") — normalize to bare team numbers.
    const normalize = (byTeamKey) => {
        const result = {};
        Object.entries(byTeamKey ?? {}).forEach(([key, value]) => {
            const teamNumber = Number(key.replace('frc', ''));
            if (Number.isFinite(teamNumber)) result[teamNumber] = value;
        });
        return result;
    };

    return {
        oprs: normalize(data?.oprs),
        dprs: normalize(data?.dprs)
    };
}
