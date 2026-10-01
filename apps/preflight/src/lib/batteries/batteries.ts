import { clockNow } from '@greybots/common/lib/now';
import { db } from '@/lib/db';
import { deleteRecord, patchRecord, saveRecord } from '@/lib/sync/local-repo';
import type { SyncedRecord } from '@/lib/sync/types';
import { uuidFromName } from '@/lib/uuid';

// Batteries (issue #87): the registry, manual measurements, and which
// battery was in the robot when. Batteries belong to the team, not to one
// event, so none of this is filtered by event (uses record the event).

export const batteriesTable = 'batteries';
export const measurementsTable = 'batteryMeasurements';
export const batteryUsesTable = 'batteryUses';

export type BatteryStatus = 'active' | 'suspect' | 'retired';
export const batteryStatuses: BatteryStatus[] = ['active', 'suspect', 'retired'];
export const batteryStatusLabels: Record<BatteryStatus, string> = {
    active: 'Active',
    suspect: 'Suspect',
    retired: 'Retired'
};

export interface Battery extends SyncedRecord {
    // The number written on the battery. Fixed once registered: the row's id
    // is derived from it, so two devices registering battery 7 converge.
    number: number;
    label: string | null;
    // "YYYY-MM-DD".
    purchase_date: string | null;
    status: BatteryStatus;
    notes: string | null;
    updated_by_name: string | null;
}

// A manual reading. Every value is optional: a quick voltage check and a
// full analyzer reading are both one measurement.
export interface BatteryMeasurement extends SyncedRecord {
    battery_id: string;
    measured_at: string;
    resting_voltage: number | null;
    internal_resistance_mohm: number | null;
    // Percent.
    state_of_charge: number | null;
    capacity_wh: number | null;
    observations: string | null;
    // 'manual' today; charger telemetry (a future release) can add its own.
    source: string;
    measured_by_name: string | null;
    updated_by_name: string | null;
}

export type BatteryUseKind = 'match' | 'test' | 'other';

// A battery going into the robot. Open (removed_at null) while installed.
export interface BatteryUse extends SyncedRecord {
    battery_id: string;
    event_key: string | null;
    kind: BatteryUseKind;
    match_key: string | null;
    // What it was used for, as shown in the history (e.g. "Qual 12").
    label: string | null;
    // The pit visit (checklist run) it was installed in, if any.
    run_id: string | null;
    installed_at: string;
    installed_by_name: string | null;
    removed_at: string | null;
    removed_by_name: string | null;
    updated_by_name: string | null;
}

const nowIso = () => new Date(clockNow()).toISOString();
const clean = (value: string | null | undefined) => value?.trim() || null;

// --- Registry --------------------------------------------------------------

export function batteryId(number: number): Promise<string> {
    return uuidFromName(`battery:${number}`);
}

export async function listBatteries(): Promise<Battery[]> {
    const rows = await db.syncedTable<Battery>(batteriesTable).filter((b) => !b.deleted).toArray();
    return rows.sort((a, b) => a.number - b.number);
}

export interface BatteryInput {
    label?: string | null;
    purchase_date?: string | null;
    status?: BatteryStatus;
    notes?: string | null;
}

export async function registerBattery(number: number, input: BatteryInput, editor: string | null): Promise<Battery> {
    if (!Number.isInteger(number) || number <= 0) throw new Error('Enter the battery number (1, 2, 3…)');
    const id = await batteryId(number);
    const existing = await db.syncedTable<Battery>(batteriesTable).get(id);
    if (existing && !existing.deleted) throw new Error(`Battery ${number} is already registered`);
    return saveRecord<Battery>(batteriesTable, {
        id,
        number,
        label: clean(input.label),
        purchase_date: input.purchase_date || null,
        status: input.status ?? 'active',
        notes: clean(input.notes),
        updated_by_name: editor
    });
}

export function updateBattery(id: string, input: BatteryInput, editor: string | null) {
    return patchRecord<Battery>(batteriesTable, id, {
        label: clean(input.label),
        purchase_date: input.purchase_date || null,
        status: input.status ?? 'active',
        notes: clean(input.notes),
        updated_by_name: editor
    });
}

// Removes a battery registered by mistake. Its history stays in the database
// (and comes back if the number is registered again).
export function deleteBattery(id: string) {
    return deleteRecord(batteriesTable, id);
}

// The lowest number not in use, for the "add battery" form.
export function nextBatteryNumber(batteries: Battery[]): number {
    const used = new Set(batteries.map((b) => b.number));
    let n = 1;
    while (used.has(n)) n++;
    return n;
}

// --- QR labels -------------------------------------------------------------

const qrPrefix = 'preflight:battery:';

export function batteryQrText(number: number): string {
    return `${qrPrefix}${number}`;
}

// The battery number in a scanned code, or null if it isn't one of ours. A
// bare number is accepted too, so a typed or older label still works.
export function parseBatteryCode(text: string): number | null {
    const trimmed = text.trim();
    const value = trimmed.toLowerCase().startsWith(qrPrefix) ? trimmed.slice(qrPrefix.length) : trimmed;
    return /^\d{1,4}$/.test(value) ? Number(value) : null;
}

// --- Measurements ----------------------------------------------------------

export async function listMeasurements(batteryIdValue?: string): Promise<BatteryMeasurement[]> {
    const table = db.syncedTable<BatteryMeasurement>(measurementsTable);
    const rows = await (batteryIdValue ? table.where('battery_id').equals(batteryIdValue) : table.toCollection())
        .filter((m) => !m.deleted)
        .toArray();
    // Newest first.
    return rows.sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
}

