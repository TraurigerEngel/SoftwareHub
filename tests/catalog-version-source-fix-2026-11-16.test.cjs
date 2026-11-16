'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const programs = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/programs.json'),'utf8'));
const ids = Object.fromEntries(programs.map(x => [x.id,x]));
const visible = html => html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
function versionOf(item, html) {
  const source = item.versionSource;
  const matches = [...visible(html).matchAll(new RegExp(source.versionPattern,(source.versionPatternFlags||'i').replace(/g/g,'')+'g'))];
  if (source.versionPick==='highest') matches.sort((a,b)=>b[1].localeCompare(a[1],undefined,{numeric:true}));
  return matches[0]?.[1] ?? null;
}
test('ADB AppControl uses current official Windows page, not discontinued domain', () => {
  const p=ids['adb-appcontrol'];
  assert.equal(p.website,'https://www.adbappcontrol.com/ru/pc/');
  assert.equal(p.versionSource.url,p.website);
  assert.equal(p.actions[0].url,p.website);
  assert.equal(versionOf(p,`<h3>Последняя версия</h3> <div>1.8.6</div>`),'1.8.6');
  assert.equal(versionOf(p,`<h3>Последняя версия</h3> <div>1.8.6-beta</div>`),'1.8.6');
  assert.equal(versionOf(p,`<p>Windows 7, 8, 8.1, 10, 11</p>`),null);
});
test('Snappy Driver Installer Origin parses official v2.0.8 download label and has no stale fallback', () => {
  const p=ids['snappy-driver-installer-origin'];
  assert.equal(p.website,'https://www.glenn.delahoy.com/snappy-driver-installer-origin/');
  assert.equal(p.versionSource.url,p.website);
  assert.equal(p.versionSource.fallbackVersion,undefined);
  assert.equal(p.versionSource.fallbackOnParseMiss,undefined);
  assert.equal(versionOf(p,`<a href="https://example.org/download">Snappy Driver Installer Origin v2.0.8</a>`),'2.0.8');
  assert.equal(versionOf(p,`<a>Snappy Driver Installer Origin v2.0.8</a><a>SDIO Backup Drivers v1.5.0</a>`),'2.0.8');
  assert.equal(versionOf(p,`<h1>Snappy Driver Installer Origin</h1><div>Weekly updates 26.11.2</div>`),null);
  assert.equal(versionOf(p,`<script>Snappy Driver Installer Origin v99.0.0</script><p>Weekly updates</p>`),null);
  assert.equal(programs.length,141);
  assert.equal(programs.filter(x=>x.type==='site').length,49);
});
