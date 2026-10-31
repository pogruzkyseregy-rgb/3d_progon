// Prepares web/ for packaging:
//  1. copies three.js (build + GLTFLoader/RoomEnvironment) into web/vendor, so the APK works offline
//  2. shrinks the model: ~1.7M triangles -> ~100k, textures 2048 -> 1024
// Run from the repo root after `npm install`:  npm run prepare-web

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'models', 'Silver_Fox_AvrorA_model.glb');
const tmpDir = path.join(root, 'build', 'tmp');
const simplified = path.join(tmpDir, 'simplified.glb');
const outModel = path.join(root, 'web', 'model', 'aurora.glb');
const gltfBin = path.join(root, 'node_modules', '.bin', 'gltf-transform');

// Tuning knobs for the phone build
const SIMPLIFY_RATIO = '0.06';   // keep 6% of triangles (~100k)
const SIMPLIFY_ERROR = '0.001';  // max allowed relative error
const TEXTURE_SIZE = '1024';

function run(args) {
  console.log(`> gltf-transform ${args.join(' ')}`);
  execFileSync(gltfBin, args, { stdio: 'inherit' });
}

if (!existsSync(src)) {
  console.error(`Model not found: ${src}\nPut Silver_Fox_AvrorA_model.glb into models/ first.`);
  process.exit(1);
}

// 1. three.js
const threeDir = path.join(root, 'node_modules', 'three');
const vendor = path.join(root, 'web', 'vendor', 'three');
rmSync(vendor, { recursive: true, force: true });
cpSync(path.join(threeDir, 'build'), path.join(vendor, 'build'), { recursive: true });
cpSync(path.join(threeDir, 'examples', 'jsm'), path.join(vendor, 'examples', 'jsm'), { recursive: true });
console.log('three.js copied to web/vendor/three');

// 2. model
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });
mkdirSync(path.dirname(outModel), { recursive: true });

run(['simplify', src, simplified, '--ratio', SIMPLIFY_RATIO, '--error', SIMPLIFY_ERROR]);
run(['resize', simplified, outModel, '--width', TEXTURE_SIZE, '--height', TEXTURE_SIZE]);

console.log(`model ready: ${outModel}`);

// 3. Mixamo files (optional): models/mixamo/*.fbx -> web/anim/
const mixamoDir = path.join(root, 'models', 'mixamo');
const animOut = path.join(root, 'web', 'anim');
rmSync(animOut, { recursive: true, force: true });
if (existsSync(mixamoDir)) {
  mkdirSync(animOut, { recursive: true });
  const fbx = readdirSync(mixamoDir).filter((f) => f.toLowerCase().endsWith('.fbx'));
  for (const f of fbx) cpSync(path.join(mixamoDir, f), path.join(animOut, f));
  console.log(`copied ${fbx.length} Mixamo file(s) to web/anim`);
}
