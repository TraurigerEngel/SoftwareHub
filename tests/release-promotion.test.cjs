'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=x=>fs.readFileSync(path.join(root,x),'utf8');
test('v0.7.4 Stable npm/Cargo/Tauri and lockfile versions agree',()=>{
  const pkg=JSON.parse(read('package.json'));
  const lock=JSON.parse(read('package-lock.json'));
  const cfg=JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(pkg.version,'0.7.4');
  assert.equal(lock.version,'0.7.4');
  assert.equal(lock.packages[''].version,'0.7.4');
  assert.equal(cfg.version,'0.7.4');
  assert.match(read('src-tauri/Cargo.toml'),/^version = "0\.7\.4"$/m);
  assert.match(read('src-tauri/Cargo.lock'),/\[\[package\]\]\r?\nname = "software-hub-tauri"\r?\nversion = "0\.7\.4"/);
});
test('Stable sources cannot be mistaken for Preview or RC1',()=>{
  assert.ok(fs.existsSync(path.join(root,'.SOFTWARE_HUB_STABLE_SOURCE')));
  assert.ok(!fs.existsSync(path.join(root,'.SOFTWARE_HUB_RC_ONLY')));
  assert.ok(!fs.existsSync(path.join(root,'.VISUAL_PREVIEW_ONLY')));
  const script=read('MAKE-FINAL-ARCHIVES.ps1');
  assert.match(script,/\$version = '0\.7\.4'/);
  assert.match(script,/Software_Hub_v0\.7\.4_Stable/);
  assert.match(script,/FileHash/);
  assert.doesNotMatch(script,/Get-FileHash/);
  assert.match(script,/visual-preview-12\.css/);
});
