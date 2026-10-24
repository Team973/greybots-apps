<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import FullCalendar from '@fullcalendar/vue3';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { CalendarOptions, EventClickArg, EventDropArg, EventInput, EventSourceFuncArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';
import SessionDialog from '@/components/SessionDialog.vue';
import { errorMessage } from '@/lib/db';
import { formatSessionTime } from '@/lib/dates';
import { fetchPlansFor, fetchSessions, updateSession, type Session } from '@/lib/sessions';
import { useAuthStore } from '@/stores/auth-store';

// The shop schedule, as a calendar. Leads and admins add sessions (one-off or
// repeating) by dragging across empty time or with "Add session", move one by
// dragging it, change its length from its bottom edge, and tap it to rename
// or cancel it. Everyone can tap through to a session's plan.
const auth = useAuthStore();
const router = useRouter();
const viewMode = useViewModeStore();

const upcoming = ref<Session[]>([]);
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
    const sessions = await fetchSessions(info.start.toISOString(), info.end.toISOString());
    const counts = await countsFor(sessions);
    return sessions.map((session) => {
      const count = counts.get(session.id) ?? 0;
      return {
        id: session.id,
        title: count ? `${session.title} · ${count} ${count === 1 ? 'ticket' : 'tickets'}` : session.title,
        start: session.starts_at,
        end: session.ends_at,
        extendedProps: { session }
      };
    });
  } catch (e) {
    error.value = errorMessage(e);
    return [];
  }
}

async function loadUpcoming() {
  try {
    const now = new Date();
    const later = new Date(now.getTime() + 28 * 86_400_000);
    upcoming.value = await fetchSessions(now.toISOString(), later.toISOString());
    upcomingCounts.value = await countsFor(upcoming.value);
  } catch (e) {
    error.value = errorMessage(e);
  }
}

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
  allDaySlot: false,
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
  select: (info) => {
    openNew(info.start.toISOString(), info.end.toISOString());
    info.view.calendar.unselect();
  },
  eventClick: (info: EventClickArg) => {
    const session = info.event.extendedProps.session as Session;
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
      <ul v-if="upcoming.length" class="upcoming">
        <li v-for="session in upcoming" :key="session.id">
          <RouterLink :to="`/sessions/${session.id}`" class="upcoming-link">
            <strong>{{ session.title }}</strong>
            <span class="muted">{{ formatSessionTime(session.starts_at, session.ends_at) }}</span>
            <span class="chip">{{ upcomingCounts.get(session.id) ?? 0 }} planned</span>
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

.upcoming-link:hover {
  background: rgba(128, 128, 128, 0.12);
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
</style>
