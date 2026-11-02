<script setup lang="ts">
import { onMounted, ref } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import NumberInput from '@greybots/common/components/Number.vue';
import Switch from '@greybots/common/components/Switch.vue';

import { ctreLicenseUrl, type OwletStatus } from '@shared/hoot';
import { shortcutActions, shortcutFromPress, type ShortcutAction } from '@shared/shortcuts';
import SaveStatus from '@/components/SaveStatus.vue';
import TeamAccount from '@/components/TeamAccount.vue';
import { useSettingsDraft } from '@/settings-draft';
import { useSettingsStore } from '@/stores/settings-store';

// The robot connection is set on the Offload page; the rest here.
const store = useSettingsStore();
const { draft, errors, saveState, edit, typed } = useSettingsDraft();
const defaultDirectory = ref('');

async function chooseFolder() {
  const directory = await window.diagnostics.chooseDataDirectory();
  if (directory) edit({ dataDirectory: directory });
}

// Shortcuts: click one, then press the keys. Escape keeps it as it was;
// Backspace or Delete turns it off.
const recording = ref<ShortcutAction | null>(null);

function recordKey(action: ShortcutAction, event: KeyboardEvent) {
  if (recording.value !== action) return;
  // The keys are for this, not for the shortcuts themselves (App.vue).
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    recording.value = null;
    return;
  }
  const shortcut = event.key === 'Backspace' || event.key === 'Delete' ? '' : shortcutFromPress(event);
  // A modifier on its own, or a plain key: keep waiting.
  if (shortcut === null) return;
  recording.value = null;
  setShortcut(action, shortcut);
}

function setShortcut(action: ShortcutAction, shortcut: string) {
  edit({ shortcuts: { ...draft.value.shortcuts, [action]: shortcut } });
}

// CTRE's owlet, which reads Hoot logs.
const owlet = ref<OwletStatus | null>(null);
const owletBusy = ref(false);

async function owletAction(action: () => Promise<OwletStatus>) {
  owletBusy.value = true;
  try {
    owlet.value = await action();
    await store.load();
    draft.value = { ...draft.value, ctreLicenseAccepted: store.settings.ctreLicenseAccepted };
  } finally {
    owletBusy.value = false;
  }
}

const acceptCtre = () => owletAction(() => window.diagnostics.acceptCtreLicense());
const updateOwlet = () => owletAction(() => window.diagnostics.downloadOwlet());

onMounted(async () => {
  owlet.value = await window.diagnostics.getOwletStatus();
  // The default folder's path depends on the computer, so the main process says.
  const storage = await window.diagnostics.getStorageInfo();
  if (storage.isDefault) defaultDirectory.value = storage.directory;
});
</script>

