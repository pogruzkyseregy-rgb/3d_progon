import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/examples/jsm/environments/RoomEnvironment.js';
import { applyAction, moodOf, parseState, tick, STAT_KEYS } from './js/state.js';

const SAVE_KEY = 'aurora-tamagotchi-v1';
const DANCE_MS = 12000;
const BPM = 120;

// ---------- DOM ----------
const canvas = document.getElementById('scene');
const bubble = document.getElementById('bubble');
const moodEl = document.getElementById('mood');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

// ---------- Save (per device, try/catch because WebView can refuse storage) ----------
function readSave() {
  try {
    return localStorage.getItem(SAVE_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeSave() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: game still works, progress just isn't kept */
  }
}

const hadSave = readSave() !== '';
let state = parseState(readSave(), Date.now());

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0b1f);

// The model is metallic, so without an environment map it would look black.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
camera.position.set(0, 1.2, 5);
camera.lookAt(0, 0.95, 0);

const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(2, 4, 3);
scene.add(key);
const rim = new THREE.DirectionalLight(0x6fd6ff, 1.2);
rim.position.set(-3, 2, -3);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xffffff, 0x222244, 0.4));

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(0.9, 48),
  new THREE.MeshBasicMaterial({ color: 0x3a1f6b, transparent: true, opacity: 0.5 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.01;
scene.add(floor);

// pivot is the single transform we animate; its origin is at the feet
const pivot = new THREE.Group();
scene.add(pivot);

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Model ----------
let model = null;
new GLTFLoader().load(
  'model/aurora.glb',
  (gltf) => {
    model = gltf.scene;
    // Normalise: about 1.8 units tall, feet on y=0, centred on X/Z
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const k = 1.8 / size.y;
    model.scale.setScalar(k);
    model.position.set(-center.x * k, -box.min.y * k, -center.z * k);
    pivot.add(model);
    loadingEl.hidden = true;
    if (!hadSave) say('Привет! Я Аврора');
  },
  (xhr) => {
    if (xhr.total) loadingText.textContent = `Загрузка ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
  },
  (err) => {
    console.error(err);
    loadingText.textContent = 'Не удалось загрузить модель';
  },
);

// ---------- Bubble & HUD ----------
let sayTimer = 0;
function say(text) {
  if (!text) return;
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => bubble.classList.remove('show'), 2500);
}

function refreshHud() {
  for (const k of STAT_KEYS) {
    const el = document.querySelector(`[data-stat="${k}"] i`);
    if (el) el.style.width = `${Math.round(state[k])}%`;
  }
  const m = moodOf(state);
  moodEl.textContent = m.text;
  for (const btn of document.querySelectorAll('[data-action]')) {
    btn.classList.toggle('active', btn.dataset.action === 'sleep' && state.sleeping);
  }
}

// ---------- Actions ----------
let danceUntil = 0;

function doAction(name, { quiet = false } = {}) {
  const r = applyAction(state, name, Date.now());
  state = r.state;
  writeSave();
  if (!quiet) say(r.msg);
  if (name === 'dance' && r.ok) danceUntil = performance.now() + DANCE_MS;
  refreshHud();
}

for (const btn of document.querySelectorAll('[data-action]')) {
  btn.addEventListener('click', () => doAction(btn.dataset.action));
}

// ---------- Touch: stroke = pet, tap = poke ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let lookTarget = 0;
let squash = 0; // 0..1 bounce after a touch

function setNdc(e) {
  const r = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}
function overModel() {
  if (!model) return false;
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObject(model, true).length > 0;
}

let press = null;
canvas.addEventListener('pointerdown', (e) => {
  setNdc(e);
  press = {
    lastX: e.clientX,
    lastY: e.clientY,
    moved: 0,
    strokeAcc: 0,
    lastPetAt: 0,
    onModel: overModel(),
  };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  setNdc(e);
  lookTarget = THREE.MathUtils.clamp(ndc.x, -1, 1) * 0.35;
  if (!press) return;
  const dist = Math.hypot(e.clientX - press.lastX, e.clientY - press.lastY);
  press.lastX = e.clientX;
  press.lastY = e.clientY;
  press.moved += dist;
  if (press.onModel && dist > 0 && overModel()) {
    press.strokeAcc += dist;
    const now = performance.now();
    if (press.strokeAcc > 120 && now - press.lastPetAt > 350) {
      press.strokeAcc = 0;
      press.lastPetAt = now;
      squash = 1;
      doAction('pet', { quiet: true });
    }
  }
});

function endPress() {
  if (!press) return;
  if (press.onModel && press.moved < 12) poke();
  press = null;
}
canvas.addEventListener('pointerup', endPress);
canvas.addEventListener('pointercancel', endPress);

const POKE_LINES = ['Хихи!', 'Щекотно!', 'Эй!', 'Мур~'];
function poke() {
  squash = 1;
  if (state.sleeping) {
    say('Тсс…');
    return;
  }
  say(POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)]);
}

// ---------- Animation loop ----------
const lerp = (a, b, k) => a + (b - a) * Math.min(1, k);
let sleepBlend = 0;
let danceBlend = 0;
let yaw = 0;
const t0 = performance.now();
let last = t0;
let lastTickAt = t0;
let lastSaveAt = t0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = (now - t0) / 1000;

  if (now - lastTickAt > 1000) {
    state = tick(state, Date.now());
    lastTickAt = now;
    refreshHud();
  }
  if (now - lastSaveAt > 5000) {
    writeSave();
    lastSaveAt = now;
  }

  sleepBlend = lerp(sleepBlend, state.sleeping ? 1 : 0, dt * 2);
  const dancing = now < danceUntil;
  danceBlend = lerp(danceBlend, dancing ? 1 : 0, dt * 4);
  squash = Math.max(0, squash - dt * 4);
  yaw = lerp(yaw, lookTarget, dt * 3);

  // Idle: slow breathing and a gentle sway. Sleep slows the breathing and leans her forward.
  const breath = Math.sin(t * lerp(2.2, 1.3, sleepBlend)) * 0.012;
  const sway = Math.sin(t * 1.1) * 0.04;
  // Dance: bounce and turn on the beat
  const beatPhase = t * (BPM / 60) * Math.PI * 2;
  const beat = Math.sin(beatPhase);
  const bounce = Math.abs(beat) * 0.06 * danceBlend;

  pivot.position.y = bounce - 0.04 * sleepBlend;
  pivot.rotation.x = 0.12 * sleepBlend;
  pivot.rotation.y = yaw * (1 - danceBlend) + beat * 0.35 * danceBlend + sway * 0.3;
  pivot.rotation.z = sway * 0.3 * (1 - sleepBlend);

  const s = 1 + squash * 0.06;
  pivot.scale.set(s * (1 - breath * 0.5), s * (1 + breath + squash * 0.03), s * (1 - breath * 0.5));

  key.intensity = lerp(key.intensity, state.sleeping ? 0.35 : 1.4, dt * 2);
  rim.color.setHSL(danceBlend > 0.01 ? (t * 0.12) % 1 : 0.52, 0.9, 0.65);

  renderer.render(scene, camera);
}

// Save when the app goes to background, so progress is not lost
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') writeSave();
});

refreshHud();
requestAnimationFrame((now) => {
  last = now;
  lastTickAt = now;
  lastSaveAt = now;
  frame(now);
});
