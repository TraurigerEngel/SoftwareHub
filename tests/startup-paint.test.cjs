'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = source('web/index.html');
const css = source('web/styles.css');
const renderer = source('web/renderer.js');
const bridge = source('web/bridge.js');

class ClassList {
  constructor() { this.values = new Set(); }
  add(x) { this.values.add(x); }
  remove(x) { this.values.delete(x); }
  toggle(x, flag) { if (flag ?? !this.values.has(x)) this.add(x); else this.remove(x); }
  contains(x) { return this.values.has(x); }
}
class Elem {
  constructor() {
    this.classList = new ClassList(); this.dataset = {}; this.textContent = '';
    this.innerHTML = ''; this.value = ''; this.style = {};
    this.scrollWidth = 100; this.clientWidth = 100;
    this.listeners = {};
  }
  addEventListener(n, cb) { this.listeners[n] = cb; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  removeAttribute() {}
  setAttribute() {}
  closest() { return null; }
  contains() { return false; }
  focus() {}
}
class Input extends Elem {}
class TextArea extends Elem {}

function fakeDocument() {
  const names = ['loadingOverlay', 'loadingTitle', 'loadingDetail', 'loadingProgressBar',
    'loadingCount', 'stats', 'refreshBtn', 'search', 'programFilterWrap', 'programFilterBtn',
    'programFilterLabel', 'programFilterPopover', 'programFilterTitle', 'programFilterSummary',
    'programFilterClose', 'programFilterSearch', 'programFilterOptions', 'grid', 'pagination',
    'toast', 'startupScreen', 'startupStatus', 'startupRetry', 'windowMinimize', 'windowClose'];
  const elements = Object.fromEntries(names.map(name => [name, new Elem()]));
  elements.search = new Input();
  elements.programFilterSearch = new Input();
  elements.startupRetry.classList.add('hidden');
  return {
    elements, body: new Elem(), documentElement: { dataset:{ startup:'loading' } },
    getElementById(name) { return this.elements[name] || null; },
    addEventListener() {}, hasFocus() { return true; }
  };
}

function rendererHarness(hub) {
  const document = fakeDocument();
  const frames = [];
  const window = { addEventListener() {}, softwareHub:hub };
  const sandbox = {
    document, window, navigator:{onLine:false}, Element:Elem, HTMLInputElement:Input,
    HTMLTextAreaElement:TextArea, URL, Intl, Date, Map, Set, Math, Number,
    String, Boolean, Object, Array, RegExp, Promise, console,
    requestAnimationFrame(cb) { frames.push(cb); return frames.length; },
    setTimeout:() => 1, clearTimeout:() => {}
  };
  vm.runInNewContext(renderer, sandbox, {filename:'renderer.js'});
  return {document, frames};
}
const makeHub = (overrides={}) => ({
  async getCatalog() { return {programs:[{id:'app',name:'Ready App',programCategory:'Система',website:'https://example.test'}], sources:{}}; },
  async getVersionCache() { return {}; },
  async getStartupRefreshIds() { return []; },
  ...overrides
});
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await new Promise(resolve=>setImmediate(resolve)); };

