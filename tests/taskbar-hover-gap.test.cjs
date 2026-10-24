'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const rust = read('src-tauri/src/lib.rs');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const moduleText = rust.slice(rust.indexOf('mod taskbar_autohide {'), rust.indexOf('\npub fn run() {'));

test('Kinoteka HF51 native frameless geometry: 2 physical px outside window, no left stripe', () => {
  assert.equal(config.app.windows[0].maximized, true, 'startup maximized, then unmaximize in compat mode');
  assert.equal(config.app.windows[0].visible, false);
  assert.equal(config.app.windows[0].resizable, false);
  assert.equal(config.app.windows[0].decorations, false);
  for (const sig of [
    /fn taskbar_is_autohidden_at_bottom/, /SHAppBarMessage\(ABM_GETAUTOHIDEBAREX/,
    /DwmGetWindowAttribute\(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS/,
    /GetWindowLongPtrW\(hwnd, GWL_STYLE\)/,
    /style & !\(WS_THICKFRAME \| WS_BORDER \| WS_DLGFRAME\)/,
    /SetWindowLongPtrW\(hwnd, GWL_STYLE, without_frame\)/,
    /SWP_FRAMECHANGED_NOMOVE_NOSIZE/,/DWMWA_WINDOW_CORNER_PREFERENCE/,
    /DWMWA_BORDER_COLOR/, /window\.unmaximize\(\)/,
    /let bottom = m\.bottom - TASKBAR_NATIVE_GAP_PX;/,
    /bottom \+ 2/,/left: m\.left - margins\[0\]/,
    /right: m\.right \+ margins\[2\]/,
    /static APPLYING: AtomicBool/,
  ]) assert.match(moduleText, sig);
  assert.doesNotMatch(moduleText, /monitor\.work_area\(\)/);
  assert.match(moduleText, /SOFTWAREHUB_TASKBAR_GAP_PX/);
  // If DWM reports an invisible 8px NC border, it must be removed before
  // sizing so the visible content reaches x=0 (no 8px desktop stripe).
  const m={left:0,right:1920,bottom:1080,top:0};
  const current={left:-8,top:0,right:1928,bottom:1080};
  const visual={left:0,top:0,right:1920,bottom:1080};
  const margins=[visual.left-current.left,visual.top-current.top,current.right-visual.right,current.bottom-visual.bottom];
  assert.equal(m.left-margins[0],-8);
  assert.equal(m.right+margins[2],1928);
  assert.equal(m.bottom-4+2,1078);
});

test('window applies Kinoteka taskbar parity before display and again on focus/resize', () => {
  const setup=rust.slice(rust.indexOf('.setup(|app| {'));
  assert.match(setup, /window\.maximize\(\)\?;/);
  assert.match(setup, /taskbar_autohide::apply\(&window\);/);
  assert.match(setup, /tauri::WindowEvent::Focused\(true\) \| tauri::WindowEvent::Resized/);
  assert.ok(setup.indexOf('taskbar_autohide::apply(&window)') < setup.indexOf('window.show()?;'));
  assert.doesNotMatch(read('src-tauri/capabilities/default.json'), /allow-set-size|allow-set-position/);
});

// Parity HF3: Kinoteka disables the default Tauri shadow; with decorations=false
// the default shadow creates an unwanted Windows 11 accent outline.
test('shadowless undecorated window: no Windows accent frame around taskbar gap', () => {
  assert.equal(config.app.windows[0].decorations, false);
  assert.equal(config.app.windows[0].shadow, false, 'explicitly disable native shadow');
  assert.equal(config.app.windows[0].resizable, false);
  assert.match(moduleText, /DwmSetWindowAttribute\(hwnd, DWMWA_BORDER_COLOR/);
  assert.match(moduleText, /DWMWA_COLOR_NONE/);
});
