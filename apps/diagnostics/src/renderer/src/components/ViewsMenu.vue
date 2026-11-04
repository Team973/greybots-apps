<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { viewKeys, type SavedView, type SignalMapping, type ViewBody, type ViewSpan } from '@shared/library';
import { matchKey, searchMatches } from '@shared/signal-match';

// Saved views (#148): the chart as it is, kept by name to bring back on any
// log or live, its signals found by name, path end, or the robot's mapping.

const props = defineProps<{
  // The signals in what's open, to say how many of each view's are here.
  available: string[];
  // Whose log it is ("frc973"), for its mapping; '' live.
  robot: string;
  // What's on the chart now, less the span (the menu asks for that).
  current: (span: ViewSpan) => ViewBody;
  // Phases the open log has, to offer them as a view's span.
  canPhase: boolean;
}>();

const emit = defineEmits<{
  // A view to put on the chart, and the robot's mapping to find its signals with.
  apply: [view: SavedView, mapping: Record<string, string | null> | undefined];
}>();

const open = ref(false);
const views = ref<SavedView[]>([]);
const mappings = ref<SignalMapping[]>([]);
const query = ref('');
const problem = ref('');
const naming = ref<{ id?: string; name: string; span: ViewSpan['type'] | 'auto' | 'teleop' | 'endgame' | 'match' } | null>(null);

async function load() {
  try {
    [views.value, mappings.value] = await Promise.all([window.diagnostics.getLibrary('view'), window.diagnostics.getLibrary('mapping')]);
  } catch (error) {
    problem.value = (error as Error).message;
  }
}
watch(open, (isOpen) => { if (isOpen) load(); });

const mapping = computed(() => mappings.value.find((m) => m.robot === props.robot)?.fields);

// Each view with how many of its signals are here; the best fits first,
// then those saved for this robot.
const listed = computed(() => views.value
  .filter((view) => searchMatches(query.value, view.name, viewKeys(view)))
  .map((view) => {
    const keys = viewKeys(view);
    const found = keys.filter((key) => matchKey(key, props.available, mapping.value).key !== null).length;
    return { view, found, total: keys.length };
  })
  .sort((a, b) => (b.found / Math.max(1, b.total)) - (a.found / Math.max(1, a.total)) ||
    Number(b.view.robot === props.robot) - Number(a.view.robot === props.robot) || a.view.name.localeCompare(b.view.name)));

const spanChoices: { id: string; label: string }[] = [
  { id: 'all', label: 'The whole log' },
  { id: 'match', label: 'The match' },
  { id: 'auto', label: 'Autonomous' },
  { id: 'teleop', label: 'Teleop' },
  { id: 'endgame', label: 'Endgame' }
];

const toSpan = (choice: string): ViewSpan => (choice === 'all' ? { type: 'all' } : { type: 'phase', phase: choice as 'auto' | 'teleop' | 'endgame' | 'match' });
const spanName = (span: ViewSpan) => (span.type === 'all' ? '' : spanChoices.find((c) => c.id === span.phase)?.label ?? '');

function startSaving(view?: SavedView) {
  naming.value = view
    ? { id: view.id, name: view.name, span: view.span.type === 'all' ? 'all' : view.span.phase }
    : { name: '', span: 'all' };
}

async function save() {
  if (!naming.value || !naming.value.name.trim()) return;
  const existing = views.value.find((v) => v.id === naming.value!.id);
  const body = props.current(toSpan(naming.value.span));
  try {
    // A plain copy: reactive objects can't be sent to the main process.
    await window.diagnostics.saveLibraryItem(JSON.parse(JSON.stringify({
      ...(existing ?? { description: '', robot: null, createdBy: null, cloud: null, created: '', changed: '' }),
      id: existing?.id ?? '',
      kind: 'view',
      name: naming.value.name.trim(),
      ...body
    })) as SavedView);
    naming.value = null;
    await load();
  } catch (error) {
    problem.value = (error as Error).message;
  }
}

