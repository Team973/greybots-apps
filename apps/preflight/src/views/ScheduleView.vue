<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import EventSettingsDialog from '@/components/schedule/EventSettingsDialog.vue';
import MatchTimingDialog from '@/components/schedule/MatchTimingDialog.vue';
import MilestoneTimeline from '@/components/schedule/MilestoneTimeline.vue';
import ScheduleCalendar from '@/components/schedule/ScheduleCalendar.vue';
import ScheduleItemDialog from '@/components/schedule/ScheduleItemDialog.vue';
import { clockNow } from '@greybots/common/lib/now';
import { tbaAutoImportMs } from '@/lib/constants';
import { useLiveQuery } from '@/lib/live-query';
import { formatDateRange, isDifferentTimezone } from '@/lib/schedule/dates';
import { getActiveEvent, listScheduleItems, rescheduleItem } from '@/lib/schedule/schedule-repo';
import { getLastImportAt, importTbaSchedule } from '@/lib/schedule/tba-import';
import { emptyTiming, getMatchTiming, type MatchTiming } from '@/lib/schedule/timing';
import {
  filterColors,
  filterLabels,
  scheduleFilters,
  type ActiveEvent,
  type ScheduleFilter,
  type ScheduleItem
} from '@/lib/schedule/types';
import TaskDialog from '@/components/tasks/TaskDialog.vue';
import { listTasks, type Task } from '@/lib/tasks/tasks';
import { useSessionStore } from '@/stores/session-store';
import { useSyncStore } from '@/stores/sync-store';

const session = useSessionStore();
const sync = useSyncStore();
const canEdit = computed(() => session.hasRole('lead'));

const activeEvent = useLiveQuery<ActiveEvent | null>(getActiveEvent, null);
const activeEventKey = computed(() => activeEvent.value?.event_key ?? null);
const items = useLiveQuery<ScheduleItem[]>(
  () => (activeEventKey.value ? listScheduleItems(activeEventKey.value) : []),
  [],
  activeEventKey
);
watch(activeEventKey, async (key) => {
  lastImportAt.value = key ? await getLastImportAt(key) : null;
});

// Completed tasks, drawn on the calendar for post-event review.
const tasks = useLiveQuery<Task[]>(() => (activeEventKey.value ? listTasks(activeEventKey.value) : []), [], activeEventKey);
const matches = computed(() => items.value.filter((i) => i.kind === 'match'));

// Filters, remembered per device. The *hidden* filters are stored, so a
// newly added one shows up by default.
const filterStorageKey = 'preflight_schedule_hidden_categories';
const categories = scheduleFilters;
function loadHidden(): ScheduleFilter[] {
  try {
    const saved = JSON.parse(localStorage.getItem(filterStorageKey) ?? 'null');
    if (Array.isArray(saved)) return saved.filter((c) => categories.includes(c));
  } catch {
    // Ignore unreadable storage.
  }
  return [];
}
const hidden = loadHidden();
const visibleCategories = ref<ScheduleFilter[]>(categories.filter((c) => !hidden.includes(c)));
watch(visibleCategories, (value) => {
  try {
    localStorage.setItem(filterStorageKey, JSON.stringify(categories.filter((c) => !value.includes(c))));
  } catch {
    // Storage unavailable; filters just won't persist.
  }
});
const visibleItems = computed(() => items.value.filter((item) => visibleCategories.value.includes(item.category)));
const visibleTasks = computed(() => (visibleCategories.value.includes('task') ? tasks.value : []));

const taskDialogId = ref<string | null>(null);
const taskDialogTask = computed(() => tasks.value.find((t) => t.id === taskDialogId.value) ?? null);

// --- TBA import ---
const canImport = computed(() => canEdit.value && !!activeEvent.value && sync.online && sync.hasServerSession);
const importing = ref(false);
const importMessage = ref<string | null>(null);
const importError = ref<string | null>(null);
const lastImportAt = ref<string | null>(null);

