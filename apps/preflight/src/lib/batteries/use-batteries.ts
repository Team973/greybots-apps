import { computed } from 'vue';
import { useLiveQuery } from '@/lib/live-query';
import {
    installedUse,
    latestReadings,
    listBatteries,
    listBatteryUses,
    listMeasurements,
    type Battery,
    type BatteryMeasurement,
    type BatteryReadings,
    type BatteryUse
} from './batteries';

// Live view of the battery registry with each battery's latest readings and
// history, plus the battery that's in the robot right now.
export function useBatteries() {
    // Null until each query has answered, so callers that decide something
    // from the data (e.g. which battery to recommend) can wait for all of it.
    const batteryRows = useLiveQuery<Battery[] | null>(listBatteries, null);
    const measurementRows = useLiveQuery<BatteryMeasurement[] | null>(() => listMeasurements(), null);
    const useRows = useLiveQuery<BatteryUse[] | null>(() => listBatteryUses(), null);
    const loaded = computed(() => batteryRows.value !== null && measurementRows.value !== null && useRows.value !== null);
    const batteries = computed(() => batteryRows.value ?? []);
    const measurements = computed(() => measurementRows.value ?? []);
    const uses = computed(() => useRows.value ?? []);

    const measurementsByBattery = computed(() => {
        const map = new Map<string, BatteryMeasurement[]>();
        for (const m of measurements.value) map.set(m.battery_id, [...(map.get(m.battery_id) ?? []), m]);
        return map;
    });
    const usesByBattery = computed(() => {
        const map = new Map<string, BatteryUse[]>();
        for (const u of uses.value) map.set(u.battery_id, [...(map.get(u.battery_id) ?? []), u]);
        return map;
    });
    const readings = computed(() => {
        const map = new Map<string, BatteryReadings>();
        for (const b of batteries.value) map.set(b.id, latestReadings(measurementsByBattery.value.get(b.id) ?? []));
        return map;
    });

    const installed = computed(() => installedUse(uses.value));
    const installedBattery = computed(() => batteries.value.find((b) => b.id === installed.value?.battery_id) ?? null);

    return { loaded, batteries, measurements, uses, measurementsByBattery, usesByBattery, readings, installed, installedBattery };
}
