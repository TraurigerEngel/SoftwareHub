'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
test('v0.7.2 Stable retains the exact user-approved RC renderer and backend',()=>{
  assert.equal(hash('web/renderer.js'),'95b0563629da2f195dfa1a03d82788bf4f8bf1fa6b08e68e43d63166df94af5e');
  assert.equal(hash('src-tauri/src/lib.rs'),'743f50b5a47f184c10253d0367566c149cd6243ee54e80894b563ea3cff3d7bb');
});
test('v0.7.2 Stable contains the final icon and all approved visual styles',()=>{
  for(const f of ['assets/icon.png','assets/icon.ico','assets/icon-master.png','src-tauri/icons/icon.ico','web/brand-icon.png','web/visual-preview-10.css','web/visual-preview-11.css','web/visual-preview-12.css']){
    assert.ok(fs.statSync(path.join(root,f)).size>0,`Missing: ${f}`);
  }
  assert.ok(fs.readFileSync(path.join(root,'web/index.html'),'utf8').includes('visual-preview-12.css'));
});
