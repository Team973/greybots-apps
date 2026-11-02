// More kinds of plot than the line chart (#144): a 2D field, the console, a
// pie chart and a 3D robot. They sit under the line chart on the Signals
// page and show the same moment: the pin, the playhead, or now when live.
//
// Nothing here may touch Node or the DOM.

export type PanelType = 'field' | 'console' | 'pie' | 'robot3d';

export const panelLabels: Record<PanelType, string> = {
  field: '2D field',
  console: 'Console',
  pie: 'Pie chart',
  robot3d: '3D robot'
};

// A palette slot, or a colour the person chose ('#rrggbb'), as on the chart.
export type PanelColor = number | string;

// How a pose signal is drawn on the field: a robot (a square the size of
// one, with its heading), a path through its poses (a trajectory), or dots.
export type FieldStyle = 'robot' | 'path' | 'points';

export interface FieldItem {
  key: string;
  style: FieldStyle;
  color: PanelColor;
  // How solid a robot's fill is, 0 (just the border) to 1.
  opacity: number;
}

export type FieldRotation = 0 | 90 | 180 | 270;

export interface FieldPanel {
  id: string;
  type: 'field';
  // The season whose field is drawn ('2026').
  season: string;
  // Turned this far clockwise: 0 has the blue alliance wall on the left.
  rotation: FieldRotation;
  // A robot's side, bumpers and all, in metres.
  robotSize: number;
  // Seconds of where each robot has been, drawn behind it. 0 for none.
  trail: number;
  items: FieldItem[];
}

export interface ConsolePanel {
  id: string;
  type: 'console';
  // A text signal: WPILib's DataLogManager logs what the robot code prints
  // as `console`, and live from the robot it comes from the roboRIO's
  // console (port 1741), under the same name.
  key: string;
  filter: string;
}

// What a pie's slices are: each signal's share of their total over the span
// (current by motor: amp-seconds), or how long one signal spent at each of
// its values (time in each state or zone).
export type PieMode = 'share' | 'states';

export interface PiePanel {
  id: string;
  type: 'pie';
  mode: PieMode;
  // For 'share', numbers; for 'states', one signal.
  keys: string[];
}

export interface Robot3dPanel {
  id: string;
  type: 'robot3d';
  // A robot model in the data folder's models/ (its folder name), or '' for
  // a plain box the size of a robot.
  model: string;
  // The robot's pose on the field: a Pose2d or Pose3d.
  poseKey: string;
  // Where the model's moving parts are, relative to the robot: a Pose3d[].
  componentsKey: string;
  // The field drawn under it, or '' for a plain floor.
  season: string;
}

export type PlotPanel = FieldPanel | ConsolePanel | PiePanel | Robot3dPanel;

// At most this many on the page, and this many signals on a field or a pie.
export const maxPanels = 6;
export const maxFieldItems = 8;
export const maxPieKeys = 8;

export const defaultRobotSize = 0.9;

export function newPanel(type: PanelType, id: string, season: string): PlotPanel {
  switch (type) {
    case 'field':
      return { id, type, season, rotation: 0, robotSize: defaultRobotSize, trail: 2, items: [] };
    case 'console':
      return { id, type, key: 'console', filter: '' };
    case 'pie':
      return { id, type, mode: 'share', keys: [] };
    case 'robot3d':
      return { id, type, model: '', poseKey: '', componentsKey: '', season };
  }
}

// The signals a panel reads.
export function panelKeys(panel: PlotPanel): string[] {
  switch (panel.type) {
    case 'field':
      return panel.items.map((item) => item.key);
    case 'console':
      return panel.key ? [panel.key] : [];
    case 'pie':
      return panel.keys;
    case 'robot3d':
      return [panel.poseKey, panel.componentsKey].filter(Boolean);
  }
}

// --- Values as logged ---

// A value decoded whole: a struct as its fields, an array as a list. Raw
// bytes the app can't decode are null.
export type RecordValue = boolean | number | string | null | RecordValue[] | { [field: string]: RecordValue };

