'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const programs = JSON.parse(fs.readFileSync(path.join(root, 'data/programs.json'), 'utf8'));
const lib = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const python = programs.find(p => p.id === 'python-windows');

test('Python checker stays on official Windows stable-release header without changing download links', () => {
  assert.equal(programs.length, 126);
  assert.equal(python.website, 'https://www.python.org/downloads/windows/');
  assert.equal(python.versionSource.url, python.website);
  assert.equal(python.versionSource.fallbackVersion, '3.14.7'); // unverified fallback must not be raised manually
  assert.ok(python.versionSource.versionPattern.startsWith(String.raw`Latest\s+Python\s+3\s+Release`));
  assert.match(lib, /python_windows_latest_stable_release_handles_encoded_separators/);
});

test('Python checker accepts HTML entity, Unicode dash and missing dash, but rejects prereleases', () => {
  const rx = new RegExp(python.versionSource.versionPattern, 'i');
  const values = [
    'Latest Python 3 Release - Python 3.14.8',
    'Latest Python 3 Release &ndash; Python 3.14.8',
    'Latest Python 3 Release &#8211; Python 3.14.8',
    'Latest Python 3 Release — Python 3.14.8',
    'Latest Python 3 Release Python 3.14.8',
  ];
  for (const text of values) assert.equal(rx.exec(text)?.[1], '3.14.8', text);
  for (const text of [
    'Latest Python install manager - Python install manager 26.3 Stable Releases Python 3.13.16',
    'Latest Python 3 Release - Python 3.15.0rc3',
    'Pre-releases Python 3.15.0rc3',
  ]) assert.equal(rx.exec(text), null, text);
});
