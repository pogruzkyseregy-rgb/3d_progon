import * as THREE from 'three';
import { GLTFLoader } from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from './vendor/three/examples/jsm/loaders/FBXLoader.js';
import { RoomEnvironment } from './vendor/three/examples/jsm/environments/RoomEnvironment.js';
import { applyAction, moodOf, parseState, tick, STAT_KEYS } from './js/state.js';

const SAVE_KEY = 'aurora-tamagotchi-v1';
const DANCE_MS = 12000;
const HAPPY_MS = 2500;
const BPM = 120;
const WALK_SPEED = 0.35; // world units per second
const WALK_RADIUS = 0.6;

// Rigged character from Mixamo (optional). If missing, the static model is used.
const RIGGED_FILE = 'anim/character.fbx';
// Mixamo animation clips (optional). A missing file just disables that motion.
const CLIP_FILES = {
  idle: 'anim/idle.fbx',
  walk: 'anim/walk.fbx',
  sit: 'anim/sit.fbx',
  happy: 'anim/happy.fbx',
  dance: 'anim/dance.fbx',
  sleep: 'anim/sleep.fbx',
  jump: 'anim/jump.fbx',
};

// ---------- DOM ----------
const canvas = document.getElementById('scene');
const bubble = document.getElementById('bubble');
const moodEl = document.getElementById('mood');
const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const heartsEl = document.getElementById('hearts');

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

// root: where she stands and which way she faces (wandering moves this)
// pivot: procedural breathing, sway, bounce; its origin is at the feet
const root = new THREE.Group();
const pivot = new THREE.Group();
root.add(pivot);
scene.add(root);

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

// ---------- Model & clips ----------
let model = null;
let mixer = null;
const actions = {};
let current = null;   // name of the clip now playing
let oneShot = false;  // a one-time clip (jump) is playing; ignore the state-driven choice

const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();

function placeModel(obj, rigged) {
  model = obj;
  // Normalise: about 1.8 units tall, feet on y=0, centred on X/Z
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const k = 1.8 / size.y;
  model.scale.setScalar(k);
  model.position.set(-center.x * k, -box.min.y * k, -center.z * k);
  pivot.add(model);
  if (rigged) {
    mixer = new THREE.AnimationMixer(model);
    mixer.addEventListener('finished', onClipFinished);
  }
}

function onClipFinished(e) {
  if (e.action === actions.jump) {
    actions.jump.fadeOut(0.3);
    oneShot = false;
    current = null;
  }
}

async function loadClips() {
  const entries = Object.entries(CLIP_FILES);
  const results = await Promise.all(entries.map(([, file]) => fbxLoader.loadAsync(file).catch(() => null)));
  entries.forEach(([name], i) => {
    const clip = results[i]?.animations?.[0];
    if (clip) actions[name] = mixer.clipAction(clip);
  });
}

function playAnim(name, once = false) {
  const action = actions[name];
  if (!action) return;
  const prev = current ? actions[current] : null;
  if (prev && prev !== action) prev.fadeOut(0.3);
  action.reset();
  action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  action.clampWhenFinished = once;
  action.fadeIn(0.3).play();
  current = name;
  oneShot = once;
}

function desiredAnim(now) {
  if (state.sleeping) return 'sleep';
  if (now < danceUntil) return 'dance';
  if (now < happyUntil) return 'happy';
  if (sitting) return 'sit';
  if (walking) return 'walk';
  return 'idle';
}

async function init() {
  let rigged = false;
  try {
    let obj = await fbxLoader.loadAsync(RIGGED_FILE).catch(() => null);
    if (obj) {
      rigged = true;
    } else {
      obj = (await gltfLoader.loadAsync('model/aurora.glb')).scene;
    }
    placeModel(obj, rigged);
  } catch (err) {
    console.error(err);
    loadingText.textContent = 'Не удалось загрузить модель';
    return;
  }
  loadingEl.hidden = true;
  if (!hadSave) say('Привет! Я Аврора');
  if (mixer) await loadClips();
}

// ---------- Bubble, hearts & HUD ----------
let sayTimer = 0;
function say(text) {
  if (!text) return;
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => bubble.classList.remove('show'), 2500);
}

