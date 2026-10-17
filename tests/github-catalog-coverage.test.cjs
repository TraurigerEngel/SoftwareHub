'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const catalog = JSON.parse(fs.readFileSync(path.join(root,'data/programs.json'),'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(root,'data/sources.json'),'utf8'));
const byId = Object.fromEntries(catalog.map(p=>[p.id,p]));
const renderer = fs.readFileSync(path.join(root,'web/renderer.js'),'utf8');
const rust = fs.readFileSync(path.join(root,'src-tauri/src/lib.rs'),'utf8');

const newEntries = {
  'twitch-channel-points-miner-v2':['rdavydov/Twitch-Channel-Points-Miner-v2','2.0.7'],
  'exifcleaner':['szTheory/exifcleaner','v4.5.0'],
  'nomacs':['nomacs/nomacs','3.22.4'],
  'optimizerduck':['itsfatduck/optimizerDuck','v2.29.0'],
  'ludusavi':['mtkennerly/ludusavi','v0.31.0']
};
// Snapshots of genuine published tags obtained from the linked GitHub repositories.
// Not used to pin versions at runtime: the release checker still fetches current releases.
const previouslyKnownTags = {
  '7zip':['26.04'], 'amnezia-client':['5.0.3.0'],
  'blur-autoclicker':['v3.9.6'], 'byebyedpi':['v.1.8.2'], 'caesium':['v2.8.5'],
  'compactgui':['v4.0.0-beta.12','Version 4.0 Beta 12'], 'ditto':['3.25.113.0'],
  'ffmpeg-builds':['autobuild-2026-10-08-13-05'], 'flow-launcher':['v2.1.4'],
  'lavfilters':['0.83'], 'dotnet35-offline':['2.3'], 'nv-profile-inspector':['v3.0.2.1'],
  'pinwindow':['v3.3.3'], 'prismlauncher':['11.1.1'], 'sharex':['v21.0.0'],
  'steam':['7.0.41'], 'qbittorrent':['release-5.2.4'], 'windhawk':['v1.7.3'], 'ytsage':['v5.5.6'],
  'imageglass':['10.0.6.906'], 'yt-dlp':['2026.08.19'], 'winhance':['v26.06.12'],
  'windows-update-disabler':['v2.0.0'], 'windows-defender-remover':['release13-rev1'],
  'trafficmonitor':['V1.86'], 'windirstat':['release/v2.9.2'], 'warp-generation':['3.1.0'],
  'gopeed':['v1.9.3'], 'winutil':['26.10.07'], 'privacy-sexy':['0.13.8'],
  'libre-hardware-monitor':['v0.9.6'], 'sumatra-pdf':['3.6.1rel'],
  'unigetui':['v2026.3.1'], 'rufus':['v4.15'], 'nanazip':['7.0.1843.0'],
  'ventoy':['v1.1.17'], 'notepad-plus-plus':['v8.9.8.1'],
  'telegram-desktop':['v7.2.9'],
  'losslesscut':['v3.69.0'], 'simplewall':['v.3.8.7']
};

test('five new GitHub projects use their exact releases URLs, verified tag formats and automatic checker',()=>{
  for (const [id,[repo,tag]] of Object.entries(newEntries)) {
    const p=byId[id]; assert.ok(p, id);
    const url=`https://github.com/${repo}/releases`;
    assert.equal(p.website,url,id);
    assert.deepEqual(p.actions,[{label:'Релизы',url}],id);
    assert.equal(p.versionSource.sourceId,'github-releases',id);
    assert.equal(p.versionSource.repo,repo,id);
    assert.equal(p.versionSource.releasePolicy.includePrerelease,false,id);
    assert.ok(new RegExp(p.versionSource.releasePolicy.versionPattern,'i').test(tag),id);
    assert.equal(sources[p.versionSource.sourceId].adapter,'github-releases',id);
  }
  assert.equal(catalog.length,126);
  assert.equal(catalog.filter(p=>p.type==='site').length,40);
  assert.equal(catalog.filter(p=>p.type!=='site').length,86);
});

test('every one of 45 GitHub Releases configurations accepts a real release tag and displays a version',()=>{
  const active=catalog.filter(p=>p.versionSource?.sourceId==='github-releases');
  assert.equal(active.length,45);
  assert.equal(new Set(active.map(p=>p.versionSource.repo.toLowerCase())).size,45);
  assert.equal(Object.keys(previouslyKnownTags).length,40);
  for (const p of active) {
    const s=p.versionSource, policy={...sources['github-releases'].defaultPolicy,...s.releasePolicy};
    const sample=previouslyKnownTags[p.id] || (newEntries[p.id] ? [newEntries[p.id][1]] : null);
    assert.ok(sample,`Missing audited release fixture for ${p.id}`);
    assert.ok(/^[-\w.]+\/[-\w.]+$/.test(s.repo),p.id);
    assert.equal(policy.includePrerelease,p.id==='compactgui',p.id); // CompactGUI explicitly tracks Beta release titles.
    const tag=policy.versionField==='name' ? sample[1] : sample[0];
    assert.ok(tag,`Release field absent: ${p.id}`);
    const match=policy.versionPattern ? new RegExp(policy.versionPattern,'i').exec(tag) : [tag];
    assert.ok(match,`GitHub tag does not match checker pattern for ${p.id}: ${tag}`);
    const version=match[1] || match[0];
    assert.ok(version,`Empty version for ${p.id}`);
    assert.notEqual(s.showLatestVersion,false,p.id);
    if (p.type==='site') assert.equal(s.showOnSiteCard,true,`${p.id}: hidden website version`);
    if (p.cardSummary) assert.match(renderer,/program-summary-version-lines/);
  }
  assert.match(rust,/"github-releases"\s*=>\s*check_github/);
  assert.match(renderer,/showLatestVersion && latest/);
});