test('static first paint hides only unfinished catalog, not window controls', () => {
  const config = JSON.parse(source('src-tauri/tauri.conf.json'));
  assert.equal(config.app.windows[0].visible, true);
  assert.match(html, /<html lang="ru" data-startup="loading">/);
  assert.ok(html.indexOf('id="startupScreen"') < html.indexOf('class="app-shell"'));
  assert.match(css, /html\[data-startup="loading"\] \.app-shell\s*\{\s*visibility:\s*hidden/);
  assert.match(css, /\.startup-screen\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/);
  assert.match(css, /\.startup-screen\s*\{[\s\S]*?inset:\s*42px 0 0/);
  assert.ok(!source('src-tauri/tauri.conf.json').includes('disable-gpu'));
});

test('two-phase handoff clears splash label before uncovering catalog', () => {
  const rule = selector => css.match(new RegExp(selector + '\\s*\\{([^}]*)\\}'))?.[1];
  const name = rule('html\\[data-startup="ready"\\] \\.startup-panel');
  const cover = rule('html\\[data-startup="ready"\\] \\.startup-screen');
  assert.ok(name, 'ready state must fade the label separately');
  assert.ok(cover, 'ready state must hide the cover');
  assert.match(name, /opacity:\s*0;/);
  assert.match(name, /transition:\s*opacity 200ms ease-in-out 1000ms;/);
  assert.match(cover, /opacity:\s*0;/);
  assert.match(cover, /visibility:\s*hidden;/);
  assert.doesNotMatch(cover, /pointer-events:\s*none;/, 'cover must block clicks until it is hidden');
  assert.match(cover, /transition:\s*opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms;/);
  // Prove that the text is fully gone before the cover starts revealing cards.
  const [, nameLength, nameDelay] = name.match(/transition: opacity (\d+)ms ease-in-out (\d+)ms;/) || [];
  const [, coverLength, coverDelay, hideDelay] = cover.match(/transition: opacity (\d+)ms ease-in-out (\d+)ms, visibility 0s linear (\d+)ms;/) || [];
  assert.ok(Number(nameLength) + Number(nameDelay) < Number(coverDelay), 'no title/catalog overlap');
  assert.equal(Number(coverLength) + Number(coverDelay), Number(hideDelay), 'hide only after reveal is complete');
  assert.doesNotMatch(css, /html\[data-startup="ready"\] \.app-shell\s*\{[^}]*transition:/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.startup-panel,[\s\S]*?\.startup-screen\s*\{\s*transition:\s*none;/);
  // No JavaScript delays, timers or changes to the ready gate are required.
  assert.match(renderer, /requestAnimationFrame\(\(\) => \{\s*document\.documentElement\.dataset\.startup = 'ready';/);
});

test('catalog remains gated until BOTH catalog and cache load and initial render completes', async () => {
  let resolveCache;
  const cached = new Promise(resolve => { resolveCache = resolve; });
  const h = rendererHarness(makeHub({getVersionCache:() => cached}));
  await settle();
  assert.equal(h.document.documentElement.dataset.startup, 'loading');
  assert.equal(h.document.elements.grid.innerHTML, '');
  resolveCache({});
  await settle();
  assert.match(h.document.elements.grid.innerHTML, /Ready App/);
  assert.match(h.document.elements.stats.innerHTML, /stat-chip/);
  assert.equal(h.document.documentElement.dataset.startup, 'loading', 'UI cannot reveal before a paint-frame');
  for (const frame of h.frames) frame();
  assert.equal(h.document.documentElement.dataset.startup, 'ready');
});

test('a failed catalog IPC still reveals the error state instead of trapping loading screen', async () => {
  const h = rendererHarness(makeHub({getCatalog:async()=>{ throw new Error('catalog error'); }}));
  await settle();
  assert.equal(h.document.documentElement.dataset.startup, 'loading');
  for (const frame of h.frames) frame();
  assert.equal(h.document.documentElement.dataset.startup, 'ready');
  assert.match(h.document.elements.toast.textContent, /Не удалось загрузить каталог: catalog error/);
  assert.equal(h.document.elements.toast.dataset.kind,'warning');
});

test('renderer-independent watchdog exposes retry after 12 seconds, not an infinite spinner', () => {
  const document = fakeDocument();
  const tasks = [];
  let reloads = 0;
  const window = { location:{reload:()=>{reloads++;}}, addEventListener() {} };
  vm.runInNewContext(bridge, {document,window, Object, Error, Promise, console,
    setTimeout:(fn,ms)=>{tasks.push({fn,ms});return tasks.length;}});
  assert.equal(tasks.length,1);
  assert.equal(tasks[0].ms, 12000);
  tasks[0].fn();
  assert.match(document.elements.startupStatus.textContent,/слишком много времени/);
  assert.equal(document.elements.startupRetry.classList.contains('hidden'),false);
  document.elements.startupRetry.listeners.click();
  assert.equal(reloads,1);
});

test('watchdog never triggers after successful initialization', () => {
  const document = fakeDocument();
  const tasks = [];
  const window = {location:{reload() {}},addEventListener() {}};
  vm.runInNewContext(bridge,{document,window,Object,Error,Promise,console,setTimeout:(fn)=>{tasks.push(fn);}});
  document.documentElement.dataset.startup = 'ready';
  tasks[0]();
  assert.equal(document.elements.startupRetry.classList.contains('hidden'),true);
  assert.equal(document.elements.startupStatus.textContent,'');
});
