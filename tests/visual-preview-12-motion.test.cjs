'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('web/index.html');
const motion = read('web/visual-preview-12.css');
const original = read('web/styles.css');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));

test('VP12 startup CSS is the final layered override and no Stable rules are removed', () => {
  assert.match(html, /visual-preview-11\.css">\s*<link rel="stylesheet" href="\.\/visual-preview-12\.css"/);
  assert.match(original, /transition: opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms;/);
  assert.match(motion, /html\[data-startup="ready"\] \.startup-panel\s*\{[\s\S]*?transition: opacity 170ms ease-in 170ms;/);
  assert.match(motion, /html\[data-startup="ready"\] \.startup-screen\s*\{[\s\S]*?transition: opacity 350ms [^;]* 380ms, visibility 0s linear 730ms;/);
  // Label ends at 340ms; cover starts at 380ms, ends/vanishes at 730ms.
  assert.ok(170 + 170 < 380 && 380 + 350 === 730);
  assert.match(read('web/bridge.js'), /const STARTUP_WATCHDOG_MS = 12000;/);
});

test('VP12 historical navigation CSS is inactive after Hotfix 001, without affecting search/refresh', () => {
  assert.match(motion, /\.grid > \.card\.shub-enter\s*\{\s*animation: shub-preview-card-in 180ms/);
  assert.match(motion, /animation-delay: calc\(min\(var\(--shub-enter-index, 0\), 19\) \* 3ms\);/);
  assert.match(motion, /from \{ opacity: \.9; transform: translateY\(3px\); \}/);
  assert.match(motion, /to \{ opacity: 1; transform: translateY\(0\); \}/);
  assert.ok(19 * 3 <= 57);
  const renderer = read('web/renderer.js');
  assert.match(renderer, /function renderGrid\(\)/);
  assert.doesNotMatch(renderer, /shub-enter|animateNavigation|renderGrid\(true\)/);
  assert.match(renderer, /el\('search'\)\.addEventListener\('input',[^\n]*renderGrid\(\);/);
});

test('VP12 native initial background, reduced motion and unchanged icon wiring', () => {
  assert.equal(config.app.windows[0].backgroundColor, '#020203');
  assert.match(motion, /html, body \{ background: #020203; \}/);
  assert.match(motion, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(motion, /\.startup-screen\s*\{\s*transition: none !important;/);
  assert.match(motion, /\.grid > \.card\.shub-enter\s*\{\s*animation: none !important;/);
  assert.match(read('web/visual-preview-11.css'), /url\("\.\/brand-icon\.png"\)/);
  assert.match(read('MAKE-VISUAL-PREVIEW.cmd'), /Visual-Preview-12\\SoftwareHub\.exe/);
  assert.match(read('MAKE-RELEASE.cmd'), /if exist "\.VISUAL_PREVIEW_ONLY"/);
  assert.match(read('scripts/publish-release.cjs'), /\.VISUAL_PREVIEW_ONLY/);
});