<template>
  <SaveStatus id="settings-saved" :state="saveState" />

  <section class="card">
    <h2>Offload</h2>
    <p class="hint">How to reach the robot is set on the <RouterLink to="/offload">Offload</RouterLink> page.</p>

    <div class="field-row">
      <div>
        Offload logs automatically
        <p class="hint">Pulls the robot's logs as soon as it connects. They can always be pulled from the Offload page.</p>
      </div>
      <Switch id="auto-offload-switch" :model-value="draft.autoOffload"
        @update:model-value="edit({ autoOffload: $event })"></Switch>
    </div>

    <div class="field-row">
      <div>
        Only pull logs from the last
        <p class="hint">In days. Older logs stay on the robot. 0 pulls every log.</p>
      </div>
      <NumberInput id="offload-days" :model-value="draft.offloadDays" label="Days"
        @update:model-value="typed({ offloadDays: $event })"></NumberInput>
    </div>
    <p v-if="errors.offloadDays" class="error-text">{{ errors.offloadDays }}</p>
  </section>

  <section class="card">
    <h2>Data folder</h2>
    <p class="hint">Where logs pulled off the robot, and what the app works out from them, are kept.</p>
    <p class="path" id="data-directory">{{ draft.dataDirectory || defaultDirectory || 'The default folder' }}</p>
    <div class="card-actions">
      <md-outlined-button @click="chooseFolder">Choose folder…</md-outlined-button>
      <md-outlined-button v-if="draft.dataDirectory" @click="edit({ dataDirectory: '' })">Use the default</md-outlined-button>
    </div>
    <p class="hint">Changing the folder doesn't move what's already in the old one.</p>
  </section>

  <section class="card" id="shortcuts-section">
    <h2>Keyboard shortcuts</h2>
    <p class="hint">
      These work from any page. Click one and press the keys, with Ctrl, Alt or Cmd. Escape keeps it as it was;
      Backspace turns it off.
    </p>
    <div v-for="action in shortcutActions" :key="action.id" class="field-row">
      <span>{{ action.label }}</span>
      <span class="shortcut-cell">
        <button :id="`shortcut-${action.id}`" class="shortcut-key" :class="{ recording: recording === action.id }"
          :aria-label="`Shortcut to ${action.label.toLowerCase()}`"
          @click="recording = recording === action.id ? null : action.id" @blur="recording = null"
          @keydown="recordKey(action.id, $event)">
          {{ recording === action.id ? 'Press keys…' : draft.shortcuts[action.id] || 'Off' }}
        </button>
        <button v-if="draft.shortcuts[action.id] !== action.default" class="reset" @click="setShortcut(action.id, action.default)">
          Reset to {{ action.default }}
        </button>
      </span>
    </div>
    <p v-if="errors.shortcuts" class="error-text">{{ errors.shortcuts }}</p>
  </section>

  <section class="card" id="ctre-section">
    <h2>CTRE Hoot logs</h2>
    <p class="hint">
      Hoot logs (motor controllers, CANcoders, the Pigeon) are read with CTRE's owlet tool, which comes under
      <a :href="ctreLicenseUrl" target="_blank" rel="noreferrer">CTRE's licence</a>. It's downloaded from CTRE onto this
      computer once the licence is accepted. Do that while online, before an event: after that it works offline.
    </p>
    <template v-if="owlet">
      <div v-if="!owlet.licenseAccepted" class="card-actions">
        <md-filled-button id="accept-ctre" :disabled="owletBusy" @click="acceptCtre">
          {{ owletBusy ? 'Downloading owlet…' : "Accept CTRE's licence and download owlet" }}
        </md-filled-button>
      </div>
      <template v-else>
        <p v-if="owlet.installed.length === 0" class="hint">No owlet downloaded yet.</p>
        <ul v-else class="owlet-list">
          <li v-for="version in owlet.installed" :key="version.compliancy">
            owlet {{ version.version }}, for Hoot logs of compliancy {{ version.compliancy }}
          </li>
        </ul>
        <p v-if="owlet.checkedAt" class="hint">Last checked with CTRE {{ new Date(owlet.checkedAt).toLocaleString() }}.</p>
        <p v-if="owlet.error" class="error-text">{{ owlet.error }}</p>
        <div class="card-actions">
          <md-outlined-button id="update-owlet" :disabled="owletBusy || owlet.downloading" @click="updateOwlet">
            {{ owletBusy || owlet.downloading ? 'Checking…' : 'Check CTRE for owlet updates' }}
          </md-outlined-button>
        </div>
      </template>
    </template>
  </section>

  <TeamAccount />
</template>

<style scoped>
.shortcut-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.shortcut-key {
  min-width: 120px;
  padding: 6px 10px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: var(--tile-background-color);
  color: inherit;
  font: inherit;
  font-family: ui-monospace, Consolas, monospace;
  cursor: pointer;
}

.shortcut-key.recording {
  border-color: #2a78d6;
  outline: 2px solid color-mix(in srgb, #2a78d6 40%, transparent);
}

.reset {
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
  opacity: 0.8;
}

.owlet-list {
  margin: 0;
  padding-left: 20px;
}
</style>
