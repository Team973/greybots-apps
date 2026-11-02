<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  defaultRobotSize,
  isPoseListType,
  isSinglePoseType,
  modelFile,
  posesFrom,
  recordAt,
  type ModelRotation,
  type Pose,
  type Robot3dPanel,
  type RobotModel
} from '@shared/plots';
import type { SignalInfo } from '@shared/signals';
import { fieldFor, fieldImages } from '@/fields';
import { useRecords } from '@/panel-data';

// The robot in 3D (#144), where its pose says, with its moving parts where
// theirs say, on the field. Drag to turn the view, right-drag (or
// Shift+drag) to move it, scroll to zoom.

const props = defineProps<{
  panel: Robot3dPanel;
  session: string;
  signals: SignalInfo[];
  time: number;
  span: [number, number];
  dark: boolean;
  editing: boolean;
  models: RobotModel[];
}>();

const emit = defineEmits<{
  update: [panel: Robot3dPanel];
  addModel: [];
}>();

function update(change: Partial<Robot3dPanel>) {
  emit('update', { ...props.panel, ...change });
}

const labelOf = (signal: SignalInfo) => (signal.subsystem ? `${signal.subsystem} / ${signal.name}` : signal.name);
const poseSignals = computed(() => props.signals.filter((s) => !s.parent && s.count !== 0 && isSinglePoseType(s.type)));
const partSignals = computed(() => props.signals.filter((s) => !s.parent && s.count !== 0 && isPoseListType(s.type)));
const model = computed(() => props.models.find((m) => m.id === props.panel.model) ?? null);

// --- Reading ---

const keys = computed(() => [props.panel.poseKey, props.panel.componentsKey].filter(Boolean));
const readSpan = computed<[number, number]>(() => [Math.min(props.span[0], props.time), Math.max(props.span[1], props.time)]);
const { records, error } = useRecords(computed(() => props.session), keys, readSpan);

const robotPose = computed<Pose | null>(() => {
  const found = records.value.get(props.panel.poseKey);
  return found ? posesFrom(recordAt(found, props.time), found.type)[0] ?? null : null;
});
const partPoses = computed<Pose[]>(() => {
  const found = records.value.get(props.panel.componentsKey);
  return found ? posesFrom(recordAt(found, props.time), found.type) : [];
});

// --- The scene ---

const box = ref<HTMLElement | null>(null);
const height = 380;
const loadError = ref('');
const loading = ref(false);
const follow = ref(true);

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
// The robot, placed by its pose; its parts are inside it, each placed by its own.
const robot = new THREE.Group();
let parts: THREE.Group[] = [];
let floor: THREE.Object3D | null = null;
const lastTarget = new THREE.Vector3();
let frame = 0;

function render() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => renderer?.render(scene, camera));
}

// Rotations applied one after another, about the field's axes.
function rotationOf(rotations: ModelRotation[]): THREE.Quaternion {
  const q = new THREE.Quaternion();
  for (const r of rotations) {
    const axis = new THREE.Vector3(r.axis === 'x' ? 1 : 0, r.axis === 'y' ? 1 : 0, r.axis === 'z' ? 1 : 0);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, (r.degrees * Math.PI) / 180));
  }
  return q;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

function clearRobot() {
  for (const child of [...robot.children]) {
    robot.remove(child);
    disposeObject(child);
  }
  parts = [];
}

// A box the size of a robot, with a mark at the front, when there's no model.
function boxRobot() {
  const size = defaultRobotSize;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x2a78d6, transparent: true, opacity: 0.55 })
  );
  body.position.z = 0.12;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), new THREE.LineBasicMaterial({ color: 0x1b4f8f }));
  edges.position.copy(body.position);
  const front = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 16), new THREE.MeshStandardMaterial({ color: 0xeb6834 }));
  front.rotation.z = -Math.PI / 2;
  front.position.set(size / 2 - 0.12, 0, 0.26);
  robot.add(body, edges, front);
}

