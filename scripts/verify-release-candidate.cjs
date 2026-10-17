'use strict';
// Independent verification of the already-published Windows portable RC.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { versionFolderLabel } = require('./publish-release.cjs');

const EXPECTED = ['RELEASE-INFO.txt', 'RELEASE-MANIFEST.json', 'SoftwareHub.exe', 'portable-data'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRegularFile(file) {
  const st = fs.lstatSync(file);
  return st.isFile() && !st.isSymbolicLink();
}

function fileHash(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function verifyPeX64(file) {
  const bytes = fs.readFileSync(file);
  assert(bytes.length >= 0x40 && bytes.toString('ascii', 0, 2) === 'MZ', 'Invalid MZ header');
  const offset = bytes.readUInt32LE(0x3c);
  assert(offset <= bytes.length - 6 && bytes.toString('binary', offset, offset + 4) === 'PE\0\0', 'Invalid PE signature');
  assert(bytes.readUInt16LE(offset + 4) === 0x8664, 'Executable is not Windows x64');
  return bytes.length;
}

function verifyReleaseDirectory(releaseDir, expectedVersion) {
  assert(fs.existsSync(releaseDir) && fs.lstatSync(releaseDir).isDirectory(), 'Release folder not found');
  const actual = fs.readdirSync(releaseDir).sort();
  assert(JSON.stringify(actual) === JSON.stringify(EXPECTED), `Unexpected release contents: ${actual.join(', ')}`);
  for (const name of EXPECTED) {
    assert(!fs.lstatSync(path.join(releaseDir, name)).isSymbolicLink(), `Symlink in release: ${name}`);
  }
  const dataDir = path.join(releaseDir, 'portable-data');
  assert(fs.statSync(dataDir).isDirectory(), 'portable-data is not a directory');
  assert(fs.readdirSync(dataDir).length === 0, 'New portable-data must start empty; test a COPY, not the original RC');

  const manifestFile = path.join(releaseDir, 'RELEASE-MANIFEST.json');
  const infoFile = path.join(releaseDir, 'RELEASE-INFO.txt');
  const executable = path.join(releaseDir, 'SoftwareHub.exe');
  assert(isRegularFile(manifestFile) && isRegularFile(infoFile) && isRegularFile(executable), 'Missing release files');
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const info = fs.readFileSync(infoFile, 'utf8');
  assert(m.appName === 'Software Hub', 'Wrong application name');
  assert(m.version === expectedVersion, `Version mismatch: ${m.version} != ${expectedVersion}`);
  const expectedChannel = /^\d+\.\d+\.\d+$/.test(expectedVersion) ? 'stable' : 'candidate';
  assert(m.releaseChannel === expectedChannel, 'Release channel mismatch');
  const expectedLabel = expectedChannel === 'stable' ? '_Stable_' : '_ReleaseCandidate_';
  assert(path.basename(releaseDir).includes(expectedLabel), 'Release folder channel mismatch');
  assert(info.includes(`Release channel: ${expectedChannel}`), 'Release report channel mismatch');
  assert(m.releaseName === path.basename(releaseDir), 'Manifest release folder name mismatch');
  assert(m.executable?.fileName === 'SoftwareHub.exe' && m.executable.machine === 'x64', 'Executable metadata mismatch');
  assert(m.portable?.dataFolder === 'portable-data' && m.portable.dataFolderStartsEmpty === true, 'Portable metadata mismatch');
  assert(typeof m.executable.sha256 === 'string' && /^[a-f0-9]{64}$/.test(m.executable.sha256), 'Invalid SHA-256 in manifest');
  const size = verifyPeX64(executable);
  assert(size === m.executable.sizeBytes, 'Executable size mismatch');
  const sha256 = fileHash(executable);
  assert(sha256 === m.executable.sha256, 'Executable SHA-256 mismatch');
  assert(info.includes(`Executable SHA-256: ${sha256}`), 'Release report SHA-256 mismatch');
  assert(info.includes(`Version: ${expectedVersion}`), 'Release report version mismatch');
  return {releaseDir, version: m.version, exeSize: size, sha256};
}

function latestReleaseDir(projectDir, expectedVersion) {
  const dir = path.join(projectDir, 'Release');
  assert(fs.existsSync(dir), 'Release root not found');
  const candidates = fs.readdirSync(dir, {withFileTypes:true})
    .filter(e => e.isDirectory() && /^Software_Hub_Tauri_v.+_(?:ReleaseCandidate|Stable)_\d{8}-\d{6}$/.test(e.name))
    .filter(e => !expectedVersion || e.name.startsWith(`Software_Hub_Tauri_${versionFolderLabel(expectedVersion)}_${/^\d+\.\d+\.\d+$/.test(expectedVersion) ? 'Stable' : 'ReleaseCandidate'}_`))
    .map(e => ({dir:path.join(dir,e.name), mtime:fs.statSync(path.join(dir,e.name)).mtimeMs}))
    .sort((a,b) => b.mtime - a.mtime);
  assert(candidates.length > 0, 'No matching release folders found');
  return candidates[0].dir;
}

if (require.main === module) {
  try {
    const projectDir = path.join(__dirname, '..');
    const version = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')).version;
    const folder = process.argv[2] ? path.resolve(process.argv[2]) : latestReleaseDir(projectDir, version);
    const result = verifyReleaseDirectory(folder, version);
    console.log(`RELEASE ARTIFACT VERIFY OK: ${result.releaseDir}`);
    console.log(`Windows x64 EXE: ${result.exeSize} bytes`);
    console.log(`SHA-256: ${result.sha256}`);
  } catch (error) {
    console.error(`RELEASE ARTIFACT VERIFY FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {verifyReleaseDirectory, latestReleaseDir, verifyPeX64};
