<script setup lang="ts">
// Part sorter: snap a photo of a pile of bolts (or gears), and the page groups
// them by type and highlights the largest type first. Sort those out of view,
// snap again (Check), and it moves on to the next largest. Everything runs on
// the phone. See apps/workshop/docs/part-sorter-design.md.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { PartSorterClient, grab } from '@/lib/partSorter/client';
import { drawResult, groupColor, UNKNOWN_COLOR } from '@/lib/partSorter/draw';
import type { PartKind, ReadyInfo, SorterResult, Timings } from '@/lib/partSorter/protocol';
import { describeLoad, deviceInfo, formatReport, runSpeedTest } from '@/lib/partSorter/speedTest';

type Phase = 'start' | 'loading' | 'aim' | 'working' | 'sorting' | 'done';

const phase = ref<Phase>('start');
const kind = ref<PartKind>('bolts');
const error = ref('');
const ready = ref<ReadyInfo | null>(null);
const timings = ref<Timings | null>(null);
// Downloading the part finder: 0-1, or null when not downloading.
const progress = ref<number | null>(null);
// Loading in the background failed; Start tries again.
const preloadFailed = ref(false);

// Every browser with WebGPU or recent WASM has SIMD; the C++ module needs it.
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const supported = typeof WebAssembly === 'object' && WebAssembly.validate(SIMD_TEST);

let client: PartSorterClient | null = null;

// ---- Camera

const video = ref<HTMLVideoElement | null>(null);
const stream = shallowRef<MediaStream | null>(null);
const cameraError = ref('');
const torchAvailable = ref(false);
const torchOn = ref(false);
let wakeLock: { release(): Promise<void> } | null = null;

async function startCamera() {
  cameraError.value = '';
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = window.isSecureContext
      ? "This browser can't use the camera here. Use a photo instead."
      : 'The camera only works over https. Use a photo instead.';
    return;
  }
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    cameraError.value =
      name === 'NotAllowedError'
        ? "The camera is blocked. Allow it for this site in the browser's settings, or use a photo instead."
        : name === 'NotFoundError'
          ? 'No camera found. Use a photo instead.'
          : "Couldn't start the camera. Use a photo instead.";
    return;
  }
  const track = stream.value.getVideoTracks()[0];
  const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
  torchAvailable.value = !!caps.torch;
  await keepAwake();
}

// The video element only exists once the page is past Start.
watch([video, stream], ([el, s]) => {
  if (el && s && el.srcObject !== s) {
    el.srcObject = s;
    el.play().catch(() => {});
  }
});

function stopCamera() {
  stream.value?.getTracks().forEach((t) => t.stop());
  stream.value = null;
  torchOn.value = false;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

async function keepAwake() {
  const nav = navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
  try {
    wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

async function toggleTorch() {
  const track = stream.value?.getVideoTracks()[0];
  if (!track) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: !torchOn.value } as MediaTrackConstraintSet] });
    torchOn.value = !torchOn.value;
  } catch {
    torchAvailable.value = false;
  }
}

// The wake lock is dropped when the page is hidden; take it again on return.
function onVisibility() {
  if (document.visibilityState === 'visible' && stream.value) keepAwake();
}
document.addEventListener('visibilitychange', onVisibility);

// ---- Sorting

const result = shallowRef<SorterResult | null>(null);
const photo = shallowRef<ImageBitmap | null>(null);
const current = ref(0);
const showAll = ref(false);
const toast = ref('');
const canvas = ref<HTMLCanvasElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
let toastTimer: number | undefined;

const groups = computed(() => result.value?.groups ?? []);
const unknownCount = computed(() => result.value?.parts.filter((p) => p.group < 0).length ?? 0);
const currentGroup = computed(() => groups.value[current.value]);
// Each group's size next to the largest, for the bar in the header.
const volume = (g: { length: number; diameter: number }) => g.length * g.diameter * g.diameter;
const relativeSize = computed(() => (currentGroup.value && groups.value.length ? volume(currentGroup.value) / volume(groups.value[0]) : 0));

// Starts loading the part finder as soon as the page opens, so it's often
// ready by the time the student presses Start: starting it takes seconds on a
// phone (compiling ONNX Runtime), even when the files are already kept.
function preload() {
  if (client) return client;
  preloadFailed.value = false;
  const c = new PartSorterClient(kind.value);
  client = c;
  c.onProgress = (loaded, total) => (progress.value = total ? Math.min(1, loaded / total) : null);
  c.whenReady().then(
    (info) => {
      if (client !== c) return;
      ready.value = info;
      progress.value = null;
    },
    () => {
      // Start tries again, and says what went wrong.
      if (client !== c) return;
      progress.value = null;
      preloadFailed.value = true;
      c.dispose();
      client = null;
    }
  );
  return c;
}
if (supported) preload();

