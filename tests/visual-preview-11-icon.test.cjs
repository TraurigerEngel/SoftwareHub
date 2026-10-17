'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p));
const text = p => read(p).toString('utf8');
const sha = p => crypto.createHash('sha256').update(read(p)).digest('hex');

test('VP11 embeds the same Windows icon in both project icon locations', () => {
  assert.equal(sha('assets/icon.ico'), sha('src-tauri/icons/icon.ico'));
  const ico = read('src-tauri/icons/icon.ico');
  assert.equal(ico.readUInt16LE(0),0);
  assert.equal(ico.readUInt16LE(2),1);
  const count=ico.readUInt16LE(4);
  const sizes=[];
  for(let i=0;i<count;i++) {
    const pos=6+16*i;
    const w=ico[pos]||256, h=ico[pos+1]||256;
    assert.equal(w,h);
    const length=ico.readUInt32LE(pos+8), offset=ico.readUInt32LE(pos+12);
    assert.ok(offset >= 6+16*count && offset+length <= ico.length);
    sizes.push(w);
  }
  assert.deepEqual(sizes.sort((a,b)=>a-b),[16,24,32,48,64,128,256]);
  const tauri=JSON.parse(text('src-tauri/tauri.conf.json'));
  assert.deepEqual(tauri.bundle.icon, ['icons/icon.ico']);
});

test('VP11 has PNG alpha asset, original source image and local splash icon', () => {
  for(const name of ['assets/icon.png','web/brand-icon.png','assets/icon-master.png']) {
    const png=read(name);
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.ok(png.readUInt32BE(16)>=256 && png.readUInt32BE(20)>=256);
  }
  assert.equal(read('assets/icon.png')[25],6,'app PNG should have RGBA alpha');
  const html=text('web/index.html');
  const css=text('web/visual-preview-11.css');
  assert.match(html,/visual-preview-10\.css">\s*<link rel="stylesheet" href="\.\/visual-preview-11\.css"/);
  assert.match(html,/<link rel="icon" type="image\/png" href="\.\/brand-icon\.png">/);
  assert.match(css,/\.startup-mark\s*\{[\s\S]*url\("\.\/brand-icon\.png"\)/);
  assert.match(css,/\.startup-mark::before,\s*\.startup-mark::after\s*\{ content: none; \}/);
});

test('VP11 builds to an isolated Preview 11 directory and cannot publish as Stable', () => {
  assert.match(text('MAKE-VISUAL-PREVIEW.cmd'),/Visual-Preview-12\\SoftwareHub\.exe/);
  assert.match(text('MAKE-VISUAL-PREVIEW.cmd'),/npm run build:release/);
  assert.match(text('MAKE-RELEASE.cmd'),/if exist "\.VISUAL_PREVIEW_ONLY"/);
  assert.match(text('README.md'),/Visual Preview 11/);
});
