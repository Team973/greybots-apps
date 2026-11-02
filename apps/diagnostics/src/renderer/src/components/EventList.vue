<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';

import { eventKinds, maxNoteLength, type EventKind, type LogEvent, type MatchPhase } from '@shared/events';
import { eventColor, eventTime, isProblem, isRoutine, shownEvent, type EventFilter } from '@/review';
import { eventsPng } from '@/events-image';

// The events of a log, listed under its chart: what kinds show, a jump to
// the previous or next error or warning, and notes to add, change or remove.

const props = defineProps<{
  events: LogEvent[];
  phases: MatchPhase[];
  selected: string | null;
  // Still being looked for (device faults), or ''.
  pending: string;
  // Notes can't go on live sessions: they're not kept.
  canNote: boolean;
  // Where a new note goes: the pin, or the middle of the span shown.
  noteTime: number;
  dark: boolean;
  // What the log is, for the top of a copied image.
  caption: string;
}>();

const filter = defineModel<EventFilter>('filter', { required: true });

const emit = defineEmits<{
  select: [event: LogEvent];
  step: [direction: 1 | -1];
  saveNote: [note: { id?: string; time: number; text: string }];
  deleteNote: [id: string];
}>();

const shown = computed(() => props.events.filter((e) => shownEvent(e, filter.value)));
const problems = computed(() => shown.value.filter(isProblem));
const counts = computed(() => {
  const out = new Map<EventKind, number>();
  for (const e of props.events) if (filter.value.routine || !isRoutine(e)) out.set(e.kind, (out.get(e.kind) ?? 0) + 1);
  return out;
});
const routineCount = computed(() => props.events.filter(isRoutine).length);

function toggleKind(kind: EventKind) {
  const kinds = filter.value.kinds.includes(kind) ? filter.value.kinds.filter((k) => k !== kind) : [...filter.value.kinds, kind];
  filter.value = { ...filter.value, kinds };
}

// The picked event, scrolled to.
const list = ref<HTMLElement | null>(null);
watch(() => props.selected, async (id) => {
  await nextTick();
  if (id) list.value?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
});

// How long a span lasted, when it's worth saying.
function spanText(event: LogEvent): string {
  if (event.end === null || event.end - event.start < 0.05) return '';
  const length = event.end - event.start;
  return `${length.toFixed(length < 10 ? 2 : 0)} s long`;
}

// --- Copying the list as an image, to paste into a PR or a message ---

const section = ref<HTMLElement | null>(null);
const copying = ref(false);
const copyState = ref<'idle' | 'copied' | string>('idle');
let copyTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(copyTimer));

async function copyImage() {
  copying.value = true;
  try {
    const card = getComputedStyle(section.value?.closest('.card') ?? document.body);
    const kinds = eventKinds.filter((k) => filter.value.kinds.includes(k.kind) && (counts.value.get(k.kind) || k.kind === 'note'));
    const errors = problems.value.filter((e) => e.severity === 'error').length;
    const warnings = problems.value.length - errors;
    const png = await eventsPng({
      caption: `${props.caption} · events`,
      subtitle: [
        `${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`,
        `showing ${kinds.map((k) => k.label).join(', ') || 'nothing'}${filter.value.routine ? ', routine too' : ''}`,
        props.pending
      ].filter(Boolean).join(' · '),
      rows: shown.value.map((event) => ({
        color: eventColor(event, props.dark),
        time: eventTime(event.start, props.phases),
        title: event.title,
        notes: [event.detail, spanText(event)]
      })),
      background: card.backgroundColor,
      text: card.color,
      fontFamily: card.fontFamily
    });
    const problem = await window.diagnostics.copyImage(png);
    copyState.value = problem || 'copied';
  } catch (error) {
    copyState.value = (error as Error).message;
  } finally {
    copying.value = false;
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copyState.value = 'idle'; }, 2500);
}

// --- Notes ---

const editing = ref<{ id?: string; time: number; text: string } | null>(null);
const noteBox = ref<HTMLTextAreaElement | null>(null);

async function startNote() {
  editing.value = { time: props.noteTime, text: '' };
  await nextTick();
  noteBox.value?.focus();
}

async function editNote(event: LogEvent) {
  editing.value = { id: event.id.replace(/^note:/, ''), time: event.start, text: [event.title, event.detail].filter(Boolean).join('\n') };
  await nextTick();
  noteBox.value?.focus();
}

function saveNote() {
  if (!editing.value) return;
  emit('saveNote', editing.value);
  editing.value = null;
}

function onNoteKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) saveNote();
  if (event.key === 'Escape') editing.value = null;
}
</script>

