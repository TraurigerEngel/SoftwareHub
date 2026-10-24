'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');

const splash = read('web/splash-stable-073.css');
test('v0.7.3 Stable loads splash pacing last without altering the approved layout', () => {
  const html = read('web/index.html');
  assert.match(html, /visual-preview-12\.css">\s*<link rel="stylesheet" href="\.\/splash-stable-073\.css"/);
  assert.equal(JSON.parse(read('package.json')).version, '0.7.4');
  assert.equal(sha('web/renderer.js'), '31ed822da57f28b630f9557c542082e56c921b7f32e856f10b5881862cb481c7');
  assert.equal(sha('src-tauri/src/lib.rs'), 'f7e6a43d76c192cb9c262b1a3b16d0d54003394cd94b84fbb36cd9505a356d45');
  assert.equal(sha('web/visual-preview-12.css'), '5c39771675988d551d21e501111689e2cd7e1ee900738ed55867eb43e71d6f0a');
});

test('v0.7.3 splash holds the title 1.8s, avoids ghosting and hides at 2.7s', () => {
  const title = splash.match(/html\[data-startup="ready"\] \.startup-panel\s*\{([^}]*)\}/)?.[1];
  const cover = splash.match(/html\[data-startup="ready"\] \.startup-screen\s*\{([^}]*)\}/)?.[1];
  assert.ok(title && cover);
  assert.match(title, /opacity:\s*0;/);
  assert.match(cover, /visibility:\s*hidden;/);
  const [,titleLength,titleDelay] = title.match(/transition:\s*opacity (\d+)ms ease-in-out (\d+)ms;/) || [];
  const [,coverLength,coverDelay,hideAt] = cover.match(/transition:\s*opacity (\d+)ms [^;]*? (\d+)ms, visibility 0s linear (\d+)ms;/) || [];
  assert.equal(Number(titleDelay), 1800);
  assert.equal(Number(titleLength), 400);
  assert.ok(Number(titleDelay)+Number(titleLength)<Number(coverDelay));
  assert.equal(Number(coverDelay),2250);
  assert.equal(Number(coverLength)+Number(coverDelay),Number(hideAt));
  assert.equal(Number(hideAt),2700);
  assert.doesNotMatch(cover,/pointer-events:\s*none/);
  assert.match(splash,/\.startup-name\s*\{\s*animation: shub073-name-appear 420ms/);
  assert.match(splash,/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;/);
  assert.doesNotMatch(splash,/\.card|\.pagination|\.topbar|\.grid\s*\{/);
});
