'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'web/renderer.js'), 'utf8');
const rust = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const programs = JSON.parse(fs.readFileSync(path.join(root, 'data/programs.json'), 'utf8'));

const functions = vm.runInNewContext(renderer.slice(0, renderer.indexOf('function visiblePrograms(')) + '\n({visibleCardSearchText, sourceLabel, getSourceCheckState})', {Intl, Date, URL, Map});

test('search and card rendering no longer use release dates', () => {
  assert.doesNotMatch(renderer, /resolvedReleaseDate|releaseFieldLabel|showReleaseDate|siteReleaseDate|oldDate|newDate/);
  assert.doesNotMatch(renderer, /const reallyChanged =[^\n]*(?:publishedAt|date)/i);
  assert.match(renderer, /const reallyChanged = !previousVerified \|\| oldVersion !== newVersion/);
  assert.match(renderer, /class="version-line"/);
  assert.match(renderer, /Последняя версия/);
  assert.match(renderer, /Проверено: \$\{checkedAt\}/);
});

test('Rust logs contain versions only, and cache strips legacy release dates', () => {
  const logSection = rust.slice(rust.indexOf('fn append_check_log_in('), rust.indexOf('fn finish_check_log_in('));
  assert.doesNotMatch(logSection, /Дата релиза|oldDate|newDate/);
  assert.match(logSection, /Версия: \{\} → \{\}/);
  assert.match(rust, /safe\.remove\("publishedAt"\)/);
  assert.match(rust, /safe\.remove\("publishedAtText"\)/);
  assert.match(rust, /Изменена версия или впервые подтверждена/);
});

test('GitHub and configured fallback return versions without release date fields', () => {
  const github = rust.slice(rust.indexOf('fn check_github('), rust.indexOf('fn strip_html('));
  const fallback = rust.slice(rust.indexOf('fn configured_fallback('), rust.indexOf("fn pick_releases<"));
  assert.doesNotMatch(github, /"publishedAt"|"publishedAtText"/);
  assert.doesNotMatch(fallback, /"publishedAt"|"publishedAtText"/);
  assert.match(github, /"version":version/);
  assert.match(fallback, /"version":version/);
});

test('Visual C++ has no automatic version and keeps the official download URL', () => {
  const p = programs.find(p => p.id === 'visualcpp');
  assert.equal(p.versionSource.sourceId, undefined);
  assert.equal(p.versionSource.fallbackVersion, undefined);
  assert.equal(p.versionSource.showLatestVersion, false);
  assert.equal(p.versionSource.showSource, false);
  assert.equal(p.actions[0].url, 'https://www.techpowerup.com/download/visual-c-redistributable-runtime-package-all-in-one/');
});
