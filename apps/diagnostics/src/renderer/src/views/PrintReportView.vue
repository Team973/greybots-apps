<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import type { Report } from '@shared/library';
import ReportViewer from '@/components/ReportViewer.vue';

// A report laid out for paper, which Save as PDF prints in a hidden window
// the width of the page (main/index.ts): the whole report, in the light
// theme, nothing of the app around it. It says when it's drawn by setting
// `data-ready` on the body: 'yes', or what went wrong.

const route = useRoute();
const report = ref<Report | null>(null);

onMounted(async () => {
  document.documentElement.setAttribute('theme', 'light');
  let ready = 'yes';
  try {
    report.value = await window.diagnostics.getReport(String(route.params.id));
    if (!report.value) ready = 'That report is gone.';
  } catch (error) {
    ready = (error as Error).message || "The report couldn't be read.";
  }
  // Drawn, and the charts sized to the page (they measure themselves).
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await document.fonts.ready;
  document.body.dataset.ready = ready;
});
</script>

<template>
  <ReportViewer v-if="report" :report="report" paper />
</template>

<style>
/* The page is the paper's: white, with the margins the PDF gives it, and
   as long as the report. (The app's #app is fixed to the window and
   scrolls inside it, which prints just one window's worth.) */
body:has(.report.paper),
#app:has(.report.paper) {
  position: static;
  display: block;
  height: auto;
  min-height: 0;
  margin: 0;
  overflow: visible;
  background: #fff;
  color: #000;
}
</style>
