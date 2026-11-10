<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import '@material/web/button/outlined-button';
import { useViewModeStore } from '@greybots/common/stores/view-mode-store';

import {
  delayPath,
  describePlacement,
  movePose,
  movesFor,
  placementOf,
  poseAt,
  symmetryFor,
  trailBefore,
  type Alliance,
  type AutoPath,
  type FieldSide
} from '@shared/auto-compare';
import type { SignalLogFile } from '@shared/ipc';
import { robotLabel, robotsIn } from '@shared/log-filter';
import { describeMatch, robotFolderName } from '@shared/offload';
import { defaultRobotSize, isSinglePoseType, posesFrom, type Pose } from '@shared/plots';
import FieldCanvas, { type CanvasItem } from '@/components/FieldCanvas.vue';
import { fieldFor, seasonFor } from '@/fields';
import { formatTime } from '@/format';
import { colorFor, palette } from '@/palette';
import { useSettingsStore } from '@/stores/settings-store';

// Comparing autos: several robots' autonomous paths on one field, each moved
// to the alliance and side it's to be tried from (auto-compare.ts), played
// together from each auto's own start. A row is a team's log and the pose
// signal to draw from it.

const viewMode = useViewModeStore();
const settingsStore = useSettingsStore();

interface Row {
  id: string;
  robot: string;
  logId: string;
  key: string;
  // Where to try it: an alliance and side, or as it ran (null).
  alliance: Alliance | null;
  side: FieldSide | null;
  // Seconds after auto starts that this robot sets off (waiting where it
  // began until then), to try combinations of delays.
  offset: number;
  color: number;
  hidden: boolean;
}

// What's read for a row: its log's pose signals, and its auto's path.
interface Loaded {
  state: 'loading' | 'ready' | 'error';
  message: string;
  poseKeys: string[];
  // Seconds since the auto started, and where it was.
  path: AutoPath;
  autoLength: number;
}

const maxRows = 6;
// The longest delay, seconds: an auto period.
const maxOffset = 20;
const storageKey = 'autos.rows';

function loadRows(): Row[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as Row[];
    return Array.isArray(saved)
      ? saved.filter((r) => r && typeof r.id === 'string').slice(0, maxRows).map((r) => ({ ...r, offset: Number.isFinite(r.offset) ? r.offset : 0 }))
      : [];
  } catch {
    return [];
  }
}
const rows = ref<Row[]>(loadRows());
watch(rows, (value) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Kept for this visit only.
  }
}, { deep: true });

const logs = ref<SignalLogFile[]>([]);
// Data logs only: Driver Station logs alone have no poses.
const robotLogs = computed(() => logs.value.filter((log) => log.localPath));
const robots = computed(() => robotsIn(robotLogs.value));
const logsOf = (robot: string) => robotLogs.value.filter((log) => log.robot === robot);
const logName = (log: SignalLogFile) => (log.match ? `${describeMatch(log.match)}, ${formatTime(log.recorded)}` : `${formatTime(log.recorded)} (${log.name})`);

const loaded = reactive<Record<string, Loaded>>({});

// The field: the season of the first row's log.
const season = computed(() => seasonFor(logs.value.find((log) => log.id === rows.value[0]?.logId)?.recorded));
const field = computed(() => fieldFor(season.value));

// --- Reading a row's auto ---

// One at a time: the main process keeps only a few logs open, so rows
// reading at once would make them take turns opening.
let queue: Promise<unknown> = Promise.resolve();
const loadedFor = new Map<string, string>();

const preferredPose = (keys: string[]) =>
  keys.find((k) => /estimators\/fused\/pose$/i.test(k)) ?? keys.find((k) => /pose$/i.test(k) && !/sample|target|setpoint/i.test(k)) ?? keys[0] ?? '';