// Every value of a signal over a span, whole, for what a line can't show:
// poses, lists of poses. Times as in SignalSeries.
export interface SignalRecords {
  key: string;
  // The logged type: 'struct:Pose2d', 'struct:Pose3d[]', 'double[]', ...
  type: string;
  times: number[];
  values: RecordValue[];
  // There were more than were sent (the first ones went).
  truncated: boolean;
}

// The value holding at time t: the last at or before it.
export function recordAt(records: SignalRecords, t: number): RecordValue | undefined {
  const { times } = records;
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= t) low = mid + 1;
    else high = mid;
  }
  return low === 0 ? undefined : records.values[low - 1];
}

// --- Poses ---

// A pose in metres on the field (WPILib's: x along the field from the blue
// wall, y to the left, z up), with its rotation as a quaternion.
export interface Pose {
  x: number;
  y: number;
  z: number;
  qw: number;
  qx: number;
  qy: number;
  qz: number;
  // Whether it says which way it faces (a Translation2d doesn't).
  heading: boolean;
}

// Types the field and the 3D robot can place: WPILib's geometry structs and
// lists of them, and Field2d's `double[]` (x, y, degrees for each).
const poseType = /^struct:(Pose2d|Pose3d|Translation2d|Translation3d)(\[\])?$|^double\[\]$/;

export const isPoseType = (type: string) => poseType.test(type);
// One pose each value, not a list of them.
export const isSinglePoseType = (type: string) => /^struct:(Pose2d|Pose3d)$/.test(type);
export const isPoseListType = (type: string) => /^struct:Pose3d\[\]$/.test(type);

const yawQuaternion = (yaw: number) => ({ qw: Math.cos(yaw / 2), qx: 0, qy: 0, qz: Math.sin(yaw / 2) });

function num(value: RecordValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function field(value: RecordValue | undefined, name: string): RecordValue | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value[name] : undefined;
}

// One struct value as a pose, or null if it isn't one.
function structPose(value: RecordValue | undefined, typeName: string): Pose | null {
  if (typeName === 'Translation2d' || typeName === 'Translation3d') {
    const x = num(field(value, 'x'));
    const y = num(field(value, 'y'));
    if (x === null || y === null) return null;
    return { x, y, z: num(field(value, 'z')) ?? 0, ...yawQuaternion(0), heading: false };
  }
  const translation = field(value, 'translation');
  const rotation = field(value, 'rotation');
  const x = num(field(translation, 'x'));
  const y = num(field(translation, 'y'));
  if (x === null || y === null) return null;
  if (typeName === 'Pose2d') {
    const yaw = num(field(rotation, 'value'));
    if (yaw === null) return null;
    return { x, y, z: 0, ...yawQuaternion(yaw), heading: true };
  }
  const q = field(rotation, 'q');
  const qw = num(field(q, 'w'));
  const qx = num(field(q, 'x'));
  const qy = num(field(q, 'y'));
  const qz = num(field(q, 'z'));
  if (qw === null || qx === null || qy === null || qz === null) return null;
  return { x, y, z: num(field(translation, 'z')) ?? 0, qw, qx, qy, qz, heading: true };
}

// The poses in one value of a signal of type `type`: one for a Pose2d, as
// many as there are for a list. [] when it isn't poses.
export function posesFrom(value: RecordValue | undefined, type: string): Pose[] {
  if (value === undefined || value === null) return [];
  if (type === 'double[]') {
    // Field2d: x, y, degrees for each pose.
    if (!Array.isArray(value) || value.length % 3 !== 0) return [];
    const poses: Pose[] = [];
    for (let i = 0; i + 2 < value.length; i += 3) {
      const [x, y, degrees] = [num(value[i]), num(value[i + 1]), num(value[i + 2])];
      if (x === null || y === null || degrees === null) return [];
      poses.push({ x, y, z: 0, ...yawQuaternion((degrees * Math.PI) / 180), heading: true });
    }
    return poses;
  }
  const found = /^struct:(\w+?)(\[\])?$/.exec(type);
  if (!found) return [];
  const items = found[2] ? (Array.isArray(value) ? value : []) : [value];
  const poses: Pose[] = [];
  for (const item of items) {
    const pose = structPose(item, found[1]);
    if (pose) poses.push(pose);
  }
  return poses;
}

