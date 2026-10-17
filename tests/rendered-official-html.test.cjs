'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const rust = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const programs = JSON.parse(fs.readFileSync(path.join(root, 'data/programs.json'),'utf8'));
const find = id => programs.find(p=>p.id===id);

test('only RTSS tries official HTML without a rendered WebView', () => {
  assert.match(rust, /field\(p, "id"\) == "rtss"/);
  assert.match(rust, /rtss_version_from_official_index/);
  assert.match(rust, /if probe_official_html && !same_official_page\(url, &final_url\)/);
  assert.match(rust, /if !from_cleaned && !probe_official_html/);
  assert.match(rust, /"official-html-version-not-found"/);
  assert.match(rust, /"official-guru3d-index"/);
  assert.match(rust, /"transport":if probe_official_html \{ "official-html" \}/);
});

test('the actual official source URLs and download buttons remain untouched', () => {
  assert.equal(programs.length,126);
  assert.equal(find('rtss').versionSource.renderedPageUrl, 'https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/');
  assert.equal(find('visualcpp').versionSource.renderedPageUrl, undefined);
  assert.equal(find('rtss').actions[0].url, find('rtss').website);
  assert.equal(find('visualcpp').actions[0].url, find('visualcpp').website);
  assert.match(rust, /fn rendered_html_probe_only_accepts_exact_official_document/);
  assert.match(rust, /fn rtss_html_probe_finds_only_official_release_title_not_other_downloads/);
  assert.doesNotMatch(rust, /fn visualcpp_html_probe_requires_explicit_runtime_version/);
});

test('HTTPS and response-size limits stay enabled and unverified results stay fallback', () => {
  assert.match(rust, /if normalized_https\(address\)\.is_none\(\)/);
  assert.match(rust, /MAX_NETWORK_BYTES/);
  assert.match(rust, /if !from_cleaned && !probe_official_html/);
  assert.match(rust, /configured_fallback\(p,source,&reason\)/);
  assert.doesNotMatch(rust.slice(rust.indexOf("fn check_official("), rust.indexOf("#[tauri::command]\nasync fn check_version")), /parsed_date|official-html-date/);
});
