<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import type { Repair } from '@/lib/repairs/repairs';

// Surfaces the repair being worked on (issue #83) wherever the robot's
// status is shown. Links to the repair log.
const props = defineProps<{ repairs: Repair[] }>();
const first = computed(() => props.repairs[0] ?? null);
const label = computed(() => {
  if (!first.value) return '';
  const who = first.value.assignee ? ` (${first.value.assignee})` : '';
  const more = props.repairs.length > 1 ? ` +${props.repairs.length - 1} more` : '';
  return `${first.value.title}${who}${more}`;
});
</script>

<template>
  <RouterLink v-if="first" to="/repairs" class="repair-chip">
    <span class="tag">Repair</span>
    <span class="what">{{ label }}</span>
  </RouterLink>
</template>

<style scoped>
.repair-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 3px 12px 3px 3px;
  border-radius: 999px;
  background: #1a1a1a;
  color: #fff;
  font-size: 0.95rem;
  text-decoration: none;
}

.tag {
  flex: none;
  padding: 1px 10px;
  border-radius: 999px;
  background: #c62828;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.what {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
