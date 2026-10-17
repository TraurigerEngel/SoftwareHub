'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const rust = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root,'data/programs.json'),'utf8'));
const python = catalog.find(p => p.id === 'python-windows');

test('only Python retries official RSS after unrecognized HTML', () => {
  assert.match(rust, /if field\(p, "id"\) == "python-windows" \{\s*if let Some\(version\) = check_python_official_rss\(client\)/);
  assert.match(rust, /const FEED: &str = "https:\/\/www\.python\.org\/downloads\/feed\.rss"/);
  assert.match(rust, /"transport":"python-rss"/);
  assert.match(rust, /python_rss_stable_version\(&xml\)/);
  assert.equal(python.website, 'https://www.python.org/downloads/windows/');
  assert.equal(python.versionSource.url, python.website);
  assert.equal(python.versionSource.fallbackVersion, '3.14.7');
  assert.equal(catalog.length,126);
});

test('RSS only trusts matching official HTTPS stable release title and permalink', () => {
  assert.match(rust,/fn python_official_rss_selects_highest_proven_stable_release_only/);
  assert.match(rust,/fn python_official_rss_rejects_unrelated_or_unverifiable_versions/);
  assert.match(rust,/release_path = format!/);
  assert.match(rust,/matches!\(link_url\.host_str\(\), Some\("www\.python\.org" \| "python\.org"\)\)/);
  assert.match(rust,/if final_url\.scheme\(\) != "https"/);
  assert.match(rust,/"publishedAt":null,"publishedAtText":null/);
  assert.match(rust,/"htmlUrl":p\.get\("website"\)/);
});
