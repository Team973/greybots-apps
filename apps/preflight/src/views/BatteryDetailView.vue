<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import AutosaveStatus from '@/components/AutosaveStatus.vue';
import BatteryQr from '@/components/batteries/BatteryQr.vue';
import { useAutosave } from '@/lib/autosave';
import {
  addMeasurement,
  batterySets,
  batteryStatusLabels,
  batteryStatuses,
  deleteBattery,
  deleteBatteryUse,
  deleteMeasurement,
  formatReading,
  installBattery,
  registerBattery,
  removeBattery,
  setUseWh,
  totalWhDischarged,
  updateBattery,
  useCounts,
  type BatteryStatus,
  type BatteryUse,
  type MeasurementInput
} from '@/lib/batteries/batteries';
import { useBatteries } from '@/lib/batteries/use-batteries';
import { useLiveQuery } from '@/lib/live-query';
import { formatTime } from '@/lib/schedule/dates';
import { getActiveEvent, listScheduleItems } from '@/lib/schedule/schedule-repo';
import type { ActiveEvent, ScheduleItem } from '@/lib/schedule/types';
import { clockNow } from '@greybots/common/lib/now';
import { useSessionStore } from '@/stores/session-store';

// One battery (issue #87): its details and QR label, putting it in the robot
// for a match or test, manual measurements, and its history.
const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const canEdit = computed(() => session.hasRole('member'));
const editor = () => session.user?.name ?? null;

const number = computed(() => Number(route.params.number));
const { batteries, readings, measurementsByBattery, usesByBattery, installed, installedBattery } = useBatteries();
const battery = computed(() => batteries.value.find((b) => b.number === number.value) ?? null);
const batteryKey = computed(() => battery.value?.id ?? '');
const measurements = computed(() => measurementsByBattery.value.get(batteryKey.value) ?? []);
const uses = computed(() => usesByBattery.value.get(batteryKey.value) ?? []);
const latest = computed(() => readings.value.get(batteryKey.value) ?? null);
const counts = computed(() => useCounts(uses.value));
// Running total of energy discharged over every use.
const whTotal = computed(() => totalWhDischarged(uses.value));
const sets = computed(() => batterySets(batteries.value));
const isInstalled = computed(() => !!battery.value && installed.value?.battery_id === battery.value.id);

const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const eventKey = computed(() => activeEvent.value?.event_key ?? '');
const items = useLiveQuery<ScheduleItem[]>(() => (eventKey.value ? listScheduleItems(eventKey.value) : []), [], eventKey);
const matches = computed(() =>
  items.value.filter((i) => i.kind === 'match').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
);

