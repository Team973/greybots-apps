<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import NumberInput from '@greybots/common/components/Number.vue';
import Switch from '@greybots/common/components/Switch.vue';
import TextInput from '@greybots/common/components/TextInput.vue';

import { robotAddresses } from '@shared/robot-address';
import { ctreLicenseUrl, type OwletStatus } from '@shared/hoot';
import { defaultSettings, settingsErrors, type Settings, type SettingsErrors } from '@shared/settings';
import { shortcutActions, shortcutFromPress, type ShortcutAction } from '@shared/shortcuts';
import { useSettingsStore } from '@/stores/settings-store';

const store = useSettingsStore();

// What's on screen. Each change is saved as it's made: at once for a switch
// or a choice, and once typing pauses for a text or number box. A change
// with something wrong with it isn't saved until it's put right.
const draft = ref<Settings>({ ...defaultSettings });
const errors = ref<SettingsErrors>({});
const saveState = ref<'idle' | 'saving' | 'saved' | 'invalid'>('idle');
const defaultDirectory = ref('');

const manual = computed(() => draft.value.addressMode === 'manual');
const addresses = computed(() => robotAddresses(draft.value));

const typingPauseMs = 600;
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

// Leaving the page while typing: what was typed is saved.
onBeforeUnmount(() => {
  if (saveTimer) save();
});

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
  await store.load();
  draft.value = JSON.parse(JSON.stringify(store.settings)) as Settings;
  // The default folder's path depends on the computer, so the main process says.
  const storage = await window.diagnostics.getStorageInfo();
  if (storage.isDefault) defaultDirectory.value = storage.directory;
});
</script>

<template>
  <p id="settings-saved" class="save-state" :class="{ 'error-text': saveState === 'invalid' }">
    <template v-if="saveState === 'saving'">Saving…</template>
    <template v-else-if="saveState === 'saved'">All changes saved.</template>
    <template v-else-if="saveState === 'invalid'">Not saved until the problem below is put right.</template>
    <template v-else>Changes are saved as you make them.</template>
  </p>

  <section class="card">
    <h2>Robot connection</h2>

    <div class="field-row">
      <NumberInput id="team-number" :model-value="draft.teamNumber" label="Team number"
        @update:model-value="typed({ teamNumber: $event })"></NumberInput>
    </div>
    <p v-if="errors.teamNumber" class="error-text">{{ errors.teamNumber }}</p>

    <div class="field-row">
      <div>
        Use a set address
        <p class="hint">For a robot that isn't at its usual team address, or a simulator.</p>
      </div>
      <Switch id="manual-address-switch" :model-value="manual"
        @update:model-value="edit({ addressMode: $event ? 'manual' : 'team' })"></Switch>
    </div>

    <template v-if="manual">
      <TextInput id="manual-address" :model-value="draft.manualAddress" label="IP address or hostname"
        @update:model-value="typed({ manualAddress: $event })"></TextInput>
      <p v-if="errors.manualAddress" class="error-text">{{ errors.manualAddress }}</p>
    </template>

    <div class="field-row">
      <div>
        Find the robot by mDNS
        <p class="hint">Looks for the robot by its name on the network, as well as its address.</p>
      </div>
      <Switch id="mdns-switch" :model-value="draft.mdnsEnabled"
        @update:model-value="edit({ mdnsEnabled: $event })"></Switch>
    </div>

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

    <p class="hint">
      With these settings the robot is looked for at:
      <span v-for="(address, i) in addresses" :key="address.host" class="path">{{ i > 0 ? ', ' : ' ' }}{{ address.host }}</span>
    </p>
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
</template>

<style scoped>
.save-state {
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.8;
}

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
