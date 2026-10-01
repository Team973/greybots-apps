<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import jsQR from 'jsqr';
import '@material/web/button/filled-button';
import '@material/web/button/text-button';
import AppDialog from '@/components/AppDialog.vue';
import { parseBatteryCode } from '@/lib/batteries/batteries';

// Pick a battery by scanning its QR label with the device camera, or by
// typing its number when there's no camera. Decoding runs on the device
// (jsQR), so it works with no internet.
const props = defineProps<{ open: boolean; title?: string }>();
const emit = defineEmits<{ close: []; scanned: [number: number] }>();

const video = ref<HTMLVideoElement | null>(null);
const cameraError = ref<string | null>(null);
const hint = ref<string | null>(null);
const typed = ref<number | ''>('');

let stream: MediaStream | null = null;
let frame = 0;
const canvas = document.createElement('canvas');

function stop() {
  cancelAnimationFrame(frame);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

function scanFrame() {
  const el = video.value;
  if (!stream || !el) return;
  if (el.readyState === el.HAVE_ENOUGH_DATA && el.videoWidth) {
    // Downscale: plenty for a label held up to the camera, and much faster.
    const scale = Math.min(1, 640 / el.videoWidth);
    canvas.width = Math.round(el.videoWidth * scale);
    canvas.height = Math.round(el.videoHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
      if (code?.data) {
        const number = parseBatteryCode(code.data);
        if (number !== null) return found(number);
        hint.value = "That QR code isn't a battery label.";
      }
    }
  }
  frame = requestAnimationFrame(scanFrame);
}

async function start() {
  cameraError.value = null;
  hint.value = null;
  typed.value = '';
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = 'No camera available on this device.';
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    // The dialog may have closed while the permission prompt was up.
    if (!props.open || !video.value) return stop();
    video.value.srcObject = stream;
    await video.value.play();
    frame = requestAnimationFrame(scanFrame);
  } catch (e) {
    stop();
    cameraError.value =
      e instanceof DOMException && e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it, or type the number.' : "Couldn't start the camera.";
  }
}

function found(number: number) {
  stop();
  emit('scanned', number);
}

function submitTyped() {
  const number = Number(typed.value);
  if (Number.isInteger(number) && number > 0) found(number);
}

watch(
  () => props.open,
  (open) => {
    if (open) start();
    else stop();
  },
  { immediate: true }
);
onBeforeUnmount(stop);
</script>

<template>
  <AppDialog :open="open" :title="title ?? 'Scan a battery'" @close="emit('close')">
    <div class="viewfinder">
      <video ref="video" playsinline muted></video>
      <p v-if="cameraError" class="camera-error">{{ cameraError }}</p>
    </div>
    <p v-if="hint" class="hint">{{ hint }}</p>
    <form class="form-row" @submit.prevent="submitTyped">
      <label class="field"><span>Or type the battery number</span><input v-model.number="typed" type="number" min="1" step="1" inputmode="numeric" /></label>
      <md-filled-button class="go" type="button" :disabled="typed === ''" @click="submitTyped">Select</md-filled-button>
    </form>
    <template #actions>
      <span class="actions-spacer"></span>
      <md-text-button @click="emit('close')">Cancel</md-text-button>
    </template>
  </AppDialog>
</template>

<style scoped>
.viewfinder {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 4 / 3;
  max-height: 46dvh;
  border-radius: 10px;
  overflow: hidden;
  background: #000;
}

.viewfinder video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.camera-error {
  position: absolute;
  margin: 0;
  padding: 0 16px;
  color: #fff;
  text-align: center;
}

.hint {
  margin: 0;
  opacity: 0.8;
  font-size: 0.9rem;
}

.go {
  align-self: flex-end;
  flex: none;
}
</style>
