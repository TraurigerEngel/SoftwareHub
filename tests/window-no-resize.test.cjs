'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const windowConfig = config.app.windows[0];
const html = read('web/index.html');
const bridge = read('web/bridge.js');

// Real work-area sizing exposes the desktop bottom edge for Explorer.
// CSS padding alone would not expose the taskbar hover trigger.
test('window disables resizing and uses native work-area sizing with bottom gap', () => {
  assert.equal(windowConfig.resizable, false, 'disable Windows native sizing hit zones');
  assert.equal(windowConfig.maximized, true, 'native maximization is startup only; Win32 compatibility unmaximizes auto-hide taskbar monitors');
  assert.equal(windowConfig.decorations, false, 'retain custom centered titlebar');
  assert.notEqual(windowConfig.fullscreen, true, 'do not cover Windows taskbar');
  assert.equal(windowConfig.visible, false, 'show only after native work-area geometry is applied');
});

test('window keeps exactly minimize and close controls; no resize/maximize button', () => {
  assert.match(html, /id="windowMinimize"/);
  assert.match(html, /id="windowClose"/);
  assert.doesNotMatch(html, /id="windowMaximize"/);
  assert.match(bridge, /\['windowMinimize','minimize_window'\]/);
  assert.match(bridge, /\['windowClose','close_window'\]/);
  assert.doesNotMatch(bridge, /\['windowMaximize','toggle_maximize_window'\]/);
});
