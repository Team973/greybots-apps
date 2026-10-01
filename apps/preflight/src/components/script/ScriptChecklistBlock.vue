<script setup lang="ts">
import type { ScriptChecklist } from '@/lib/script/event-script';

// One checklist as it prints: a tick box per step, who does it, anything
// worked out for the match, and room to write what the step records.
defineProps<{ checklist: ScriptChecklist; showInstructions: boolean }>();
</script>

<template>
  <section class="checklist">
    <h3>{{ checklist.name }}</h3>
    <ol>
      <li v-for="(step, i) in checklist.steps" :key="i" :class="{ skipped: step.skipped }">
        <span class="box" aria-hidden="true">{{ step.skipped ? '–' : '' }}</span>
        <div class="step">
          <p class="title">
            <span class="name">{{ step.title }}</span>
            <span v-if="step.who.length" class="who">{{ step.who.join(', ') }}</span>
          </p>
          <p v-if="step.note" class="note">{{ step.note }}</p>
          <p v-if="showInstructions && step.instructions && !step.skipped" class="instructions">{{ step.instructions }}</p>
          <template v-if="!step.skipped">
            <p v-if="step.input === 'pass_fail'" class="record">
              <span class="box small"></span> Pass <span class="box small"></span> Fail
            </p>
            <p v-else-if="step.input === 'battery'" class="record">Battery installed: <span class="blank short"></span></p>
            <p v-else-if="step.input === 'text'" class="record lines"><span class="blank"></span><span class="blank"></span></p>
          </template>
        </div>
      </li>
    </ol>
    <p v-if="!checklist.steps.length" class="empty">No steps.</p>
  </section>
</template>

<style scoped>
.checklist {
  break-inside: avoid-page;
  margin-top: 0.14in;
}

h3 {
  margin: 0 0 0.05in;
  padding-bottom: 0.03in;
  border-bottom: 1.5pt solid #000;
  font-size: 13pt;
}

ol {
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  display: flex;
  gap: 0.1in;
  padding: 0.045in 0;
  border-bottom: 0.5pt solid #bbb;
  break-inside: avoid;
}

.box {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0.19in;
  height: 0.19in;
  margin-top: 0.01in;
  border: 1.2pt solid #000;
  font-weight: 700;
  line-height: 1;
}

.box.small {
  width: 0.14in;
  height: 0.14in;
  margin: 0 0.04in 0 0.1in;
  vertical-align: middle;
}

.step {
  flex: 1;
  min-width: 0;
}

p {
  margin: 0;
}

.title {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.15in;
}

.name {
  font-size: 11pt;
  font-weight: 600;
}

.who {
  flex: none;
  max-width: 45%;
  font-size: 8.5pt;
  text-align: right;
}

/* What was worked out for this match: the part people came for. */
.note {
  font-size: 10pt;
  font-weight: 700;
}

.instructions {
  font-size: 8.5pt;
  color: #333;
}

.record {
  margin-top: 0.03in;
  font-size: 9.5pt;
}

.record .box.small:first-child {
  margin-left: 0;
}

.blank {
  display: inline-block;
  width: 100%;
  height: 0.2in;
  border-bottom: 0.7pt solid #000;
}

.blank.short {
  width: 0.9in;
  vertical-align: bottom;
}

.lines {
  display: flex;
  flex-direction: column;
}

li.skipped .name {
  text-decoration: line-through;
  font-weight: 400;
}

.empty {
  font-size: 9.5pt;
  font-style: italic;
}
</style>
