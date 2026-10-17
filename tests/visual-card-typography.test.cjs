'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const css = read('web/styles.css');
const html = read('web/index.html');
const renderer = read('web/renderer.js');
const particles = read('web/particles.js');
const block = css.slice(css.lastIndexOf('/* Visual Preview 6 — Card & Typography Refinement.'), css.indexOf('/* Visual Preview 7 — Toolbar & Controls Polish.'));

test('Visual Preview 6 refines only cards, leaving the Kinoteka background unchanged', () => {
  assert.ok(block.startsWith('/* Visual Preview 6 — Card & Typography Refinement.'));
  assert.doesNotMatch(block, /\.shub-particle-field\s*\{|\.app-shell\s*\{|(?:@keyframes|animation:|backdrop-filter:|requestAnimationFrame)/);
  assert.match(css, /\/\* Visual Preview 5 — exact Kinoteka v1\.0 Stable particle compositor geometry/);
  assert.match(html, /<script src="\.\/particles\.js"><\/script>/);
  assert.match(particles, /requestAnimationFrame/);
});

test('Visual Preview 6 keeps five columns, 186px card rows, and the accepted splash timing', () => {
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-auto-rows: 186px/);
  assert.match(css, /\.card\s*\{[^}]*height: 186px;[^}]*min-height: 186px;/);
  assert.doesNotMatch(block, /(?:grid-template-columns:|grid-auto-rows:|height:\s*186px|\.startup-screen|\.startup-panel|data-startup)/);
  assert.match(css, /transition: opacity 200ms ease-in-out 1000ms;/);
  assert.match(css, /transition: opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms;/);
});

test('Visual Preview 6 preserves truncation, card controls and metadata readability', () => {
  assert.match(block, /\.title-wrap\s*\{[^}]*min-width:\s*0/);
  assert.match(block, /\.card \.version-line > span:first-child\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(block, /\.card \.version-line > span:last-child\s*\{[^}]*max-width:\s*60%/);
  assert.match(block, /\.card \.version-value\.source\s*\{/);
  assert.match(block, /\.card \.site-summary,/);
  assert.match(block, /\.card \.action\.primary\s*\{/);
  assert.match(block, /@media \(prefers-contrast: more\)/);
  assert.match(renderer, /class="card-head"/);
  assert.match(renderer, /class="versions"/);
  assert.match(renderer, /class="actions"/);
});
