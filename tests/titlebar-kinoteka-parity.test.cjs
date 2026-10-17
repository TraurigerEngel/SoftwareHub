'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const html = read('web/index.html');
const css = read('web/styles.css');
const bridge = read('web/bridge.js');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const parity = css.slice(css.indexOf('Visual Preview 8 — Kinoteka / Igroteka centered titlebar parity.'));

test('Kinoteka-like titlebar has centered brand and only minimize/close buttons', () => {
  assert.match(html, /class="window-titlebar-spacer" data-tauri-drag-region/);
  assert.match(html, /class="window-titlebar-title" data-tauri-drag-region>Software Hub<\/div>/);
  assert.match(html, /id="windowMinimize"/);
  assert.match(html, /id="windowClose"/);
  assert.doesNotMatch(html, /id="windowMaximize"|window-titlebar-dot/);
  assert.ok(html.indexOf('class="window-titlebar-spacer"') < html.indexOf('class="window-titlebar-title"'));
  assert.ok(html.indexOf('class="window-titlebar-title"') < html.indexOf('class="window-controls"'));
  assert.match(parity, /grid-template-columns:\s*minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(parity, /\.window-titlebar-spacer\s*\{[^}]*width:\s*92px;/s);
  assert.match(parity, /\.window-controls button\s*\{[^}]*opacity:\s*0;/s);
  assert.match(parity, /\.window-controls button:hover,[\s\S]*?opacity:\s*1;/);
});

test('native desktop window starts maximized with normal taskbar and working close/minimize', () => {
  const win = config.app.windows[0];
  assert.equal(win.maximized, true);
  assert.equal(win.decorations, false);
  assert.notEqual(win.fullscreen, true, 'maximized is not exclusive fullscreen');
  assert.equal(win.visible, true, 'keep proven splash and first paint behavior');
  assert.match(bridge, /\['windowMinimize','minimize_window'\]/);
  assert.match(bridge, /\['windowClose','close_window'\]/);
  assert.doesNotMatch(bridge, /\['windowMaximize','toggle_maximize_window'\]/);
});

test('42px titlebar aligns splash and Kinoteka canvas with content, retaining transitions', () => {
  assert.match(parity, /\.window-titlebar\s*\{[^}]*flex:\s*0 0 42px;/s);
  assert.match(css, /\.startup-screen\s*\{[^}]*inset:\s*42px 0 0;/s);
  assert.match(css.slice(css.indexOf('Visual Preview 5')), /\.shub-particle-field\s*\{[^}]*inset:\s*42px 0 0;/s);
  assert.match(css.slice(css.indexOf('Visual Preview 5')), /height:\s*calc\(100vh - 42px\);/);
  assert.match(css, /transition:\s*opacity 200ms ease-in-out 1000ms;/);
  assert.match(css, /transition:\s*opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms;/);
  assert.match(parity, /backdrop-filter:\s*none;/);
});
