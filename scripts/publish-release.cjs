'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fail(message) {
  throw new Error(message);
}

function ensureFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`${label} is missing: ${filePath}`);
  }
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  // Release folder names must be stable across Windows/local time zones.
  // The input date is an instant; format it in UTC just like generatedAt.
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function versionFolderLabel(version) {
  const raw = String(version || '').trim().replace(/^v/i, '');
  if (!raw) {
    return 'v0.0.0';
  }
  return 'v' + raw
    .replace(/-preview\.?([0-9]+)/ig, '_Preview$1')
    .replace(/-rc\.?([0-9]+)/ig, '_RC$1')
    .replace(/-beta\.?([0-9]+)/ig, '_Beta$1')
    .replace(/-alpha\.?([0-9]+)/ig, '_Alpha$1')
    .replace(/[^A-Za-z0-9._-]+/g, '_');
}

function releaseChannel(version) {
  return /^\d+\.\d+\.\d+$/.test(version) ? 'stable' : 'candidate';
}

function verifySourceVersion(rootDir, pkg) {
  const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const cargo = fs.readFileSync(path.join(rootDir, 'src-tauri', 'Cargo.toml'), 'utf8');
  const packageVersion = String(pkg.version || '');
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (config.version !== packageVersion || cargoVersion !== packageVersion) {
    fail(`Inconsistent app versions: npm=${packageVersion}; tauri=${config.version}; cargo=${cargoVersion}`);
  }
  const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  if (lock.version !== packageVersion || lock.packages?.['']?.version !== packageVersion) {
    fail('npm package-lock.json version is stale: synchronize the lockfile before building');
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function inspectPeExecutable(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 0x40) {
    fail('Release executable is too small to be a valid PE file');
  }
  if (buffer.toString('ascii', 0, 2) !== 'MZ') {
    fail('Release executable is not a valid Windows PE file (missing MZ header)');
  }
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 6 >= buffer.length) {
    fail('Release executable is not a valid Windows PE file (invalid PE header offset)');
  }
  if (buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    fail('Release executable is not a valid Windows PE file (missing PE signature)');
  }
  const machine = buffer.readUInt16LE(peOffset + 4);
  const machineName = machine === 0x8664 ? 'x64' : machine === 0x14c ? 'x86' : `0x${machine.toString(16)}`;
  return { peOffset, machine, machineName, isX64: machine === 0x8664 };
}

