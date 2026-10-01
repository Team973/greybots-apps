<script setup lang="ts">
import { ref } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import { clockOffset, useNow } from '@greybots/common/lib/now';
import { toLocalInput } from '@/lib/schedule/dates';
import { resetClock, setPretendTime } from '@/lib/testing-clock';

// Admin-only: pretend it's a different date/time on this device.
const offset = clockOffset();
const now = useNow(1000);
const pretend = ref(toLocalInput(new Date(now.value).toISOString()));
const error = ref<string | null>(null);

function apply() {
  const at = Date.parse(pretend.value);
  if (Number.isNaN(at)) return (error.value = 'Pick a date and time');
  error.value = null;
  setPretendTime(at);
}
</script>

<template>
  <div class="card">
    <h2>Testing mode</h2>
    <p class="hint">
      Pretend it's a different date and time on this device, e.g. to replay an event day that's over and check that the
      schedule-driven features (bumper swaps, automatic Inbound, timers) work. The clock keeps running from the time you
      set. Status changes, checked steps, and task times recorded meanwhile use the pretend time, so test on a test event.
    </p>
    <dl class="detail-list">
      <dt>App clock</dt>
      <dd>{{ new Date(now).toLocaleString() }}{{ offset !== 0 ? ' (testing)' : ' (real time)' }}</dd>
    </dl>
    <div class="form-row">
      <label class="field"><span>Pretend it's</span><input v-model="pretend" type="datetime-local" step="60" /></label>
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>
    <div class="form-row">
      <md-filled-button @click="apply">Set clock</md-filled-button>
      <md-outlined-button :disabled="offset === 0" @click="resetClock">Back to real time</md-outlined-button>
    </div>
  </div>
</template>
