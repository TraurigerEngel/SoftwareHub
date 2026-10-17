'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  createReleaseArtifacts,
  inspectPeExecutable,
  versionFolderLabel,
  formatTimestamp
} = require('../scripts/publish-release.cjs');

function writeFakePeX64(filePath) {
  const buffer = Buffer.alloc(512, 0);
  buffer.write('MZ', 0, 'ascii');
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write('PE\0\0', 0x80, 'ascii');
  buffer.writeUInt16LE(0x8664, 0x84);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
}

function setupTempProject(version = '0.7.1') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shub-release-'));
  fs.mkdirSync(path.join(dir, 'src-tauri', 'target', 'release'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }, null, 2));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
  fs.writeFileSync(path.join(dir, 'src-tauri', 'Cargo.lock'), '# lock\n');
  fs.writeFileSync(path.join(dir, 'src-tauri', 'Cargo.toml'), `[package]\nname = "software-hub-tauri"\nversion = "${version}"\n`);
  fs.writeFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({version}));
  writeFakePeX64(path.join(dir, 'src-tauri', 'target', 'release', 'software-hub-tauri.exe'));
  return dir;
}

test('version label and timestamp are stable and human readable', () => {
  assert.equal(versionFolderLabel('0.7.0-preview.1'), 'v0.7.0_Preview1');
  assert.equal(versionFolderLabel('0.7.1'), 'v0.7.1');
  assert.equal(versionFolderLabel('1.0.0-rc.2'), 'v1.0.0_RC2');
  assert.equal(formatTimestamp(new Date('2026-10-08T05:51:17Z')), '20261008-055117');
});

test('release timestamp is UTC on Windows and does not depend on local timezone', () => {
  const modulePath = path.join(__dirname, '../scripts/publish-release.cjs');
  for (const zone of ['UTC', 'Asia/Yekaterinburg', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, ['-e',
      'const m=require(process.argv[1]); process.stdout.write(m.formatTimestamp(new Date("2026-10-08T05:51:17Z")));',
      modulePath
    ], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    assert.equal(result.status, 0, `${zone}: ${result.stderr}`);
    assert.equal(result.stdout, '20261008-055117', `wrong release timestamp in ${zone}`);
  }
  assert.equal(formatTimestamp(new Date('2026-12-31T23:59:59Z')), '20261231-235959');
});

test('PE inspection validates a Windows x64 executable', () => {
  const buffer = Buffer.alloc(512, 0);
  buffer.write('MZ', 0, 'ascii');
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write('PE\0\0', 0x80, 'ascii');
  buffer.writeUInt16LE(0x8664, 0x84);
  const info = inspectPeExecutable(buffer);
  assert.equal(info.isX64, true);
  assert.equal(info.machineName, 'x64');
});

test('release publish creates an isolated portable folder with manifest and empty portable-data', () => {
  const root = setupTempProject();
  const result = createReleaseArtifacts(root, { now: new Date('2026-10-08T05:51:17Z') });
  assert.match(result.releaseName, /^Software_Hub_Tauri_v0\.7\.1_Stable_20261008-055117$/);
  const entries = fs.readdirSync(result.releaseDir).sort();
  assert.deepEqual(entries, ['RELEASE-INFO.txt', 'RELEASE-MANIFEST.json', 'SoftwareHub.exe', 'portable-data']);
  assert.equal(fs.readdirSync(result.portableDataDir).length, 0);
  const report = fs.readFileSync(result.reportPath, 'utf8');
  assert.match(report, /Executable SHA-256:/);
  assert.match(report, /portable-data/i);
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(manifest.releaseChannel, 'stable');
  assert.equal(manifest.version, '0.7.1');
  assert.match(report, /Software Hub — v0\.7\.1 Stable/);
  assert.doesNotMatch(report, /Release Candidate/);
  assert.equal(manifest.executable.machine, 'x64');
  assert.equal(manifest.portable.dataFolderStartsEmpty, true);
});

test('release publish refuses to continue without both lockfiles', () => {
  const root = setupTempProject();
  fs.rmSync(path.join(root, 'src-tauri', 'Cargo.lock'));
  assert.throws(() => createReleaseArtifacts(root), /Cargo lockfile is missing/);
});

test('publisher refuses stale npm lockfile version', () => {
  const root = setupTempProject();
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({version:'0.7.0-preview.1',packages:{'':{version:'0.7.0-preview.1'}}}));
  assert.throws(() => createReleaseArtifacts(root), /package-lock\.json version is stale/);
});

test('publisher refuses mismatch between Cargo, Tauri and npm version', () => {
  const root = setupTempProject();
  fs.writeFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({version:'0.7.2'}));
  assert.throws(() => createReleaseArtifacts(root), /Inconsistent app versions/);
});

test('old preview candidate output remains supported for historical verification', () => {
  const root = setupTempProject('0.7.0-preview.1');
  const result = createReleaseArtifacts(root, {now:new Date('2026-10-08T05:51:17Z')});
  assert.match(result.releaseName, /_Preview1_ReleaseCandidate_20261008-055117$/);
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
  assert.equal(manifest.releaseChannel, 'candidate');
});


test('v0.7.1 publisher does not overwrite historical v0.7.0 Stable artifacts', () => {
  const root = setupTempProject();
  const old = path.join(root, 'Release', 'Software_Hub_Tauri_v0.7.0_Stable_20261008-000000');
  fs.mkdirSync(old, {recursive:true});
  fs.writeFileSync(path.join(old, 'keep.txt'), 'old Stable unchanged');
  const current = createReleaseArtifacts(root, {now:new Date('2026-10-09T00:00:00Z')});
  assert.match(current.releaseName, /^Software_Hub_Tauri_v0\.7\.1_Stable_/);
  assert.equal(fs.readFileSync(path.join(old, 'keep.txt'), 'utf8'), 'old Stable unchanged');
});
