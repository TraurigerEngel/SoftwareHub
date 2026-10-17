'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'web/styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'web/renderer.js'), 'utf8');
const config = fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8');

const familyStart = css.indexOf('/* Visual Preview 3 — Family Style Alignment');
assert.ok(familyStart > 0, 'Preview 3 rules must be additive and come after Preview 2');
const family = css.slice(familyStart, css.indexOf('/* Visual Preview 4 — Kinoteka Particle & Glass Parity'));

test('family background carries subtle colour glints and gently breathing dust', () => {
  assert.match(family, /\.app-shell\s*\{\s*background:[\s\S]*rgba\(129, 78, 170, \.19\)/);
  assert.match(family, /rgba\(218, 173, 91, \.115\)/);
  assert.match(family, /\.app-shell::after\s*\{[\s\S]*animation: shub-family-dust-breathe 26s ease-in-out infinite alternate;/);
  assert.match(family, /@keyframes shub-family-dust-breathe/);
  assert.match(family, /@media \(prefers-reduced-motion: reduce\), \(prefers-contrast: more\)\s*\{\s*\.app-shell::after\s*\{ animation: none; \}/);
});

test('kinoteka family glass remains translucent without widespread compositor blur', () => {
  assert.match(family, /--family-glass: rgba\(13, 13, 17, \.61\)/);
  assert.match(family, /\.card\s*\{[\s\S]*rgba\(21, 20, 24, \.69\)/);
  assert.match(family, /\.card\s*\{[\s\S]*backdrop-filter: none;/);
  assert.match(family, /\.search-box, \.filter-button\s*\{[\s\S]*rgba\(29, 28, 33, \.67\)/);
  assert.match(family, /\.stat-chip\s*\{[\s\S]*rgba\(39, 36, 39, \.67\)/);
  assert.match(family, /\.program-filter-popover\s*\{ background: rgba\(17, 16, 19, \.965\); \}/);
});

test('approved splash timings and catalog structure are not changed by visual preview', () => {
  const startup = css.slice(css.indexOf('html[data-startup="ready"] .startup-panel'));
  assert.match(startup, /transition: opacity 200ms ease-in-out 1000ms;/);
  assert.match(startup, /transition: opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms;/);
  assert.doesNotMatch(family, /data-startup|\.startup-panel|\.startup-screen|\.grid\s*\{|grid-template-columns/);
  assert.match(renderer, /document\.documentElement\.dataset\.startup = 'ready'/);
  assert.doesNotMatch(config, /disable-gpu/);
});

test('preview only changes passive appearance, not animations of cards or page functionality', () => {
  assert.doesNotMatch(family, /\.card[^\{]*\{[^}]*animation:/);
  assert.doesNotMatch(family, /\.action[^\{]*\{[^}]*animation:/);
  assert.doesNotMatch(family, /\.app-shell::after[^\{]*\{[^}]*pointer-events:\s*auto/);
  assert.match(family, /\.button-primary:hover\s*\{/);
  assert.match(family, /\.page-button.active\s*\{/);
});