let modelRequest = 0;
async function loadModel() {
  const mine = ++modelRequest;
  clearRobot();
  loadError.value = '';
  const chosen = model.value;
  if (!chosen) {
    boxRobot();
    render();
    return;
  }
  loading.value = true;
  try {
    const loader = new GLTFLoader();
    const parse = async (file: string) => {
      const bytes = await window.diagnostics.readModelFile(chosen.id, file);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return (await loader.parseAsync(buffer, '')).scene;
    };
    const base = await parse(modelFile(null));
    const loaded: { index: number; scene: THREE.Group }[] = [];
    for (const [index] of chosen.config.components.entries()) {
      if (!chosen.files.includes(modelFile(index))) continue;
      loaded.push({ index, scene: await parse(modelFile(index)) });
    }
    if (mine !== modelRequest) return;
    clearRobot();
    base.quaternion.copy(rotationOf(chosen.config.rotations));
    base.position.set(...chosen.config.position);
    robot.add(base);
    for (const { index, scene: part } of loaded) {
      const component = chosen.config.components[index];
      part.quaternion.copy(rotationOf(component.zeroedRotations));
      part.position.set(...component.zeroedPosition);
      const holder = new THREE.Group();
      holder.add(part);
      robot.add(holder);
      parts[index] = holder;
    }
  } catch (e) {
    if (mine !== modelRequest) return;
    loadError.value = `The model couldn't be drawn: ${(e as Error).message}`;
    clearRobot();
    boxRobot();
  } finally {
    if (mine === modelRequest) loading.value = false;
  }
  placeRobot();
}

function setFloor() {
  if (floor) {
    scene.remove(floor);
    disposeObject(floor);
    floor = null;
  }
  if (!props.panel.season) {
    const grid = new THREE.GridHelper(20, 20, 0x888888, 0x555555);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(8.25, 4.1, 0);
    floor = grid;
    scene.add(grid);
    render();
    return;
  }
  const f = fieldFor(props.panel.season);
  new THREE.TextureLoader().load(f.image, (texture) => {
    if (!renderer || fieldFor(props.panel.season) !== f) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const image = texture.image as { width: number; height: number };
    // The whole image, sized so its field is the field's size, placed so the
    // field's corner is at 0, 0, and turned about the field's middle (fields.ts).
    const perX = (f.right - f.left) / f.length;
    const perY = (f.bottom - f.top) / f.width;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(image.width / perX, image.height / perY),
      new THREE.MeshBasicMaterial({ map: texture })
    );
    plane.position.set(f.length - (image.width / 2 - f.left) / perX, f.width - (f.bottom - image.height / 2) / perY, -0.001);
    plane.rotation.z = Math.PI;
    if (floor) {
      scene.remove(floor);
      disposeObject(floor);
    }
    floor = plane;
    scene.add(plane);
    render();
  });
}

function placeRobot() {
  const pose = robotPose.value;
  robot.visible = pose !== null;
  if (pose) {
    robot.position.set(pose.x, pose.y, pose.z);
    robot.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
  }
  for (const [i, holder] of parts.entries()) {
    const part = partPoses.value[i];
    if (!holder) continue;
    if (part) {
      holder.position.set(part.x, part.y, part.z);
      holder.quaternion.set(part.qx, part.qy, part.qz, part.qw);
    } else {
      holder.position.set(0, 0, 0);
      holder.quaternion.identity();
    }
  }
  // Following: the view moves with the robot, turned however it's been turned.
  if (pose && follow.value) {
    const target = new THREE.Vector3(pose.x, pose.y, pose.z + 0.3);
    camera.position.add(target.clone().sub(lastTarget));
    controls.target.copy(target);
    lastTarget.copy(target);
    controls.update();
  }
  render();
}

function resetView() {
  const pose = robotPose.value;
  const target = pose ? new THREE.Vector3(pose.x, pose.y, pose.z + 0.3) : new THREE.Vector3(8.25, 4.1, 0);
  controls.target.copy(target);
  lastTarget.copy(target);
  // Behind the robot's left shoulder, above it.
  camera.position.set(target.x - 3.2, target.y - 2.4, target.z + 2.2);
  controls.update();
  render();
}

function setBackground() {
  if (!scene) return;
  scene.background = new THREE.Color(props.dark ? 0x1e1e1e : 0xf2f2f2);
  render();
}

let observer: ResizeObserver | undefined;
onMounted(() => {
  if (!box.value) return;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch {
    loadError.value = "3D drawing (WebGL) isn't available on this computer.";
    return;
  }
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(box.value.clientWidth, height);
  box.value.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, box.value.clientWidth / height, 0.05, 200);
  // The field's way up: z.
  camera.up.set(0, 0, 1);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.addEventListener('change', render);
  // Moving the view by hand (right-drag) stops it following; turning it doesn't.
  controls.addEventListener('start', () => { panStart = controls.target.clone(); });
  controls.addEventListener('change', () => {
    if (panStart && controls.target.distanceTo(panStart) > 1e-3) follow.value = false;
  });
  controls.addEventListener('end', () => { panStart = null; });

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, -6, 10);
  scene.add(sun);
  scene.add(robot);

  setBackground();
  setFloor();
  void loadModel();
  resetView();

  observer = new ResizeObserver(() => {
    if (!renderer || !box.value) return;
    const width = box.value.clientWidth;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  });
  observer.observe(box.value);
});

