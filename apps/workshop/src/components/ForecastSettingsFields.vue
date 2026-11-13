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
      <div class="form-grid">
        <label class="field">
          <span>From the last … sessions</span>
          <input v-model="draft.sessions" type="number" min="1" :max="maxForecastSessions" step="1" required :disabled="!draft.sessionsVisible" />
        </label>
      </div>
      <div class="opened" role="radiogroup" aria-label="Tickets opened a session">
        <span class="opened-label">Tickets opened</span>
        <label class="radio">
          <input v-model="draft.sessionsOpenedAuto" type="radio" :value="false" :disabled="!draft.sessionsVisible" />
          <input
            v-model="draft.sessionsOpened"
            class="rate"
            type="number"
            min="0"
            step="any"
            inputmode="decimal"
            aria-label="Tickets opened a session"
            :disabled="!draft.sessionsVisible || draft.sessionsOpenedAuto"
          />
          a session
        </label>
        <label class="radio">
          <input v-model="draft.sessionsOpenedAuto" type="radio" :value="true" :disabled="!draft.sessionsVisible" />
          Measured from the same sessions
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

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.opened {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.85rem;
}

.opened-label {
  opacity: 0.75;
}

.radio {
  display: flex;
  align-items: center;
  gap: 8px;
}

.radio input[type='radio'] {
  width: 16px;
  height: 16px;
  margin: 0;
}

.rate {
  width: 80px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--accent-color);
  background: var(--background-color);
  color: var(--primary-text-color);
  font: inherit;
}

.rate:disabled {
  opacity: 0.6;
}

.check input {
  width: 18px;
  height: 18px;
}
</style>
