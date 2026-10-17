'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rust = fs.readFileSync(path.join(__dirname, '..', 'src-tauri/src/lib.rs'), 'utf8');
const checker = rust.slice(rust.indexOf('fn check_official('), rust.indexOf('#[tauri::command]\nasync fn check_version'));

test('official version checks no longer parse or return release dates', () => {
  assert.doesNotMatch(rust, /fn (?:parse_published_date|normalize_date|parse_date_from_version|release_date_from_version_match|verified_or_configured_date|visualcpp_latest_package_date)\s*\(/);
  assert.doesNotMatch(checker, /parse_published_date|release_date_from_version_match|visualcpp_latest_package_date|verified_or_configured_date|official-html-date/);
  assert.match(checker, /"version":version,"rawVersion":full_match/);
  assert.match(checker, /configured_fallback\(p,source,&reason\)/);
});
test('date-only checking is disabled but version checking remains available', () => {
  assert.match(rust, /adapter == "official-page-date" \{return default_failure\("manual-source"\)/);
  assert.match(rust, /"github-releases"=>check_github/);
  assert.match(rust, /"official-page"\|"dotnet-official"\|"official-download"=>check_official/);
});