function createReleaseArtifacts(rootDir, options = {}) {
  // Visual Preview builds are test artifacts, never official Stable releases.
  if (fs.existsSync(path.join(rootDir, '.VISUAL_PREVIEW_ONLY'))) {
    fail('Visual Preview 12 cannot be published as Stable. Use MAKE-VISUAL-PREVIEW.cmd.');
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const packagePath = path.join(rootDir, 'package.json');
  const packageLockPath = path.join(rootDir, 'package-lock.json');
  const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock');
  const compiledExePath = path.join(rootDir, 'src-tauri', 'target', 'release', 'software-hub-tauri.exe');

  ensureFile(packagePath, 'package.json');
  ensureFile(packageLockPath, 'npm lockfile');
  ensureFile(cargoLockPath, 'Cargo lockfile');
  ensureFile(compiledExePath, 'Compiled release executable');

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  verifySourceVersion(rootDir, pkg);
  const channel = releaseChannel(pkg.version);
  if (fs.existsSync(path.join(rootDir, '.SOFTWARE_HUB_RC_ONLY')) && channel !== 'candidate') {
    fail('RC-only source cannot be published as Stable. Perform a separate approved Stable promotion.');
  }
  const releaseRoot = path.join(rootDir, 'Release');
  const releaseName = `Software_Hub_Tauri_${versionFolderLabel(pkg.version)}_${channel === 'stable' ? 'Stable' : 'ReleaseCandidate'}_${formatTimestamp(now)}`;
  const releaseDir = path.join(releaseRoot, releaseName);
  const portableDataDir = path.join(releaseDir, 'portable-data');
  const portableExePath = path.join(releaseDir, 'SoftwareHub.exe');
  const reportPath = path.join(releaseDir, 'RELEASE-INFO.txt');
  const manifestPath = path.join(releaseDir, 'RELEASE-MANIFEST.json');

  if (fs.existsSync(releaseDir)) {
    fail(`Release output already exists: ${releaseDir}`);
  }

  fs.mkdirSync(portableDataDir, { recursive: true });
  fs.copyFileSync(compiledExePath, portableExePath);

  const exeBuffer = fs.readFileSync(portableExePath);
  const pe = inspectPeExecutable(exeBuffer);
  if (!pe.isX64) {
    fail(`Release executable must be Windows x64, got ${pe.machineName}`);
  }
  const exeSize = fs.statSync(portableExePath).size;
  const exeSha256 = sha256File(portableExePath);
  const generatedAt = now.toISOString();

  const reportLines = [
    channel === 'stable' ? 'Software Hub — v' + pkg.version + ' Stable' : 'Software Hub — Release Candidate',
    `Version: ${pkg.version}`,
    `Release channel: ${channel}`,
    `Generated at: ${generatedAt}`,
    `Output folder: ${releaseName}`,
    `Executable: SoftwareHub.exe`,
    `Executable machine: ${pe.machineName}`,
    `Executable size: ${exeSize} bytes`,
    `Executable SHA-256: ${exeSha256}`,
    'Portable data folder: .\\portable-data',
    'Portable data contents: empty on build; created/filled by the app on first run',
    'Verified lockfiles: package-lock.json; src-tauri\\Cargo.lock',
    'Requirement: Microsoft WebView2 Runtime must be installed on the target Windows system.',
    'Note: This folder is isolated from previous release builds and is safe to copy elsewhere.'
  ];
  fs.writeFileSync(reportPath, reportLines.join('\r\n') + '\r\n', 'utf8');

  const manifest = {
    appName: 'Software Hub',
    version: pkg.version,
    releaseChannel: channel,
    generatedAt,
    releaseName,
    executable: {
      fileName: 'SoftwareHub.exe',
      sizeBytes: exeSize,
      sha256: exeSha256,
      machine: pe.machineName
    },
    portable: {
      dataFolder: 'portable-data',
      dataFolderStartsEmpty: true
    },
    verifiedInputs: {
      npmLockfile: 'package-lock.json',
      cargoLockfile: 'src-tauri/Cargo.lock'
    },
    notes: [
      'No installer is generated.',
      channel === 'stable' ? 'This is a portable stable release folder.' : 'This is a portable release candidate folder.',
      'Previous Release builds are not overwritten.'
    ]
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const topEntries = fs.readdirSync(releaseDir).sort();
  const expectedEntries = ['RELEASE-INFO.txt', 'RELEASE-MANIFEST.json', 'SoftwareHub.exe', 'portable-data'];
  if (JSON.stringify(topEntries) !== JSON.stringify(expectedEntries)) {
    fail(`Unexpected release folder contents: ${topEntries.join(', ')}`);
  }

  return {
    releaseDir,
    releaseName,
    portableExePath,
    portableDataDir,
    reportPath,
    manifestPath,
    exeSize,
    exeSha256,
    machine: pe.machineName
  };
}

if (require.main === module) {
  try {
    const rootDir = path.join(__dirname, '..');
    const result = createReleaseArtifacts(rootDir);
    console.log(`RELEASE PUBLISH OK: ${result.releaseDir}`);
    console.log(`Portable EXE: ${result.portableExePath}`);
    console.log(`SHA-256: ${result.exeSha256}`);
    console.log(`Machine: ${result.machine}`);
  } catch (error) {
    console.error(`RELEASE PUBLISH FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  createReleaseArtifacts,
  inspectPeExecutable,
  versionFolderLabel,
  formatTimestamp,
  releaseChannel,
  verifySourceVersion,
  sha256File
};