async function start() {
  error.value = '';
  phase.value = 'loading';
  const c = preload();
  const camera = startCamera();
  try {
    ready.value = await c.whenReady();
    progress.value = null;
    // After it's ready: the kind set now, not when the page opened.
    c.reset(kind.value);
  } catch (err) {
    error.value = `The part finder didn't load: ${err instanceof Error ? err.message : err}`;
    progress.value = null;
    if (client === c) {
      c.dispose();
      client = null;
    }
    phase.value = 'start';
    return;
  }
  await camera;
  phase.value = 'aim';
}

async function snap(mode: 'scan' | 'check', file?: File) {
  if (!client) return;
  let bitmap: ImageBitmap;
  try {
    if (file) bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    else if (video.value && stream.value && video.value.videoWidth) bitmap = await createImageBitmap(video.value);
    else {
      fileInput.value?.click();
      return;
    }
  } catch {
    error.value = "Couldn't read that photo.";
    return;
  }
  const image = grab(bitmap, bitmap.width, bitmap.height);
  const back = phase.value;
  phase.value = 'working';
  error.value = '';
  try {
    const out = await client.run(mode, image);
    timings.value = out.timings;
    const unknown = out.result.parts.filter((p) => p.group < 0).length;
    history.value.push({ mode, size: `${out.result.width}x${out.result.height}`, ...out.timings, parts: out.result.parts.length, unknown, groups: out.result.groups.length });
    photo.value?.close();
    photo.value = bitmap;
    result.value = out.result;
    if (mode === 'scan') {
      current.value = 0;
      phase.value = out.result.groups.length ? 'sorting' : 'aim';
      if (!out.result.groups.length) error.value = 'No parts found. Get the whole pile in view, from about 30–50 cm above it.';
    } else {
      phase.value = 'sorting';
      afterCheck();
    }
  } catch (err) {
    error.value = `That didn't work: ${err instanceof Error ? err.message : err}`;
    phase.value = back;
  }
  await redraw();
}

// After a check: if none of the current group is left, on to the next group
// that still has parts in view.
function afterCheck() {
  const gs = groups.value;
  if (!gs.length || gs[current.value].count > 0) return;
  const done = current.value;
  let next = gs.findIndex((g, i) => i > done && g.count > 0);
  if (next < 0) next = gs.findIndex((g) => g.count > 0);
  if (next < 0) {
    phase.value = 'done';
    buzz([80, 60, 80, 60, 160]);
    return;
  }
  current.value = next;
  showToast(`Group ${done + 1} done. Next: group ${next + 1} of ${gs.length}`);
  buzz([120]);
}

function buzz(pattern: number[]) {
  navigator.vibrate?.(pattern);
}

function showToast(text: string) {
  toast.value = text;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ''), 3000);
}

function skip(step: number) {
  const n = groups.value.length;
  current.value = Math.min(n - 1, Math.max(0, current.value + step));
  if (phase.value === 'done') phase.value = 'sorting';
}

function rescan() {
  client?.reset(kind.value);
  result.value = null;
  photo.value?.close();
  photo.value = null;
  current.value = 0;
  showAll.value = false;
  phase.value = 'aim';
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) snap(result.value ? 'check' : 'scan', file);
}

async function redraw() {
  await nextTick();
  if (canvas.value && photo.value && result.value) drawResult(canvas.value, photo.value, result.value, showAll.value ? -1 : current.value);
}
watch([current, showAll, phase], redraw);

// ---- Saving photos, for retraining the part finder on the ones it gets wrong