function load(row: Row) {
  const want = `${row.logId}\n${row.key}`;
  if (!row.logId || loadedFor.get(row.id) === want) return;
  loadedFor.set(row.id, want);
  loaded[row.id] = { state: 'loading', message: '', poseKeys: loaded[row.id]?.poseKeys ?? [], path: { times: [], poses: [] }, autoLength: 0 };
  queue = queue.then(async () => {
    try {
      const summary = await window.diagnostics.openSignalLog(row.logId);
      // Whole poses, not their fields (x, y, rotation), which carry the pose's type too.
      const poseKeys = summary.signals.filter((s) => isSinglePoseType(s.type) && !s.parent && s.count !== 0).map((s) => s.key);
      if (!row.key || !poseKeys.includes(row.key)) {
        // Noted as what's being read first, so setting it doesn't read it again.
        const key = preferredPose(poseKeys);
        loadedFor.set(row.id, `${row.logId}\n${key}`);
        row.key = key;
      }
      const review = await window.diagnostics.getEvents(row.logId);
      const auto = review.phases.filter((p) => p.name === 'auto');
      if (auto.length === 0) throw new Error('No autonomous period in this log.');
      if (!row.key) throw new Error('No pose signal in this log.');
      const [start, end] = [auto[0].start, auto[auto.length - 1].end];
      const records = await window.diagnostics.readRecords(row.logId, row.key, { start: start - 0.5, end }, 5000);
      const path: AutoPath = { times: [], poses: [] };
      records?.times.forEach((t, i) => {
        const pose = posesFrom(records.values[i], records.type)[0];
        // (0, 0) is a pose not set yet, not the field's corner.
        if (pose && !(pose.x === 0 && pose.y === 0)) {
          path.times.push(Math.max(0, t - start));
          path.poses.push(pose);
        }
      });
      if (path.poses.length === 0) throw new Error(`${row.key} has no poses in auto.`);
      loaded[row.id] = { state: 'ready', message: '', poseKeys, path, autoLength: end - start };
      loadedFor.set(row.id, `${row.logId}\n${row.key}`);
    } catch (error) {
      loaded[row.id] = { state: 'error', message: (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), poseKeys: loaded[row.id]?.poseKeys ?? [], path: { times: [], poses: [] }, autoLength: 0 };
    }
  });
}
watch(rows, (value) => value.forEach(load), { deep: true });

// --- Rows ---

const newId = () => Math.random().toString(36).slice(2, 10);
function addRow() {
  if (rows.value.length >= maxRows) return;
  const defaultRobot = settingsStore.loaded ? robotFolderName(settingsStore.settings) : '';
  const used = new Set(rows.value.map((r) => r.color));
  const robot = robots.value.includes(defaultRobot) && !rows.value.length ? defaultRobot : robots.value[0] ?? '';
  const log = logsOf(robot).find((l) => l.match) ?? logsOf(robot)[0];
  rows.value.push({
    id: newId(),
    robot,
    logId: log?.id ?? '',
    key: '',
    alliance: null,
    side: null,
    offset: 0,
    color: [...Array(palette.light.length).keys()].find((c) => !used.has(c)) ?? 0,
    hidden: false
  });
}
function setRobot(row: Row, robot: string) {
  row.robot = robot;
  const log = logsOf(robot).find((l) => l.match) ?? logsOf(robot)[0];
  row.logId = log?.id ?? '';
  row.key = '';
}
function setLog(row: Row, logId: string) {
  row.logId = logId;
  row.key = '';
}
function removeRow(row: Row) {
  rows.value = rows.value.filter((r) => r !== row);
  delete loaded[row.id];
  loadedFor.delete(row.id);
}

// Each row's path, moved where it's to be tried.
const moved = computed(() => rows.value.map((row) => {
  const data = loaded[row.id];
  if (data?.state !== 'ready') return null;
  const start = data.path.poses[0];
  const ran = placementOf(start, field.value);
  const moves = movesFor(start, field.value, symmetryFor(season.value), { alliance: row.alliance, side: row.side });
  const path = delayPath({ times: data.path.times, poses: data.path.poses.map((p) => movePose(p, moves, field.value)) }, row.offset);
  return { ran, now: placementOf(path.poses[0], field.value), path };
}));

