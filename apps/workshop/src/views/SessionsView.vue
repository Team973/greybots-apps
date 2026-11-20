<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import FullCalendar from '@fullcalendar/vue3';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { CalendarOptions, DateSelectArg, EventClickArg, EventDropArg, EventInput, EventSourceFuncArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import KeyDateDialog from '@/components/KeyDateDialog.vue';
import SessionDialog from '@/components/SessionDialog.vue';
import { errorMessage } from '@/lib/db';
import { addDays, formatDay, formatSessionTime, toDateString, today } from '@/lib/dates';
import { eventName, fetchEvents, type TeamEvent } from '@/lib/events';
import { fetchKeyDates, updateKeyDate, type KeyDate } from '@/lib/keyDates';
import { fetchPlansFor, fetchSessions, updateSession, type Session } from '@/lib/sessions';
import { useAuthStore } from '@/stores/auth-store';
import { useDirectoryStore } from '@/stores/directory-store';

// The shop schedule, as a calendar. Leads and admins add sessions (one-off or
// repeating) by dragging across empty time or with "Add session", move one by
// dragging it, change its length from its bottom edge, and tap it to rename
// or cancel it. Everyone can tap through to a session's plan.
//
// The all-day row ("Key dates") holds the team's competition events (from
// GreyScout's event list, so they can't be moved or edited here) and, after
// them in their own colour, the key milestones leads and admins mark: drag
// across the row or use "Add milestone" to add one, drag one to move it, tap
// it to change or remove it. Both also show in "Coming up".
const auth = useAuthStore();
const directory = useDirectoryStore();
const router = useRouter();
const viewMode = useViewModeStore();

const upcoming = ref<Session[]>([]);
const upcomingEvents = ref<TeamEvent[]>([]);
const upcomingKeyDates = ref<KeyDate[]>([]);
const upcomingCounts = ref<Map<string, number>>(new Map());
const error = ref('');
const calendar = ref<InstanceType<typeof FullCalendar> | null>(null);

const dialogOpen = ref(false);
const editingSession = ref<Session | null>(null);
const newRange = ref<{ start: string; end: string } | null>(null);

const keyDateDialogOpen = ref(false);
const editingKeyDate = ref<KeyDate | null>(null);
const newKeyDateRange = ref<{ start: string; end: string } | null>(null);

async function countsFor(list: Session[]) {
  const plan = await fetchPlansFor(list.map((s) => s.id));
  const counts = new Map<string, number>();
  for (const item of plan) counts.set(item.session_id, (counts.get(item.session_id) ?? 0) + 1);
  return counts;
}

// The calendar asks for the sessions in whatever range it's showing.
async function loadEvents(info: EventSourceFuncArg): Promise<EventInput[]> {
  try {
    const [sessions, events, keyDates] = await Promise.all([
      fetchSessions(info.start.toISOString(), info.end.toISOString()),
      fetchEvents(toDateString(info.start), toDateString(info.end)),
      fetchKeyDates(toDateString(info.start), toDateString(info.end))
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
      // Competition events come first in the row, then key milestones.
      extendedProps: { event, order: 0 }
    }));
    const keyDateItems: EventInput[] = keyDates.map((keyDate) => ({
      id: `key-${keyDate.id}`,
      title: keyDate.title,
      start: keyDate.start_date,
      end: addDays(keyDate.end_date, 1),
      allDay: true,
      classNames: ['key-date'],
      extendedProps: { keyDate, order: 1 }
    }));
    return [...eventItems, ...keyDateItems].concat(sessions.map((session) => {
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
    [upcoming.value, upcomingEvents.value, upcomingKeyDates.value] = await Promise.all([
      fetchSessions(now.toISOString(), later.toISOString()),
      fetchEvents(today(), toDateString(later)),
      fetchKeyDates(today(), toDateString(later))
    ]);
    upcomingCounts.value = await countsFor(upcoming.value);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

// Sessions, events, and key milestones in the next four weeks, in order (an
// event or milestone by its first day, before that day's sessions; events
// before milestones).
type Upcoming =
  | { kind: 'session'; at: string; session: Session }
  | { kind: 'event'; at: string; event: TeamEvent }
  | { kind: 'key'; at: string; keyDate: KeyDate };
const dayStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const kindOrder = { event: 0, key: 1, session: 2 };
const comingUp = computed<Upcoming[]>(() =>
  [
    ...upcoming.value.map((session) => ({ kind: 'session' as const, at: session.starts_at, session })),
    ...upcomingEvents.value.map((event) => ({ kind: 'event' as const, at: dayStart(event.start_date), event })),
    ...upcomingKeyDates.value.map((keyDate) => ({ kind: 'key' as const, at: dayStart(keyDate.start_date), keyDate }))
  ].sort((a, b) => a.at.localeCompare(b.at) || kindOrder[a.kind] - kindOrder[b.kind])
);
const upcomingKey = (item: Upcoming) => (item.kind === 'event' ? `event-${item.event.event_id}` : item.kind === 'key' ? `key-${item.keyDate.id}` : item.session.id);
const dayRange = (start: string, end: string) => (start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`);

function reload() {
  calendar.value?.getApi().refetchEvents();
  return loadUpcoming();
}
onMounted(loadUpcoming);

function openKeyDate(keyDate: KeyDate | null, range?: { start: string; end: string }) {
  if (!auth.isLead) return;
  editingKeyDate.value = keyDate;
  newKeyDateRange.value = range ?? null;
  keyDateDialogOpen.value = true;
}

function openNew(start?: string, end?: string) {
  editingSession.value = null;
  newRange.value = start && end ? { start, end } : null;
  dialogOpen.value = true;
}

async function reschedule(info: EventDropArg | EventResizeDoneArg) {
  const session = info.event.extendedProps.session as Session | undefined;
  const keyDate = info.event.extendedProps.keyDate as KeyDate | undefined;
  error.value = '';
  try {
    if (keyDate) {
      // All-day ends are exclusive; a one-day item can come back with none.
      const start = toDateString(info.event.start!);
      const end = info.event.end ? addDays(toDateString(info.event.end), -1) : start;
      await updateKeyDate(keyDate.id, { start_date: start, end_date: end });
    } else if (session) {
      await updateSession(session.id, { starts_at: info.event.start!.toISOString(), ends_at: info.event.end!.toISOString() });
    }
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
  // The all-day row is for competition events and key milestones.
  allDaySlot: true,
  allDayText: 'Key dates',
  eventOrder: 'order,start,-duration,title',
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
  // Sessions stay in the time grid and milestones in the all-day row.
  eventAllow: (span, moving) => span.allDay === !!moving?.allDay,
  select: (info: DateSelectArg) => {
    if (info.allDay) {
      openKeyDate(null, { start: toDateString(info.start), end: addDays(toDateString(info.end), -1) });
    } else {
      openNew(info.start.toISOString(), info.end.toISOString());
    }
    info.view.calendar.unselect();
  },
  eventClick: (info: EventClickArg) => {
    const keyDate = info.event.extendedProps.keyDate as KeyDate | undefined;
    if (keyDate) return openKeyDate(keyDate);
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
      <div v-if="auth.isLead" class="header-actions">
        <button class="button" @click="openKeyDate(null)">Add milestone</button>
        <button class="button primary" @click="openNew()">Add session</button>
      </div>
      <p class="hint">
        <template v-if="auth.isLead">
          Drag across empty time to add a session, or across the Key dates row to add a milestone. Drag either to move it, or tap it to change it.
        </template>
        <template v-else>Tap a session to see its plan.</template>
      </p>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>

    <section class="panel">
      <h2>Coming up</h2>
      <ul v-if="comingUp.length" class="upcoming">
        <li v-for="item in comingUp" :key="upcomingKey(item)">
          <div v-if="item.kind === 'event'" class="upcoming-link event">
            <span class="chip event-chip">Event</span>
            <strong>{{ eventName(item.event) }}</strong>
            <span class="muted">{{ dayRange(item.event.start_date, item.event.end_date) }}</span>
          </div>
          <component
            :is="auth.isLead ? 'button' : 'div'"
            v-else-if="item.kind === 'key'"
            :type="auth.isLead ? 'button' : undefined"
            class="upcoming-link key"
            @click="openKeyDate(item.keyDate)"
          >
            <span class="chip key-chip">Milestone</span>
            <strong>{{ item.keyDate.title }}</strong>
            <span class="muted">{{ dayRange(item.keyDate.start_date, item.keyDate.end_date) }}</span>
            <span v-if="item.keyDate.notes" class="muted key-notes">{{ item.keyDate.notes }}</span>
          </component>
          <RouterLink v-else :to="`/sessions/${item.session.id}`" class="upcoming-link">
            <strong>{{ item.session.title }}</strong>
            <span class="muted">{{ formatSessionTime(item.session.starts_at, item.session.ends_at) }}</span>
            <span v-if="item.session.shop_boss" class="muted">Boss: {{ directory.personName(item.session.shop_boss) }}</span>
            <span class="chip">{{ upcomingCounts.get(item.session.id) ?? 0 }} planned</span>
          </RouterLink>
        </li>
      </ul>
      <p v-else class="empty">Nothing scheduled in the next four weeks.</p>
    </section>

    <section class="panel calendar">
      <FullCalendar ref="calendar" :options="options" />
    </section>

    <KeyDateDialog
      :open="keyDateDialogOpen"
      :key-date="editingKeyDate"
      :start="newKeyDateRange?.start"
      :end="newKeyDateRange?.end"
      @close="keyDateDialogOpen = false"
      @saved="reload"
    />
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

a.upcoming-link:hover,
button.upcoming-link:hover {
  background: rgba(128, 128, 128, 0.12);
}

button.upcoming-link {
  width: 100%;
  border: none;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.upcoming-link.key {
  box-shadow: inset 4px 0 0 var(--key-date-color);
}

.key-chip {
  border-color: var(--key-date-color);
  color: var(--key-date-color);
  font-weight: 600;
}

.key-notes {
  flex-basis: 100%;
  font-size: 0.85rem;
}

.header-actions {
  display: flex;
  gap: 8px;
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

/* Key milestones: a lighter fill in their own colour, so competition events
   stay the boldest thing in the row. */
.calendar :deep(.fc-event.key-date) {
  background-color: var(--key-date-bg);
  border-color: var(--key-date-color);
}

.calendar :deep(.fc-event.key-date .fc-event-main) {
  color: var(--key-date-color);
  font-weight: 600;
}
</style>
