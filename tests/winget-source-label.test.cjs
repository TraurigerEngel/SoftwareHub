'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'web', 'renderer.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'programs.json'), 'utf8'));
const sourceStart = renderer.indexOf('function sourceId(program) {');
const sourceEnd = renderer.indexOf('function renderActionButtons(program) {');
assert.ok(sourceStart >= 0 && sourceEnd > sourceStart, 'the source-label functions must exist');
const sourceFunctions = renderer.slice(sourceStart, sourceEnd);

function labelFor(program, result, sourceLabelValue = 'Страница производителя') {
  const code = `(() => {
    const versionCache = new Map([['${program.id}', __result]]);
    const sources = { [__sourceId]: { label: __sourceLabelValue } };
    ${sourceFunctions}
    return sourceLabel(__program);
  })()`;
  return vm.runInNewContext(code, {
    __result: result,
    __program: program,
    __sourceId: program.versionSource?.sourceId || program.versionSource?.type,
    __sourceLabelValue: sourceLabelValue,
    Map
  });
}

test('all five verified community WinGet fallbacks disclose the community source', () => {
  const ids = ['adwcleaner', 'afterburner', 'gpu-z', 'nvcleanstall', 'rtss'];
  for (const id of ids) {
    const program = catalog.find(entry => entry.id === id);
    assert.ok(program, `missing catalog entry: ${id}`);
    assert.equal(labelFor(program, {ok:true, transport:'winget-community-manifest', version:'1.2.3'}), 'WinGet (сообщество)', id);
  }
});

test('vendor results, failed results and unrelated programs are not mislabeled WinGet', () => {
  const byId = Object.fromEntries(catalog.map(entry => [entry.id, entry]));
  const vendorLabel = 'Страница производителя';
  assert.equal(labelFor(byId['gpu-z'], {ok:true, transport:'fetch', version:'2.71.0'}, vendorLabel), vendorLabel);
  assert.equal(labelFor(byId.nvcleanstall, {ok:false, transport:'winget-community-manifest'}, vendorLabel), vendorLabel);
  assert.equal(labelFor(byId['cpu-z'], {ok:true, transport:'winget-community-manifest'}, vendorLabel), vendorLabel);
});