test('two intentionally manual GitHub-linked cards remain without automatic version checking',()=>{
  const r=byId['revanced-gmscore'];
  assert.equal(r.versionSource.sourceId,'manual-official');
  assert.match(r.versionSource.reason,/независимые версии/);
  const m=byId['microsoft-activation-scripts'];
  assert.equal(m.versionSource,undefined); // no checking, even with an old cache entry
  assert.ok(m.cardSummary);
  assert.match(renderer,/program-summary-version-lines/);
  assert.ok(catalog.every(p=>p.id !== 'atk-hub'||!p.versionSource));
});

test('LosslessCut still checks latest GitHub version without a summary',()=>{
  assert.equal(byId.losslesscut.cardSummary,undefined);
  assert.ok(sources[byId.losslesscut.versionSource.sourceId].adapter);
  assert.match(renderer,/automaticSource && showLatestVersion && latest/);
  assert.match(renderer,/escapeHtml\(latest\)/);
  assert.match(renderer,/const hasVerifiedLatest = Boolean\(hasLatest && !isConfiguredFallbackResult\(live\)\)/);
});

test('renderer really paints checked GitHub versions on cards with summaries',async()=>{
  const vm=require('node:vm');
  class List {toggle(){} add(){} remove(){} contains(){return false}}
  class Node {constructor(){this.innerHTML='';this.textContent='';this.value='';this.style={};this.dataset={};this.classList=new List();this.scrollWidth=100;this.clientWidth=100;this.disabled=false}
    addEventListener(){} querySelectorAll(){return []} querySelector(){return null} contains(){return false} focus(){} setAttribute(){} removeAttribute(){} }
  class Input extends Node {}
  const ids=['loadingOverlay','loadingTitle','loadingDetail','loadingProgressBar','loadingCount','stats','refreshBtn','search','programFilterWrap','programFilterBtn','programFilterLabel','programFilterPopover','programFilterTitle','programFilterSummary','programFilterClose','programFilterSearch','programFilterOptions','grid','pagination','toast'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node()]));
  nodes.search=new Input();nodes.programFilterSearch=new Input();
  const document={getElementById:(id)=>nodes[id]||null,documentElement:{dataset:{}},body:new Node(),addEventListener(){},hasFocus:()=>true};
  const subset=['losslesscut','microsoft-activation-scripts'].map(id=>byId[id]);
  const cache={
    losslesscut:{ok:true,version:'3.69.0',publishedAtText:'01.03.2026',checkedAt:'2026-10-08T10:00:00Z'},
    'microsoft-activation-scripts':{ok:true,version:'3.12',publishedAt:'2025-12-31T00:00:00Z',checkedAt:'2026-10-08T10:00:00Z'}
  };
  const window={addEventListener(){},softwareHub:{getCatalog:async()=>({programs:subset,sources}),getVersionCache:async()=>cache,checkVersion:async()=>({ok:false}),getStartupRefreshIds:async()=>[],isInternetAvailable:async()=>false}};
  const ctx={document,window,navigator:{onLine:false},Element:Node,HTMLInputElement:Input,HTMLTextAreaElement:Input,URL,Intl,Date,Map,Set,Math,Number,String,Boolean,Object,Array,RegExp,Promise,console,requestAnimationFrame:(fn)=>{fn();return 1},setTimeout:()=>1,clearTimeout:()=>{}};
  vm.runInNewContext(renderer,ctx,{filename:'renderer.js'});
  await new Promise(resolve=>setImmediate(resolve));
  const html=nodes.grid.innerHTML;
  for (const p of subset) assert.match(html,new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.ok(html.includes('>3.69.0</span>'), 'LosslessCut version missing from card');
  assert.doesNotMatch(html, />(?:3\.12|0\.1\.0)<\/span>/, 'Removed/disabled versions must stay hidden even if cached');
  assert.equal((html.match(/program-summary-version-lines/g)||[]).length,0);
  assert.ok(html.includes('>Источник</span><span class="version-value source"'), 'LosslessCut source row missing');
  assert.ok(html.includes('>GitHub</span>'), 'GitHub source label missing');
  assert.ok(!html.includes('Быстрый монтаж видео и аудио без лишнего перекодирования.'), 'LosslessCut summary was not removed');
  assert.doesNotMatch(html, /01\.03\.2026|2025-12-31|02\.01\.2025/);
  assert.doesNotMatch(html, /<span>Релиз(?: сборника)?<\/span>/);
  assert.doesNotMatch(nodes.toast.textContent,/Не удалось загрузить каталог/);
});
