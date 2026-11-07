<script setup lang="ts">
import { ref } from 'vue';

import { eventKinds, type EventKind } from '@shared/events';
import { monitorCatalog } from '@shared/monitors';
import {
  pieMeasureLabels,
  scopeLabels,
  sectionLabels,
  type ReportScope,
  type ReportSection,
  type PieMeasure,
  type ReportSectionType,
  type ReportTemplate,
  type SavedView
} from '@shared/library';

// A report template, edited on a copy: saved, or let go.

const props = defineProps<{
  template: ReportTemplate;
  views: SavedView[];
}>();

const emit = defineEmits<{
  save: [template: ReportTemplate];
  cancel: [];
}>();

const draft = ref<ReportTemplate>(JSON.parse(JSON.stringify(props.template)) as ReportTemplate);
const adding = ref<ReportSectionType>('chart');

function setScope(type: ReportScope['type']) {
  draft.value.scope = type === 'conditions' ? { type, conditions: [{ key: '', value: true }] } : { type };
}

function newSection(type: ReportSectionType): ReportSection {
  switch (type) {
    case 'heading': return { type, text: 'Heading' };
    case 'text': return { type, text: '' };
    case 'summary': return { type };
    case 'chart': {
      const view = props.views[0];
      return { type, title: view?.name ?? 'Chart', viewId: view?.id ?? null, view: view ? viewBody(view) : { axes: [], traces: [], span: { type: 'all' }, eventKinds: null } };
    }
    case 'stats': return { type, title: 'Stats', keys: [] };
    case 'pie': return { type, title: 'Pie chart', measure: 'charge', voltage: '', slices: [] };
    case 'events': return { type, title: 'Errors and warnings', kinds: [], problemsOnly: true };
    case 'monitors': return { type, title: 'Monitors', ids: [] };
    case 'vision': return { type, title: 'Vision system' };
  }
}

const viewBody = (view: SavedView) => JSON.parse(JSON.stringify({ axes: view.axes, traces: view.traces, span: view.span, eventKinds: view.eventKinds }));

function add() {
  draft.value.sections.push(newSection(adding.value));
}

function move(i: number, by: -1 | 1) {
  const sections = draft.value.sections;
  const j = i + by;
  if (j < 0 || j >= sections.length) return;
  [sections[i], sections[j]] = [sections[j], sections[i]];
}

function pickView(section: Extract<ReportSection, { type: 'chart' }>, id: string) {
  const view = props.views.find((v) => v.id === id);
  if (!view) return;
  section.viewId = view.id;
  section.view = viewBody(view);
  if (!section.title || props.views.some((v) => v.name === section.title)) section.title = view.name;
}

// Stats' signals, one per line.
const keysText = (keys: string[]) => keys.join('\n');
const setKeys = (section: Extract<ReportSection, { type: 'stats' }>, text: string) => {
  section.keys = text.split('\n').map((k) => k.trim()).filter(Boolean);
};
function addViewKeys(section: Extract<ReportSection, { type: 'stats' }>, id: string) {
  const view = props.views.find((v) => v.id === id);
  if (view) section.keys = [...new Set([...section.keys, ...view.traces.filter((t) => t.kind !== 'string').map((t) => t.key)])];
}

// A pie's slices: each a name and its signals, one per line; or many at
// once, a slice for each signal.
type PieSection = Extract<ReportSection, { type: 'pie' }>;
const sliceKeys = (slice: PieSection['slices'][number], text: string) => {
  slice.keys = text.split('\n').map((k) => k.trim()).filter(Boolean);
};
const eachText = ref<Record<number, string>>({});
function addEach(section: PieSection, i: number) {
  const keys = (eachText.value[i] ?? '').split('\n').map((k) => k.trim()).filter(Boolean);
  section.slices.push(...keys.map((key) => ({ label: '', keys: [key] })));
  eachText.value[i] = '';
}

function toggleKind(section: Extract<ReportSection, { type: 'events' }>, kind: EventKind) {
  section.kinds = section.kinds.includes(kind) ? section.kinds.filter((k) => k !== kind) : [...section.kinds, kind];
}

const canSave = () => draft.value.name.trim() !== '';
</script>

