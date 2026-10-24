"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../web/renderer.js"), "utf8");

class Element {
  constructor() {
    this.listeners = {}; this.dataset = {}; this.style = {};
    this.textContent = ''; this.innerHTML = ''; this.value = ''; this.disabled = false;
    this.scrollWidth = 100; this.clientWidth = 100; this.scrollTop = 0;
    this.classList = { add(){}, remove(){}, toggle(){}, contains(){return false} };
  }
  addEventListener(key, fn) { this.listeners[key] = fn; }
  querySelectorAll(){return [];} querySelector(){return null;}
  removeAttribute(){} setAttribute(){} closest(){return null;}
  contains(){return false;} focus(){} setPointerCapture(){}
}
class Input extends Element {}
class Textarea extends Element {}
const nextTick = () => new Promise(resolve => setImmediate(resolve));
async function harness() {
  const ids = ["loadingOverlay", "loadingTitle", "loadingDetail", "loadingProgressBar", "loadingCount", "stats", "refreshBtn", "search", "programFilterWrap", "programFilterBtn", "programFilterLabel", "programFilterPopover", "programFilterTitle", "programFilterSummary", "programFilterClose", "programFilterSearch", "programFilterOptions", "grid", "pagination", "toast"];
  const elems = Object.fromEntries(ids.map(id => [id, new Element()]));
  elems.search = new Input(); elems.programFilterSearch = new Input();
  const document = {body:new Element(),documentElement:{dataset:{startup:"loading"}},
    getElementById:id=>elems[id]||null, hasFocus:()=>true, addEventListener(){} };
  const calls = {startupIds:0, internet:0, check:0, cacheWrites:0, idle:0, backgroundLog:0, manualLog:0};
  const hub = {
    getCatalog: async()=>({programs:[{id:"winscp",name:"WinSCP",programCategory:"Файлы",type:"program",website:"https://winscp.net/eng/download.php",versionSource:{sourceId:"official-page"},actions:[{label:"Скачать",url:"https://winscp.net/eng/download.php"}]}],sources:{"official-page":{adapter:"official-page",label:"Официальная страница"}}}),
    getVersionCache:async()=>({winscp:{ok:true,version:"6.7",checkedAt:"2026-10-24T00:00:00Z",transport:"official-html"}}),
    getStartupRefreshIds:async()=>{calls.startupIds++;return ["winscp"];},
    isInternetAvailable:async()=>{calls.internet++;return true;},
    checkVersion:async()=>{calls.check++;return {ok:true,version:"6.7",transport:"official-html"};},
    startVersionCheckLog:async(mode)=>{ if(mode==='manual') calls.manualLog++; else calls.backgroundLog++; return "test-log"; },
    appendVersionCheckLog:async()=>true,finishVersionCheckLog:async()=>true,
    setVersionCache:async()=>{calls.cacheWrites++;return true;},
    openExternal:async()=>true, copyCatalogText:async()=>true
  };
  const frames = [], timers = [], idle = [];
  const window = {softwareHub:hub, addEventListener(){}, requestIdleCallback(cb){calls.idle++;idle.push(cb);} };
  const ctx={document,window,navigator:{onLine:true},URL,Intl,Date,Map,Set,Math,Number,String,Boolean,Object,Array,RegExp,Promise,console,Element,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,
    requestAnimationFrame(cb){frames.push(cb);return frames.length;},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}};
  vm.runInNewContext(source,ctx,{filename:"renderer.js"});
  await nextTick();
  frames.splice(0).forEach(fn=>fn());
  await nextTick();
  return {elems,document,calls,frames,timers,idle,window};
}

test("no automatic version request, no idle refresh and saved versions render after startup", async()=>{
  assert.doesNotMatch(source,/\b(?:startupVersionRefresh|scheduleStartupVersionRefresh)\b/);
  assert.match(source,/await restoreCache\(\)/);
  assert.match(source,/el\('refreshBtn'\)\.addEventListener\('click', \(\) => checkVersions\(\)\)/);
  const h = await harness();
  assert.equal(h.document.documentElement.dataset.startup,"ready");
  assert.match(h.elems.grid.innerHTML,/WinSCP/);
  assert.match(h.elems.grid.innerHTML,/6\.7/);
  assert.equal(h.calls.startupIds,0);
  assert.equal(h.calls.internet,0);
  assert.equal(h.calls.check,0);
  assert.equal(h.calls.cacheWrites,0);
  assert.equal(h.calls.idle,0);
  assert.equal(h.calls.backgroundLog,0);
  for (const fn of h.timers) fn();
  for (const fn of h.idle) fn();
  await nextTick();
  assert.equal(h.calls.check,0,"pending startup timers cannot start checks");
  assert.equal(h.calls.internet,0,"startup must not perform connectivity probes");
});

test("clicking only the Refresh button starts checks and saves the new cache", async()=>{
  const h=await harness();
  assert.equal(typeof h.elems.refreshBtn.listeners.click,"function");
  h.elems.refreshBtn.listeners.click();
  await nextTick();
  await nextTick();
  assert.equal(h.calls.manualLog,1);
  assert.equal(h.calls.backgroundLog,0);
  assert.equal(h.calls.internet,1);
  assert.equal(h.calls.check,1);
  assert.equal(h.calls.cacheWrites,1);
  assert.equal(h.elems.refreshBtn.disabled,false);
});
