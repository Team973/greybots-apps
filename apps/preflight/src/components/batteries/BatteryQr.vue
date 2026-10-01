<script setup lang="ts">
import { ref, watch } from 'vue';
import QRCode from 'qrcode';
import { batteryQrText } from '@/lib/batteries/batteries';

// The QR code for a battery's label. Generated on the device, so labels can
// be made with no internet.
const props = withDefaults(defineProps<{ number: number; size?: number }>(), { size: 160 });
const src = ref('');

watch(
  () => [props.number, props.size],
  async () => {
    // Medium error correction: labels get scuffed.
    src.value = await QRCode.toDataURL(batteryQrText(props.number), { errorCorrectionLevel: 'M', margin: 1, width: props.size * 2 });
  },
  { immediate: true }
);
</script>

<template>
  <img v-if="src" class="battery-qr" :src="src" :width="size" :height="size" :alt="`QR code for battery ${number}`" />
</template>

<style scoped>
.battery-qr {
  display: block;
  background: #fff;
  image-rendering: pixelated;
}
</style>
