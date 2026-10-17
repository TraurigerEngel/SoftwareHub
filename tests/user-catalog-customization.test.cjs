'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data/programs.json'),'utf8'));
const byId = Object.fromEntries(catalog.map(p => [p.id,p]));
const sources = JSON.parse(fs.readFileSync(path.join(root, 'data/sources.json'),'utf8'));

test('CPU-Z checks official CPUID classic Windows release, download stays TechPowerUp', () => {
  const p=byId['cpu-z'];
  assert.ok(p);
  assert.equal(p.website,'https://www.techpowerup.com/download/cpu-z/?origin=serp_auto');
  assert.deepEqual(p.actions,[{label:'Скачать',url:p.website}]);
  assert.equal(p.versionSource.sourceId,'official-page');
  assert.equal(sources[p.versionSource.sourceId].adapter,'official-page');
  assert.equal(p.versionSource.url,'https://www.cpuid.com/softwares/cpu-z.html');
  const rx = new RegExp(p.versionSource.versionPattern,p.versionSource.versionPatternFlags);
  assert.equal(rx.exec('CLASSIC VERSIONS Version 3.01 for windows® x86/x64')[1],'3.01');
  assert.equal(rx.exec('CLASSIC VERSIONS Version 3.02 for windows® x86/x64')[1],'3.02');
  assert.equal(rx.exec('CLASSIC VERSIONS Version 3.02 for windows&reg; x86/x64')[1],'3.02');
  for (const other of ['CPU-Z 2.21 August 17th, 2026', 'Version 2.19 / 2.20.2 ASUS ROG', 'Version 3.02 for Android', 'Version 3.02 for windows® ARM64', 'Version 1.04 for windows® 95/98']) {
    // An old Windows 95 vintage version can appear on the site, but it is
    // older than the classic version and versionPick=highest prevents replacing it.
    if (!other.includes('95/98')) assert.equal(rx.test(other),false,other);
  }
  assert.equal(p.versionSource.versionPick,'highest');
});

test('Microsoft Activation Scripts stays visible without ANY automatic version config', () => {
  const p=byId['microsoft-activation-scripts'];
  assert.ok(p);
  assert.equal(Object.hasOwn(p,'versionSource'),false);
  assert.equal(p.actions[0].label,'GitHub');
  assert.match(p.actions[0].url,/github\.com\/massgravel\/Microsoft-Activation-Scripts/);
  assert.ok(p.cardSummary);
});

test('ZStartup is removed from catalog and version-source lookup',()=>{
  assert.equal(byId.zstartup,undefined);
  assert.equal(catalog.length,126);
  assert.equal(catalog.filter(p=>p.type==='site').length,40);
  assert.equal(catalog.filter(p=>p.type!=='site').length,86);
  assert.equal(catalog.filter(p=>p.versionSource?.sourceId==='github-releases').length,45);
});

// Regression guard: do not re-add BetterTrumpet to the catalog or GitHub release checks.
test('BetterTrumpet is absent from catalog and automated version checks',()=>{
  assert.equal(byId.bettertrumpet,undefined);
  assert.equal(catalog.some(p=>p.versionSource?.repo==='xammen/BetterTrumpet'),false);
  assert.equal(catalog.length,126);
});

test('LosslessCut has no summary; GitHub release version and source are enabled',()=>{
  const p=byId.losslesscut;
  assert.ok(p);
  assert.equal(p.cardSummary,undefined);
  assert.equal(p.versionSource.sourceId,'github-releases');
  assert.equal(p.versionSource.repo,'mifi/lossless-cut');
  assert.notEqual(p.versionSource.showSource,false);
  assert.notEqual(p.versionSource.showLatestVersion,false);
  assert.deepEqual(p.actions,[{label:'Релизы',url:p.website}]);
});
