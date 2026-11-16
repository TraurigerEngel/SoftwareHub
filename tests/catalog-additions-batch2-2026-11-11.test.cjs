'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const programs = JSON.parse(fs.readFileSync(path.join(root, 'data/programs.json'), 'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(root, 'data/sources.json'), 'utf8'));
const byId = Object.fromEntries(programs.map(p => [p.id, p]));
const exactLinks = {
  win11debloat: 'https://github.com/Raphire/Win11Debloat/releases',
  'drweb-cureit': 'https://free.drweb.ru/download+cureit+free/',
  'microsoft-safety-scanner': 'https://learn.microsoft.com/en-us/defender-endpoint/safety-scanner-download',
  ratool: 'https://www.majorgeeks.com/files/details/ratool_%28removable_access_tool%29.html',
  'comfyui-desktop': 'https://comfy.org/download',
  omarchy: 'https://omarchy.org/',
  'civitai-red': 'https://civitai.red/',
  civitai: 'https://civitai.com/',
  tgmtproxy: 'https://tgmtproxy.github.io/mtproxy/',
  localsend: 'https://localsend.org/',
  nodejs: 'https://nodejs.org/en/download',
  rutracker: 'https://rutracker.org'
};

test('all 12 requested resources are reachable through exactly one catalog card each', () => {
  assert.equal(programs.length,141);
  assert.equal(new Set(programs.map(p=>p.id)).size,141);
  assert.equal(programs.filter(p => p.type === 'site').length,49);
  assert.equal(programs.filter(p => p.type !== 'site').length,92);
  for (const [id, url] of Object.entries(exactLinks)) {
    const p = byId[id];
    assert.ok(p, `${id} missing`);
    assert.ok(p.website===url || p.actions.some(a=>a.url===url), `${id}: exact requested URL missing`);
    assert.ok(p.actions.some(a=>a.url===url), `${id}: requested URL cannot be opened`);
    assert.equal(programs.filter(x=>x.id===id).length,1,`${id} was duplicated`);
  }
});

test('new sites have manual service metadata and meaningful unique descriptions',()=>{
  for (const id of ['omarchy','civitai-red','civitai','tgmtproxy']) {
    const p=byId[id];
    assert.equal(p.type,'site',id);
    assert.equal(p.versionSource.sourceId,'manual-service',id);
    assert.equal(sources[p.versionSource.sourceId].adapter,null,id);
    assert.ok(p.siteCategory && p.siteSummary,id);
  }
  assert.match(byId['civitai-red'].siteSummary,/18\+/);
  assert.match(byId.tgmtproxy.siteSummary,/операторам/);
});

test('new programs show verified stable GitHub tags or intentionally use manual sources',()=>{
  for (const [id,repo,tag] of [
    ['win11debloat','Raphire/Win11Debloat','2026.10.30'],
    ['localsend','localsend/localsend','v1.18.2']
  ]) {
    const p=byId[id];
    assert.notEqual(p.type,'site');
    assert.equal(p.versionSource.sourceId,'github-releases',id);
    assert.equal(p.versionSource.repo,repo,id);
    assert.equal(p.versionSource.releasePolicy.includePrerelease,false,id);
    const rx = new RegExp(p.versionSource.releasePolicy.versionPattern);
    assert.equal(rx.exec(tag)?.[1],tag.replace(/^v/,''),id);
    assert.equal(sources['github-releases'].adapter,'github-releases');
    assert.ok(p.cardSummary,id);
  }
  for (const id of ['drweb-cureit','microsoft-safety-scanner','ratool','comfyui-desktop']) {
    const p=byId[id];
    assert.equal(p.versionSource.sourceId,'manual-official',id);
    assert.equal(sources[p.versionSource.sourceId].adapter,null,id);
    assert.ok(p.cardSummary,id);
  }
  assert.equal(programs.filter(p=>p.versionSource?.sourceId==='github-releases').length,47);
});

test('prior entries Node.js and RuTracker stay untouched and do not get another entry',()=>{
  assert.equal(programs.filter(p=>p.id==='nodejs').length,1);
  assert.equal(byId.nodejs.website,exactLinks.nodejs);
  assert.equal(programs.filter(p=>p.id==='rutracker').length,1);
  assert.equal(byId.rutracker.website,'https://rutracker.org/forum/index.php');
  assert.equal(byId.rutracker.type,'site');
});
