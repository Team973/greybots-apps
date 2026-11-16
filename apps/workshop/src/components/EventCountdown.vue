<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { errorMessage } from '@/lib/db';
import { formatDate, formatDay } from '@/lib/dates';
import { eventName, fetchCountdown, type Countdown } from '@/lib/events';

// Front and center on My tasks: how many shop sessions are left before the
// team's next event. Loads on its own, so a problem here never hides the
// rest of the page.
const countdown = ref<Countdown | null>(null);
const loaded = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    countdown.value = await fetchCountdown();
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loaded.value = true;
  }
});

const days = computed(() => {
  const n = countdown.value?.daysLeft ?? 0;
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
});
// Whole hours, or to the half hour when that's how sessions run.
const hours = computed(() => {
  const h = Math.round((countdown.value?.hoursLeft ?? 0) * 2) / 2;
  return { value: Number.isInteger(h) ? String(h) : h.toFixed(1), one: h === 1 };
});
const dates = computed(() => {
  const e = countdown.value?.event;
  if (!e) return '';
  return e.start_date === e.end_date ? formatDay(e.start_date) : `${formatDay(e.start_date)} – ${formatDay(e.end_date)}`;
});
</script>

<template>
  <section v-if="loaded" class="panel countdown" :class="{ none: !countdown }" aria-live="polite">
    <p v-if="error" class="error-text">Couldn't load the next event: {{ error }}</p>

    <template v-else-if="countdown && countdown.underway">
      <p class="eyebrow">At an event now</p>
      <p class="headline"><strong>{{ eventName(countdown.event) }}</strong></p>
      <p class="sub muted">{{ dates }}</p>
    </template>

    <template v-else-if="countdown">
      <p class="until">Until <strong>{{ eventName(countdown.event) }}</strong></p>
      <div class="figures">
        <div class="figure">
          <span class="number">{{ countdown.sessionsLeft }}</span>
          <span class="label">shop {{ countdown.sessionsLeft === 1 ? 'session' : 'sessions' }} left</span>
        </div>
        <div class="figure">
          <span class="number">{{ hours.value }}</span>
          <span class="label">shop {{ hours.one ? 'hour' : 'hours' }} left</span>
        </div>
      </div>
      <p class="sub muted">{{ dates }} · {{ days }}</p>
      <p v-if="countdown.scheduleShort" class="note">
        <template v-if="countdown.lastSession">The schedule stops {{ formatDate(countdown.lastSession) }}, so there may be more.</template>
        <template v-else>No shop sessions are scheduled before it yet.</template>
        <RouterLink to="/sessions" class="text-link">Schedule</RouterLink>
      </p>
    </template>

    <p v-else class="muted">No upcoming events yet. They show up here once The Blue Alliance lists the team's registrations.</p>
  </section>
</template>

<style scoped>
.countdown {
  border-left: 6px solid var(--event-color);
}

.countdown.none {
  border-left-color: rgba(128, 128, 128, 0.4);
}

.countdown p {
  margin: 0;
}

.until {
  font-size: 1.2rem;
}

.figures {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 40px;
}

.figure {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
}

.number {
  font-size: 3.4rem;
  font-weight: 700;
  line-height: 1;
  color: var(--event-color);
  font-variant-numeric: tabular-nums;
}

.label {
  font-size: 1.1rem;
}

.eyebrow {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--event-color);
}

.headline {
  font-size: 1.6rem;
}

.sub {
  font-size: 0.95rem;
}

.note {
  font-size: 0.9rem;
}

.note .text-link {
  margin-left: 6px;
}
</style>