const error = ref<string | null>(null);
const busy = ref(false);
async function act(action: () => Promise<unknown>) {
  error.value = null;
  busy.value = true;
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

// --- Details (saved automatically) ---
const label = ref('');
const purchaseDate = ref('');
const status = ref<BatteryStatus>('active');
const setName = ref('');
const notes = ref('');
const details = () => ({
  label: label.value,
  purchase_date: purchaseDate.value || null,
  status: status.value,
  set_name: setName.value,
  notes: notes.value
});
const autosave = useAutosave(details, (value) => updateBattery(batteryKey.value, value, editor()), {
  enabled: () => canEdit.value && !!battery.value
});
watch(
  batteryKey,
  () => {
    label.value = battery.value?.label ?? '';
    purchaseDate.value = battery.value?.purchase_date ?? '';
    status.value = battery.value?.status ?? 'active';
    setName.value = battery.value?.set_name ?? '';
    notes.value = battery.value?.notes ?? '';
    autosave.reset();
  },
  { immediate: true }
);

// --- Assignment ---
// "match:<key>", "test", or "other". Defaults to our next match.
const target = ref('test');
const nextMatch = computed(() => matches.value.find((m) => Date.parse(m.end_at) > clockNow()) ?? null);
// Keyed on the match itself, so a schedule refresh doesn't undo a selection.
watch(
  () => nextMatch.value?.match_key ?? null,
  (key) => (target.value = key ? `match:${key}` : 'test'),
  { immediate: true }
);

function install() {
  const id = batteryKey.value;
  const event = eventKey.value || null;
  if (target.value.startsWith('match:')) {
    const matchKey = target.value.slice('match:'.length);
    const match = matches.value.find((m) => m.match_key === matchKey);
    return act(() => installBattery(id, { event_key: event, kind: 'match', match_key: matchKey, label: match?.title ?? matchKey }, editor()));
  }
  const kind = target.value === 'test' ? 'test' : 'other';
  return act(() => installBattery(id, { event_key: event, kind, label: kind === 'test' ? 'Test / practice' : 'Other' }, editor()));
}

const openUse = computed(() => uses.value.find((u) => !u.removed_at) ?? null);
const takeOut = () => openUse.value && act(() => removeBattery(openUse.value!, editor()));

// Wh discharged in one use, entered after the match or test.
function saveUseWh(use: BatteryUse, event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim();
  const wh = raw === '' ? null : Number(raw);
  if (wh === (use.wh_discharged ?? null)) return;
  return act(() => setUseWh(use.id, wh, editor()));
}

function useLine(use: BatteryUse): string {
  const day = new Date(use.installed_at).toLocaleDateString([], { month: 'numeric', day: 'numeric' });
  const until = use.removed_at ? ` – ${formatTime(use.removed_at)}` : ' – now';
  return `${day} ${formatTime(use.installed_at)}${until}${use.installed_by_name ? ` · ${use.installed_by_name}` : ''}`;
}

// --- Measurements ---
const voltage = ref<number | ''>('');
const resistance = ref<number | ''>('');
const charge = ref<number | ''>('');
const capacity = ref<number | ''>('');
const observations = ref('');
const num = (value: number | '') => (value === '' ? null : value);

function saveMeasurement() {
  const input: MeasurementInput = {
    resting_voltage: num(voltage.value),
    internal_resistance_mohm: num(resistance.value),
    state_of_charge: num(charge.value),
    capacity_wh: num(capacity.value),
    observations: observations.value
  };
  return act(async () => {
    await addMeasurement(batteryKey.value, input, editor());
    voltage.value = resistance.value = charge.value = capacity.value = '';
    observations.value = '';
  });
}

function when(iso: string): string {
  return `${new Date(iso).toLocaleDateString([], { month: 'numeric', day: 'numeric' })} ${formatTime(iso)}`;
}

function remove() {
  if (!battery.value || !confirm(`Remove battery ${battery.value.number} from the registry?`)) return;
  return act(async () => {
    await deleteBattery(battery.value!.id);
    router.push('/batteries');
  });
}

const register = () => act(() => registerBattery(number.value, {}, editor()));
</script>

<template>
  <div class="battery-detail">
    <RouterLink to="/batteries" class="panel-link">← All batteries</RouterLink>

    <div v-if="!battery" class="card">
      <h2>Battery {{ Number.isInteger(number) ? number : '' }} isn't registered</h2>
      <p class="hint">Register it to start tracking its measurements and use.</p>
      <div v-if="canEdit && Number.isInteger(number) && number > 0" class="form-row">
        <md-filled-button :disabled="busy" @click="register">Register battery {{ number }}</md-filled-button>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
    </div>

    <template v-else>
      <header class="head">
        <h1>Battery {{ battery.number }}</h1>
        <span v-if="isInstalled" class="tag installed-tag">In robot</span>
        <span v-if="battery.status !== 'active'" class="tag" :class="battery.status">{{ batteryStatusLabels[battery.status] }}</span>
        <span class="summary">
          {{ formatReading(latest?.state_of_charge ?? null, 0) }}% · {{ formatReading(latest?.resting_voltage ?? null, 2) }} V ·
          {{ formatReading(latest?.internal_resistance_mohm ?? null) }} mΩ · {{ formatReading(whTotal, 0) }} Wh used
        </span>
      </header>
      <p v-if="error" class="error-text">{{ error }}</p>

      <div class="columns">
        <div class="column">
          <section class="panel">
            <header class="panel-header"><h2>In the robot</h2></header>
            <p v-if="isInstalled && openUse" class="state">
              Installed for <strong>{{ openUse.label ?? 'use' }}</strong> since {{ formatTime(openUse.installed_at) }}.
            </p>
            <p v-else class="state">
              Not installed.<template v-if="installedBattery"> Battery {{ installedBattery.number }} is in the robot.</template>
            </p>
            <div v-if="canEdit" class="form-row">
              <label class="field">
                <span>{{ isInstalled ? 'Assign to' : 'Install for' }}</span>
                <select v-model="target">
                  <option v-for="m in matches" :key="m.id" :value="`match:${m.match_key}`">{{ m.title }} · {{ formatTime(m.start_at) }}</option>
                  <option value="test">Test / practice</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <md-filled-button class="row-button" :disabled="busy || battery.status === 'retired'" @click="install">
                {{ isInstalled ? 'Reassign' : 'Install' }}
              </md-filled-button>
              <md-outlined-button v-if="isInstalled" class="row-button" :disabled="busy" @click="takeOut">Take out</md-outlined-button>
            </div>
            <p v-if="battery.status === 'retired'" class="hint">Retired batteries can't be installed.</p>
          </section>

          <section class="panel">
            <header class="panel-header">
              <h2>Details</h2>
              <AutosaveStatus v-if="canEdit" :state="autosave.state.value" :error="autosave.error.value" />
            </header>
            <div class="form-row">
              <label class="field"><span>Label</span><input v-model="label" :readonly="!canEdit" placeholder="e.g. MK ES17-12, 2026 set" /></label>
              <label class="field">
                <span>Lifecycle</span>
                <select v-model="status" :disabled="!canEdit">
                  <option v-for="s in batteryStatuses" :key="s" :value="s">{{ batteryStatusLabels[s] }}</option>
                </select>
              </label>
              <label class="field"><span>Purchased</span><input v-model="purchaseDate" type="date" :readonly="!canEdit" /></label>
            </div>
            <div class="form-row">
              <label class="field">
                <span>Set</span>
                <input v-model="setName" list="battery-sets" :readonly="!canEdit" placeholder="e.g. Season, Championship" />
                <datalist id="battery-sets"><option v-for="s in sets" :key="s" :value="s"></option></datalist>
              </label>
              <md-outlined-button v-if="canEdit && !isInstalled" class="row-button" @click="status = status === 'retired' ? 'active' : 'retired'">
                {{ status === 'retired' ? 'Return to service' : 'Retire battery' }}
              </md-outlined-button>
            </div>
            <p v-if="status === 'retired'" class="hint">Retired: hidden from All batteries and the rotation. Its history is kept.</p>
            <label class="field"><span>Notes</span><textarea v-model="notes" rows="2" :readonly="!canEdit"></textarea></label>
            <div class="label-row">
              <BatteryQr :number="battery.number" :size="96" />
              <div>
                <RouterLink :to="`/batteries/labels?only=${battery.number}`" class="panel-link">Print this battery's label</RouterLink>
                <p class="hint">Stick it on the battery, then use “Scan label” to pick it.</p>
                <button v-if="canEdit" class="danger-link" @click="remove">Remove from registry</button>
              </div>
            </div>
          </section>
        </div>

        <div class="column">
          <section class="panel">
            <header class="panel-header"><h2>Measurements</h2></header>
            <form v-if="canEdit" class="measure" @submit.prevent="saveMeasurement">
              <label class="field"><span>Resting V</span><input v-model.number="voltage" type="number" step="0.01" min="0" inputmode="decimal" /></label>
              <label class="field"><span>Resistance mΩ</span><input v-model.number="resistance" type="number" step="0.1" min="0" inputmode="decimal" /></label>
              <label class="field"><span>Charge %</span><input v-model.number="charge" type="number" step="1" min="0" inputmode="numeric" /></label>
              <label class="field"><span>Capacity Wh</span><input v-model.number="capacity" type="number" step="1" min="0" inputmode="numeric" /></label>
              <label class="field wide"><span>Observations</span><input v-model="observations" placeholder="e.g. swollen case, loose terminal" /></label>
              <button type="submit" class="record" :disabled="busy">Record</button>
            </form>
            <ul class="history">
              <li v-for="m in measurements" :key="m.id">
                <span class="when">{{ when(m.measured_at) }}</span>
                <span class="values">
                  <template v-if="m.resting_voltage !== null">{{ formatReading(m.resting_voltage, 2) }} V </template>
                  <template v-if="m.internal_resistance_mohm !== null">{{ formatReading(m.internal_resistance_mohm) }} mΩ </template>
                  <template v-if="m.state_of_charge !== null">{{ formatReading(m.state_of_charge, 0) }}% </template>
                  <template v-if="m.capacity_wh !== null">{{ formatReading(m.capacity_wh, 0) }} Wh </template>
                  <em v-if="m.observations">{{ m.observations }}</em>
                </span>
                <span class="by">{{ m.measured_by_name }}</span>
                <button v-if="canEdit" class="icon-small" aria-label="Delete measurement" @click="act(() => deleteMeasurement(m.id))">✕</button>
              </li>
            </ul>
            <p v-if="!measurements.length" class="hint">No measurements yet.</p>
          </section>

          <section class="panel">
            <header class="panel-header">
              <h2>Usage history</h2>
              <span class="hint">{{ counts.matches }} match{{ counts.matches === 1 ? '' : 'es' }} · {{ counts.tests }} test{{ counts.tests === 1 ? '' : 's' }} · {{ formatReading(whTotal, 0) }} Wh used</span>
            </header>
            <ul class="history">
              <li v-for="use in uses" :key="use.id">
                <span class="values"><strong>{{ use.label ?? use.kind }}</strong></span>
                <span class="when">{{ useLine(use) }}</span>
                <label class="use-wh" title="Wh discharged in this use">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    inputmode="decimal"
                    placeholder="—"
                    :value="use.wh_discharged ?? ''"
                    :readonly="!canEdit"
                    aria-label="Wh discharged in this use"
                    @change="saveUseWh(use, $event)"
                  />
                  <span>Wh</span>
                </label>
                <button v-if="canEdit" class="icon-small" aria-label="Delete this use" @click="act(() => deleteBatteryUse(use.id))">✕</button>
              </li>
            </ul>
            <p v-if="!uses.length" class="hint">Not used yet.</p>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.battery-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 1200px;
}