<template>
  <form id="template-editor" class="editor" @submit.prevent="canSave() && emit('save', draft)">
    <label class="field">
      <span>Name</span>
      <input v-model="draft.name" maxlength="120" required />
    </label>
    <label class="field">
      <span>What it's for</span>
      <textarea v-model="draft.description" rows="2" maxlength="4000"></textarea>
    </label>
    <label class="field">
      <span>For one robot only</span>
      <input :value="draft.robot ?? ''" placeholder="Any robot (or a name like frc254)" maxlength="40"
        @input="draft.robot = ($event.target as HTMLInputElement).value.trim() || null" />
    </label>

    <fieldset class="field">
      <legend>Of</legend>
      <label v-for="(label, type) in scopeLabels" :key="type" class="choice">
        <input type="radio" name="scope" :checked="draft.scope.type === type" @change="setScope(type)" /> {{ label }}
      </label>
      <div v-if="draft.scope.type === 'conditions'" class="conditions">
        <div v-for="(condition, i) in draft.scope.conditions" :key="i" class="condition">
          <input v-model="condition.key" placeholder="Signal, e.g. /Robot/Test/Running" aria-label="Signal" />
          <select v-model="condition.value" aria-label="Is">
            <option :value="true">is true</option>
            <option :value="false">is false</option>
          </select>
          <button type="button" class="icon" aria-label="Remove" @click="draft.scope.conditions.splice(i, 1)">✕</button>
        </div>
        <button type="button" class="small-button" @click="draft.scope.conditions.push({ key: '', value: true })">Add a condition</button>
        <p class="hint small">The report is of wherever they all hold. Signals are found by name, or by the end of their path.</p>
      </div>
    </fieldset>

    <h3>Sections</h3>
    <p v-if="draft.sections.length === 0" class="hint small">None yet.</p>
    <div v-for="(section, i) in draft.sections" :key="i" class="section">
      <div class="section-head">
        <strong>{{ sectionLabels[section.type] }}</strong>
        <span class="spacer"></span>
        <button type="button" class="icon" aria-label="Move up" :disabled="i === 0" @click="move(i, -1)">↑</button>
        <button type="button" class="icon" aria-label="Move down" :disabled="i === draft.sections.length - 1" @click="move(i, 1)">↓</button>
        <button type="button" class="icon" aria-label="Remove section" @click="draft.sections.splice(i, 1)">✕</button>
      </div>
      <input v-if="section.type === 'heading'" v-model="section.text" aria-label="Heading" maxlength="120" />
      <textarea v-else-if="section.type === 'text'" v-model="section.text" rows="3" aria-label="Text" maxlength="4000"></textarea>
      <p v-else-if="section.type === 'summary'" class="hint small">How long, the match's phases, errors, warnings, brownouts and the battery.</p>
      <template v-else-if="section.type === 'chart'">
        <input v-model="section.title" aria-label="Chart title" maxlength="120" />
        <select :value="section.viewId ?? ''" aria-label="From the view" @change="pickView(section, ($event.target as HTMLSelectElement).value)">
          <option value="" disabled>Pick a saved view</option>
          <option v-for="view in views" :key="view.id" :value="view.id">{{ view.name }}</option>
        </select>
        <p class="hint small">
          {{ section.view.traces.map((t) => t.key).join(', ') || 'No signals: save a view on the Signals page first.' }}
        </p>
      </template>
      <template v-else-if="section.type === 'stats'">
        <input v-model="section.title" aria-label="Table title" maxlength="120" />
        <textarea :value="keysText(section.keys)" rows="4" aria-label="Signals, one per line" placeholder="Signals, one per line"
          @change="setKeys(section, ($event.target as HTMLTextAreaElement).value)"></textarea>
        <select value="" aria-label="Add a view's signals" @change="addViewKeys(section, ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
          <option value="">Add a saved view's signals…</option>
          <option v-for="view in views" :key="view.id" :value="view.id">{{ view.name }}</option>
        </select>
      </template>
      <template v-else-if="section.type === 'pie'">
        <input v-model="section.title" aria-label="Pie title" maxlength="120" />
        <select v-model="section.measure" aria-label="What the slices add up">
          <option v-for="(label, measure) in pieMeasureLabels" :key="measure" :value="measure as PieMeasure">{{ label }}</option>
        </select>
        <p v-if="section.measure === 'charge'" class="hint small">
          Each slice's share of the total over the report's span: its signals' averages added up, times the span. Currents, say: amp-seconds drawn.
        </p>
        <template v-else>
          <input v-model="section.voltage" aria-label="Voltage signal" placeholder="Voltage: empty for each current's own (…Voltage beside …Current)" />
          <p class="hint small">
            Each slice's share of the energy over the report's span: each of its signals (a current) times the voltage, added up over time, in
            watt-hours. Leave the voltage empty to use each current's own supply voltage, as motor controllers log it (SupplyVoltage beside
            SupplyCurrent); or name one, the battery's, for all of them.
          </p>
        </template>
        <div v-for="(slice, j) in section.slices" :key="j" class="slice">
          <input v-model="slice.label" :aria-label="`Slice ${j + 1} name`" placeholder="Name (or the signal's)" maxlength="120" />
          <textarea :value="keysText(slice.keys)" :rows="Math.min(4, Math.max(1, slice.keys.length))" :aria-label="`Slice ${j + 1} signals, one per line`"
            placeholder="Signals, one per line" @change="sliceKeys(slice, ($event.target as HTMLTextAreaElement).value)"></textarea>
          <button type="button" class="icon" :aria-label="`Remove slice ${j + 1}`" @click="section.slices.splice(j, 1)">✕</button>
        </div>
        <button type="button" class="small-button" @click="section.slices.push({ label: '', keys: [] })">Add a slice</button>
        <textarea v-model="eachText[i]" rows="3" aria-label="Signals to add, a slice each" placeholder="Or signals, one per line, a slice each"></textarea>
        <button type="button" class="small-button" :disabled="!eachText[i]?.trim()" @click="addEach(section, i)">Add a slice for each</button>
      </template>
      <template v-else-if="section.type === 'monitors'">
        <input v-model="section.title" aria-label="Monitors title" maxlength="120" />
        <div class="kinds">
          <label v-for="monitor in monitorCatalog" :key="monitor.id" class="choice small">
            <input type="checkbox" :checked="section.ids.includes(monitor.id)"
              @change="section.ids = section.ids.includes(monitor.id) ? section.ids.filter((id) => id !== monitor.id) : [...section.ids, monitor.id]" /> {{ monitor.name }}
          </label>
        </div>
        <p class="hint small">None ticked runs every monitor. Their bounds are in the code (monitorSettings, src/shared/monitors.ts).</p>
      </template>
      <template v-else-if="section.type === 'vision'">
        <input v-model="section.title" aria-label="Vision title" maxlength="120" />
        <p class="hint small">Each camera the robot reads: frames used and thrown out, when (a heatmap), and its measurements against the fused pose.</p>
      </template>
      <template v-else-if="section.type === 'events'">
        <input v-model="section.title" aria-label="Events title" maxlength="120" />
        <div class="kinds">
          <label v-for="kind in eventKinds" :key="kind.kind" class="choice small">
            <input type="checkbox" :checked="section.kinds.includes(kind.kind)" @change="toggleKind(section, kind.kind)" /> {{ kind.label }}
          </label>
        </div>
        <label class="choice small"><input v-model="section.problemsOnly" type="checkbox" /> Errors and warnings only</label>
        <p class="hint small">No kinds ticked lists every kind.</p>
      </template>
    </div>

    <div class="add">
      <select v-model="adding" aria-label="Section to add">
        <option v-for="(label, type) in sectionLabels" :key="type" :value="type">{{ label }}</option>
      </select>
      <button type="button" class="small-button" @click="add">Add a section</button>
    </div>

    <div class="actions">
      <button id="save-template" class="small-button primary" type="submit" :disabled="!canSave()">Save</button>
      <button class="small-button" type="button" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: none;
  margin: 0;
  padding: 0;
}

.field > span,
legend {
  font-size: 0.85rem;
  opacity: 0.75;
}

input,
textarea,
select {
  padding: 5px 8px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

select option {
  background: var(--tile-background-color, Canvas);
}

.choice {
  display: flex;
  align-items: center;
  gap: 6px;
}

.conditions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 0 22px;
}

.condition {
  display: flex;
  gap: 6px;
}

.condition input {
  flex: 1;
}

.slice {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(0, 2fr) auto;
  align-items: start;
  gap: 6px;
}

.small-button {
  align-self: flex-start;
}

h3 {
  margin: 8px 0 0;
  font-size: 1rem;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid rgba(127, 127, 127, 0.3);
  border-radius: 8px;
}

.section-head,
.add,
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spacer {
  flex: 1;
}

.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.icon {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.icon:disabled {
  opacity: 0.3;
}

.small-button {
  padding: 5px 12px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.small-button.primary {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 18%, transparent);
}

.small-button:disabled {
  opacity: 0.45;
}

.small {
  font-size: 0.85rem;
}
</style>
