<script setup lang="ts">
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import type { ReportProblem } from '@shared/library';
import { groupProblems } from '@shared/report-cards';
import { severityColor } from '@/review';

// Flags for what reports found: errors (red) and warnings (amber), with their
// titles on hover, and signals missing. Tinted with their colour and always
// named, so colour isn't all that tells them apart.
withDefaults(defineProps<{
  errors: ReportProblem[];
  warnings: ReportProblem[];
  missing?: number;
  // Say so when there are no errors or warnings.
  clean?: boolean;
}>(), { missing: 0, clean: true });

const viewMode = useViewModeStore();
const color = (severity: 'error' | 'warning') => severityColor(severity, viewMode.isDarkMode);
// Each once, with how many times when more than one.
const titles = (problems: ReportProblem[]) => groupProblems(problems).map((g) => (g.count > 1 ? `${g.title} (×${g.count})` : g.title)).join('\n');
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
</script>

<template>
  <span class="flags">
    <span v-if="errors.length" class="flag" :style="{ '--flag': color('error') }" :title="titles(errors)">{{ plural(errors.length, 'error') }}</span>
    <span v-if="warnings.length" class="flag" :style="{ '--flag': color('warning') }" :title="titles(warnings)">{{ plural(warnings.length, 'warning') }}</span>
    <span v-if="missing" class="flag quiet" title="Signals asked for that this log doesn't have">{{ plural(missing, 'signal') }} missing</span>
    <span v-if="clean && !errors.length && !warnings.length" class="flag quiet">No errors or warnings</span>
  </span>
</template>

<style scoped>
.flags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 6px;
}

.flag {
  padding: 1px 8px;
  border: 1px solid var(--flag, rgba(127, 127, 127, 0.6));
  border-radius: 999px;
  background: color-mix(in srgb, var(--flag, transparent) 18%, transparent);
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: default;
}

.flag.quiet {
  font-weight: 400;
  opacity: 0.75;
}
</style>
