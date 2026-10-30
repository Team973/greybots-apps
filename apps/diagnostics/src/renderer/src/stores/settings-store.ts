import { defineStore } from 'pinia';

import { defaultSettings, type Settings, type SettingsErrors } from '@shared/settings';

// The settings as the main process last reported them. The main process owns
// them (it keeps the file); this is the window's copy.
export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: { ...defaultSettings } as Settings,
    loaded: false
  }),
  actions: {
    async load() {
      this.settings = await window.diagnostics.getSettings();
      this.loaded = true;
    },
    // Resolves to what was wrong, by field. Empty when the settings were saved.
    async save(settings: Settings): Promise<SettingsErrors> {
      // A plain copy: what's handed over may be a reactive object, which
      // can't be sent to the main process.
      const result = await window.diagnostics.saveSettings({ ...settings });
      this.settings = result.settings;
      return result.errors;
    }
  }
});
