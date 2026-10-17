'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../web/particles.js'), 'utf8');

// Use identical deterministic particles and frame times to exercise a wrap
// from the right edge to the left edge without waiting for random movement.
function measureStrokes(code) {
  const lengths = [];
  let cursor = null;
  let segments = [];
  const ctx = {
    setTransform() {}, clearRect() {},
    beginPath() { cursor = null; segments = []; },
    moveTo(x, y) { cursor = [x, y]; },
    lineTo(x, y) {
      if (cursor) segments.push(Math.hypot(x - cursor[0], y - cursor[1]));
      cursor = [x, y];
    },
    stroke() { lengths.push(...segments); },
    arc() {}, ellipse() {}, fill() {}, closePath() {}
  };
  const canvas = {
    width: 0, height: 0,
    getBoundingClientRect() { return { width: 1280, height: 760 }; },
    getContext() { return ctx; }
  };
  const callbacks = [];
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => .999;
  const document = {
    hidden: false,
    documentElement: { dataset: { startup: 'ready' } },
    getElementById(id) { return id === 'shubParticleField' ? canvas : null; },
    addEventListener() {}
  };
  const window = {
    devicePixelRatio: 1,
    matchMedia() { return { matches: false, addEventListener() {} }; },
    requestAnimationFrame(fn) { callbacks.push(fn); return callbacks.length; },
    cancelAnimationFrame() {}, addEventListener() {}
  };
  const env = {
    Math: deterministicMath, document, window,
    performance: { now() { return 0; } },
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    MutationObserver: class {}
  };
  vm.runInNewContext(code, env, { filename: 'particles.js', timeout: 2000 });
  for (let tick = 1; tick <= 50; tick++) {
    const callback = callbacks.shift();
    assert.ok(callback, `frame ${tick} must be scheduled`);
    callback(tick * 40);
  }
  return lengths;
}

test('edge wrap cannot draw full-screen particle trails, while local streaks remain', () => {
  assert.match(source, /let wrapped=false;/);
  assert.match(source, /if\(p\.fast&&r>1\.05&&!wrapped\)/);

  // Prove the simulated motion actually crosses the edge and reproduces the
  // old full-screen line when the guard is intentionally removed.
  const unguarded = measureStrokes(source.replace('&&r>1.05&&!wrapped', '&&r>1.05'));
  assert.ok(unguarded.some(length => length > 1200), 'test must exercise a real screen-edge wrap');

  const guarded = measureStrokes(source);
  assert.ok(guarded.some(length => length > .5 && length < 30), 'normal short streaks must remain');
  assert.ok(guarded.every(length => length < 100), 'no stroke may span the canvas on an edge wrap');
});
