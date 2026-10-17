'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const programs = JSON.parse(read('data/programs.json'));
test('catalog retains unique ids and exact 126 entries', () => {
  assert.equal(programs.length, 126);
  assert.equal(new Set(programs.map(p=>p.id)).size,126);
});
test('bridge exposes the same eight methods as old Electron preload', () => {
  const bridge = read('web/bridge.js');
  for (const method of ['getCatalog','openExternal','copyCatalogText','checkVersion','getVersionCache','setVersionCache','getStartupRefreshIds','isInternetAvailable']) assert.match(bridge,new RegExp(`${method}:`));
});
test('trusted URLs are validated server-side against catalog', () => {
  const backend=read('src-tauri/src/lib.rs');
  assert.match(backend,/fn allowed_external_url/);
  assert.match(backend,/fn open_external/);
});
test('the release binary has no Electron extraction or payload runtime',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.ok(!pkg.devDependencies.electron);
  assert.ok(!fs.existsSync(path.join(root,'build-tools','portable-launcher.cpp')));
});

test('Windows desktop Tauri links the Rust library as rlib only, without an unnecessary DLL', () => {
  const cargo = read('src-tauri/Cargo.toml');
  assert.match(cargo, /^crate-type\s*=\s*\["rlib"\]$/m);
  assert.doesNotMatch(cargo, /^crate-type\s*=.*(?:"cdylib"|"staticlib")/m);
  assert.match(read('src-tauri/src/main.rs'), /software_hub_tauri_lib::run\(\)/);
});
