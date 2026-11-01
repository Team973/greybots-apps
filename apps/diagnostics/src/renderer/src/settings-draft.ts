import { onBeforeUnmount, onMounted, ref } from 'vue';

import { defaultSettings, settingsErrors, type Settings, type SettingsErrors } from '@shared/settings';
import { useSettingsStore } from '@/stores/settings-store';

// Settings as a page edits them (Settings, and the robot connection on the
// Offload page). Each change is saved as it's made: at once for a switch or
// a choice, and once typing pauses for a text or number box. A change with
// something wrong with it isn't saved until it's put right.

export type SaveState = 'idle' | 'saving' | 'saved' | 'invalid';

const typingPauseMs = 600;

export function useSettingsDraft() {
  const store = useSettingsStore();
  const draft = ref<Settings>({ ...defaultSettings });
  const errors = ref<SettingsErrors>({});
  const saveState = ref<SaveState>('idle');

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  // Saves one after another, so an older one can't land after a newer one.
  let saving: Promise<void> = Promise.resolve();

  function edit(change: Partial<Settings>, delay = 0) {
    draft.value = { ...draft.value, ...change };
    // Checked here so the message is instant; the main process checks again,
    // since it's the one that keeps them.
    errors.value = settingsErrors(draft.value);
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (Object.keys(errors.value).length > 0) {
      saveState.value = 'invalid';
      return;
    }
    saveTimer = setTimeout(save, delay);
  }

  const typed = (change: Partial<Settings>) => edit(change, typingPauseMs);

  function save() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    const settings = draft.value;
    saveState.value = 'saving';
    saving = saving.then(async () => {
      const problems = await store.save(settings);
      // Changed again since: that change's own save says how it went.
      if (draft.value !== settings) return;
      errors.value = problems;
      saveState.value = Object.keys(problems).length > 0 ? 'invalid' : 'saved';
    });
  }

  // From what the main process has, for when something else changed them.
  async function reload() {
    await store.load();
    draft.value = JSON.parse(JSON.stringify(store.settings)) as Settings;
  }

  onMounted(reload);
  // Leaving the page while typing: what was typed is saved.
  onBeforeUnmount(() => {
    if (saveTimer) save();
  });

  return { draft, errors, saveState, edit, typed, reload };
}
