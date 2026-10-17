'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const js = read('web/renderer.js');
const html = read('web/index.html');
const motion = read('web/visual-preview-12.css');

test('Hotfix 001 switches page and resets scroll without a delayed frame', () => {
  assert.match(js, /currentPage = page;\s*renderGrid\(\);\s*\/\/ Return to the top immediately[^\n]*\s*const grid = el\('grid'\);\s*if \(grid\) grid\.scrollTop = 0;/);
  assert.doesNotMatch(js, /scrollTo\(\{|behavior:\s*'smooth'/);
});

test('Hotfix 001 never creates card entrance classes on any catalog update', () => {
  assert.match(js, /function renderGrid\(\) \{/);
  assert.match(js, /renderGrid\(\);/);
  assert.doesNotMatch(js, /shub-enter|animateNavigation|entranceStyle|--shub-enter-index|renderGrid\(true\)/);
  assert.match(js, /<article class="card site-card"/);
  assert.match(js, /<article class="card"/);
});

test('Hotfix 001 preserves Preview 12 startup handoff and other visuals', () => {
  assert.match(motion, /html\[data-startup="ready"\] \.startup-screen/);
  assert.match(html, /visual-preview-12\.css/);
  assert.match(html, /brand-icon\.png/);
  assert.match(html, /particles\.js/);
});
