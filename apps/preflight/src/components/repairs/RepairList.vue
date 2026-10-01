<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import RepairDialog from './RepairDialog.vue';
import { formatElapsed, useNow } from '@greybots/common/lib/now';
import { usePitMembers } from '@/lib/checklists/pit-members';
import { useLiveQuery } from '@/lib/live-query';
import { createRepair, finishRepair, listRepairs, reopenRepair, startRepairWork, type Repair, type RepairOrigin } from '@/lib/repairs/repairs';
import { formatTime } from '@/lib/schedule/dates';
import type { ScheduleItem } from '@/lib/schedule/types';
import { subsystemSuggestions } from '@/lib/subsystems';
import { useSessionStore } from '@/stores/session-store';

// The repair and maintenance log (issue #83) as a panel: what's being worked
// on first, then what's waiting, then (collapsed) what's done. `quickAdd`
// shows an inline row that logs a repair and starts it at once (used while
// the robot is in Repair, where speed matters).
const props = withDefaults(
  defineProps<{
    eventKey: string;
    matches: ScheduleItem[];
    heading?: string;
    quickAdd?: boolean;
    // Show finished repairs without having to expand them (the Repairs page).
    showDone?: boolean;
    // Recorded on repairs logged from here.
    origin?: RepairOrigin;
    // Match to link new repairs to by default.
    defaultMatchKey?: string | null;
  }>(),
  { heading: 'Repairs', quickAdd: false, showDone: false, origin: () => ({ source: 'standalone' as const }), defaultMatchKey: null }
);
const session = useSessionStore();
const canEdit = computed(() => session.hasRole('member'));
const editor = () => session.user?.name ?? null;
const now = useNow(30_000);
const members = usePitMembers();

const eventKey = computed(() => props.eventKey);
const repairs = useLiveQuery<Repair[]>(() => listRepairs(eventKey.value), [], eventKey);
const pending = computed(() => repairs.value.filter((r) => r.status !== 'done'));
const done = computed(() => repairs.value.filter((r) => r.status === 'done'));
const doneOpen = ref(props.showDone);
watch(() => props.showDone, (value) => (doneOpen.value = value));

const matchTitles = computed(() => new Map(props.matches.map((m) => [m.match_key, m.title])));

function meta(repair: Repair): string {
  const parts: string[] = [];
  if (repair.status === 'in_progress' && repair.started_at) parts.push(`In progress · ${formatElapsed(now.value - Date.parse(repair.started_at))}`);
  if (repair.status === 'done' && repair.finished_at) {
    const length = repair.started_at ? ` (${formatElapsed(Date.parse(repair.finished_at) - Date.parse(repair.started_at))})` : '';
    parts.push(`Done ${formatTime(repair.finished_at)}${length}${repair.finished_by_name ? ` by ${repair.finished_by_name}` : ''}`);
  }
  const what = [repair.subsystem, repair.component].filter(Boolean).join(' / ');
  if (what) parts.push(what);
  if (repair.match_key) parts.push(matchTitles.value.get(repair.match_key) ?? repair.match_key);
  return parts.join(' · ');
}

// --- Inline quick add ---
const quickTitle = ref('');
const quickSubsystem = ref('');
const quickAssignee = ref('');
const error = ref<string | null>(null);
watch(quickTitle, () => (error.value = null));