function stamp() {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

async function toJpeg(source: CanvasImageSource, width: number, height: number) {
  const c = new OffscreenCanvas(width, height);
  c.getContext('2d')!.drawImage(source, 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

// The photo as taken, and the result drawn on it. Shared on phones (Save to
// Photos, Files, ...); downloaded elsewhere.
async function savePhoto() {
  if (!photo.value) return;
  const name = `part-sorter-${stamp()}`;
  const files = [new File([await toJpeg(photo.value, photo.value.width, photo.value.height)], `${name}.jpg`, { type: 'image/jpeg' })];
  if (canvas.value) files.push(new File([await toJpeg(canvas.value, canvas.value.width, canvas.value.height)], `${name}-result.jpg`, { type: 'image/jpeg' }));
  try {
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files });
      return;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
  }
  for (const file of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
}

// ---- Speed and details

type Snapshot = Timings & { mode: string; size: string; parts: number; unknown: number; groups: number };
const history = ref<Snapshot[]>([]);
const testing = ref('');
const report = ref('');
const copied = ref(false);

async function speedTest() {
  if (!photo.value || testing.value) return;
  report.value = '';
  testing.value = 'Starting…';
  try {
    const result = await runSpeedTest(kind.value, photo.value, (text) => (testing.value = text));
    report.value = formatReport(result);
  } catch (err) {
    report.value = `The speed test failed: ${err instanceof Error ? err.message : err}`;
  }
  testing.value = '';
}

// Everything in one block of text: the device, the setup, this session's
// snapshots, and the speed test's table.
const details = computed(() => {
  const ms = (v: number) => Math.round(v);
  const lines = Object.entries(deviceInfo()).map(([k, v]) => `${k}: ${v}`);
  if (ready.value)
    lines.push(
      `running on: ${ready.value.provider === 'webgpu' ? 'GPU' : 'CPU'}, ${ready.value.threads} CPU thread${ready.value.threads === 1 ? '' : 's'}, ${describeLoad(ready.value)}${ready.value.gpu ? `, ${ready.value.gpu}` : ''}`
    );
  if (history.value.length) {
    lines.push('', 'snapshots: mode size prep model sort ms, parts ? groups');
    for (const h of history.value) lines.push(`${h.mode} ${h.size} ${ms(h.prepMs)} ${ms(h.modelMs)} ${ms(h.sorterMs)}, ${h.parts} ${h.unknown} ${h.groups}`);
  }
  if (report.value) lines.push('', report.value);
  return lines.join('\n');
});

async function copyDetails() {
  try {
    await navigator.clipboard.writeText(details.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    copied.value = false;
  }
}

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility);
  window.clearTimeout(toastTimer);
  stopCamera();
  client?.dispose();
  photo.value?.close();
});
</script>

<template>
  <div class="page sorter">
    <header class="page-header">
      <h1>Part sorter</h1>
      <p class="hint">Spread a pile of one kind of part on a plain surface. The page groups them by type, largest first: take those out, then Check.</p>
    </header>

    <p v-if="!supported" class="error-text">This browser is too old for the part sorter. Update it, or use a recent Chrome, Safari or Firefox.</p>

    <section v-else-if="phase === 'start' || phase === 'loading'" class="panel start">
      <div class="segmented" role="group" aria-label="Kind of part">
        <button :class="{ on: kind === 'bolts' }" @click="kind = 'bolts'">Bolts</button>
        <button :class="{ on: kind === 'gears' }" disabled title="Coming later">Gears</button>
      </div>
      <button class="button primary big" :disabled="phase === 'loading'" @click="start">
        {{ phase === 'loading' ? 'Loading…' : 'Start camera' }}
      </button>
      <div v-if="phase === 'loading'" class="loading" aria-live="polite">
        <progress :value="progress ?? undefined" max="1"></progress>
        <span class="hint small">{{
          progress !== null && progress < 1 ? `Downloading the part finder… ${Math.round(progress * 100)}%` : 'Starting the part finder…'
        }}</span>
      </div>
      <p v-else-if="ready" class="hint">The part finder is ready.</p>
      <p v-else-if="progress !== null && progress < 1" class="hint">Downloading the part finder… {{ Math.round(progress * 100) }}%. It's kept on the phone after this.</p>
      <p v-else-if="preloadFailed" class="hint">Press Start to load the part finder.</p>
      <p v-else class="hint">Getting the part finder ready…</p>
    </section>

    <template v-else>
      <div v-if="phase === 'sorting' && currentGroup" class="status" :style="{ '--group': groupColor(current) }">
        <span class="swatch" aria-hidden="true"></span>
        <div class="status-text">
          <strong>Group {{ current + 1 }} of {{ groups.length }} · {{ currentGroup.count }} left</strong>
          <span class="size-bar" :title="`Size next to the largest group`"><i :style="{ width: `${Math.max(6, relativeSize * 100)}%` }"></i></span>
          <span v-if="unknownCount" class="unknown" :style="{ color: UNKNOWN_COLOR }">{{ unknownCount }} ? · spread these apart</span>
        </div>
      </div>
      <div v-else-if="phase === 'done'" class="status done">
        <strong>All sorted</strong>
        <span v-if="unknownCount" class="unknown" :style="{ color: UNKNOWN_COLOR }">{{ unknownCount }} ? left · spread them out and Rescan</span>
      </div>
      <div v-else class="status">
        <strong>{{ phase === 'working' ? 'Finding parts…' : stream ? 'Hold the phone above the pile, then Scan' : 'Use a photo of the pile' }}</strong>
      </div>

      <div class="viewer">
        <video v-show="!result || phase === 'aim'" ref="video" class="feed" playsinline muted></video>
        <canvas v-show="result && phase !== 'aim'" ref="canvas" class="feed"></canvas>
        <video
          v-if="result && phase !== 'aim' && stream"
          class="pip"
          playsinline
          muted
          autoplay
          :srcObject.prop="stream"
          aria-hidden="true"
        ></video>
        <div v-if="phase === 'working'" class="busy" aria-live="polite"><span class="spinner"></span></div>
        <div v-if="toast" class="toast" role="status">{{ toast }}</div>
        <p v-if="cameraError && !result" class="camera-error">{{ cameraError }}</p>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>

      <div class="controls">
        <template v-if="phase === 'aim' || (phase === 'working' && !result)">
          <button class="button primary big" :disabled="phase === 'working'" @click="snap('scan')">Scan</button>
        </template>
        <template v-else>
          <button class="button primary big" :disabled="phase === 'working'" @click="snap('check')">Check</button>
          <button class="button" :disabled="phase === 'working' || current === 0" @click="skip(-1)">Back</button>
          <button class="button" :disabled="phase === 'working' || current >= groups.length - 1" @click="skip(1)">Skip</button>
          <button class="button" :class="{ on: showAll }" :disabled="phase === 'working'" @click="showAll = !showAll">
            {{ showAll ? 'Current group' : 'All groups' }}
          </button>
          <button class="button" :disabled="phase === 'working'" @click="rescan">Rescan</button>
        </template>
        <button class="button" :disabled="phase === 'working'" @click="fileInput?.click()">Use a photo</button>
        <button v-if="photo && result" class="button" :disabled="phase === 'working'" @click="savePhoto">Save photo</button>
        <button v-if="torchAvailable" class="button" @click="toggleTorch">{{ torchOn ? 'Light off' : 'Light on' }}</button>
        <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
      </div>

      <p v-if="ready" class="hint small">
        Running on {{ ready.provider === 'webgpu' ? 'the GPU' : ready.threads > 1 ? `${ready.threads} CPU cores` : 'the CPU' }}<template v-if="timings">
          · finding {{ Math.round(timings.prepMs + timings.modelMs) }} ms · sorting {{ Math.round(timings.sorterMs) }} ms</template
        >
      </p>
    </template>

    <details v-if="supported" class="panel details">
      <summary>Speed and details</summary>
      <p class="hint small">
        The speed test runs the last photo on each processor this phone has, at a few sizes (a minute or two). Copy the details and send them to
        whoever is tuning the part sorter, with the photo (Save photo) if the groups were wrong.
      </p>
      <div class="controls">
        <button class="button" :disabled="!photo || !!testing || phase === 'working'" @click="speedTest">{{ testing ? 'Testing…' : 'Speed test' }}</button>
        <button class="button" @click="copyDetails">{{ copied ? 'Copied' : 'Copy details' }}</button>
      </div>
      <p v-if="!photo" class="hint small">Scan, or use a photo, first.</p>
      <p v-if="testing" class="hint small" aria-live="polite">{{ testing }}</p>
      <pre class="details-text">{{ details }}</pre>
    </details>
  </div>
