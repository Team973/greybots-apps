<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import FullCalendar from '@fullcalendar/vue3';
import timeGridPlugin from '@fullcalendar/timegrid';
import type { CalendarOptions, EventClickArg, EventInput } from '@fullcalendar/core';
import { clockNow } from '@greybots/common/lib/now';
import ScheduleItemDialog from '@/components/schedule/ScheduleItemDialog.vue';
import { scheduleItemColor, type ScheduleItem } from '@/lib/schedule/types';
import { useSessionStore } from '@/stores/session-store';

// Today's schedule around the current time (Overview mockup, left column).
// Read-only here; editing happens on the Schedule page.
const props = defineProps<{ eventKey: string | null; items: ScheduleItem[] }>();
const session = useSessionStore();

const events = computed<EventInput[]>(() =>
  props.items.map((item) => ({
    id: item.id,
    title: item.title,
    start: item.start_at,
    end: item.end_at,
    backgroundColor: scheduleItemColor(item),
    extendedProps: { item }
  }))
);

function scrollTime() {
  const hour = Math.max(new Date(clockNow()).getHours() - 1, 0);
  return `${String(hour).padStart(2, '0')}:00:00`;
}

// Live copy of the opened item, so the dialog's autosave never writes back
// stale fields.
const selectedId = ref<string | null>(null);
const selected = computed(() => props.items.find((i) => i.id === selectedId.value) ?? null);

const options = computed<CalendarOptions>(() => ({
  plugins: [timeGridPlugin],
  initialView: 'timeGridDay',
  headerToolbar: false,
  dayHeaders: false,
  allDaySlot: false,
  nowIndicator: true,
  // Follows the app clock (which testing mode can shift).
  now: () => new Date(clockNow()),
  height: '100%',
  slotDuration: '00:30:00',
  scrollTime: scrollTime(),
  slotEventOverlap: false,
  eventMinHeight: 18,
  editable: false,
  selectable: false,
  events: events.value,
  eventClick: (info: EventClickArg) => (selectedId.value = (info.event.extendedProps.item as ScheduleItem).id)
}));
</script>

<template>
  <section class="panel strip-panel">
    <header class="panel-header">
      <h2>Schedule</h2>
      <RouterLink to="/schedule" class="panel-link">Full schedule →</RouterLink>
    </header>
    <div class="strip">
      <FullCalendar :options="options" />
    </div>
    <ScheduleItemDialog
      v-if="eventKey"
      :open="!!selected"
      :event-key="eventKey"
      :item="selected"
      :draft="null"
      :can-edit="session.hasRole('lead')"
      @close="selectedId = null"
    />
  </section>
</template>

<style scoped>
.strip {
  /* Fill the panel, no more: the panel's grid area sets the height. */
  flex: 1;
  min-height: 0;
  overflow: hidden;
  color-scheme: light dark;

  --fc-border-color: rgba(128, 128, 128, 0.35);
  --fc-page-bg-color: var(--tile-background-color);
  --fc-today-bg-color: transparent;
  --fc-now-indicator-color: #ff8a1f;
  --fc-event-border-color: transparent;
}

.strip :deep(.fc) {
  font-size: 0.85rem;
}

.strip :deep(.fc-timegrid-now-indicator-line) {
  border-width: 2px 0 0;
}

.strip :deep(.fc-event) {
  cursor: pointer;
}
</style>
