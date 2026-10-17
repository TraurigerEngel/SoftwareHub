'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
const renderer = fs.readFileSync(path.join(root,'web/renderer.js'),'utf8');
const bridge = fs.readFileSync(path.join(root,'web/bridge.js'),'utf8');
const rust = fs.readFileSync(path.join(root,'src-tauri/src/lib.rs'),'utf8');

class FakeElement {
  constructor(id='') {this.id=id;this.value='';this.textContent='';this.innerHTML='';this.disabled=false;this.dataset={};this.style={};this.classList={add(){},remove(){},toggle(){},contains(){return false}};this.scrollWidth=100;this.clientWidth=100;this.scrollTop=0;}
  addEventListener(){} setAttribute(){} removeAttribute(){} querySelectorAll(){return []} querySelector(){return null} contains(){return false} closest(){return null} focus(){} setPointerCapture(){}
}
class FakeInputElement extends FakeElement {}
class FakeTextAreaElement extends FakeElement {}
async function setup({online=true, results={}, previous={}} = {}) {
  const events=[];
  const names=['alpha','beta','gamma','delta'];
  const programs=names.map(id=>({id,name:id,programCategory:'Утилиты',website:'https://example.test/',actions:[{label:'Сайт',url:'https://example.test/'}],versionSource:{sourceId:'official-page'}}));
  const sources={'official-page':{adapter:'official-page',label:'Официальная страница'}};
  const ids=['loadingOverlay','loadingTitle','loadingDetail','loadingProgressBar','loadingCount','stats','refreshBtn','search','programFilterWrap','programFilterBtn','programFilterLabel','programFilterPopover','programFilterTitle','programFilterSummary','programFilterClose','programFilterSearch','programFilterOptions','grid','pagination','toast'];
  const elements=Object.fromEntries(ids.map(id=>[id,new FakeElement(id)]));
  elements.search=new FakeInputElement('search');
  elements.programFilterSearch=new FakeInputElement('programFilterSearch');
  const document={getElementById:id=>elements[id]||null,addEventListener(){},hasFocus(){return true},body:new FakeElement('body'),documentElement:{dataset:{startup:'loading'}}};
  const window={ addEventListener(){}, softwareHub: {
    async getCatalog(){return {programs,sources}}, async getVersionCache(){return previous},
    async getStartupRefreshIds(){return []}, async setVersionCache(c){events.push(['cache',c]);return true},
    async checkVersion(id){return results[id] || {ok:false,reason:'no-response'}},
    async isInternetAvailable(){return online},
    async startVersionCheckLog(mode,planned){events.push(['start',mode,planned]);return 'check-20261008T120000000Z-1-00000.txt'},
    async appendVersionCheckLog(id,data){events.push(['entry',id,data]);return true},
    async finishVersionCheckLog(id,summary){events.push(['finish',id,summary]);return true},
    async openExternal(){return true},async copyCatalogText(){return true}
  }};
  const context={window,document,navigator:{onLine:online},Element:FakeElement,HTMLInputElement:FakeInputElement,HTMLTextAreaElement:FakeTextAreaElement,URL,Intl,Date,Map,Set,Math,Number,String,Boolean,Object,Array,RegExp,Promise,console,requestAnimationFrame:fn=>{fn();return 1},setTimeout:()=>1,clearTimeout() {}};
  vm.runInNewContext(renderer,context,{filename:'renderer.js'});
  await new Promise(resolve=>setImmediate(resolve));
  return {events,context,elements};
}

test('diagnostics bridge is Rust-only and logs do not require frontend filesystem access',()=>{
  for(const command of ['start_version_check_log','append_version_check_log','finish_version_check_log']){
    assert.match(bridge,new RegExp(`'${command}'`));
    assert.match(rust,new RegExp(`fn ${command}\\(`));
  }
  assert.match(rust,/MAX_CHECK_LOGS: usize = 40/);
  assert.match(rust,/create_new\(true\)/);
  assert.match(rust,/safe_log_name/);
  assert.match(rust,/check_log_tracks_progress_and_preserves_completion_after_reopen/);
  assert.match(rust,/check_log_rotation_keeps_latest_forty_and_ignores_foreign_files/);
});
test('manual checks log new data, unchanged results, fallbacks and failures with real reasons',async()=>{
  const {events,context}=await setup({
    previous:{alpha:{ok:true,version:'1.0',publishedAt:'2026-10-01',checkedAt:'2026-10-01T00:00:00Z'},beta:{ok:true,version:'2.0',publishedAt:'2026-10-01',checkedAt:'2026-10-01T00:00:00Z'}},
    results:{alpha:{ok:true,version:'1.1',publishedAt:'2026-10-07',transport:'fetch'},beta:{ok:true,version:'2.0',publishedAt:'2026-10-01'},gamma:{ok:true,version:'3',verification:'configured-fallback',reason:'rendered-page-pending-port'},delta:{ok:false,reason:'HTTP 403'}}
  });
  await context.checkVersions({connectivityChecked:true});
  const outcomes=events.filter(e=>e[0]==='entry').map(e=>e[2]);
  assert.deepEqual(outcomes.map(e=>e.status).sort(),['changed','error','fallback','unchanged']);
  assert.equal(outcomes.find(e=>e.programId==='alpha').oldVersion,'1.0');
  assert.equal(outcomes.find(e=>e.programId==='alpha').newVersion,'1.1');
  assert.equal(outcomes.find(e=>e.programId==='gamma').reason,'rendered-page-pending-port');
  assert.equal(outcomes.find(e=>e.programId==='delta').reason,'HTTP 403');
  assert.equal(events[0][0],'start');
  assert.equal(events.at(-1)[0],'finish');
  assert.equal(events.at(-1)[2].changed,1);
  assert.equal(events.at(-1)[2].unchanged,1);
  assert.equal(events.at(-1)[2].fallback,1);
  assert.equal(events.at(-1)[2].errors,1);
});
test('offline manual run still creates and finalizes a report',async()=>{
  const {events,context}=await setup({online:false});
  await context.checkVersions();
  assert.equal(events[0][0],'start');
  assert.equal(events.at(-1)[0],'finish');
  assert.equal(events.at(-1)[2].status,'offline');
  assert.equal(events.filter(e=>e[0]==='entry').length,0);
});

test('date-only change does not count as a new program version', async () => {
  const {events,context}=await setup({
    previous:{alpha:{ok:true,version:'1.0',publishedAt:'2026-01-01T00:00:00Z',checkedAt:'2026-10-01T00:00:00Z'}},
    results:{alpha:{ok:true,version:'1.0',publishedAt:'2026-10-08T00:00:00Z',transport:'github-atom'}}
  });
  await context.checkVersions({connectivityChecked:true});
  const alpha=events.find(e=>e[0]==='entry' && e[2].programId==='alpha')[2];
  assert.equal(alpha.status,'unchanged');
  assert.equal(Object.hasOwn(alpha,'oldDate'),false);
  assert.equal(Object.hasOwn(alpha,'newDate'),false);
  assert.equal(events.at(-1)[2].unchanged,1);
});