</template>

<style scoped>
.start {
  align-items: flex-start;
  gap: 14px;
}

.button.big {
  padding: 12px 22px;
  font-size: 1.05rem;
}

.button.on {
  background: var(--accent-color);
  color: #fff;
}

.status {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 8px 14px;
  border-radius: 10px;
  background-color: var(--tile-background-color);
}

.status .swatch {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--group);
}

.status-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.status-text strong,
.status strong {
  font-size: 1.1rem;
}

.status.done {
  flex-wrap: wrap;
}

.size-bar {
  display: block;
  height: 6px;
  max-width: 220px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.25);
  overflow: hidden;
}

.size-bar i {
  display: block;
  height: 100%;
  background: var(--group);
}

.unknown {
  font-size: 0.9rem;
}

.viewer {
  position: relative;
  display: flex;
  justify-content: center;
  border-radius: 10px;
  overflow: hidden;
  background: #111;
}

.feed {
  display: block;
  width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

canvas.feed {
  width: auto;
  max-width: 100%;
  height: auto;
}

.pip {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 24%;
  max-width: 160px;
  border: 2px solid rgba(255, 255, 255, 0.7);
  border-radius: 6px;
}

.busy {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.spinner {
  width: 48px;
  height: 48px;
  border: 5px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.toast {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  font-weight: 600;
  white-space: nowrap;
}

.camera-error {
  position: absolute;
  inset: auto 12px 12px;
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hint.small {
  font-size: 0.85rem;
}

.loading {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(100%, 360px);
}

.loading progress {
  width: 100%;
  height: 10px;
  accent-color: var(--accent-color);
}

.details summary {
  cursor: pointer;
  font-weight: 600;
}

.details-text {
  margin: 0;
  max-height: 40vh;
  overflow: auto;
  font-size: 0.75rem;
  white-space: pre;
}
</style>
