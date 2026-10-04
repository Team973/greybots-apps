import { db } from '@/lib/db';
import { saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';
import { uuidFromName } from '@/lib/uuid';

// The pit timer: a countdown the crew sets by hand (up to 99:99), shown on
// the Overview and on the pit display. Its state is one synced row, so both
// places, and every device, show the same timer.

export const timersTable = 'timers';
const pitTimerKey = 'pit';

export interface PitTimer extends SyncedRecord {
    key: string;
    // The four digits dialed in, as MMSS. Each digit is 0-9 on its own, so
    // "9999" is 99 minutes and 99 seconds.
    set_digits: string;
    // While running: when it reaches zero. Null when stopped or paused. This
    // is real time, not the app clock, so a device in testing mode still
    // agrees with the others.
    ends_at: string | null;
    // While paused: milliseconds left. Null otherwise.
    paused_ms: number | null;
    updated_by_name: string | null;
}

export type TimerState = Pick<PitTimer, 'set_digits' | 'ends_at' | 'paused_ms'>;
export const defaultTimerState: TimerState = { set_digits: '0500', ends_at: null, paused_ms: null };

// For a live query: awaits only the database.
export async function getPitTimer(): Promise<TimerState> {
    const row = await db.syncedTable<PitTimer>(timersTable).where('key').equals(pitTimerKey).first();
    if (!row || row.deleted || !/^\d{4}$/.test(row.set_digits)) return defaultTimerState;
    return { set_digits: row.set_digits, ends_at: row.ends_at, paused_ms: row.paused_ms };
}

async function save(state: TimerState, editor: string | null) {
    // The id is derived from the key, so every device writes the same row.
    await saveRecord<PitTimer>(timersTable, { id: await uuidFromName(`timer:${pitTimerKey}`), key: pitTimerKey, ...state, updated_by_name: editor });
}

// "MMSS" -> milliseconds. Seconds above 59 simply count as seconds.
export function digitsToMs(digits: string): number {
    return (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 1000;
}

export type TimerPhase = 'stopped' | 'running' | 'paused';
export function timerPhase(state: TimerState): TimerPhase {
    return state.ends_at ? 'running' : state.paused_ms !== null ? 'paused' : 'stopped';
}

// Time left, given the real time `now` (epoch ms).
export function timerRemainingMs(state: TimerState, now: number): number {
    if (state.ends_at) return Math.max(0, Date.parse(state.ends_at) - now);
    return state.paused_ms ?? digitsToMs(state.set_digits);
}

// Step one of the four digits up or down, wrapping 0-9 on its own. Only while
// the timer is stopped.
export function adjustTimerDigit(state: TimerState, index: number, delta: 1 | -1, editor: string | null) {
    if (timerPhase(state) !== 'stopped') return Promise.resolve();
    const digits = state.set_digits.split('').map(Number);
    digits[index] = (digits[index] + delta + 10) % 10;
    return save({ set_digits: digits.join(''), ends_at: null, paused_ms: null }, editor);
}

// Start from the dialed-in time, or resume from where it was paused.
export function startTimer(state: TimerState, editor: string | null) {
    const ms = state.paused_ms ?? digitsToMs(state.set_digits);
    if (ms <= 0) return Promise.resolve();
    return save({ set_digits: state.set_digits, ends_at: new Date(Date.now() + ms).toISOString(), paused_ms: null }, editor);
}

export function pauseTimer(state: TimerState, editor: string | null) {
    if (!state.ends_at) return Promise.resolve();
    return save({ set_digits: state.set_digits, ends_at: null, paused_ms: timerRemainingMs(state, Date.now()) }, editor);
}

// Back to the last dialed-in time, stopped.
export function resetTimer(state: TimerState, editor: string | null) {
    return save({ set_digits: state.set_digits, ends_at: null, paused_ms: null }, editor);
}
