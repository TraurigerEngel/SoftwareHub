"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const catalog = JSON.parse(fs.readFileSync(path.join(root,'data/programs.json'),'utf8'));
const byId = Object.fromEntries(catalog.map(p=>[p.id,p]));
const sources = JSON.parse(fs.readFileSync(path.join(root,'data/sources.json'),'utf8'));

const newSites = {
 'claude-ai':['https://claude.ai/new','ИИ'],
 'check-host-tcp-ssh':['https://check-host.net/check-tcp?host=89.105.219.179:22','Сеть'],
 'cloudflare-speed-test':['https://speed.cloudflare.com/ru-ru','Сеть'],
 'unattend-generator-github':['https://github.com/rbardtke/windows-unattend-generator','Windows'],
 'artcraft':['https://getartcraft.com/','Дизайн']
};

test('all five new links are unique, visible sites with manual version source',()=>{
 assert.equal(catalog.length,141);
 assert.equal(new Set(catalog.map(p=>p.id)).size,141);
 assert.equal(catalog.filter(p=>p.type==='site').length,49);
 assert.equal(catalog.filter(p=>p.type!=='site').length,92);
 for (const [id,[url,category]] of Object.entries(newSites)){
   const site=byId[id];
   assert.ok(site,id);
   assert.equal(site.type,'site',id);
   assert.equal(site.website,url,id);
   assert.equal(site.siteCategory,category,id);
   assert.ok(site.siteSummary,id);
   assert.equal(site.versionSource.sourceId,'manual-service',id);
   assert.equal(site.versionSource.url,url,id);
   assert.equal(sources[site.versionSource.sourceId].adapter,null,id);
   assert.ok(site.actions.some(a=>a.url===url),id);
 }
});

test('already available ByeByeDPI is not duplicated or modified',()=>{
 const found=catalog.filter(p=>p.id==='byebyedpi');
 assert.equal(found.length,1);
 assert.equal(found[0].website,'https://github.com/romanvht/ByeByeDPI/releases');
 assert.equal(found[0].versionSource.sourceId,'github-releases');
});

test('the Russian webcam tester stays primary and new root link is accessible',()=>{
 const site=byId['webcam-mic-test'];
 assert.equal(site.website,'https://webcammictest.com/ru/');
 assert.deepEqual(site.actions, [
   {label:'Тест',url:'https://webcammictest.com/ru/'},
   {label:'Главная',url:'https://webcammictest.com/'}
 ]);
});

test('two distinct Windows generators and both TCP checks remain accessible',()=>{
 assert.equal(byId['unattend-generator'].website,'https://schneegans.de/windows/unattend-generator/');
 assert.equal(byId['check-host-tcp'].website,'https://check-host.net/check-tcp?host=95.182.80.39');
});