// Which way it faces on the field, radians anticlockwise from +x.
export function yawOf(pose: Pose): number {
  const { qw, qx, qy, qz } = pose;
  return Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz));
}

// --- Pies ---

export interface PieSlice {
  label: string;
  value: number;
}

// How long each value held during [start, end], from a signal's values
// (times ascending): the value carried in from before the start counts,
// and the last holds until `end`. Longest first.
export function timeInStates(times: ArrayLike<number>, values: ArrayLike<string | number>, start: number, end: number, label: (value: string | number) => string = String): PieSlice[] {
  const totals = new Map<string, number>();
  for (let i = 0; i < times.length; i++) {
    const from = Math.max(times[i], start);
    const to = Math.min(i + 1 < times.length ? times[i + 1] : end, end);
    if (to <= from) continue;
    const name = label(values[i]);
    totals.set(name, (totals.get(name) ?? 0) + (to - from));
  }
  return [...totals].map(([name, value]) => ({ label: name, value })).sort((a, b) => b.value - a.value);
}

// Slices past `max` are put together as Other, so colours aren't cycled.
export function foldSlices(slices: PieSlice[], max: number): PieSlice[] {
  const positive = slices.filter((s) => s.value > 0);
  if (positive.length <= max) return positive;
  const kept = positive.slice(0, max - 1);
  const rest = positive.slice(max - 1).reduce((sum, s) => sum + s.value, 0);
  return [...kept, { label: 'Other', value: rest }];
}

// --- Robot models ---

// A robot model, as AdvantageScope keeps them, so a team's models work in
// both: a folder with config.json, model.glb (the robot) and model_0.glb,
// model_1.glb, ... (its moving parts, in the order of the components pose
// list). The config turns the model to stand on the field the WPILib way
// (`rotations`, applied in order, then `position`, metres), and each part
// so it sits at its zero (`zeroedRotations`, `zeroedPosition`).
export interface ModelRotation {
  axis: 'x' | 'y' | 'z';
  degrees: number;
}

export interface ModelConfig {
  name: string;
  rotations: ModelRotation[];
  position: [number, number, number];
  components: { zeroedRotations: ModelRotation[]; zeroedPosition: [number, number, number] }[];
}

export interface RobotModel {
  // Its folder in models/.
  id: string;
  config: ModelConfig;
  // The part files there are: model.glb, model_0.glb, ...
  files: string[];
}

function cleanRotations(raw: unknown): ModelRotation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === 'object' && ['x', 'y', 'z'].includes((r as ModelRotation).axis) && Number.isFinite((r as ModelRotation).degrees))
    .map((r) => ({ axis: (r as ModelRotation).axis, degrees: (r as ModelRotation).degrees }));
}

function cleanPosition(raw: unknown): [number, number, number] {
  return Array.isArray(raw) && raw.length === 3 && raw.every(Number.isFinite) ? [raw[0], raw[1], raw[2]] : [0, 0, 0];
}

// A config.json as read, with what this app uses and nothing else; null if
// it isn't one.
export function cleanModelConfig(raw: unknown, fallbackName: string): ModelConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const config = raw as Record<string, unknown>;
  return {
    name: typeof config.name === 'string' && config.name.trim() ? config.name.trim().slice(0, 120) : fallbackName,
    rotations: cleanRotations(config.rotations),
    position: cleanPosition(config.position),
    components: Array.isArray(config.components)
      ? config.components.slice(0, 32).map((c) => ({
        zeroedRotations: cleanRotations((c as Record<string, unknown>)?.zeroedRotations),
        zeroedPosition: cleanPosition((c as Record<string, unknown>)?.zeroedPosition)
      }))
      : []
  };
}

