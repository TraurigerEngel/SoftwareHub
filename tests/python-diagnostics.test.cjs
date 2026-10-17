'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const rust = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const programs = JSON.parse(fs.readFileSync(path.join(root, 'data/programs.json'), 'utf8'));

test('Python diagnostics run only on a parsing miss and do not turn fallback into verified data', () => {
  assert.match(rust, /if matches\.is_empty\(\) \{\s*if field\(p, "id"\) == "python-windows"/);
  assert.match(rust, /python_diagnostic\.unwrap_or\("python-version-not-found"\)/);
  assert.match(rust, /fn python_windows_page_diagnostic\(raw: &str, cleaned: &str\)/);
  assert.match(rust, /configured_fallback\(p,source,&reason\)/);
});

test('Diagnostic outputs are constant labels, not a saved copy of source HTML or secrets', () => {
  for (const label of ['python-page-access-challenge', 'python-header-present-pattern-miss',
    'python-stable-section-without-header', 'python-windows-page-unexpected-layout',
    'python-unexpected-response', 'python-empty-response']) assert.ok(rust.includes('"' + label + '"'));
  assert.equal(programs.length, 126);
  const python = programs.find(p => p.id === 'python-windows');
  assert.equal(python.versionSource.url, 'https://www.python.org/downloads/windows/');
  assert.equal(python.versionSource.fallbackVersion, '3.14.7');
});
