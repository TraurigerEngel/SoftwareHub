'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('web/styles.css');
// Scope this regression to Preview 2's own rules; later visual previews are allowed to add effects.
const preview2 = css.split('/* Visual Preview 2 — Ambient Glass Background')[1]?.split('/* Visual Preview 3 — Family Style Alignment')[0];

test('Visual Preview 2 is a CSS-only layered atmospheric background', () => {
  assert.ok(preview2);
  assert.match(preview2, /\.app-shell::before\s*\{/);
  assert.match(preview2, /\.app-shell::after\s*\{/);
  assert.match(preview2, /pointer-events:\s*none;/);
  assert.match(preview2, /radial-gradient/);
  assert.match(preview2, /#000;/);
  assert.doesNotMatch(preview2, /@keyframes|animation:|backdrop-filter:/);
});

test('Visual Preview 2 keeps cards and controls translucent with a readable filter dropdown', () => {
  assert.match(preview2, /\.card\s*\{[\s\S]*?linear-gradient\(162deg, rgba\(27, 26, 29, \.73\), rgba\(11, 11, 13, \.66\)\)/);
  assert.match(preview2, /\.search-box,\s*\.filter-button\s*\{[\s\S]*?rgba\(25, 23, 26, \.62\)/);
  assert.match(preview2, /\.program-filter-popover\s*\{\s*background: rgba\(18, 17, 19, \.95\)/);
  assert.match(preview2, /\.app-shell > \.toolbar\s*\{ position: relative; z-index: 3; \}/);
  assert.match(preview2, /@media \(prefers-contrast: more\)/);
});

test('Visual Preview 2 preserves catalog, native window, release flow and approved splash timing', () => {
  assert.equal(JSON.parse(read('data/programs.json')).length, 126);
  assert.match(css, /transition: opacity 200ms ease-in-out 1000ms;/);
  assert.match(css, /transition: opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms;/);
  assert.doesNotMatch(preview2, /startup-(?:screen|panel)|data-startup/);
  assert.match(read('MAKE-RELEASE.cmd'), /publish:release/);
  assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).app.windows[0].visible, true);
});