.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.head h1 {
  margin: 0;
  font-size: 1.8rem;
}

.summary {
  margin-left: auto;
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}

.tag {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.85rem;
  font-weight: 700;
}

.installed-tag {
  background: #2e7d32;
  color: #fff;
}

.tag.suspect {
  background: #ffc107;
  color: #1a1a1a;
}

.tag.retired {
  background: var(--accent-color);
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

@media (max-width: 900px) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

.state {
  margin: 0;
}

.hint {
  margin: 0;
  opacity: 0.7;
  font-size: 0.85rem;
}

.row-button {
  align-self: flex-end;
  flex: none;
}

.label-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.danger-link {
  margin-top: 6px;
  padding: 0;
  border: none;
  background: none;
  color: #e5534b;
  font: inherit;
  font-size: 0.85rem;
  text-decoration: underline;
  cursor: pointer;
}

.measure {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.measure .wide {
  grid-column: span 3;
}

.record {
  align-self: end;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: #2e7d32;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.record:disabled {
  opacity: 0.6;
}

.history {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--background-color);
}

.when,
.by {
  flex: none;
  font-size: 0.85rem;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.values {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.use-wh {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85rem;
}

.use-wh input {
  width: 64px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--tile-background-color);
  color: var(--primary-text-color);
  font: inherit;
  text-align: right;
}

.values em {
  opacity: 0.85;
}
</style>
