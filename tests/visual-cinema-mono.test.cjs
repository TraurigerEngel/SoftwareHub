'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = p => fs.readFileSync(path.join(root,p), 'utf8');
const css = source('web/styles.css');
const baseline = source('web/renderer.js');
const catalog = JSON.parse(source('data/programs.json'));

const preview = css.slice(css.indexOf('/* Visual Preview 1 — Cinema Mono foundation'));

test('Cinema Mono is a CSS-only theme with true black and gold-first interactions', () => {
  assert.match(preview, /--bg:\s*#000000;/);
  assert.match(preview, /--accent:\s*#deb06a;/);
  assert.match(preview, /--accent-rgb:\s*222, 176, 106;/);
  assert.match(preview, /\.card\s*\{/);
  assert.match(preview, /\.program-filter-popover\s*\{/);
  assert.match(preview, /\.action\.primary\s*\{/);
  assert.match(preview, /\.badge\.site-category\s*\{/);
});

test('Cinema Mono preview retains the approved startup transition timings unchanged', () => {
  assert.match(css, /transition:\s*opacity 200ms ease-in-out 1000ms;/);
  assert.match(css, /transition:\s*opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms;/);
  assert.doesNotMatch(preview, /data-startup|startup-screen|startup-panel/);
});

test('Cinema Mono preview retains catalog and renderer functional contracts', () => {
  assert.equal(catalog.length, 126);
  assert.match(baseline, /requestAnimationFrame/);
  assert.equal(JSON.parse(source('src-tauri/tauri.conf.json')).app.windows[0].title, 'Software Hub');
});