let panStart: THREE.Vector3 | null = null;

onUnmounted(() => {
  observer?.disconnect();
  cancelAnimationFrame(frame);
  controls?.dispose();
  clearRobot();
  if (floor) disposeObject(floor);
  renderer?.dispose();
  renderer = null;
});

watch([robotPose, partPoses], placeRobot);
watch(() => props.panel.season, setFloor);
watch(() => props.dark, setBackground);
watch(() => [props.panel.model, model.value?.files.join()].join('|'), () => void loadModel());
watch(follow, (on) => {
  if (on) placeRobot();
});

const shownSeasons = fieldImages;

// The view as a picture, for copying.
defineExpose({ image: () => renderer?.domElement ?? null });
</script>

<template>
  <div class="robot3d-panel">
    <div v-if="editing" class="panel-settings">
      <label>
        <span class="hint small">Model</span>
        <span class="model-row">
          <select :value="panel.model" aria-label="Robot model" @change="update({ model: ($event.target as HTMLSelectElement).value })">
            <option value="">A box the size of a robot</option>
            <option v-if="panel.model && !model" :value="panel.model">{{ panel.model }} (not here)</option>
            <option v-for="m in models" :key="m.id" :value="m.id">{{ m.config.name }}</option>
          </select>
          <button class="small-button" title="Copy in a model's folder (AdvantageScope's: config.json, model.glb, model_0.glb, ...)"
            @click="emit('addModel')">Add a model…</button>
        </span>
      </label>
      <label>
        <span class="hint small">Floor</span>
        <select :value="panel.season" aria-label="Floor" @change="update({ season: ($event.target as HTMLSelectElement).value })">
          <option value="">A plain grid</option>
          <option v-for="f in shownSeasons" :key="f.season" :value="f.season">{{ f.season }} {{ f.game }}</option>
        </select>
      </label>
      <label>
        <span class="hint small">Moving parts (Pose3d[], robot-relative)</span>
        <select :value="panel.componentsKey" aria-label="Moving parts" @change="update({ componentsKey: ($event.target as HTMLSelectElement).value })">
          <option value="">None</option>
          <option v-for="s in partSignals" :key="s.key" :value="s.key">{{ labelOf(s) }}</option>
        </select>
      </label>
    </div>
    <div class="robot-tools">
      <select :value="panel.poseKey" aria-label="Robot pose" @change="update({ poseKey: ($event.target as HTMLSelectElement).value })">
        <option value="">{{ poseSignals.length ? 'Choose the robot’s pose…' : 'No Pose2d or Pose3d in this log' }}</option>
        <option v-if="panel.poseKey && !poseSignals.some((s) => s.key === panel.poseKey)" :value="panel.poseKey">{{ panel.poseKey }} (not here)</option>
        <option v-for="s in poseSignals" :key="s.key" :value="s.key">{{ labelOf(s) }} ({{ s.type.replace(/^struct:/, '') }})</option>
      </select>
      <button class="chip" :aria-pressed="follow" title="Keep the robot in the middle of the view" @click="follow = !follow">Follow</button>
      <button class="small-button" @click="resetView">Reset view</button>
    </div>
    <div ref="box" class="scene" :style="{ height: `${height}px` }"></div>
    <p v-if="loading" class="hint small">Loading the model…</p>
    <p v-if="panel.poseKey && !robotPose && !loading" class="hint small">No pose at this moment.</p>
    <p v-if="loadError" class="error-text small">{{ loadError }}</p>
    <p v-if="error" class="error-text small">{{ error }}</p>
    <p class="hint small">Drag to turn the view, right-drag to move it, scroll to zoom.</p>
  </div>
</template>

<style scoped>
.robot3d-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.robot-tools,
.model-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.robot-tools select {
  flex: 1;
  min-width: 0;
}

.scene {
  width: 100%;
  overflow: hidden;
  border-radius: 6px;
}

.scene :deep(canvas) {
  display: block;
}
</style>
