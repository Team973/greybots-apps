<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import FullCalendar from '@fullcalendar/vue3';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { CalendarOptions, DateSelectArg, EventApi, EventClickArg, EventInput } from '@fullcalendar/core';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import { addDays, toDateString } from '@/lib/schedule/dates';
import { scheduleItemColor, type ActiveEvent, type ScheduleItem } from '@/lib/schedule/types';

const props = defineProps<{
  event: ActiveEvent;
  items: ScheduleItem[];
  canEdit: boolean;
}>();
const emit = defineEmits<{
  select: [range: { start: string; end: string }];
  open: [item: ScheduleItem];
  reschedule: [item: ScheduleItem, start: Date, end: Date, revert: () => void];
}>();

const viewMode = useViewModeStore();
const calendar = ref<InstanceType<typeof FullCalendar> | null>(null);

// Every event day side by side, like a multi-day Google Calendar week.
const rangeEnd = computed(() => addDays(props.event.end_date, 1));

// Start on today when it's an event day, otherwise the first day.
function initialDate() {
  const today = toDateString(new Date());
  return today >= props.event.start_date && today <= props.event.end_date ? today : props.event.start_date;
}

function scrollTime() {
  const now = new Date();
  return `${String(Math.max(now.getHours() - 1, 0)).padStart(2, '0')}:00:00`;
}

const events = computed<EventInput[]>(() =>
  props.items.map((item) => ({
    id: item.id,
    title: item.title,
    start: item.start_at,
    end: item.end_at,
    // TBA matches can't be dragged; their time comes from the import.
    editable: props.canEdit && item.kind === 'custom',
    extendedProps: { item },
    backgroundColor: scheduleItemColor(item),
    classNames: item.kind === 'match' ? ['sched-match'] : []
  }))
);

function itemOf(event: EventApi): ScheduleItem {
  return event.extendedProps.item as ScheduleItem;
}

const options = computed<CalendarOptions>(() => ({
  plugins: [timeGridPlugin, interactionPlugin],
  initialView: viewMode.isMobile ? 'timeGridDay' : 'eventDays',
  initialDate: initialDate(),
  views: {
    // An explicit range: a `duration` view would start on the current date.
    eventDays: { type: 'timeGrid', visibleRange: { start: props.event.start_date, end: rangeEnd.value }, buttonText: 'All days' },
    timeGridDay: { buttonText: 'Day' }
  },
  validRange: { start: props.event.start_date, end: rangeEnd.value },
  headerToolbar: { left: 'prev,next', center: 'title', right: 'eventDays,timeGridDay' },
  height: '100%',
  allDaySlot: false,
  nowIndicator: true,
  slotMinTime: '06:00:00',
  slotMaxTime: '24:00:00',
  scrollTime: scrollTime(),
  slotDuration: '00:30:00',
  snapDuration: '00:05:00',
  slotEventOverlap: false,
  eventMinHeight: 18,
  dayHeaderFormat: { weekday: 'long', month: 'numeric', day: 'numeric' },
  // Editing (leads/admins): drag across empty time to create, drag an event
  // to move it, drag its bottom edge to resize, tap to edit.
  selectable: props.canEdit,
  selectMirror: true,
  editable: props.canEdit,
  longPressDelay: 350,
  events: events.value,
  select: (info: DateSelectArg) => {
    emit('select', { start: info.start.toISOString(), end: info.end.toISOString() });
    info.view.calendar.unselect();
  },
  eventClick: (info: EventClickArg) => emit('open', itemOf(info.event)),
  eventDrop: (info) => emit('reschedule', itemOf(info.event), info.event.start!, info.event.end!, info.revert),
  eventResize: (info) => emit('reschedule', itemOf(info.event), info.event.start!, info.event.end!, info.revert)
}));

// Switching events changes the date range; jump to its first day.
watch(
  () => [props.event.start_date, props.event.end_date],
  () => calendar.value?.getApi().gotoDate(initialDate())
);
</script>

<template>
  <div class="schedule-calendar">
    <FullCalendar ref="calendar" :options="options" />
  </div>
</template>

<style scoped>
.schedule-calendar {
  height: 100%;
  min-height: 480px;

  --fc-border-color: rgba(128, 128, 128, 0.35);
  --fc-page-bg-color: var(--tile-background-color);
  --fc-neutral-bg-color: var(--tile-background-color);
  --fc-today-bg-color: rgba(176, 87, 3, 0.08);
  --fc-now-indicator-color: #ff8a1f;
  --fc-highlight-color: rgba(176, 87, 3, 0.25);
  --fc-button-bg-color: var(--accent-color);
  --fc-button-border-color: var(--accent-color);
  --fc-button-hover-bg-color: var(--header-hover-color);
  --fc-button-hover-border-color: var(--header-hover-color);
  --fc-button-active-bg-color: var(--header-color);
  --fc-button-active-border-color: var(--header-color);
  --fc-button-text-color: var(--primary-text-color);
  --fc-event-border-color: transparent;
}

.schedule-calendar :deep(.fc) {
  font-size: 0.9rem;
}

.schedule-calendar :deep(.fc-toolbar-title) {
  font-size: 1.1rem;
}

.schedule-calendar :deep(.fc-timegrid-now-indicator-line) {
  border-width: 2px 0 0;
}

.schedule-calendar :deep(.fc-event) {
  cursor: pointer;
}

.schedule-calendar :deep(.sched-match) {
  font-weight: 600;
}
</style>
