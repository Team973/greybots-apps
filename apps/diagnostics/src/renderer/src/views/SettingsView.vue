<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import NumberInput from '@greybots/common/components/Number.vue';
import Switch from '@greybots/common/components/Switch.vue';
import TextInput from '@greybots/common/components/TextInput.vue';

import { robotAddresses } from '@shared/robot-address';
import { defaultSettings, settingsErrors, type Settings, type SettingsErrors } from '@shared/settings';
import { useSettingsStore } from '@/stores/settings-store';

const store = useSettingsStore();

// What's on screen, which only becomes the app's settings on Save.
const draft = ref<Settings>({ ...defaultSettings });
const errors = ref<SettingsErrors>({});
const saved = ref(false);
const defaultDirectory = ref('');

const manual = computed(() => draft.value.addressMode === 'manual');
const addresses = computed(() => robotAddresses(draft.value));
const changed = computed(() => JSON.stringify(draft.value) !== JSON.stringify(store.settings));

function edit(change: Partial<Settings>) {
  draft.value = { ...draft.value, ...change };
  saved.value = false;
}

async function chooseFolder() {
  const directory = await window.diagnostics.chooseDataDirectory();
  if (directory) edit({ dataDirectory: directory });
}

async function save() {
  // Checked here first so the message is instant; the main process checks
  // again, since it's the one that keeps them.
  errors.value = settingsErrors(draft.value);
  if (Object.keys(errors.value).length > 0) return;

  errors.value = await store.save(draft.value);
  if (Object.keys(errors.value).length > 0) return;

  draft.value = { ...store.settings };
  saved.value = true;
}

onMounted(async () => {
  await store.load();
  draft.value = { ...store.settings };
  // The default folder's path depends on the computer, so the main process says.
  const storage = await window.diagnostics.getStorageInfo();
  if (storage.isDefault) defaultDirectory.value = storage.directory;
});
</script>

<template>
  <section class="card">
    <h2>Robot connection</h2>

    <div class="field-row">
      <NumberInput id="team-number" :model-value="draft.teamNumber" label="Team number"
        @update:model-value="edit({ teamNumber: $event })"></NumberInput>
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
        @update:model-value="edit({ manualAddress: $event })"></TextInput>
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
        <p class="hint">Pulls the robot's logs as soon as it connects. They can always be pulled from the Logs page.</p>
      </div>
      <Switch id="auto-offload-switch" :model-value="draft.autoOffload"
        @update:model-value="edit({ autoOffload: $event })"></Switch>
    </div>

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

  <div class="card-actions">
    <md-filled-button id="save-settings" :disabled="!changed" @click="save">Save</md-filled-button>
    <span v-if="saved" id="settings-saved" class="success-text">Saved.</span>
  </div>
</template>
