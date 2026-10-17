'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lib = fs.readFileSync(path.join(__dirname, '../src-tauri/src/lib.rs'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '../web/renderer.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/programs.json'), 'utf8'));

test('WinGet fallback allowlist includes AdwCleaner, Afterburner, GPU-Z and NVCleanstall', () => {
  assert.match(lib, /"adwcleaner"\s*=>\s*Some\(\("manifests\/m\/Malwarebytes\/AdwCleaner", "Malwarebytes\.AdwCleaner"\)\)/);
  assert.match(lib, /"afterburner"\s*=>\s*Some\(\("manifests\/g\/Guru3D\/Afterburner", "Guru3D\.Afterburner"\)\)/);
  assert.doesNotMatch(lib, /Guru3D\.Afterburner\.Beta/);
  assert.match(lib, /!any_content && last_fetch_error\.as_deref\(\) == Some\("HTTP 403"\)/);
});

test('community manifest is verified twice and never borrows an unverified release date', () => {
  assert.match(lib, /winget_choose_manifest_directory\(&contents\)/);
  assert.match(lib, /winget_confirm_version_manifest\(&raw_manifest, package, &directory\)/);
  assert.match(lib, /same_official_page\(&api_url, &final_dir\)/);
  assert.match(lib, /same_official_page\(&manifest_url, &final_manifest\)/);
  assert.match(lib, /"publishedAt":null,"publishedAtText":null/);
  assert.match(lib, /"transport":"winget-community-manifest"/);
  assert.match(ui, /return 'WinGet \(сообщество\)'/);
});

test('unchanged official vendor download buttons and original sources', () => {
  assert.equal(catalog.length, 126);
  const byId = Object.fromEntries(catalog.map(p => [p.id, p]));
  const adw = byId.adwcleaner;
  const after = byId.afterburner;
  assert.equal(adw.website, 'https://www.malwarebytes.com/adwcleaner');
  assert.deepEqual(adw.versionSource.urls, ['https://help.malwarebytes.com/hc/en-us/articles/31589455600795-AdwCleaner-Product-Lifecycle']);
  assert.equal(adw.actions[0].url, adw.website);
  assert.equal(after.website, 'https://www.msi.com/Landing/afterburner/graphics-cards');
  assert.equal(after.actions[0].url, after.website);
  assert.deepEqual(after.versionSource.urls, [after.website]);
});


test('GPU-Z 403 fallback uses only exact TechPowerUp.GPU-Z WinGet version manifest', () => {
  assert.match(lib, /"gpu-z"\s*=>\s*Some\(\("manifests\/t\/TechPowerUp\/GPU-Z", "TechPowerUp\.GPU-Z"\)\)/);
  assert.match(lib, /matches!\(program_id, "afterburner" \| "gpu-z" \| "nvcleanstall" \| "rtss"\) && segments\.len\(\)==3/);
  assert.match(lib, /winget_confirm_version_manifest\(&raw_manifest, package, &directory\)/);
  assert.match(lib, /last_fetch_error\.as_deref\(\) == Some\("HTTP 403"\)/);
});

test('GPU-Z WinGet cannot replace 2.71.0 with older community version or invent release date', () => {
  assert.match(lib, /if !winget_meets_configured_version_floor\(id, &version, source\) \{ return None; \}/);
  assert.match(lib, /!matches!\(program_id, "gpu-z" \| "nvcleanstall" \| "rtss"\)/);
  assert.match(lib, /version_cmp\(version, baseline\) != Ordering::Less/);
  assert.match(lib, /"publishedAt":null,"publishedAtText":null/);
  assert.match(lib, /"transport":"winget-community-manifest"/);
});

test('GPU-Z vendor page and download link stay unchanged in catalog', () => {
  const item=catalog.find(p=>p.id==='gpu-z');
  assert.ok(item);
  const link='https://www.techpowerup.com/download/techpowerup-gpu-z/';
  assert.equal(item.website, link);
  assert.equal(item.versionSource.url, link);
  assert.equal(item.actions.find(a=>a.label==='Скачать').url, link);
  assert.equal(item.versionSource.fallbackVersion, '2.71.0');
  assert.equal(item.versionSource.showReleaseDate, false);
  assert.equal(catalog.length, 126);
});


test('NVCleanstall WinGet fallback only after HTTP 403, using exact manifest and no release date', () => {
  assert.match(lib, /"nvcleanstall"\s*=>\s*Some\(\("manifests\/t\/TechPowerUp\/NVCleanstall", "TechPowerUp\.NVCleanstall"\)\)/);
  assert.match(lib, /matches!\(program_id, "afterburner" \| "gpu-z" \| "nvcleanstall" \| "rtss"\) && segments\.len\(\)==3/);
  assert.match(lib, /last_fetch_error\.as_deref\(\) == Some\("HTTP 403"\)/);
  assert.match(lib, /winget_confirm_version_manifest\(&raw_manifest, package, &directory\)/);
  assert.match(lib, /"publishedAt":null,"publishedAtText":null/);
});

test('NVCleanstall has a minimum known version and cannot silently downgrade', () => {
  assert.match(lib, /if !winget_meets_configured_version_floor\(id, &version, source\) \{ return None; \}/);
  assert.match(lib, /!matches!\(program_id, "gpu-z" \| "nvcleanstall" \| "rtss"\)/);
  assert.match(lib, /version_cmp\(version, baseline\) != Ordering::Less/);
  assert.match(lib, /winget_nvcleanstall_exact_manifest_and_stale_community_guard/);
});

test('NVCleanstall and Visual C++ unchanged; CPU-Z download stays on TechPowerUp', () => {
  const byId=Object.fromEntries(catalog.map(p=>[p.id,p]));
  const nv='https://www.techpowerup.com/download/techpowerup-nvcleanstall/';
  assert.equal(byId.nvcleanstall.website,nv);
  assert.equal(byId.nvcleanstall.versionSource.url,nv);
  assert.equal(byId.nvcleanstall.actions.find(a=>a.label==='Скачать').url,nv);
  assert.equal(byId.nvcleanstall.versionSource.fallbackVersion,'1.19.0');
  assert.equal(byId['cpu-z'].website,'https://www.techpowerup.com/download/cpu-z/?origin=serp_auto');
  assert.equal(byId['cpu-z'].versionSource.url,'https://www.cpuid.com/softwares/cpu-z.html');
  assert.equal(byId['cpu-z'].actions[0].url,byId['cpu-z'].website);
  assert.equal(byId['cpu-z'].versionSource.fallbackVersion,'3.01');
  assert.equal(byId.visualcpp.actions[0].url,byId.visualcpp.website);
  assert.doesNotMatch(lib, /"cpu-z"\s*=>\s*Some\(\("manifests\//);
  assert.doesNotMatch(lib, /"visualcpp"\s*=>\s*Some\(\("manifests\//);
  assert.equal(catalog.length,126);
});