export interface MeasurementInput {
    resting_voltage: number | null;
    internal_resistance_mohm: number | null;
    state_of_charge: number | null;
    capacity_wh: number | null;
    observations: string | null;
}

export function validateMeasurement(input: MeasurementInput): string | null {
    const { resting_voltage: v, internal_resistance_mohm: r, state_of_charge: soc, capacity_wh: wh } = input;
    if ([v, r, soc, wh].every((n) => n === null) && !input.observations?.trim()) return 'Enter at least one value or an observation';
    if ([v, r, soc, wh].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) return 'Values must be positive numbers';
    if (v !== null && v > 20) return 'Resting voltage looks wrong (a charged battery is about 13 V)';
    if (soc !== null && soc > 100) return 'State of charge is a percentage (0–100)';
    return null;
}

export async function addMeasurement(batteryIdValue: string, input: MeasurementInput, editor: string | null) {
    const error = validateMeasurement(input);
    if (error) throw new Error(error);
    return saveRecord<BatteryMeasurement>(measurementsTable, {
        battery_id: batteryIdValue,
        measured_at: nowIso(),
        resting_voltage: input.resting_voltage,
        internal_resistance_mohm: input.internal_resistance_mohm,
        state_of_charge: input.state_of_charge,
        capacity_wh: input.capacity_wh,
        observations: clean(input.observations),
        source: 'manual',
        measured_by_name: editor,
        updated_by_name: editor
    });
}

export function deleteMeasurement(id: string) {
    return deleteRecord(measurementsTable, id);
}

// The most recent value of each metric (they may come from different
// measurements, since each one can leave values out).
export interface BatteryReadings {
    resting_voltage: number | null;
    internal_resistance_mohm: number | null;
    state_of_charge: number | null;
    capacity_wh: number | null;
    // When the newest measurement was taken.
    measured_at: string | null;
}

// `measurements` must be newest first (as listMeasurements returns them).
export function latestReadings(measurements: BatteryMeasurement[]): BatteryReadings {
    const latest = <K extends keyof MeasurementInput>(key: K) =>
        (measurements.find((m) => m[key] !== null && m[key] !== undefined)?.[key] ?? null) as number | null;
    return {
        resting_voltage: latest('resting_voltage'),
        internal_resistance_mohm: latest('internal_resistance_mohm'),
        state_of_charge: latest('state_of_charge'),
        capacity_wh: latest('capacity_wh'),
        measured_at: measurements[0]?.measured_at ?? null
    };
}

// --- Use (assignment to a match or test) -----------------------------------

export async function listBatteryUses(batteryIdValue?: string): Promise<BatteryUse[]> {
    const table = db.syncedTable<BatteryUse>(batteryUsesTable);
    const rows = await (batteryIdValue ? table.where('battery_id').equals(batteryIdValue) : table.toCollection())
        .filter((u) => !u.deleted)
        .toArray();
    // Newest first.
    return rows.sort((a, b) => Date.parse(b.installed_at) - Date.parse(a.installed_at));
}

// The battery in the robot right now: the newest use that hasn't ended.
// `uses` must be newest first.
export function installedUse(uses: BatteryUse[]): BatteryUse | null {
    return uses.find((u) => !u.removed_at) ?? null;
}

export interface UseTarget {
    event_key: string | null;
    kind: BatteryUseKind;
    match_key?: string | null;
    label?: string | null;
    run_id?: string | null;
}

// Put a battery in the robot for a match or test. Whatever was installed
// before comes out at the same moment (one battery at a time).
export async function installBattery(batteryIdValue: string, target: UseTarget, editor: string | null): Promise<BatteryUse> {
    const now = nowIso();
    const open = (await listBatteryUses()).filter((u) => !u.removed_at);
    for (const use of open) {
        // Re-assigning the installed battery to another match is a new use.
        await patchRecord<BatteryUse>(batteryUsesTable, use.id, { removed_at: now, removed_by_name: editor, updated_by_name: editor });
    }
    return saveRecord<BatteryUse>(batteryUsesTable, {
        battery_id: batteryIdValue,
        event_key: target.event_key,
        kind: target.kind,
        match_key: target.match_key ?? null,
        label: clean(target.label),
        run_id: target.run_id ?? null,
        installed_at: now,
        installed_by_name: editor,
        removed_at: null,
        removed_by_name: null,
        updated_by_name: editor
    });
}

// Which battery to put in next: batteries are rotated in number order, so
// it's the next number up from the one installed most recently, wrapping
// back to the lowest. Only active batteries are suggested (a suspect one can
// still be chosen by hand). `uses` must be newest first.
export function recommendBattery(batteries: Battery[], uses: BatteryUse[]): Battery | null {
    const rotation = batteries.filter((b) => b.status === 'active').sort((a, b) => a.number - b.number);
    if (!rotation.length) return null;
    const last = batteries.find((b) => b.id === uses[0]?.battery_id);
    if (!last) return rotation[0];
    return rotation.find((b) => b.number > last.number) ?? rotation[0];
}

export function removeBattery(use: BatteryUse, editor: string | null) {
    return patchRecord<BatteryUse>(batteryUsesTable, use.id, { removed_at: nowIso(), removed_by_name: editor, updated_by_name: editor });
}

// Undo a wrong assignment.
export function deleteBatteryUse(id: string) {
    return deleteRecord(batteryUsesTable, id);
}

export function useCounts(uses: BatteryUse[]): { matches: number; tests: number } {
    return {
        matches: uses.filter((u) => u.kind === 'match').length,
        tests: uses.filter((u) => u.kind === 'test').length
    };
}

// "13.4" / "12" / "—": a reading with at most `digits` decimals.
export function formatReading(value: number | null, digits = 1): string {
    return value === null ? '—' : String(Number(value.toFixed(digits)));
}