async function act(action: () => Promise<unknown>) {
  error.value = null;
  try {
    await action();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function addQuick() {
  if (!quickTitle.value.trim()) return (error.value = "What's being repaired?");
  return act(async () => {
    await createRepair(
      props.eventKey,
      { title: quickTitle.value, subsystem: quickSubsystem.value, assignee: quickAssignee.value, match_key: props.defaultMatchKey },
      editor(),
      { ...props.origin, start: true }
    );
    quickTitle.value = '';
    quickSubsystem.value = '';
  });
}

const advance = (repair: Repair) => act(() => (repair.status === 'open' ? startRepairWork(repair, editor()) : finishRepair(repair, editor())));
const reopen = (repair: Repair) => act(() => reopenRepair(repair, editor()));

// The dialog shows the live copy of the repair, so Start/Reopen update in place.
const dialog = ref<{ repairId: string | null } | null>(null);
const dialogRepair = computed(() => (dialog.value?.repairId ? repairs.value.find((r) => r.id === dialog.value!.repairId) ?? null : null));
</script>

<template>
  <section class="panel repairs">
    <header class="panel-header">
      <h2>{{ heading }}</h2>
      <button v-if="canEdit" class="icon-button" aria-label="Log a repair" @click="dialog = { repairId: null }">+</button>
    </header>

    <form v-if="quickAdd && canEdit" class="quick-add" @submit.prevent="addQuick">
      <input v-model="quickTitle" class="quick-title" placeholder="What's being repaired?" aria-label="New repair" />
      <input v-model="quickSubsystem" class="quick-small" list="quick-repair-subsystems" placeholder="Subsystem" aria-label="Subsystem" />
      <datalist id="quick-repair-subsystems"><option v-for="s in subsystemSuggestions" :key="s" :value="s" /></datalist>
      <input v-model="quickAssignee" class="quick-small" list="quick-repair-assignees" placeholder="Who's on it" aria-label="Who's on it" />
      <datalist id="quick-repair-assignees"><option v-for="name in members" :key="name" :value="name" /></datalist>
      <button type="submit" class="quick-submit">Start</button>
    </form>
    <p v-if="error" class="error-text">{{ error }}</p>

    <ul class="repair-list">
      <li v-for="repair in pending" :key="repair.id" class="repair" :class="repair.status">
        <button class="repair-body" @click="dialog = { repairId: repair.id }">
          <span class="title">{{ repair.title }}</span>
          <span v-if="meta(repair)" class="meta">{{ meta(repair) }}</span>
        </button>
        <span class="assignee-pill" :class="{ unassigned: !repair.assignee }">{{ repair.assignee || 'Unassigned' }}</span>
        <button v-if="canEdit" class="advance" :class="repair.status" @click="advance(repair)">
          {{ repair.status === 'open' ? 'Start' : 'Done' }}
        </button>
      </li>
    </ul>
    <p v-if="!pending.length" class="hint">No open repairs.</p>

    <button v-if="done.length && !showDone" class="done-toggle" @click="doneOpen = !doneOpen">
      {{ doneOpen ? 'Hide' : 'Show' }} finished ({{ done.length }})
    </button>
    <h3 v-if="done.length && showDone" class="done-heading">Finished</h3>
    <ul v-if="doneOpen" class="repair-list">
      <li v-for="repair in done" :key="repair.id" class="repair done">
        <button class="repair-body" @click="dialog = { repairId: repair.id }">
          <span class="title">{{ repair.title }}</span>
          <span class="meta">{{ meta(repair) }}</span>
        </button>
        <span class="assignee-pill" :class="{ unassigned: !repair.assignee }">{{ repair.assignee || 'Unassigned' }}</span>
        <button v-if="canEdit" class="advance" @click="reopen(repair)">Reopen</button>
      </li>
    </ul>

    <RepairDialog
      :open="!!dialog"
      :event-key="eventKey"
      :repair="dialogRepair"
      :matches="matches"
      :can-edit="canEdit"
      :origin="origin"
      :preset="{ match_key: defaultMatchKey }"
      @close="dialog = null"
    />
  </section>
</template>

<style scoped>
.quick-add {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.quick-add input {
  min-width: 0;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
  color: var(--primary-text-color);
  font: inherit;
}

.quick-title {
  flex: 3 1 200px;
}

.quick-small {
  flex: 1 1 110px;
}

.quick-submit {
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: #c62828;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.repair-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.repair {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
}

.repair.in_progress {
  border-color: #c62828;
  box-shadow: inset 4px 0 0 #c62828;
}

.repair.done .title {
  text-decoration: line-through;
  opacity: 0.6;
}

.repair-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.title {
  overflow-wrap: anywhere;
}

.meta {
  font-size: 0.8rem;
  opacity: 0.7;
}

.assignee-pill {
  flex: none;
  max-width: 35%;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--accent-color);
  font-size: 0.85rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assignee-pill.unassigned {
  background: transparent;
  border: 1px dashed var(--accent-color);
  font-weight: 400;
  font-style: italic;
  opacity: 0.7;
}

.advance {
  flex: none;
  min-width: 64px;
  padding: 8px 12px;
  border: 1px solid var(--accent-color);
  border-radius: 8px;
  background: transparent;
  color: var(--primary-text-color);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
}

.advance.in_progress {
  border-color: #2e7d32;
  background: #2e7d32;
  color: #fff;
}

.done-toggle {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: var(--primary-text-color);
  opacity: 0.7;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.done-heading {
  margin: 8px 0 0;
  font-size: 0.85rem;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.hint {
  margin: 0;
  opacity: 0.7;
}
</style>
