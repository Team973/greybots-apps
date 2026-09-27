import { defineStore } from 'pinia';
import { db, getMeta, setMeta } from '@/lib/db';
import { defaultIdleLockMinutes, kioskSessionKey } from '@/lib/constants';
import { signOutAccount } from '@/lib/greybots-account';

// kiosk: shared device, pit crew sign in with local PINs, fully offline.
//        Syncing uses a greybots-apps account "linked" to the device.
// web:   personal device, sign in with your own greybots-apps account.
export type DeviceMode = 'kiosk' | 'web';

interface DeviceConfig {
    mode: DeviceMode;
    deviceId: string;
    deviceName: string;
    idleLockMinutes: number;
    configuredAt: string;
}

const deviceConfigKey = 'device';

export const useDeviceStore = defineStore('device', {
    state() {
        return {
            loaded: false,
            config: null as DeviceConfig | null
        };
    },
    getters: {
        isConfigured(): boolean {
            return !!this.config;
        },
        mode(): DeviceMode | null {
            return this.config?.mode ?? null;
        },
        isKiosk(): boolean {
            return this.config?.mode === 'kiosk';
        },
        deviceName(): string {
            return this.config?.deviceName ?? '';
        }
    },
    actions: {
        async load() {
            this.config = (await getMeta<DeviceConfig>(deviceConfigKey)) ?? null;
            this.loaded = true;
        },

        async configure(mode: DeviceMode, deviceName: string) {
            const config: DeviceConfig = {
                mode,
                deviceId: crypto.randomUUID(),
                deviceName: deviceName.trim() || 'Preflight device',
                idleLockMinutes: defaultIdleLockMinutes,
                configuredAt: new Date().toISOString()
            };
            await setMeta(deviceConfigKey, config);
            this.config = config;
        },

        async update(changes: Partial<Pick<DeviceConfig, 'deviceName' | 'idleLockMinutes'>>) {
            if (!this.config) return;
            const config = { ...this.config, ...changes };
            await setMeta(deviceConfigKey, config);
            this.config = config;
        },

        // Wipe everything on this device (local users, unsynced data, config)
        // and return to first-run setup.
        async resetDevice() {
            await signOutAccount().catch(() => undefined);
            sessionStorage.removeItem(kioskSessionKey);
            db.close();
            await db.delete();
            window.location.replace('/');
        }
    }
});