// --- Playing them together, from each auto's start ---

const t = ref(0);
// Long enough for every auto, after its delay.
const longest = computed(() => Math.max(15, ...rows.value.map((row) => {
  const length = loaded[row.id]?.autoLength;
  return length ? length + Math.max(0, row.offset || 0) : 0;
})));
function setOffset(row: Row, value: string) {
  const seconds = Number(value);
  row.offset = Number.isFinite(seconds) ? Math.min(maxOffset, Math.max(0, seconds)) : 0;
}
const playing = ref(false);
let frame = 0;
let last = 0;
function step(now: number) {
  if (!playing.value) return;
  t.value = Math.min(longest.value, t.value + (now - last) / 1000);
  last = now;
  if (t.value >= longest.value) playing.value = false;
  else frame = requestAnimationFrame(step);
}
function play() {
  if (t.value >= longest.value) t.value = 0;
  playing.value = true;
  last = performance.now();
  frame = requestAnimationFrame(step);
}
function pause() {
  playing.value = false;
  cancelAnimationFrame(frame);
}
onUnmounted(() => cancelAnimationFrame(frame));
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

const colorOf = (row: Row) => colorFor(row.color, viewMode.isDarkMode);
const items = computed<CanvasItem[]>(() => rows.value.flatMap((row, i): CanvasItem[] => {
  const m = moved.value[i];
  if (!m || row.hidden) return [];
  const at = poseAt(m.path, t.value);
  return [
    { key: `${row.id}-path`, color: colorOf(row), style: 'path', opacity: 0.9, poses: [], history: m.path.poses },
    { key: row.id, color: colorOf(row), style: 'robot', opacity: 0.95, poses: at ? [at] : [], history: trailBefore(m.path, t.value, 1) as Pose[] }
  ];
}));

onMounted(async () => {
  if (!settingsStore.loaded) await settingsStore.load();
  logs.value = await window.diagnostics.getSignalLogs();
  // Rows whose logs have gone are dropped.
  rows.value = rows.value.filter((row) => logs.value.some((log) => log.id === row.logId));
  if (rows.value.length === 0) addRow();
  rows.value.forEach(load);
});
</script>

