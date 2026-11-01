<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import NumberInput from '@greybots/common/components/Number.vue';
import Switch from '@greybots/common/components/Switch.vue';
import TextInput from '@greybots/common/components/TextInput.vue';

import { robotAddresses } from '@shared/robot-address';
import { ctreLicenseUrl, type OwletStatus } from '@shared/hoot';
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

    <div class="field-row">
      <div>
        Only pull logs from the last
        <p class="hint">In days. Older logs stay on the robot. 0 pulls every log.</p>
      </div>
      <NumberInput id="offload-days" :model-value="draft.offloadDays" label="Days"
        @update:model-value="edit({ offloadDays: $event })"></NumberInput>
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

  <div class="card-actions">
    <md-filled-button id="save-settings" :disabled="!changed" @click="save">Save</md-filled-button>
    <span v-if="saved" id="settings-saved" class="success-text">Saved.</span>
  </div>
</template>

<style scoped>
.owlet-list {
  margin: 0;
  padding-left: 20px;
}
</style>
