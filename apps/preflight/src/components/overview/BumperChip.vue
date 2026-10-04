<script setup lang="ts">
import { computed } from 'vue';
import { matchColor, type ScheduleItem } from '@/lib/schedule/types';

// Which bumpers the robot needs for its next match, shown wherever the
// robot's status is. Hidden when the schedule doesn't say (no upcoming match,
// or its alliances aren't posted yet).
const props = defineProps<{ match: ScheduleItem | null }>();

const alliance = computed(() => props.match?.match_info?.alliance ?? null);
</script>

<template>
  <span v-if="match && alliance" class="bumper-chip" :title="`${match.title} is on the ${alliance} alliance`">
    <span class="tag" :style="{ background: matchColor(alliance) }">{{ alliance === 'red' ? 'Red' : 'Blue' }} bumpers</span>
    <span class="what">{{ match.title }}</span>
  </span>
</template>

<style scoped>
/* Same shape as the installed battery chip, which it sits beside. */
.bumper-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 3px 12px 3px 3px;
  border-radius: 999px;
  background: #1a1a1a;
  color: #fff;
  font-size: 0.95rem;
}

.tag {
  flex: none;
  padding: 1px 10px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
}

.what {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
