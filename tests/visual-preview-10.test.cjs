'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('web/index.html');
const css = read('web/visual-preview-10.css');
const renderer = read('web/renderer.js');
const bridge = read('web/bridge.js');

test('VP10 is loaded after original Stable CSS without changing startup script order', () => {
  assert.match(html, /styles\.css">\s*<link rel="stylesheet" href="\.\/visual-preview-10\.css">/);
  const scripts = ['./bridge.js', './renderer.js', './particles.js'];
  assert.ok(scripts.every((name,i) => i === 0 || html.indexOf(name) > html.indexOf(scripts[i-1])));
  assert.match(html, /<html lang="ru" data-startup="loading">/);
  assert.match(read('web/styles.css'), /transition: opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms;/);
});

test('VP10 replaces unstable font glyphs with semantic, focusable vector close/minimize icons', () => {
  assert.match(html, /id="windowMinimize" aria-label="Свернуть"[^>]*>\s*<svg class="window-control-icon"/);
  assert.match(html, /id="windowClose" aria-label="Закрыть"[^>]*>\s*<svg class="window-control-icon"/);
  assert.equal((html.match(/class="window-control-icon"/g)||[]).length, 2);
  assert.doesNotMatch(html, /id="windowMaximize"/);
  assert.match(css, /\.window-control-icon\s*\{[^}]*stroke:\s*currentColor;/s);
  assert.match(css, /\.window-controls button:focus-visible\s*\{[^}]*outline:\s*1px solid/s);
  assert.match(bridge, /\['windowMinimize','minimize_window'\]/);
  assert.match(bridge, /\['windowClose','close_window'\]/);
});

test('VP10 keeps the proven splash transition while updating splash detail', () => {
  assert.match(html, /class="startup-mark" aria-hidden="true"/);
  assert.match(html, /class="startup-progress-track" aria-hidden="true"><span class="startup-progress-fill"/);
  assert.match(css, /\.startup-mark::before/);
  assert.match(css, /\.startup-mark::after/);
  assert.match(css, /\.startup-progress-fill\s*\{[^}]*animation: shub-preview-load 1\.7s/s);
  assert.match(css, /\.startup-screen:has\(#startupRetry:not\(\.hidden\)\) \.startup-progress-fill/);
  assert.doesNotMatch(css, /html\[data-startup="ready"\] \.startup-panel\s*\{|html\[data-startup="ready"\] \.startup-screen\s*\{/);
  assert.match(bridge, /const STARTUP_WATCHDOG_MS = 12000;/);
});

test('VP10 atmosphere stays static behind the original Kinoteka canvas', () => {
  assert.match(css, /\.app-shell\s*\{\s*background:[\s\S]*rgba\(112, 56, 152, \.095\)/);
  assert.match(css, /rgba\(164, 64, 114, \.074\)/);
  assert.match(css, /rgba\(191, 142, 75, \.065\)/);
  assert.doesNotMatch(css, /\.shub-particle-field\s*\{|backdrop-filter:\s*blur/);
  const particles = read('web/particles.js');
  assert.match(particles, /const MAX_FPS=90;/);
  assert.match(particles, /const HUE_CYCLE_SECONDS=72;/);
});

test('VP10 entrance styling remains archived while Hotfix 001 restores instant navigation', () => {
  assert.match(renderer, /function renderGrid\(\)/);
  assert.doesNotMatch(renderer, /animateNavigation|shub-enter|renderGrid\(true\)|--shub-enter-index/);
  assert.match(renderer, /el\('search'\)\.addEventListener\('input',[^\n]*renderGrid\(\);/);
  // Historical CSS remains, but the runtime never creates the entry class.
  assert.match(css, /\.grid > \.card\.shub-enter\s*\{[^}]*animation: shub-preview-card-in 230ms/s);
});

test('VP10 motion and contrast preferences are respected without a heavy per-card blur', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.grid > \.card\.shub-enter\s*\{\s*animation: none !important;/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /\.app-shell\s*\{ background: #020203 !important; \}/);
  assert.doesNotMatch(css, /will-change:|backdrop-filter:.*blur\(/);
});

test('VP10 cannot be accidentally published with the v0.7.1 Stable scripts', () => {
  const marker = fs.existsSync(path.join(root,'.VISUAL_PREVIEW_ONLY'));
  const isRc = fs.existsSync(path.join(root,'.SOFTWARE_HUB_RC_ONLY')) && JSON.parse(read('package.json')).version === '0.7.2-rc.1';
  const isStable = fs.existsSync(path.join(root,'.SOFTWARE_HUB_STABLE_SOURCE')) && ['0.7.2','0.7.3'].includes(JSON.parse(read('package.json')).version);
  assert.ok(marker || isRc || isStable, 'Only isolated Preview or RC sources allowed');
  assert.match(read('MAKE-RELEASE.cmd'), /if exist "\.VISUAL_PREVIEW_ONLY"/);
  assert.match(read('scripts/publish-release.cjs'), /if \(fs\.existsSync\(path\.join\(rootDir, '\.VISUAL_PREVIEW_ONLY'\)\)\)/);
  assert.match(read('MAKE-FINAL-ARCHIVES.ps1'), /if \(Test-Path -LiteralPath \(Join-Path \$PSScriptRoot '\.VISUAL_PREVIEW_ONLY'\)\)/);
  assert.match(read('MAKE-VISUAL-PREVIEW.cmd'), /npm ci --no-audit --no-fund/);
  assert.match(read('MAKE-VISUAL-PREVIEW.cmd'), /npm run build:release/);
  assert.match(read('src-tauri/src/main.rs'), /windows_subsystem = "windows"/);
  assert.match(read('MAKE-VISUAL-PREVIEW.cmd'), /Visual-Preview-12\\SoftwareHub\.exe/);
});
