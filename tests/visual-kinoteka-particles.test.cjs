'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const html = read('web/index.html');
const css = read('web/styles.css');
const particleCode = read('web/particles.js');

function simulate({ reducedMotion = false, highContrast = false } = {}) {
  const handlers = {};
  let mutation;
  let observerDisconnected = false;
  const frames = new Map();
  let nextId = 1;
  const calls = { draw: 0, cancels: 0, resizes: 0, arcs: 0, ellipses: 0, strokes: 0 };
  const ctx = {
    setTransform() { calls.resizes++; }, clearRect() { calls.draw++; },
    beginPath() {}, arc() { calls.arcs++; }, ellipse() { calls.ellipses++; },
    fill() {}, stroke() { calls.strokes++; }, moveTo() {}, lineTo() {}, closePath() {}
  };
  const canvas = {
    width: 0, height: 0,
    getContext() { return ctx; },
    getBoundingClientRect() { return { width: 1280, height: 760 }; }
  };
  const document = {
    hidden: false,
    documentElement: { dataset: { startup: 'loading' } },
    getElementById(id) { return id === 'shubParticleField' ? canvas : null; },
    addEventListener(name, callback) { handlers[name] = callback; }
  };
  const queries = {
    '(prefers-reduced-motion: reduce)': { matches: reducedMotion, addEventListener(name, callback) { handlers.motion = callback; } },
    '(prefers-contrast: more)': { matches: highContrast, addEventListener(name, callback) { handlers.contrast = callback; } }
  };
  const window = {
    devicePixelRatio: 2,
    matchMedia(name) { return queries[name]; },
    requestAnimationFrame(callback) { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { if (frames.delete(id)) calls.cancels++; },
    addEventListener(name, callback) { handlers[name] = callback; }
  };
  const sandbox = {
    document, window, performance: { now() { return 100; } },
    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame,
    MutationObserver: class {
      constructor(callback) { mutation = callback; }
      observe() {}
      disconnect() { observerDisconnected = true; }
    },
    Math, Array, Number, String, Boolean, Object
  };
  vm.runInNewContext(particleCode, sandbox, { filename: 'particles.js' });
  return {
    document, window, canvas, calls, frames, queries, handlers,
    ready() { document.documentElement.dataset.startup = 'ready'; mutation?.(); },
    runFrame(time = 1000) {
      const [id, callback] = frames.entries().next().value || [];
      if (id === undefined) return false;
      frames.delete(id);
      callback(time);
      return true;
    },
    get disconnected() { return observerDisconnected; }
  };
}

test('Kinoteka field is passive and positioned beneath a five-column catalog', () => {
  assert.match(html, /<canvas id="shubParticleField" class="shub-particle-field" aria-hidden="true"><\/canvas>/);
  assert.ok(html.indexOf('id="shubParticleField"') < html.indexOf('class="topbar"'));
  assert.ok(html.indexOf('./renderer.js') < html.indexOf('./particles.js'));
  assert.match(css.slice(css.indexOf("Visual Preview 5")), /\.shub-particle-field\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*42px 0 0;[^}]*z-index:\s*0;[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.app-shell > \.grid,[\s\S]*?z-index:\s*1;/);
  assert.match(css, /\.app-shell > \.toolbar\s*\{\s*position:\s*relative;\s*z-index:\s*3;/);
  assert.match(css, /\.app-shell::before,\s*\.app-shell::after\s*\{[^}]*display:\s*none;/);
  assert.match(css.slice(css.indexOf("Visual Preview 5")), /\.card\s*\{[^}]*rgba\(15,16,18,\.68\)/);
  assert.doesNotMatch(css.slice(css.indexOf('Visual Preview 4')), /backdrop-filter:\s*blur/);
});

test('particles initialize only after startup is ready and remain bounded', () => {
  const sim = simulate();
  assert.equal(sim.frames.size, 0, 'no background work during the loading screen');
  sim.ready();
  assert.equal(sim.disconnected, true);
  assert.equal(sim.canvas.width, Math.ceil(1280 * 1.5));
  assert.equal(sim.frames.size, 1);
  assert.ok(sim.runFrame(1000));
  assert.equal(sim.calls.draw, 2); // Kinoteka clears the canvas during initial resize, then paints
  assert.equal(sim.frames.size, 1, 'animation schedules one successor only');
  assert.match(particleCode, /const MAX_FPS=90;/);
  assert.match(particleCode, /const HUE_CYCLE_SECONDS=72;/);
  assert.match(particleCode, /Math\.min\(1680,Math\.max\(1220,/);
  assert.match(particleCode, /Math\.min\(520,Math\.max\(330,/);
  assert.match(particleCode, /Math\.min\(34,Math\.max\(18,/);
  assert.ok(sim.calls.ellipses >= 330, 'original Kinoteka star distribution is painted');
  assert.ok(sim.calls.arcs + sim.calls.ellipses > 1200, 'original Kinoteka dense particle distribution is painted');
});

test('background animation pauses when window is hidden and resumes when visible', () => {
  const sim = simulate();
  sim.ready();
  sim.runFrame(1000);
  sim.document.hidden = true;
  sim.handlers.visibilitychange();
  assert.equal(sim.frames.size, 0);
  sim.document.hidden = false;
  sim.handlers.visibilitychange();
  assert.equal(sim.frames.size, 1);
});

test('reduced motion renders once without an animation loop, and high contrast renders nothing', () => {
  const reduced = simulate({ reducedMotion: true });
  reduced.ready();
  reduced.runFrame(1000);
  assert.equal(reduced.calls.draw, 2); // initial clear + one static draw
  assert.equal(reduced.frames.size, 0);
  const contrast = simulate({ highContrast: true });
  contrast.ready();
  assert.equal(contrast.frames.size, 0);
  assert.equal(contrast.calls.draw, 1, "initial canvas clear occurs but no draw frame is scheduled");
  assert.match(css, /@media \(prefers-contrast: more\)[\s\S]*?\.shub-particle-field\s*\{\s*display:\s*none;/);
});

test('previously approved startup timing, catalog and release build remain untouched', () => {
  const baseline = path.join(root, 'tests', 'startup-paint.test.cjs');
  assert.ok(fs.existsSync(baseline));
  assert.match(css, /transition:\s*opacity 200ms ease-in-out 1000ms;/);
  assert.match(css, /transition:\s*opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms;/);
  const catalog = JSON.parse(read('data/programs.json'));
  assert.equal(catalog.length, 126);
});


test('Visual Preview 5 keeps exact Kinoteka Stable hue, speed and shape parameters', () => {
  const source = particleCode;
  for (const expected of [
    'const HUE_SPEED=360/HUE_CYCLE_SECONDS;',
    'const RGB_WHEEL=Array.from({length:360}',
    'const clustered=Math.round(count*.54)',
    'const depth=Math.random(),fast=depth>.865;',
    'shape:(()=>{const r=Math.random();return r<.06?',
    "Math.pow(Math.random(),1.75)*c[2]",
    'pulse=.72+.28*Math.sin(t*p.twinkle+p.phase)',
    'if(p.fast&&r>1.05&&!wrapped)',
    'function spawnGlint()',
    'const MAX_FPS=90;'
  ]) assert.ok(source.includes(expected), `Kinoteka source parameter missing: ${expected}`);
  assert.ok(!source.includes('const FPS = 30;'), 'Preview 4 downgraded particle simulation must be gone');
});

test('same Kinoteka viewport layer remains click-through, with approved controls above canvas', () => {
  const vp5 = css.slice(css.indexOf('Visual Preview 5'));
  assert.match(vp5, /\.shub-particle-field\s*\{[^}]*position:\s*fixed;/);
  assert.match(vp5, /pointer-events:\s*none;/);
  assert.match(vp5, /mix-blend-mode:\s*normal;/);
  assert.match(vp5, /height:\s*calc\(100vh - 42px\);/);
  assert.match(css, /\.app-shell > \.toolbar\s*\{ position: relative; z-index: 3; \}/);
});