async function remove(view: SavedView) {
  problem.value = (await window.diagnostics.deleteLibraryItem('view', view.id).catch((e: Error) => e.message)) || '';
  await load();
}

function apply(view: SavedView) {
  emit('apply', view, mapping.value);
  open.value = false;
}

// Closed by a click elsewhere or Escape.
const box = ref<HTMLElement | null>(null);
function onDocumentClick(event: MouseEvent) {
  if (open.value && box.value && !box.value.contains(event.target as Node)) open.value = false;
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) open.value = false;
}
onMounted(() => {
  document.addEventListener('mousedown', onDocumentClick);
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentClick);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="box" class="views-menu">
    <button id="views-button" class="views-button" :aria-expanded="open" title="Saved views: save the chart, or bring one back"
      @click="open = !open">Views ▾</button>
    <div v-if="open" id="views-panel" class="panel">
      <div class="row">
        <input v-model="query" class="search" type="search" placeholder="Find a view by name or signal" aria-label="Find a view" />
        <button id="save-view" class="small-button" :disabled="available.length === 0 && !naming" @click="startSaving()">Save the chart…</button>
      </div>
      <form v-if="naming" class="naming" @submit.prevent="save">
        <input v-model="naming.name" class="search" placeholder="Name" aria-label="View name" maxlength="120" autofocus />
        <select v-model="naming.span" aria-label="Span shown">
          <option v-for="choice in spanChoices" :key="choice.id" :value="choice.id" :disabled="choice.id !== 'all' && !canPhase">
            {{ choice.label }}
          </option>
        </select>
        <button class="small-button" type="submit" :disabled="!naming.name.trim()">{{ naming.id ? 'Update' : 'Save' }}</button>
        <button class="small-button" type="button" @click="naming = null">Cancel</button>
      </form>
      <p v-if="problem" class="error-text small">{{ problem }}</p>
      <p v-if="listed.length === 0" class="hint small">{{ views.length ? 'No views match.' : 'No saved views yet.' }}</p>
      <ul class="views">
        <li v-for="{ view, found, total } in listed" :key="view.id" class="view">
          <button class="name" :disabled="found === 0" :title="found === 0 ? 'None of its signals are here' : `Show ${view.name}`" @click="apply(view)">
            {{ view.name }}
            <span class="hint small">{{ found }}/{{ total }} here{{ spanName(view.span) ? ` · ${spanName(view.span)}` : '' }}{{ view.robot ? ` · ${view.robot}` : '' }}{{ view.cloud ? ' · shared' : '' }}</span>
          </button>
          <button class="icon" :aria-label="`Update ${view.name} with the chart`" title="Update with the chart as it is" @click="startSaving(view)">✎</button>
          <button class="icon" :aria-label="`Delete ${view.name}`" title="Delete" @click="remove(view)">✕</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.views-menu {
  position: relative;
}

.views-button,
.small-button {
  padding: 6px 14px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.small-button {
  padding: 4px 10px;
  font-size: 0.85rem;
}

.small-button:disabled,
.name:disabled {
  opacity: 0.45;
  cursor: default;
}

.panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 5;
  width: min(460px, 80vw);
  max-height: 420px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid rgba(127, 127, 127, 0.4);
  border-radius: 8px;
  background: var(--tile-background-color, Canvas);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
}

.row,
.naming {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
}

.search {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.naming select {
  padding: 4px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.naming select option {
  background: var(--tile-background-color, Canvas);
}

.views {
  margin: 0;
  padding: 0;
  list-style: none;
}

.view {
  display: flex;
  align-items: center;
  gap: 2px;
  border-top: 1px solid rgba(127, 127, 127, 0.2);
}

.name {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  padding: 6px 4px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.name:hover:not(:disabled) {
  background: rgba(127, 127, 127, 0.1);
}

.icon {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}

.small {
  font-size: 0.8rem;
}
</style>
