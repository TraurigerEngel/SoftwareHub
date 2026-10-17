'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createReleaseArtifacts} = require('../scripts/publish-release.cjs');
const {verifyReleaseDirectory, latestReleaseDir} = require('../scripts/verify-release-candidate.cjs');

function fixture(version = '0.7.1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shub-artifact-'));
  const target = path.join(root, 'src-tauri', 'target', 'release');
  fs.mkdirSync(target, {recursive:true});
  const bytes = Buffer.alloc(512);
  bytes.write('MZ',0,'ascii');
  bytes.writeUInt32LE(0x80,0x3c);
  bytes.write('PE\0\0',0x80,'binary');
  bytes.writeUInt16LE(0x8664,0x84);
  fs.writeFileSync(path.join(target,'software-hub-tauri.exe'), bytes);
  fs.writeFileSync(path.join(root,'package.json'), JSON.stringify({version}));
  fs.writeFileSync(path.join(root,'package-lock.json'), JSON.stringify({version,packages:{'':{version}}}));
  fs.writeFileSync(path.join(root,'src-tauri','Cargo.lock'), 'lock');
  fs.writeFileSync(path.join(root,'src-tauri','Cargo.toml'), `[package]\nname = "software-hub-tauri"\nversion = "${version}"\n`);
  fs.writeFileSync(path.join(root,'src-tauri','tauri.conf.json'), JSON.stringify({version}));
  const output = createReleaseArtifacts(root, {now:new Date('2026-10-09T00:00:00Z')});
  return {root, output};
}

test('published portable Stable independently verifies exact files, PE architecture, size and hashes', () => {
  const {root, output} = fixture();
  assert.equal(latestReleaseDir(root), output.releaseDir);
  const result = verifyReleaseDirectory(output.releaseDir, '0.7.1');
  assert.equal(result.sha256, output.exeSha256);
});

test('published Stable rejects tampered executable', () => {
  const {output} = fixture();
  fs.appendFileSync(output.portableExePath, 'tamper');
  assert.throws(() => verifyReleaseDirectory(output.releaseDir,'0.7.1'), /size mismatch/);
});

test('published Stable rejects unexpected files and pre-filled cache', () => {
  const {output} = fixture();
  fs.writeFileSync(path.join(output.portableDataDir, 'version-cache.json'), '{}');
  assert.throws(() => verifyReleaseDirectory(output.releaseDir,'0.7.1'), /must start empty/);
  fs.rmSync(path.join(output.portableDataDir, 'version-cache.json'));
  fs.writeFileSync(path.join(output.releaseDir, 'unexpected.dll'), 'unsafe');
  assert.throws(() => verifyReleaseDirectory(output.releaseDir,'0.7.1'), /Unexpected release contents/);
});

test('published Stable rejects modified manifest and report', () => {
  const {output} = fixture();
  const manifest = JSON.parse(fs.readFileSync(output.manifestPath,'utf8'));
  manifest.executable.sha256 = '0'.repeat(64);
  fs.writeFileSync(output.manifestPath,JSON.stringify(manifest));
  assert.throws(() => verifyReleaseDirectory(output.releaseDir,'0.7.1'), /SHA-256 mismatch/);
});

test('Stable verifier rejects a tampered release channel', () => {
  const {output} = fixture();
  const manifest = JSON.parse(fs.readFileSync(output.manifestPath, 'utf8'));
  manifest.releaseChannel = 'candidate';
  fs.writeFileSync(output.manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyReleaseDirectory(output.releaseDir, '0.7.1'), /channel mismatch/);
});

test('Stable verifier ignores older Preview release candidates', () => {
  const {root,output} = fixture();
  const preview = path.join(root, 'Release', 'Software_Hub_Tauri_v0.7.0_Preview1_ReleaseCandidate_20261008-000000');
  fs.mkdirSync(preview);
  assert.equal(latestReleaseDir(root, '0.7.1'), output.releaseDir);
});
