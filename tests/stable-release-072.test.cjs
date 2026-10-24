'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex');
test('v0.7.2 Stable retains the exact user-approved RC renderer and backend',()=>{
  assert.equal(hash('web/renderer.js'),'31ed822da57f28b630f9557c542082e56c921b7f32e856f10b5881862cb481c7');
  assert.equal(hash('src-tauri/src/lib.rs'),'f7e6a43d76c192cb9c262b1a3b16d0d54003394cd94b84fbb36cd9505a356d45');
});
test('v0.7.2 Stable contains the final icon and all approved visual styles',()=>{
  for(const f of ['assets/icon.png','assets/icon.ico','assets/icon-master.png','src-tauri/icons/icon.ico','web/brand-icon.png','web/visual-preview-10.css','web/visual-preview-11.css','web/visual-preview-12.css']){
    assert.ok(fs.statSync(path.join(root,f)).size>0,`Missing: ${f}`);
  }
  assert.ok(fs.readFileSync(path.join(root,'web/index.html'),'utf8').includes('visual-preview-12.css'));
});
