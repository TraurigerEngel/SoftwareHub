 'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const programs = JSON.parse(fs.readFileSync(path.join(root,'data/programs.json'),'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(root,'data/sources.json'),'utf8'));
const byId = Object.fromEntries(programs.map(p=>[p.id,p]));

test('qBittorrent switches to official stable GitHub Releases and retains SourceForge alternative', () => {
  const p=byId.qbittorrent;
  const releaseUrl='https://github.com/qbittorrent/qBittorrent/releases';
  const sf='https://sourceforge.net/projects/qbittorrent/files/qbittorrent-win32/';
  assert.equal(p.website,releaseUrl);
  assert.deepEqual(p.actions,[{label:'Релизы',url:releaseUrl},{label:'SourceForge',url:sf}]);
  assert.equal(p.versionSource.sourceId,'github-releases');
  assert.equal(p.versionSource.repo,'qbittorrent/qBittorrent');
  assert.equal(sources[p.versionSource.sourceId].adapter,'github-releases');
  assert.equal(p.versionSource.releasePolicy.selection,'highest-version');
  assert.equal(p.versionSource.releasePolicy.includePrerelease,false);
  assert.equal(p.versionSource.releasePolicy.versionField,'tag_name');
  const pattern=new RegExp(p.versionSource.releasePolicy.versionPattern,'i');
  assert.equal(pattern.exec('release-5.2.4')[1],'5.2.4');
  for(const tag of ['release-5.3.0rc1','release-5.3.0beta1','release-5.3.0-rc1','release-5.3.0-alpha1','release-5.2.4-dev','v5.2.4']) {
    assert.equal(pattern.test(tag),false,tag);
  }
  assert.ok(!p.versionSource.publishedAtFormat);
  assert.equal(p.versionSource.fallbackVersion,'5.2.4');
});

test('WinDirStat retains primary official download and gains GitHub Releases button', () => {
  const p=byId.windirstat;
  const official='https://windirstat.net/download.html';
  assert.equal(p.website,official);
  assert.equal(p.versionSource.sourceId,'github-releases');
  assert.equal(p.versionSource.repo,'windirstat/windirstat');
  assert.deepEqual(p.actions,[
    {label:'Скачать',url:official},
    {label:'Релизы',url:'https://github.com/windirstat/windirstat/releases'}
  ]);
  assert.equal(new RegExp(p.versionSource.releasePolicy.versionPattern).test('release/v2.9.2'),true);
});