<template>
  <section id="events" ref="section" class="events">
    <div class="events-head">
      <h3>Events</h3>
      <span class="hint small">
        {{ problems.filter((e) => e.severity === 'error').length }} errors, {{ problems.filter((e) => e.severity === 'warning').length }} warnings
        <template v-if="pending"> · {{ pending }}</template>
      </span>
      <span class="spacer"></span>
      <button id="previous-problem" class="step" :disabled="problems.length === 0" title="Previous error or warning ([)"
        @click="emit('step', -1)">‹ Previous</button>
      <button id="next-problem" class="step" :disabled="problems.length === 0" title="Next error or warning (])"
        @click="emit('step', 1)">Next ›</button>
      <button v-if="canNote" id="add-note" class="step" @click="startNote">Add a note</button>
      <button id="copy-events" class="step with-icon" :disabled="copying"
        title="Copy the events listed (of the kinds shown) as an image, to paste into a PR" @click="copyImage">
        <svg viewBox="0 -960 960 960" width="16" height="16" aria-hidden="true">
          <path v-if="copyState === 'copied'" d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
          <path v-else
            d="M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z" />
        </svg>
        {{ copyState === 'copied' ? 'Copied' : 'Copy as image' }}
      </button>
    </div>
    <p v-if="copyState !== 'idle' && copyState !== 'copied'" class="error-text">{{ copyState }}</p>

    <div class="kinds">
      <template v-for="kind in eventKinds" :key="kind.kind">
        <button v-if="counts.get(kind.kind) || kind.kind === 'note'" class="chip" :aria-pressed="filter.kinds.includes(kind.kind)"
          @click="toggleKind(kind.kind)">{{ kind.label }} <span class="hint">{{ counts.get(kind.kind) ?? 0 }}</span></button>
      </template>
      <label v-if="routineCount" class="routine small">
        <input type="checkbox" :checked="filter.routine" @change="filter = { ...filter, routine: ($event.target as HTMLInputElement).checked }" />
        Routine too ({{ routineCount }}: current limits, dashboards closing, …)
      </label>
    </div>

    <form v-if="editing" class="note-editor" @submit.prevent="saveNote">
      <span class="hint small">{{ editing.id ? 'Note' : 'New note' }} at {{ eventTime(editing.time, phases) }}</span>
      <textarea ref="noteBox" v-model="editing.text" rows="3" :maxlength="maxNoteLength" aria-label="Note"
        placeholder="What happened here? The first line is its title." @keydown="onNoteKey"></textarea>
      <div class="note-actions">
        <button class="step" type="submit" :disabled="!editing.text.trim()">Save</button>
        <button class="step" type="button" @click="editing = null">Cancel</button>
        <span class="hint small">Ctrl+Enter saves.</span>
      </div>
    </form>

    <div ref="list" class="event-list" role="list">
      <p v-if="events.length === 0 && !pending" class="hint small">Nothing found in this log.</p>
      <p v-else-if="shown.length === 0 && !pending" class="hint small">None of the kinds picked.</p>
      <div v-for="event in shown" :key="event.id" :data-id="event.id" class="event" role="listitem"
        :class="{ selected: event.id === selected }" @click="emit('select', event)">
        <span class="mark" :style="{ background: eventColor(event, dark) }" :title="event.severity"></span>
        <span class="time small">{{ eventTime(event.start, phases) }}</span>
        <span class="what">
          <span class="title">{{ event.title }}</span>
          <span v-if="event.detail" class="hint small detail">{{ event.detail }}</span>
          <span v-if="spanText(event)" class="hint small">{{ spanText(event) }}</span>
        </span>
        <span v-if="event.kind === 'note'" class="note-buttons">
          <button class="icon" :aria-label="`Change note ${event.title}`" title="Change" @click.stop="editNote(event)">✎</button>
          <button class="icon" :aria-label="`Delete note ${event.title}`" title="Delete"
            @click.stop="emit('deleteNote', event.id.replace(/^note:/, ''))">✕</button>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.events {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.events-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.events-head h3 {
  margin: 0;
  font-size: 1rem;
}

.spacer {
  flex: 1;
}

.small {
  font-size: 0.85rem;
}

.step {
  padding: 4px 12px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.with-icon {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.with-icon svg {
  fill: currentColor;
}

.step:disabled {
  opacity: 0.45;
  cursor: default;
}

.kinds {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.chip {
  padding: 2px 10px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.chip[aria-pressed='true'] {
  border-color: #2a78d6;
  background: color-mix(in srgb, #2a78d6 18%, transparent);
}

.routine {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
}

.event-list {
  max-height: 240px;
  overflow-y: auto;
  border-top: 1px solid rgba(127, 127, 127, 0.25);
}

.event {
  display: grid;
  grid-template-columns: 10px 150px minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 10px;
  padding: 5px 6px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.15);
  cursor: pointer;
}

.event:hover {
  background: rgba(127, 127, 127, 0.08);
}

.event.selected {
  background: color-mix(in srgb, #2a78d6 16%, transparent);
}

.mark {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  align-self: center;
}

.time {
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
  white-space: nowrap;
}

.what {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  min-width: 0;
}

.title {
  overflow-wrap: anywhere;
}

.detail {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.note-buttons {
  display: flex;
  gap: 2px;
}

.icon {
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}

.icon:hover {
  opacity: 1;
}

.note-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.note-editor textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  resize: vertical;
}

.note-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
