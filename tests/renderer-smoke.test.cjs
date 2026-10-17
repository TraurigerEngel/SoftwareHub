const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'web', 'renderer.js'), 'utf8');

class FakeClassList {
  add() {}
  remove() {}
  toggle() {}
  contains() { return false; }
}
class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.scrollTop = 0;
    this.scrollWidth = 100;
    this.clientWidth = 100;
  }
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  querySelectorAll() { return []; }
  querySelector() { return null; }
  contains() { return false; }
  closest() { return null; }
  focus() {}
  setPointerCapture() {}
}
class FakeInputElement extends FakeElement {}
class FakeTextAreaElement extends FakeElement {}

function makeDocument() {
  const ids = ['loadingOverlay','loadingTitle','loadingDetail','loadingProgressBar','loadingCount','stats','refreshBtn','search','programFilterWrap','programFilterBtn','programFilterLabel','programFilterPopover','programFilterTitle','programFilterSummary','programFilterClose','programFilterSearch','programFilterOptions','grid','pagination','toast'];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  elements.search = new FakeInputElement('search');
  elements.programFilterSearch = new FakeInputElement('programFilterSearch');
  return {
    elements,
    body: new FakeElement('body'),
    documentElement: { dataset: { startup:'loading' } },
    getElementById(id) { return elements[id] || null; },
    addEventListener() {},
    hasFocus() { return true; }
  };
}

test('renderer boots and renders a minimal catalog without falling into the error state', async () => {
  const document = makeDocument();
  const window = {
    addEventListener() {},
    softwareHub: {
      async getCatalog() {
        return {
          programs: [
            { id:'demo-app', name:'Demo App', programCategory:'Система', website:'https://example.test/app', actions:[{label:'Сайт',url:'https://example.test/app'}] },
            { id:'demo-site', name:'Demo Site', type:'site', siteCategory:'Сеть', siteSummary:'Тестовый сайт.', website:'https://example.test/', actions:[{label:'Открыть',url:'https://example.test/'}] }
          ],
          sources: {}
        };
      },
      async getVersionCache() { return {}; },
      async setVersionCache() { return true; },
      async checkVersion() { return { ok:false, reason:'unused' }; },
      async isInternetAvailable() { return false; },
      async openExternal() { return true; },
      async copyCatalogText() { return true; }
    }
  };
  const context = {
    window,
    document,
    navigator:{ onLine:false },
    Element:FakeElement,
    HTMLInputElement:FakeInputElement,
    HTMLTextAreaElement:FakeTextAreaElement,
    URL,
    Intl,
    Date,
    Map,
    Set,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    RegExp,
    Promise,
    console,
    requestAnimationFrame:(fn) => { fn(); return 1; },
    setTimeout:() => 1,
    clearTimeout:() => {},
  };
  vm.runInNewContext(renderer, context, { filename:'renderer.js' });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(document.elements.grid.innerHTML, /Demo App/);
  assert.match(document.elements.grid.innerHTML, /Demo Site/);
  assert.match(document.elements.stats.innerHTML, />2</);
  assert.doesNotMatch(document.elements.toast.textContent, /Не удалось загрузить каталог/);
  assert.equal(document.documentElement.dataset.startup, 'ready');
});