async function runImport(silent = false) {
  if (!activeEvent.value || importing.value) return;
  importing.value = true;
  if (!silent) importMessage.value = null;
  importError.value = null;
  try {
    const result = await importTbaSchedule(activeEvent.value, session.user?.name ?? null);
    lastImportAt.value = await getLastImportAt(activeEvent.value.event_key);
    const changes = result.added + result.updated + result.removed;
    if (!silent || changes > 0) {
      importMessage.value = changes
        ? `Imported from TBA: ${result.added} added, ${result.updated} updated, ${result.removed} removed.`
        : 'Schedule is up to date with TBA.';
      if (result.unscheduled) importMessage.value += ` ${result.unscheduled} match(es) don't have a time yet.`;
    }
  } catch (e) {
    importError.value = `TBA import failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    importing.value = false;
  }
}

// Lead/admin devices keep matches current while the schedule is open.
let autoImportTimer: ReturnType<typeof setInterval> | null = null;
async function autoImport() {
  if (!canImport.value || !activeEvent.value) return;
  const last = await getLastImportAt(activeEvent.value.event_key);
  if (!last || Date.now() - Date.parse(last) >= tbaAutoImportMs) runImport(true);
}
onMounted(() => {
  autoImportTimer = setInterval(autoImport, 60_000);
});
onBeforeUnmount(() => {
  if (autoImportTimer) clearInterval(autoImportTimer);
});
watch(() => [activeEvent.value?.event_key, canImport.value], autoImport);

// Calendar, or the event timeline of milestones (issue #79). Remembered per device.
type ScheduleMode = 'calendar' | 'timeline';
const modeStorageKey = 'preflight_schedule_mode';
function loadMode(): ScheduleMode {
  try {
    return localStorage.getItem(modeStorageKey) === 'timeline' ? 'timeline' : 'calendar';
  } catch {
    return 'calendar';
  }
}
const mode = ref<ScheduleMode>(loadMode());
watch(mode, (value) => {
  try {
    localStorage.setItem(modeStorageKey, value);
  } catch {
    // Storage unavailable; the choice just won't persist.
  }
});

// Manual match timing (issue #80).
const timing = useLiveQuery<MatchTiming>(
  () => getMatchTiming(activeEventKey.value ?? ''),
  emptyTiming(''),
  activeEventKey
);
const timingOpen = ref(false);
const timingNotice = computed(() => {
  const parts: string[] = [];
  const delay = timing.value.delay_minutes;
  if (delay) parts.push(`matches are estimated ${Math.abs(delay)} min ${delay > 0 ? 'behind' : 'ahead of'} the published schedule`);
  const overrides = Object.keys(timing.value.overrides).length;
  if (overrides) parts.push(`${overrides} match${overrides === 1 ? ' has its' : 'es have their'} own estimate`);
  return parts.length ? `Manual timing: ${parts.join('; ')}.` : null;
});

// --- Dialogs ---
const settingsOpen = ref(false);
// The dialog gets the live copy of an existing item (looked up by id), so its
// autosave never writes back stale fields.
const itemDialog = ref<{ itemId: string | null; draft: { start: string; end: string } | null; kind?: 'custom' | 'milestone' } | null>(null);
const dialogItem = computed(() => (itemDialog.value?.itemId ? items.value.find((i) => i.id === itemDialog.value!.itemId) ?? null : null));
// Close the dialog if its item is deleted (e.g. from another device).
watch(dialogItem, (item) => {
  if (!item && itemDialog.value?.itemId) itemDialog.value = null;
});

function onEventSaved(_event: ActiveEvent, changed: boolean) {
  if (changed && canImport.value) runImport();
}

function onSelect(range: { start: string; end: string }) {
  itemDialog.value = { itemId: null, draft: range };
}

function newItem(kind: 'custom' | 'milestone') {
  const start = new Date(clockNow());
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  itemDialog.value = { itemId: null, kind, draft: { start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString() } };
}

async function onReschedule(item: ScheduleItem, start: Date, end: Date, revert: () => void) {
  try {
    await rescheduleItem(item, start, end, session.user?.name ?? null);
  } catch (e) {
    revert();
    importError.value = e instanceof Error ? e.message : String(e);
  }
}
</script>

<template>
  <div class="schedule-view">
    <!-- No event configured yet. -->
    <div v-if="!activeEvent" class="card">
      <h2>Schedule</h2>
      <template v-if="canEdit">
        <p class="hint">Choose the event to build the schedule around. Matches are imported from The Blue Alliance.</p>
        <div class="form-row">
          <md-filled-button @click="settingsOpen = true">Set up event</md-filled-button>
        </div>
      </template>
      <p v-else class="hint">No event has been set up yet. Ask a lead or admin to set one up.</p>
    </div>

    <template v-else>
      <header class="schedule-header">
        <div class="title">
          <h1>{{ activeEvent.name }}</h1>
          <span class="hint">
            {{ formatDateRange(activeEvent.start_date, activeEvent.end_date) }} · Team {{ activeEvent.team_number }}
            <template v-if="lastImportAt"> · TBA synced {{ new Date(lastImportAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }}</template>
          </span>
        </div>
        <div class="mode-toggle" role="group" aria-label="Schedule view">
          <button :class="{ on: mode === 'calendar' }" :aria-pressed="mode === 'calendar'" @click="mode = 'calendar'">Calendar</button>
          <button :class="{ on: mode === 'timeline' }" :aria-pressed="mode === 'timeline'" @click="mode = 'timeline'">Timeline</button>
        </div>
        <div class="filters" role="group" aria-label="Show event types">
          <label v-for="c in categories" :key="c" class="filter">
            <input v-model="visibleCategories" type="checkbox" :value="c" :style="{ accentColor: filterColors[c] }" />
            {{ filterLabels[c] }}
          </label>
        </div>
        <div class="actions">
          <md-filled-button v-if="canEdit && mode === 'calendar'" @click="newItem('custom')">New event</md-filled-button>
          <md-outlined-button @click="timingOpen = true">Match timing</md-outlined-button>
          <template v-if="canEdit">
            <md-outlined-button :disabled="!canImport || importing" @click="runImport()">
              {{ importing ? 'Importing…' : 'Import from TBA' }}
            </md-outlined-button>
            <md-outlined-button @click="settingsOpen = true">Event settings</md-outlined-button>
          </template>
        </div>
      </header>

      <p v-if="isDifferentTimezone(activeEvent.timezone)" class="hint notice">
        Times are shown in this device's timezone, which isn't the event's ({{ activeEvent.timezone }}).
      </p>
      <p v-if="canEdit && !canImport" class="hint notice">
        {{ !sync.online ? "Offline: TBA import resumes when you're back online." : 'Link a server account (Settings → Sync) to import from TBA.' }}
      </p>
      <p v-if="timingNotice" class="hint notice">
        {{ timingNotice }} <button class="notice-link" @click="timingOpen = true">Change</button>
      </p>
      <p v-if="importMessage" class="hint notice">{{ importMessage }}</p>
      <p v-if="importError" class="error-text notice">{{ importError }}</p>

      <div v-if="mode === 'timeline'" class="calendar-wrap">
        <MilestoneTimeline
          :event="activeEvent"
          :items="visibleItems"
          :can-edit="canEdit"
          @open="(item) => (itemDialog = { itemId: item.id, draft: null })"
          @add="newItem('milestone')"
        />
      </div>
      <div v-else class="calendar-wrap">
        <ScheduleCalendar
          :event="activeEvent"
          :items="visibleItems"
          :tasks="visibleTasks"
          :can-edit="canEdit"
          @select="onSelect"
          @open="(item) => (itemDialog = { itemId: item.id, draft: null })"
          @reschedule="onReschedule"
          @open-task="(task) => (taskDialogId = task.id)"
        />
      </div>
    </template>

    <EventSettingsDialog :open="settingsOpen" :current="activeEvent" @close="settingsOpen = false" @saved="onEventSaved" />
    <ScheduleItemDialog
      v-if="activeEvent"
      :open="!!itemDialog"
      :event-key="activeEvent.event_key"
      :item="dialogItem"
      :draft="itemDialog?.draft ?? null"
      :kind="itemDialog?.kind"
      :can-edit="canEdit"
      @close="itemDialog = null"
    />
    <MatchTimingDialog v-if="activeEvent" :open="timingOpen" :event-key="activeEvent.event_key" :can-edit="canEdit" @close="timingOpen = false" />
    <TaskDialog
      v-if="activeEvent"
      :open="!!taskDialogTask"
      :event-key="activeEvent.event_key"
      :task="taskDialogTask"
      :matches="matches"
      :can-edit="session.hasRole('member')"
      @close="taskDialogId = null"
    />
  </div>
</template>

<style scoped>
.schedule-view {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  height: calc(100dvh - 64px - 3rem);
  gap: 8px;
}

.schedule-view > .card {
  align-self: center;
}

.schedule-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
}

.title h1 {
  margin: 0;
  font-size: 1.4rem;
}

.mode-toggle {
  display: inline-flex;
  border: 1px solid var(--accent-color);
  border-radius: 8px;
  overflow: hidden;
}

.mode-toggle button {
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  cursor: pointer;
}

.mode-toggle button.on {
  background: var(--accent-color);
  font-weight: 600;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 6px;
  border-radius: 999px;
  border: 1px solid var(--accent-color);
  cursor: pointer;
  user-select: none;
}

.filter input {
  width: 16px;
  height: 16px;
  margin: 0;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}

.notice {
  margin: 0;
}

.notice-link {
  padding: 0;
  border: none;
  background: none;
  color: var(--header-hover-color);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.calendar-wrap {
  flex: 1;
  min-height: 0;
  padding: 12px;
  border-radius: 10px;
  background: var(--tile-background-color);
}
</style>
