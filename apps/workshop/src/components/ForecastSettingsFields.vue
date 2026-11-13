<script setup lang="ts">
import { maxForecastSessions, type ForecastDraft } from '@/lib/milestones';

// The burnup forecast settings (see lib/milestones.ts), for a milestone or a
// dashboard chart. Edits the draft in place.
const draft = defineModel<ForecastDraft>({ required: true });
</script>

<template>
  <div class="forecast-fields">
    <fieldset>
      <legend><label class="check"><input v-model="draft.planVisible" type="checkbox" /> Plan forecast</label></legend>
      <p class="hint">Your estimate of how fast tickets get closed, and how fast new ones get added.</p>
      <div class="form-grid">
        <label class="field">
          <span>Tickets closed a week</span>
          <input v-model="draft.planClosed" type="number" min="0" step="any" inputmode="decimal" :required="draft.planVisible" :disabled="!draft.planVisible" />
        </label>
        <label class="field">
          <span>Tickets opened a week</span>
          <input v-model="draft.planOpened" type="number" min="0" step="any" inputmode="decimal" :disabled="!draft.planVisible" />
        </label>
      </div>
    </fieldset>
    <fieldset>
      <legend><label class="check"><input v-model="draft.sessionsVisible" type="checkbox" /> Session forecast</label></legend>
      <p class="hint">
        Tickets closed and added per shop session over recent sessions, carried forward over the session schedule (and, past the end of the
        schedule, as often as recent sessions happened).
      </p>
      <div class="form-grid">
        <label class="field">
          <span>From the last … sessions</span>
          <input v-model="draft.sessions" type="number" min="1" :max="maxForecastSessions" step="1" required :disabled="!draft.sessionsVisible" />
        </label>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.forecast-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

fieldset {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 10px 12px 12px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 8px;
}

legend {
  padding: 0 4px;
}

.hint {
  font-size: 0.85rem;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.check input {
  width: 18px;
  height: 18px;
}
</style>
