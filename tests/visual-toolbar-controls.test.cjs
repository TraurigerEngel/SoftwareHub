'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = source('web/styles.css');
const html = source('web/index.html');
const latest = css.slice(css.indexOf('/* Visual Preview 7 — Toolbar & Controls Polish.'), css.indexOf('/* Visual Preview 8 — Kinoteka / Igroteka centered titlebar parity.'));

test('VP7 is a CSS-only control polish and does not change the approved five-column / splash layout', () => {
  assert.ok(latest.length > 1000, 'VP7 control rules are present');
  assert.doesNotMatch(latest, /\.grid\s*\{|grid-template-columns\s*:|\.card\s*\{|\.startup-screen\s*\{|\.startup-panel\s*\{|\.shub-particle-field\s*\{|@keyframes/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /transition:\s*opacity 200ms ease-in-out 1000ms/);
  assert.match(css, /transition:\s*opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms/);
});

test('VP7 search, category button and counters use no per-control backdrop blur', () => {
  assert.match(latest, /\.search-box,\s*\.filter-button\s*\{[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(latest, /\.search-box:focus-within,\s*\.filter-button\.active,/);
  assert.match(latest, /\.filter-button\[aria-expanded="true"\]/);
  assert.match(latest, /\.stat-chip\.active\s*\{/);
  assert.match(latest, /\.refresh-button:focus-visible/);
  assert.doesNotMatch(latest, /blur\(\d+px\)/);
});

test('VP7 category popover stays readable with proper focus/active states', () => {
  assert.match(html, /id="programFilterPopover"[^>]*role="dialog"/);
  assert.match(latest, /\.program-filter-popover\s*\{[\s\S]*?background:\s*rgba\(16, 16, 19, \.965\);/);
  assert.match(latest, /\.program-filter-option\.active\s*\{[\s\S]*?inset 2px 0 0 rgba\(235, 197, 141, \.66\)/);
  assert.match(latest, /\.program-filter-option:focus-visible/);
  assert.match(latest, /\.filter-search-box:focus-within/);
});

test('VP7 pagination remains keyboard-accessible and reduced contrast is respected', () => {
  assert.match(latest, /\.page-button:hover:not\(:disabled\)/);
  assert.match(latest, /\.page-button\.active/);
  assert.match(latest, /\.page-button:focus-visible/);
  assert.match(latest, /@media \(prefers-contrast: more\)/);
  assert.match(latest, /\.page-button:disabled \{ opacity: \.32; \}/);
});

test('VP7 does not modify original compositor or its dependency script', () => {
  assert.match(html, /<canvas id="shubParticleField"/);
  assert.match(html, /<script src="\.\/particles\.js"><\/script>/);
  assert.match(source('web/particles.js'), /requestAnimationFrame/);
  assert.equal(crypto.createHash('sha256').update(source('data/programs.json')).digest('hex').length, 64);
});