<template>
  <section class="card autos">
    <div class="card-head">
      <h2 title="Each robot's autonomous path, moved to the alliance and side it's to be tried from, played together from each auto's start.">Autos</h2>
      <span class="hint small">{{ field.season }} {{ field.game }}</span>
    </div>

    <div class="field-wrap">
      <FieldCanvas :items="items" :season="season" :rotation="0" :robot-size="defaultRobotSize" :max-height="520" />
    </div>

    <div class="playback">
      <button type="button" class="play" :aria-label="playing ? 'Pause' : 'Play'" @click="playing ? pause() : play()">
        <svg viewBox="0 -960 960 960" width="20" height="20" aria-hidden="true">
          <path v-if="playing" d="M520-200v-560h240v560H520Zm-320 0v-560h240v560H200Z" />
          <path v-else d="M320-200v-560l440 280-440 280Z" />
        </svg>
      </button>
      <input id="auto-time" v-model.number="t" type="range" min="0" :max="longest" step="0.05" aria-label="Time into auto" @input="pause" />
      <span class="time">Auto {{ clock(t) }}</span>
    </div>

    <table class="plain rows">
      <thead>
        <tr>
          <th></th>
          <th>Team</th>
          <th>Log</th>
          <th>Pose</th>
          <th>Alliance</th>
          <th>Side</th>
          <th title="Seconds after auto starts that the robot sets off">Start offset</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="row.id" :class="{ dim: row.hidden }">
          <td>
            <button type="button" class="swatch" :style="{ background: colorOf(row) }" :aria-label="row.hidden ? 'Show' : 'Hide'"
              :title="row.hidden ? 'Show' : 'Hide'" @click="row.hidden = !row.hidden"></button>
          </td>
          <td>
            <select :value="row.robot" aria-label="Team" @change="setRobot(row, ($event.target as HTMLSelectElement).value)">
              <option v-for="robot in robots" :key="robot" :value="robot">{{ robotLabel(robot) }}</option>
            </select>
          </td>
          <td>
            <select :value="row.logId" aria-label="Log" @change="setLog(row, ($event.target as HTMLSelectElement).value)">
              <option v-for="log in logsOf(row.robot)" :key="log.id" :value="log.id">{{ logName(log) }}</option>
            </select>
          </td>
          <td>
            <select v-model="row.key" aria-label="Pose signal" :title="row.key">
              <option v-for="key in loaded[row.id]?.poseKeys ?? []" :key="key" :value="key">{{ key.replace(/^\/Robot\/robot\//, '') }}</option>
            </select>
          </td>
          <td>
            <select :value="row.alliance ?? ''" aria-label="Alliance" @change="row.alliance = (($event.target as HTMLSelectElement).value || null) as Alliance | null">
              <option value="">As run</option>
              <option value="blue">Blue</option>
              <option value="red">Red</option>
            </select>
          </td>
          <td>
            <select :value="row.side ?? ''" aria-label="Side" title="As the alliance's drivers see it"
              @change="row.side = (($event.target as HTMLSelectElement).value || null) as FieldSide | null">
              <option value="">As run</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </td>
          <td class="offset">
            <input type="number" :value="row.offset" min="0" :max="maxOffset" step="0.5" aria-label="Start offset, seconds"
              title="Seconds after auto starts that the robot sets off" @change="setOffset(row, ($event.target as HTMLInputElement).value)" />
            <span class="hint small">s</span>
          </td>
          <td class="status">
            <span v-if="loaded[row.id]?.state === 'loading'" class="badge busy">Reading…</span>
            <span v-else-if="loaded[row.id]?.state === 'error'" class="badge bad" :title="loaded[row.id]?.message">{{ loaded[row.id]?.message }}</span>
            <span v-else-if="moved[i]" class="hint small" :title="`Ran from ${describePlacement(moved[i]!.ran)}`">
              {{ describePlacement(moved[i]!.now) }}
            </span>
            <button type="button" class="icon" aria-label="Remove" @click="removeRow(row)">✕</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="card-actions">
      <md-outlined-button id="add-auto" :disabled="rows.length >= maxRows || robots.length === 0" @click="addRow">Add a robot</md-outlined-button>
      <span v-if="robots.length === 0" class="hint">No logs yet: they come in on the Log Import page.</span>
    </div>
  </section>
</template>

<style scoped>
.autos {
  max-width: 1200px;
}

.field-wrap {
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 8px;
  padding: 8px;
}

.playback {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
}

.playback input[type='range'] {
  flex: 1;
}

.play {
  display: inline-flex;
  padding: 6px;
  border: 1px solid rgba(127, 127, 127, 0.6);
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.play svg {
  fill: currentColor;
}

.time {
  min-width: 80px;
  font-variant-numeric: tabular-nums;
}

.rows select {
  width: 100%;
  max-width: 230px;
  padding: 5px 6px;
  border-radius: 6px;
  font: inherit;
  font-size: 0.9rem;
  color: inherit;
  background: var(--tile-background-color);
  border: 1px solid rgba(127, 127, 127, 0.6);
}

.offset {
  white-space: nowrap;
}

.offset input {
  width: 64px;
  padding: 5px 6px;
  border-radius: 6px;
  font: inherit;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  color: inherit;
  background: var(--tile-background-color);
  border: 1px solid rgba(127, 127, 127, 0.6);
}

.rows td {
  vertical-align: middle;
}

.rows .dim td:not(:first-child) {
  opacity: 0.5;
}

.swatch {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.status {
  white-space: nowrap;
}

.status .badge {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.icon {
  margin-left: 8px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
</style>
