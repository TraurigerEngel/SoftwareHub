 'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root,f),'utf8');
const catalog = JSON.parse(read('data/programs.json'));
const byId = Object.fromEntries(catalog.map(p=>[p.id,p]));
const rust = read('src-tauri/src/lib.rs');

test('Hotfix 002 adds three unique cards without disturbing existing catalog',()=>{
  assert.equal(catalog.length,126);
  assert.equal(new Set(catalog.map(p=>p.id)).size,126);
  assert.equal(catalog.filter(p=>p.type==='site').length,40);
  assert.equal(catalog.filter(p=>p.type!=='site').length,86);
  assert.equal(catalog.filter(p=>p.versionSource?.sourceId==='github-releases').length,45);
});
test('simplewall automatically checks stable GitHub Releases, ignoring beta tags',()=>{
  const p=byId.simplewall;
  assert.equal(p.website,'https://github.com/henrypp/simplewall/releases');
  assert.equal(p.versionSource.repo,'henrypp/simplewall');
  assert.equal(p.versionSource.sourceId,'github-releases');
  assert.equal(p.versionSource.releasePolicy.includePrerelease,false);
  assert.match(rust, /field\(p, "id"\) != "simplewall"/); // API prerelease flag is authoritative
  const rx=new RegExp(p.versionSource.releasePolicy.versionPattern);
  assert.equal(rx.exec('v.3.8.7')[1],'3.8.7');
  assert.equal(rx.test('v.3.9.1-beta'),false);
  assert.deepEqual(p.actions,[{label:'Релизы',url:p.website}]);
});
test('Better Stack and Render keep exact private dashboard links and no version checking',()=>{
  for (const [id,url] of Object.entries({
    'betterstack-monitors':'https://incidents.betterstack.com/team/t609927/monitors/',
    'render-dashboard':'https://dashboard.render.com/web/'
  })) {
    const p=byId[id];
    assert.equal(p.type,'site');
    assert.equal(p.website,url);
    assert.equal(p.actions.length,1);
    assert.equal(p.actions[0].url,url);
    assert.equal(p.versionSource.sourceId,'manual-service');
  }
});
test('RTSS falls back to an official, exact linked index and never trusts generic site content',()=>{
  const p=byId.rtss;
  assert.deepEqual(p.versionSource.urls,[
    'https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/',
    'https://www.guru3d.com/pages/'
  ]);
  assert.equal(p.website,p.actions[0].url);
  assert.match(rust,/fn rtss_version_from_official_index/);
  assert.match(rust,/same_official_page\(RTSS_URL, resolved.as_str\(\)\)/);
  assert.match(rust, /"official-guru3d-index"/);
  assert.match(rust,/configured_fallback\(p,source,&reason\)/);
  assert.match(rust,/fn rtss_official_index_requires_exact_link_and_matching_release_title/);
});
