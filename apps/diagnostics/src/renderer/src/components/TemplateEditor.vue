<script setup lang="ts">
import { ref } from 'vue';

import { eventKinds, type EventKind } from '@shared/events';
import {
  scopeLabels,
  sectionLabels,
  type ReportScope,
  type ReportSection,
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
    case 'events': return { type, title: 'Errors and warnings', kinds: [], problemsOnly: true };
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
