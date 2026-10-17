'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const lib = fs.readFileSync(path.join(root,'src-tauri/src/lib.rs'),'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root,'data/programs.json'),'utf8'));

test('CPU-Z uses a bounded early-stop reader isolated from other official-page sources',()=>{
  const p=catalog.find(p=>p.id==='cpu-z');
  assert.ok(p);
  assert.equal(p.versionSource.url,'https://www.cpuid.com/softwares/cpu-z.html');
  assert.match(lib,/const CPU_Z_PREFIX_LIMIT_BYTES: usize = 512 \* 1024;/);
  assert.match(lib,/fn read_cpu_z_classic_early<R: Read>/);
  assert.match(lib,/if let Some\(version\) = cpu_z_classic_version_from_prefix/);
  assert.match(lib,/return Ok\(Some\(version\)\)/);
  assert.match(lib,/if field\(p, "id"\) == "cpu-z" && adapter == "official-page"/);
  assert.match(lib,/same_official_page\(CPUID_PAGE, response.url\(\).as_str\(\)\)/);
  assert.match(lib,/fn cpu_z_stream_reads_chunks_then_stops_before_trailing_body/);
  assert.match(lib,/fn cpu_z_stream_never_promotes_truncated_unrelated_page/);
  assert.match(p.versionSource.versionPattern,/x86/);
  assert.match(p.versionSource.versionPattern,/x64/);
  assert.equal(p.actions[0].url,'https://www.techpowerup.com/download/cpu-z/?origin=serp_auto');
  assert.equal(catalog.length,126);
});
