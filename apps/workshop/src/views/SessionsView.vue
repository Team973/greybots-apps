<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import FullCalendar from '@fullcalendar/vue3';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { CalendarOptions, EventClickArg, EventDropArg, EventInput, EventSourceFuncArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import SessionDialog from '@/components/SessionDialog.vue';
import { errorMessage } from '@/lib/db';
import { addDays, formatDay, formatSessionTime, toDateString, today } from '@/lib/dates';
import { eventName, fetchEvents, type TeamEvent } from '@/lib/events';
import { fetchPlansFor, fetchSessions, updateSession, type Session } from '@/lib/sessions';
import { useAuthStore } from '@/stores/auth-store';

// The shop schedule, as a calendar. Leads and admins add sessions (one-off or
// repeating) by dragging across empty time or with "Add session", move one by
// dragging it, change its length from its bottom edge, and tap it to rename
// or cancel it. Everyone can tap through to a session's plan. The team's
// competition events (from GreyScout's event list) show in the all-day row in
// their own colour, and in "Coming up"; they can't be moved or edited here.
const auth = useAuthStore();
const router = useRouter();
const viewMode = useViewModeStore();

const upcoming = ref<Session[]>([]);
const upcomingEvents = ref<TeamEvent[]>([]);
const upcomingCounts = ref<Map<string, number>>(new Map());
const error = ref('');
const calendar = ref<InstanceType<typeof FullCalendar> | null>(null);

const dialogOpen = ref(false);
const editingSession = ref<Session | null>(null);
const newRange = ref<{ start: string; end: string } | null>(null);

async function countsFor(list: Session[]) {
  const plan = await fetchPlansFor(list.map((s) => s.id));
  const counts = new Map<string, number>();
  for (const item of plan) counts.set(item.session_id, (counts.get(item.session_id) ?? 0) + 1);
  return counts;
}

// The calendar asks for the sessions in whatever range it's showing.
async function loadEvents(info: EventSourceFuncArg): Promise<EventInput[]> {
  try {
    const [sessions, events] = await Promise.all([
      fetchSessions(info.start.toISOString(), info.end.toISOString()),
      fetchEvents(toDateString(info.start), toDateString(info.end))
    ]);
    const counts = await countsFor(sessions);
    const eventItems: EventInput[] = events.map((event) => ({
      id: `event-${event.event_id}`,
      title: eventName(event),
      start: event.start_date,
      // All-day ends are exclusive.
      end: addDays(event.end_date, 1),
      allDay: true,
      editable: false,
      classNames: ['team-event'],
      extendedProps: { event }
    }));
    return eventItems.concat(sessions.map((session) => {
      const count = counts.get(session.id) ?? 0;
      return {
        id: session.id,
        title: count ? `${session.title} · ${count} ${count === 1 ? 'ticket' : 'tickets'}` : session.title,
        start: session.starts_at,
        end: session.ends_at,
        extendedProps: { session }
      };
    }));
  } catch (e) {
    error.value = errorMessage(e);
    return [];
  }
}

async function loadUpcoming() {
  try {
    const now = new Date();
    const later = new Date(now.getTime() + 28 * 86_400_000);
    [upcoming.value, upcomingEvents.value] = await Promise.all([
      fetchSessions(now.toISOString(), later.toISOString()),
      fetchEvents(today(), toDateString(later))
    ]);
    upcomingCounts.value = await countsFor(upcoming.value);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

// Sessions and events in the next four weeks, in order (an event by its
// first day, before that day's sessions).
type Upcoming = { kind: 'session'; at: string; session: Session } | { kind: 'event'; at: string; event: TeamEvent };
const comingUp = computed<Upcoming[]>(() =>
  [
    ...upcoming.value.map((session) => ({ kind: 'session' as const, at: session.starts_at, session })),
    ...upcomingEvents.value.map((event) => ({ kind: 'event' as const, at: new Date(`${event.start_date}T00:00:00`).toISOString(), event }))
  ].sort((a, b) => a.at.localeCompare(b.at))
);
const eventDates = (e: TeamEvent) => (e.start_date === e.end_date ? formatDay(e.start_date) : `${formatDay(e.start_date)} – ${formatDay(e.end_date)}`);

function reload() {
  calendar.value?.getApi().refetchEvents();
  return loadUpcoming();
}
onMounted(loadUpcoming);

function openNew(start?: string, end?: string) {
  editingSession.value = null;
  newRange.value = start && end ? { start, end } : null;
  dialogOpen.value = true;
}

async function reschedule(info: EventDropArg | EventResizeDoneArg) {
  const session = info.event.extendedProps.session as Session;
  error.value = '';
  try {
    await updateSession(session.id, { starts_at: info.event.start!.toISOString(), ends_at: info.event.end!.toISOString() });
    reload();
  } catch (e) {
    info.revert();
    error.value = errorMessage(e);
  }
}

// Built once: the role can't change while the page is open.
const options: CalendarOptions = {
  plugins: [timeGridPlugin, interactionPlugin],
  initialView: viewMode.isMobile ? 'threeDay' : 'timeGridWeek',
  views: { threeDay: { type: 'timeGrid', duration: { days: 3 }, buttonText: '3 days' } },
  headerToolbar: { left: 'prev,next today', center: 'title', right: viewMode.isMobile ? '' : 'timeGridWeek,threeDay' },
  height: 'auto',
  // The all-day row is for events only.
  allDaySlot: true,
  allDayText: 'Events',
  nowIndicator: true,
  slotMinTime: '07:00:00',
  slotMaxTime: '23:00:00',
  slotDuration: '00:30:00',
  snapDuration: '00:15:00',
  dayHeaderFormat: { weekday: 'short', month: 'numeric', day: 'numeric' },
  selectable: auth.isLead,
  selectMirror: true,
  editable: auth.isLead,
  longPressDelay: 350,
  events: loadEvents,
  selectAllow: (info) => !info.allDay,
  select: (info) => {
    openNew(info.start.toISOString(), info.end.toISOString());
    info.view.calendar.unselect();
  },
  eventClick: (info: EventClickArg) => {
    const session = info.event.extendedProps.session as Session | undefined;
    if (!session) return;
    if (auth.isLead) {
      editingSession.value = session;
      dialogOpen.value = true;
    } else {
      router.push(`/sessions/${session.id}`);
    }
  },
  eventDrop: reschedule,
  eventResize: reschedule
};
</script>

<template>
  <div class="page">
    <header class="page-header">
      <h1>Shop sessions</h1>
      <button v-if="auth.isLead" class="button primary" @click="openNew()">Add session</button>
      <p class="hint">
        <template v-if="auth.isLead">Drag across empty time to add a session, drag one to move it, or tap it to change or cancel it.</template>
        <template v-else>Tap a session to see its plan.</template>
      </p>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>

    <section class="panel">
      <h2>Coming up</h2>
      <ul v-if="comingUp.length" class="upcoming">
        <li v-for="item in comingUp" :key="item.kind === 'event' ? `event-${item.event.event_id}` : item.session.id">
          <div v-if="item.kind === 'event'" class="upcoming-link event">
            <span class="chip event-chip">Event</span>
            <strong>{{ eventName(item.event) }}</strong>
            <span class="muted">{{ eventDates(item.event) }}</span>
          </div>
          <RouterLink v-else :to="`/sessions/${item.session.id}`" class="upcoming-link">
            <strong>{{ item.session.title }}</strong>
            <span class="muted">{{ formatSessionTime(item.session.starts_at, item.session.ends_at) }}</span>
            <span class="chip">{{ upcomingCounts.get(item.session.id) ?? 0 }} planned</span>
          </RouterLink>
        </li>
      </ul>
      <p v-else class="empty">Nothing scheduled in the next four weeks.</p>
    </section>

    <section class="panel calendar">
      <FullCalendar ref="calendar" :options="options" />
    </section>

    <SessionDialog :open="dialogOpen" :session="editingSession" :start="newRange?.start" :end="newRange?.end" @close="dialogOpen = false" @saved="reload" />
  </div>
</template>

<style scoped>
.upcoming {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.upcoming-link {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 8px 10px;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
}

a.upcoming-link:hover {
  background: rgba(128, 128, 128, 0.12);
}

.upcoming-link.event {
  box-shadow: inset 4px 0 0 var(--event-color);
}

.event-chip {
  border-color: var(--event-color);
  color: var(--event-color);
  font-weight: 600;
}

.calendar {
  color-scheme: light dark;

  --fc-border-color: rgba(128, 128, 128, 0.35);
  --fc-page-bg-color: var(--tile-background-color);
  --fc-neutral-bg-color: var(--tile-background-color);
  --fc-today-bg-color: rgba(176, 87, 3, 0.08);
  --fc-now-indicator-color: #ff8a1f;
  --fc-highlight-color: rgba(176, 87, 3, 0.25);
  --fc-button-bg-color: var(--accent-color);
  --fc-button-border-color: var(--accent-color);
  --fc-button-hover-bg-color: var(--header-color);
  --fc-button-hover-border-color: var(--header-color);
  --fc-button-active-bg-color: var(--header-color);
  --fc-button-active-border-color: var(--header-color);
  --fc-event-bg-color: #b05703;
  --fc-event-border-color: #b05703;
  --fc-event-text-color: #fff;
}

.calendar :deep(.fc-toolbar-title) {
  font-size: 1.1rem;
}

.calendar :deep(.fc-event) {
  cursor: pointer;
}

/* The team's events: their own colour, and not clickable. */
.calendar :deep(.fc-event.team-event) {
  background-color: var(--event-color);
  border-color: var(--event-color);
  cursor: default;
}
</style>