// model.glb, model_0.glb, ...: the robot first, then its parts in order.
export const modelFile = (index: number | null) => (index === null ? 'model.glb' : `model_${index}.glb`);

// --- Panels as kept ---

const text = (raw: unknown, max = 400) => (typeof raw === 'string' ? raw.slice(0, max) : '');
const panelId = (raw: unknown) => (typeof raw === 'string' && /^[\w-]{1,40}$/.test(raw) ? raw : '');
const season = (raw: unknown) => (typeof raw === 'string' && /^\d{4}$/.test(raw) ? raw : '');

function cleanColor(raw: unknown): PanelColor {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < maxFieldItems) return raw;
  if (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw)) return raw;
  return 0;
}

// One panel as saved or received, with what's known and nothing else; null
// if it isn't one.
export function cleanPanel(raw: unknown): PlotPanel | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = panelId(p.id);
  if (!id) return null;
  switch (p.type) {
    case 'field': {
      const items = Array.isArray(p.items) ? p.items : [];
      return {
        id,
        type: 'field',
        season: season(p.season),
        rotation: ([0, 90, 180, 270] as const).find((r) => r === p.rotation) ?? 0,
        robotSize: typeof p.robotSize === 'number' && p.robotSize >= 0.2 && p.robotSize <= 3 ? p.robotSize : defaultRobotSize,
        trail: typeof p.trail === 'number' && p.trail >= 0 && p.trail <= 600 ? p.trail : 0,
        items: items
          .filter((item) => item && typeof item === 'object' && text((item as FieldItem).key))
          .slice(0, maxFieldItems)
          .map((item) => {
            const i = item as Record<string, unknown>;
            return {
              key: text(i.key),
              style: (['robot', 'path', 'points'] as const).find((s) => s === i.style) ?? 'robot',
              color: cleanColor(i.color),
              opacity: typeof i.opacity === 'number' && i.opacity >= 0 && i.opacity <= 1 ? i.opacity : 0.3
            };
          })
      };
    }
    case 'console':
      return { id, type: 'console', key: text(p.key), filter: text(p.filter, 200) };
    case 'pie':
      return {
        id,
        type: 'pie',
        mode: p.mode === 'states' ? 'states' : 'share',
        keys: (Array.isArray(p.keys) ? p.keys : []).map((k) => text(k)).filter(Boolean).slice(0, maxPieKeys)
      };
    case 'robot3d':
      return {
        id,
        type: 'robot3d',
        model: text(p.model, 200),
        poseKey: text(p.poseKey),
        componentsKey: text(p.componentsKey),
        season: season(p.season)
      };
    default:
      return null;
  }
}

export function cleanPanels(raw: unknown): PlotPanel[] {
  if (!Array.isArray(raw)) return [];
  const panels = raw.map(cleanPanel).filter((p): p is PlotPanel => p !== null);
  // Ids are unique: a repeat is left out.
  return panels.filter((p, i) => panels.findIndex((q) => q.id === p.id) === i).slice(0, maxPanels);
}

// A panel with each of its signals found another way (in another log, by
// a robot's mapping): a signal not found is left as it was.
export function mapPanelKeys(panel: PlotPanel, find: (key: string) => string | null): PlotPanel {
  const map = (key: string) => (key ? find(key) ?? key : key);
  switch (panel.type) {
    case 'field':
      return { ...panel, items: panel.items.map((item) => ({ ...item, key: map(item.key) })) };
    case 'console':
      return { ...panel, key: map(panel.key) };
    case 'pie':
      return { ...panel, keys: panel.keys.map(map) };
    case 'robot3d':
      return { ...panel, poseKey: map(panel.poseKey), componentsKey: map(panel.componentsKey) };
  }
}
