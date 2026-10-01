<script setup lang="ts">
import { ref, watch } from 'vue';
import '@material/web/button/filled-button';
import '@material/web/button/outlined-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import { registerBattery } from '@/lib/batteries/batteries';
import { useSessionStore } from '@/stores/session-store';

// Register a battery. "Add and next" keeps the dialog open on the next
// number, for entering a whole set at the start of a season.
const props = defineProps<{ open: boolean; nextNumber: number }>();
const emit = defineEmits<{ close: [] }>();
const session = useSessionStore();

const number = ref<number | ''>('');
const label = ref('');
const purchaseDate = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    number.value = props.nextNumber;
    label.value = '';
    error.value = null;
  },
  { immediate: true }
);

async function add(keepOpen: boolean) {
  error.value = null;
  busy.value = true;
  try {
    await registerBattery(Number(number.value), { label: label.value, purchase_date: purchaseDate.value || null }, session.user?.name ?? null);
    if (!keepOpen) return emit('close');
    // Same purchase date for the next one: sets are usually bought together.
    number.value = Number(number.value) + 1;
    label.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" title="Add a battery" @close="emit('close')">
    <div class="form-row">
      <label class="field number"><span>Number</span><input v-model.number="number" type="number" min="1" step="1" /></label>
      <label class="field"><span>Label (optional)</span><input v-model="label" placeholder="e.g. MK ES17-12, 2026 set" /></label>
    </div>
    <label class="field"><span>Purchase date (optional)</span><input v-model="purchaseDate" type="date" /></label>
    <p v-if="error" class="error-text">{{ error }}</p>
    <template #actions>
      <span class="actions-spacer"></span>
      <md-text-button @click="emit('close')">Cancel</md-text-button>
      <md-outlined-button :disabled="busy" @click="add(true)">Add and next</md-outlined-button>
      <md-filled-button :disabled="busy" @click="add(false)">Add</md-filled-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.number {
  flex: 0 1 90px;
}
</style>
