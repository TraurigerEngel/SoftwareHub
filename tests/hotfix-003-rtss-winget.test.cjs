"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const rust=fs.readFileSync(path.join(root,'src-tauri/src/lib.rs'),'utf8');
const ui=fs.readFileSync(path.join(root,'web/renderer.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/programs.json'),'utf8'));
const rtss=catalog.find(p=>p.id==='rtss');

test('Hotfix 003: RTSS has exactly scoped WinGet community version manifest fallback',()=>{
 assert.match(rust,/"rtss"\s*=>\s*Some\(\("manifests\/g\/Guru3D\/RTSS", "Guru3D\.RTSS"\)\)/);
 assert.match(rust,/winget_confirm_version_manifest\(&raw_manifest, package, &directory\)/);
 assert.match(rust,/same_official_page\(&api_url, &final_dir\)/);
 assert.match(rust,/same_official_page\(&manifest_url, &final_manifest\)/);
 assert.match(rust,/fn rtss_winget_fallback_rejects_stale_or_spoofed_manifests/);
 assert.match(rust,/if probe_official_html \{\n        if let Ok\(community_client\) = http_client\(3000\)/);
 assert.match(rust,/if !winget_meets_configured_version_floor\(id, &version, source\) \{ return None; \}/);
});

test('Hotfix 003: RTSS source label is correctly disclosed; no silent vendor claim',()=>{
 assert.match(ui,/\['adwcleaner', 'afterburner', 'gpu-z', 'nvcleanstall', 'rtss'\]\.includes\(program\.id\)/);
 assert.match(ui,/return 'WinGet \(сообщество\)'/);
 assert.equal(rtss.website,'https://www.guru3d.com/download/rtss-rivatuner-statistics-server-download/');
 assert.equal(rtss.actions[0].url,rtss.website);
 assert.equal(rtss.versionSource.fallbackVersion,'7.3.7');
 assert.equal(catalog.length,126);
});

test('Hotfix 003: old vendor 403 fallback remains intact for other software',()=>{
 assert.match(rust,/last_fetch_error\.as_deref\(\) == Some\("HTTP 403"\) && !probe_official_html/);
 assert.match(rust,/let vendor_timeout = if field\(&program,"id"\) == "rtss"/);
});