let lastHeartAt = 0;
function spawnHeart() {
  const now = performance.now();
  if (now - lastHeartAt < 600) return;
  lastHeartAt = now;
  const el = document.createElement('span');
  el.className = 'heart';
  el.textContent = ['💖', '💕', '💗'][Math.floor(Math.random() * 3)];
  el.style.left = `${40 + Math.random() * 20}%`;
  el.style.setProperty('--dx', `${(Math.random() - 0.5) * 80}px`);
  heartsEl.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

function refreshHud() {
  for (const k of STAT_KEYS) {
    const el = document.querySelector(`[data-stat="${k}"] i`);
    if (el) el.style.width = `${Math.round(state[k])}%`;
  }
  moodEl.textContent = moodOf(state).text;
  for (const btn of document.querySelectorAll('[data-action]')) {
    const a = btn.dataset.action;
    btn.classList.toggle('active', (a === 'sleep' && state.sleeping) || (a === 'sit' && sitting));
  }
}

// ---------- Actions ----------
let danceUntil = 0;
let happyUntil = 0;
let sitting = false;

function doAction(name, { quiet = false } = {}) {
  const now = performance.now();
  const r = applyAction(state, name, Date.now());
  state = r.state;
  writeSave();
  if (!quiet) say(r.msg);
  if (name === 'dance' && r.ok) {
    danceUntil = now + DANCE_MS;
    sitting = false;
  }
  if (name === 'play' && r.ok) triggerJump();
  if (name === 'pet' && r.ok) {
    happyUntil = now + HAPPY_MS;
    spawnHeart();
  }
  if (name === 'sleep') sitting = false;
  refreshHud();
  return r;
}

function toggleSit() {
  if (state.sleeping) {
    say('Сначала проснись');
    return;
  }
  sitting = !sitting;
  walkTarget = null;
  say(sitting ? 'Сижу, смотрю на тебя' : 'Встаю!');
  refreshHud();
}

function triggerJump() {
  squash = 1;
  if (mixer && actions.jump) playAnim('jump', true);
}

for (const btn of document.querySelectorAll('[data-action]')) {
  btn.addEventListener('click', () => {
    if (btn.dataset.action === 'sit') toggleSit();
    else doAction(btn.dataset.action);
  });
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
  if (state.sleeping) {
    squash = 1;
    say('Тсс…');
    return;
  }
  triggerJump();
  say(POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)]);
}

// ---------- Wandering on the floor ----------
let walking = false;
let walkTarget = null;
let nextWalkAt = 0;

function lerpAngle(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

function updateWander(now, dt) {
  const busy = state.sleeping || now < danceUntil || sitting || oneShot;
  if (busy) {
    walkTarget = null;
    walking = false;
  }
  if (!walkTarget) {
    walking = false;
    if (!busy && now > nextWalkAt) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * WALK_RADIUS;
      walkTarget = { x: Math.cos(a) * r, z: Math.sin(a) * r };
    }
    root.rotation.y = lerpAngle(root.rotation.y, 0, dt * 3);
    return;
  }
  const dx = walkTarget.x - root.position.x;
  const dz = walkTarget.z - root.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.02) {
    walkTarget = null;
    nextWalkAt = now + 4000 + Math.random() * 6000;
    return;
  }
  walking = true;
  const step = Math.min(d, WALK_SPEED * dt);
  root.position.x += (dx / d) * step;
  root.position.z += (dz / d) * step;
  root.rotation.y = lerpAngle(root.rotation.y, Math.atan2(dx, dz), dt * 6);
}

// ---------- Animation loop ----------
const lerp = (a, b, k) => a + (b - a) * Math.min(1, k);
let sleepBlend = 0;
let danceBlend = 0;
let walkBlend = 0;
let sitBlend = 0;
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
  danceBlend = lerp(danceBlend, now < danceUntil ? 1 : 0, dt * 4);
  walkBlend = lerp(walkBlend, walking ? 1 : 0, dt * 6);
  sitBlend = lerp(sitBlend, sitting ? 1 : 0, dt * 4);
  squash = Math.max(0, squash - dt * 4);
  yaw = lerp(yaw, lookTarget, dt * 3);

  updateWander(now, dt);

  // Clips drive the pose when they exist; the state picks which one plays
  if (mixer) {
    if (!oneShot) {
      const want = desiredAnim(now);
      if (want !== current) playAnim(want);
    }
    mixer.update(dt);
  }

  // Procedural motion: full strength without clips, softer on top of them
  const soft = actions.idle ? 0.4 : 1;
  const danceK = actions.dance ? 0.3 : 1;
  const breath = Math.sin(t * lerp(2.2, 1.3, sleepBlend)) * 0.012 * soft;
  const sway = Math.sin(t * 1.1) * 0.04 * soft;
  const beat = Math.sin(t * (BPM / 60) * Math.PI * 2);
  const bounce =
    Math.abs(beat) * 0.06 * danceBlend * danceK + Math.abs(Math.sin(t * 6)) * 0.03 * walkBlend;

  pivot.position.y = bounce - 0.04 * sleepBlend - 0.22 * sitBlend;
  pivot.rotation.x = 0.12 * sleepBlend * (actions.sleep ? 0.3 : 1);
  pivot.rotation.y = yaw * (1 - danceBlend) + beat * 0.35 * danceBlend * danceK + sway * 0.3;
  pivot.rotation.z = sway * 0.3 * (1 - sleepBlend);

  const s = 1 + squash * 0.06;
  pivot.scale.set(
    s * (1 - breath * 0.5),
    s * (1 + breath + squash * 0.03) * (1 - 0.08 * sitBlend),
    s * (1 - breath * 0.5),
  );

  key.intensity = lerp(key.intensity, state.sleeping ? 0.35 : 1.4, dt * 2);
  rim.color.setHSL(danceBlend > 0.01 ? (t * 0.12) % 1 : 0.52, 0.9, 0.65);

  renderer.render(scene, camera);
}

// Save when the app goes to background, so progress is not lost
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') writeSave();
});

refreshHud();
nextWalkAt = performance.now() + 5000;
init();
requestAnimationFrame((now) => {
  last = now;
  lastTickAt = now;
  lastSaveAt = now;
  frame(now);
});
