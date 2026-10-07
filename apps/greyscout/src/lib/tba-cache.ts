// @ts-nocheck
// Ephemeral, client-side-only cache for TBA OPR/DPR stats — intentionally
// never persisted to the DB (issue #26). Modeled on
// offline-queue-store.ts's try/catch localStorage load/save pattern.
// TBA's oprs endpoint returns every team at an event in one call, so this
// caches per-event rather than per-team to actually minimize TBA requests.

import { tbaStatsCacheKey, tbaRankingsCacheKey } from '@/lib/constants';
import { fetchEventOprDpr, fetchEventRankings } from '@/lib/tba-query';

function loadCache() {
    try {
        const raw = localStorage.getItem(tbaStatsCacheKey);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function saveCache(cache) {
    try {
        localStorage.setItem(tbaStatsCacheKey, JSON.stringify(cache));
    } catch (e) {
        console.warn('Failed to persist TBA stats cache:', e);
    }
}

export function getCachedTbaStats(eventId) {
    return loadCache()[eventId] ?? null;
}

export function setCachedTbaStats(eventId, stats) {
    const cache = loadCache();
    cache[eventId] = { fetchedAt: Date.now(), ...stats };
    saveCache(cache);
}

export function getTeamTbaStats(eventId, teamNumber) {
    const stats = getCachedTbaStats(eventId);
    if (!stats) return null;

    const opr = stats.oprs?.[teamNumber];
    const dpr = stats.dprs?.[teamNumber];
    if (opr == null && dpr == null) return null;

    return { opr: opr ?? null, dpr: dpr ?? null };
}

export async function refreshTbaStats(eventId) {
    const { oprs, dprs } = await fetchEventOprDpr(eventId);
    setCachedTbaStats(eventId, { oprs, dprs });
    return { oprs, dprs };
}

// ── Rankings (issue #123) ──
// Kept under their own key: setCachedTbaStats replaces an event's whole
// OPR/DPR entry, which would drop rankings stored alongside it.

function loadRankingsCache() {
    try {
        const raw = localStorage.getItem(tbaRankingsCacheKey);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

// { fetchedAt, ranks: { [teamNumber]: rank } }, or null if never fetched.
export function getCachedTbaRankings(eventId) {
    return loadRankingsCache()[eventId] ?? null;
}

export async function refreshTbaRankings(eventId) {
    const ranks = await fetchEventRankings(eventId);
    const entry = { fetchedAt: Date.now(), ranks };
    const cache = loadRankingsCache();
    cache[eventId] = entry;
    try {
        localStorage.setItem(tbaRankingsCacheKey, JSON.stringify(cache));
    } catch (e) {
        console.warn('Failed to persist TBA rankings cache:', e);
    }
    return entry;
}
