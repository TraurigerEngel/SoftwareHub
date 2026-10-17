'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareStage, VERSION } = require('../scripts/prepare-release-candidate.cjs');
const { latestReleaseDir, verifyReleaseDirectory } = require('../scripts/verify-release-candidate.cjs');
const { createReleaseArtifacts } = require('../scripts/publish-release.cjs');
const root = path.resolve(__dirname, '..');

test('Hotfix 004 creates an isolated RC1 with consistent versions and no Preview marker', () => {
  if (JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version === '0.7.2' || JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version === '0.7.3') {
    assert.ok(fs.existsSync(path.join(root,'.SOFTWARE_HUB_STABLE_SOURCE')));
    assert.ok(!fs.existsSync(path.join(root,'.SOFTWARE_HUB_RC_ONLY')));
    assert.ok(!fs.existsSync(path.join(root,'.VISUAL_PREVIEW_ONLY')));
    return;
  }
  if (fs.existsSync(path.join(root, '.SOFTWARE_HUB_RC_ONLY'))) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, VERSION);
    assert.ok(!fs.existsSync(path.join(root, '.VISUAL_PREVIEW_ONLY')));
    return;
  }
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shub-rc-unit-'));
  try {
    const stage = prepareStage(root, base);
    assert.ok(stage.startsWith(base + path.sep));
    assert.ok(fs.existsSync(path.join(root, '.VISUAL_PREVIEW_ONLY')));
    assert.ok(!fs.existsSync(path.join(stage, '.VISUAL_PREVIEW_ONLY')));
    assert.ok(fs.existsSync(path.join(stage, '.SOFTWARE_HUB_RC_ONLY')));
    const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json')));
    const lock = JSON.parse(fs.readFileSync(path.join(stage, 'package-lock.json')));
    const config = JSON.parse(fs.readFileSync(path.join(stage, 'src-tauri', 'tauri.conf.json')));
    const cargo = fs.readFileSync(path.join(stage, 'src-tauri', 'Cargo.toml'), 'utf8');
    const cargoLock = fs.readFileSync(path.join(stage, 'src-tauri', 'Cargo.lock'), 'utf8');
    assert.equal(pkg.version, VERSION);
    assert.equal(lock.version, VERSION);
    assert.equal(lock.packages[''].version, VERSION);
    assert.equal(config.version, VERSION);
    assert.ok(cargo.includes(`version = "${VERSION}"`));
    assert.ok(cargoLock.includes(`name = "software-hub-tauri"\nversion = "${VERSION}"`));
    assert.ok(!fs.existsSync(path.join(stage, 'src-tauri', 'target')));
    assert.ok(!fs.existsSync(path.join(stage, 'node_modules')));
    assert.ok(!fs.existsSync(path.join(stage, 'web', 'fonts')));
    assert.ok(!fs.existsSync(path.join(stage, 'Visual-Preview-12')));
    assert.deepEqual(fs.readFileSync(path.join(stage, 'web/renderer.js')), fs.readFileSync(path.join(root, 'web/renderer.js')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, '0.7.1');
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('versioned RC1 release lookup is compatible with publisher folder format', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shub-rc-lookup-'));
  try {
    const release = path.join(dir, 'Release', 'Software_Hub_Tauri_v0.7.2_RC1_ReleaseCandidate_20261011-000000');
    fs.mkdirSync(release, {recursive:true});
    assert.equal(latestReleaseDir(dir, VERSION), release);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

test('RC-only marker prevents accidental Stable publication', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shub-rc-safety-'));
  try {
    fs.mkdirSync(path.join(dir, 'src-tauri', 'target', 'release'), {recursive:true});
    fs.writeFileSync(path.join(dir, '.SOFTWARE_HUB_RC_ONLY'), 'RC');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({version:'0.7.2'}));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({version:'0.7.2',packages:{'':{version:'0.7.2'}}}));
    fs.writeFileSync(path.join(dir, 'src-tauri', 'Cargo.lock'), 'lock');
    fs.writeFileSync(path.join(dir, 'src-tauri', 'Cargo.toml'), '[package]\nversion = "0.7.2"\n');
    fs.writeFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({version:'0.7.2'}));
    fs.writeFileSync(path.join(dir, 'src-tauri', 'target', 'release', 'software-hub-tauri.exe'), Buffer.alloc(200));
    assert.throws(() => createReleaseArtifacts(dir), /RC-only source cannot be published as Stable/);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
