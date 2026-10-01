<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import { useNow } from '@greybots/common/lib/now';
import { useLiveQuery } from '@/lib/live-query';
import { formatTime } from '@/lib/schedule/dates';
import { addDefaultMilestones, defaultMilestoneIds, groupByPhase, milestoneState, swapMilestones } from '@/lib/schedule/milestones';
import { deleteScheduleItem, listScheduleItems } from '@/lib/schedule/schedule-repo';
import { categoryLabels, phaseLabels, scheduleItemColor, type ActiveEvent, type ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// The event timeline (issue #79): every milestone of the event in order,
// grouped by phase. Leads/admins add the standard milestones, then rename,
// retime, reorder, or delete them; tapping a milestone opens it for editing.
const props = defineProps<{ event: ActiveEvent; items: ScheduleItem[]; canEdit: boolean }>();
const emit = defineEmits<{ open: [item: ScheduleItem]; add: [] }>();

const session = useSessionStore();
const editor = () => session.user?.name ?? null;
const now = useNow(30_000);

const groups = computed(() => groupByPhase(props.items));
const hasMilestones = computed(() => groups.value.length > 0);

// How many standard milestones the event doesn't have (never added, or
// deleted). Counted against every item, not just the filtered ones shown.
const eventKey = computed(() => props.event.event_key);
const allItems = useLiveQuery<ScheduleItem[]>(() => listScheduleItems(eventKey.value), [], eventKey);
const defaultIds = ref<string[]>([]);
watch(eventKey, async (key) => (defaultIds.value = await defaultMilestoneIds(key)), { immediate: true });
const missingDefaults = computed(() => {
  const present = new Set(allItems.value.map((i) => i.id));
  return defaultIds.value.filter((id) => !present.has(id)).length;
});

const busy = ref(false);
const error = ref<string | null>(null);
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

const addDefaults = () => act(() => addDefaultMilestones(props.event, editor()));

// Moves a milestone one place earlier or later within its phase.
function move(milestones: ScheduleItem[], index: number, delta: -1 | 1) {
  const a = milestones[Math.min(index, index + delta)];
  const b = milestones[Math.max(index, index + delta)];
  if (a && b) act(() => swapMilestones(a, b, editor()));
}

function remove(item: ScheduleItem) {
  if (confirm(`Remove "${item.title}" from the timeline?`)) act(() => deleteScheduleItem(item.id));
}

function when(item: ScheduleItem): string {
  const day = new Date(item.start_at).toLocaleDateString([], { weekday: 'short' });
  return `${day} ${formatTime(item.start_at)} – ${formatTime(item.end_at)}`;
}
</script>

<template>
  <div class="timeline">
    <div v-if="canEdit" class="toolbar">
      <md-filled-button @click="emit('add')">Add milestone</md-filled-button>
      <md-outlined-button v-if="missingDefaults > 0" :disabled="busy" @click="addDefaults">
        {{ hasMilestones ? `Add ${missingDefaults} missing standard milestone${missingDefaults === 1 ? '' : 's'}` : 'Add the standard milestones' }}
      </md-outlined-button>
      <span v-if="hasMilestones" class="hint">Tap a milestone to rename or retime it. Times are starting points: set them for this event.</span>
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>

    <p v-if="!hasMilestones" class="hint empty">
      No milestones yet.
      <template v-if="canEdit"> Start from the standard set (load-in through departure), then adjust the times for this event.</template>
      <template v-else> A lead or admin can add them.</template>
    </p>

    <section v-for="group in groups" :key="group.phase ?? 'other'" class="phase">
      <h2>{{ group.phase ? phaseLabels[group.phase] : 'Other' }}</h2>
      <ol class="milestones">
        <li v-for="(item, i) in group.milestones" :key="item.id" class="milestone" :class="milestoneState(item, now)">
          <span class="dot" :style="{ background: scheduleItemColor(item) }" aria-hidden="true"></span>
          <button class="body" @click="emit('open', item)">
            <span class="name">{{ item.title }}</span>
            <span class="meta">{{ when(item) }} · {{ categoryLabels[item.category] }}<template v-if="milestoneState(item, now) === 'current'"> · Now</template></span>
          </button>
          <template v-if="canEdit">
            <button class="icon-small" :disabled="busy || i === 0" :aria-label="`Move ${item.title} earlier`" @click="move(group.milestones, i, -1)">↑</button>
            <button
              class="icon-small"
              :disabled="busy || i === group.milestones.length - 1"
              :aria-label="`Move ${item.title} later`"
              @click="move(group.milestones, i, 1)"
            >
              ↓
            </button>
            <button class="icon-small" :disabled="busy" :aria-label="`Remove ${item.title}`" @click="remove(item)">✕</button>
          </template>
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  overflow-y: auto;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.hint {
  margin: 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

.empty {
  padding: 24px 0;
}

.phase h2 {
  margin: 0 0 6px;
  font-size: 0.85rem;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.milestones {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.milestone {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
}

.milestone.past {
  opacity: 0.55;
}

.milestone.current {
  border-color: #ff8a1f;
  box-shadow: 0 0 0 1px #ff8a1f;
}

.dot {
  flex: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  min-width: 0;
  padding: 2px 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.name {
  overflow-wrap: anywhere;
}

.meta {
  font-size: 0.8rem;
  opacity: 0.7;
}
</style>
