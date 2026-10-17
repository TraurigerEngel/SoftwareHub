'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const programs = JSON.parse(fs.readFileSync(path.join(root, 'data/programs.json'),'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(root, 'data/sources.json'),'utf8'));
const ui = fs.readFileSync(path.join(root, 'web/renderer.js'), 'utf8');
const rust = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const p = programs.find(p => p.id === 'visualcpp');

test('Visual C++ skips network checks and hides version/source without changing download', () => {
  assert.ok(p);
  assert.equal(p.versionSource.sourceId, undefined);
  assert.equal(p.versionSource.url, undefined);
  assert.equal(p.versionSource.fallbackVersion, undefined);
  assert.equal(p.versionSource.showLatestVersion, false);
  assert.equal(p.versionSource.showSource, false);
  assert.equal(p.website,'https://www.techpowerup.com/download/visual-c-redistributable-runtime-package-all-in-one/');
  assert.deepEqual(p.actions,[{label:'Скачать',url:p.website}]);
  assert.equal(programs.length,126);
  assert.equal(programs.filter(x=>x.type==='site').length,40);
  assert.equal(programs.filter(x=>x.type!=='site').length,86);
  assert.doesNotMatch(rust, /matches!\(field\(p, "id"\), "rtss" \| "visualcpp"\)/);
  assert.doesNotMatch(rust.slice(0, rust.indexOf('#[cfg(test)]')), /field\(p, "id"\) == "visualcpp"/);
});

test('stale cached Visual C++ version and failed check are invisible on card and in search', () => {
  const prelude=ui.slice(0,ui.indexOf('function renderPagination('));
  const context={Intl,Date,URL,Map};
  const f=vm.runInNewContext(prelude+'\n({sourceId, visibleCardSearchText, getSourceCheckState, versionCache, renderActionButtons})',context);
  f.versionCache.set('visualcpp',{ok:true,version:'14.51.36247.0',refreshError:{reason:'HTTP 403'},checkedAt:'2026-10-09T02:46:00Z'});
  assert.equal(f.sourceId(p),null);
  assert.equal(Boolean(sources[f.sourceId(p)]?.adapter),false);
  assert.equal(f.getSourceCheckState(p).key,'manual');
  const search=f.visibleCardSearchText(p);
  assert.doesNotMatch(search,/14\.51|последняя версия|источник|ошибка|резерв/);
  assert.match(f.renderActionButtons(p),/Скачать/);
  assert.match(ui,/showLatestVersion = p\.versionSource\?\.showLatestVersion !== false/);
  assert.match(ui,/showSource = p\.versionSource\?\.showSource !== false/);
});
