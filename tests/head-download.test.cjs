'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const rust = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'lib.rs'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'programs.json'), 'utf8'));

test('official-download uses HEAD metadata and keeps the configured official installer URL', () => {
  const radmin = catalog.find(p => p.id === 'radminvpn');
  assert.ok(radmin, 'Radmin VPN must exist in catalog');
  assert.equal(radmin.versionSource.sourceId, 'official-download');
  assert.match(radmin.versionSource.url, /^https:\/\/download\.radmin-vpn\.com\//);
  assert.match(rust, /adapter == "official-download" \{ reqwest::Method::HEAD \}/);
  assert.match(rust, /headers\.get\("content-disposition"\)/);
});

test('HEAD returns before Content-Length checks or reading response bytes', () => {
  const helper = rust.split('fn read_response_body_limited')[1]?.split('fn fetch_limited')[0];
  assert.ok(helper, 'bounded-response helper missing');
  const earlyReturn = helper.indexOf('if *method == reqwest::Method::HEAD { return Ok(String::new()); }');
  const lengthCheck = helper.indexOf('CONTENT_LENGTH');
  const bodyRead = helper.indexOf('reader.read(');
  assert.ok(earlyReturn >= 0 && earlyReturn < lengthCheck && lengthCheck < bodyRead);
  assert.match(rust, /fn head_download_metadata_does_not_trigger_html_size_limit_or_read_body/);
  assert.match(rust, /fn get_responses_remain_strictly_size_bounded/);
});
