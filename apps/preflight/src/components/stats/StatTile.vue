<script setup lang="ts">
// One headline number: what it is, the number, and a line of context.
defineProps<{ label: string; value: string; detail?: string | null }>();
</script>

<template>
  <div class="stat-tile">
    <p class="label">{{ label }}</p>
    <p class="value">{{ value }}</p>
    <p v-if="detail" class="detail">{{ detail }}</p>
  </div>
</template>

<style scoped>
.stat-tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--tile-background-color);
}

p {
  margin: 0;
}

.label {
  font-size: 0.85rem;
  opacity: 0.75;
}

.value {
  font-size: clamp(1.8rem, 3.2vw, 2.6rem);
  font-weight: 700;
  line-height: 1.1;
}

.detail {
  font-size: 0.8rem;
  opacity: 0.7;
}
</style>
