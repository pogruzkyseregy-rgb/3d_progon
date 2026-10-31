import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, tick, applyAction, moodOf, parseState } from '../web/js/state.js';

const MIN = 60000;

test('stats fall while awake', () => {
  const s0 = createState(0);
  const s1 = tick(s0, 10 * MIN);
  assert.ok(s1.fullness < s0.fullness);
  assert.ok(s1.energy < s0.energy);
  assert.ok(s1.mood < s0.mood);
});

test('sleep restores energy and wakes up at 100', () => {
  let s = applyAction(createState(0), 'sleep', 0).state;
  assert.equal(s.sleeping, true);
  s = tick(s, 60 * MIN);
  assert.equal(s.energy, 100);
  assert.equal(s.sleeping, false);
});

test('cannot wake up too early', () => {
  let s = createState(0);
  s.sleeping = true;
  s.energy = 20;
  const r = applyAction(s, 'sleep', 0);
  assert.equal(r.state.sleeping, true);
  assert.equal(r.ok, false);
});

test('feeding raises fullness', () => {
  const s = createState(0);
  s.fullness = 50;
  const r = applyAction(s, 'fish', 0);
  assert.equal(r.ok, true);
  assert.equal(r.state.fullness, 80);
});

test('feeding is refused when already full', () => {
  const s = createState(0);
  s.fullness = 95;
  const r = applyAction(s, 'fish', 0);
  assert.equal(r.ok, false);
  assert.equal(r.state.fullness, 95);
});

test('play is refused without energy', () => {
  const s = createState(0);
  s.energy = 10;
  const r = applyAction(s, 'play', 0);
  assert.equal(r.ok, false);
  assert.equal(r.state.mood, s.mood);
});

test('no actions while sleeping except waking up', () => {
  const s = createState(0);
  s.sleeping = true;
  const pet = applyAction(s, 'pet', 0);
  assert.equal(pet.ok, false);
  assert.equal(pet.state.affection, s.affection);
});

test('offline catch-up is capped and never negative', () => {
  const s = tick(createState(0), 10000 * MIN);
  for (const k of ['fullness', 'mood', 'energy', 'affection']) {
    assert.ok(s[k] >= 0 && s[k] <= 100, k);
  }
  assert.equal(s.fullness, 0);
});

test('moodOf reports hunger', () => {
  const s = createState(0);
  s.fullness = 10;
  assert.equal(moodOf(s).id, 'hungry');
});

test('parseState survives garbage and keeps valid numbers', () => {
  assert.equal(parseState('{not json', 0).fullness, 80);
  assert.equal(parseState('null', 0).fullness, 80);
  const raw = JSON.stringify({ fullness: 42, mood: 50, energy: 60, affection: 10, sleeping: false, lastUpdate: 0 });
  const s = parseState(raw, 0);
  assert.equal(s.fullness, 42);
  assert.equal(s.affection, 10);
});
