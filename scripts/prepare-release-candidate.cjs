'use strict';
// Never mutate the user's confirmed Preview or existing Stable release.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { formatTimestamp } = require('./publish-release.cjs');
const VERSION = '0.7.2-rc.1';
const TOP = ['README.md', 'README-RC1.txt', '.gitignore', 'MAKE-RELEASE.cmd',
  'MAKE-PREVIEW.cmd', 'MAKE-VISUAL-PREVIEW.cmd', 'MAKE-FINAL-ARCHIVES.ps1',
  'MAKE-RELEASE-CANDIDATE.cmd', 'MAKE-RC-PORTABLE.ps1', 'package.json', 'package-lock.json'];
const DIRS = ['assets', 'data', 'migration-reference', 'scripts', 'src-tauri', 'tests', 'web'];
const EXCLUDED = new Set(['node_modules', 'target', 'Release', 'ReleaseCandidate-Work',
  '.git', 'Artifacts', 'PATCH-BACKUPS', 'Visual-Preview-12']);
function assert(ok, message) { if (!ok) throw new Error(message); }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function expectedJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function copyFile(from, to) {
  assert(fs.lstatSync(from).isFile() && !fs.lstatSync(from).isSymbolicLink(), `Unsafe source: ${from}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
function copyTree(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw new Error(`Symlink in source: ${path.join(from, e.name)}`);
    if (EXCLUDED.has(e.name) || (path.basename(from) === 'web' && e.name === 'fonts')) continue;
    const next = path.join(from, e.name);
    if (e.isDirectory()) copyTree(next, path.join(to, e.name));
    else if (e.isFile()) copyFile(next, path.join(to, e.name));
    else throw new Error(`Unsupported source entry: ${next}`);
  }
}
function prepareStage(projectDir, workspaceParent) {
  const root = path.resolve(projectDir);
  assert(fs.existsSync(path.join(root, '.VISUAL_PREVIEW_ONLY')), 'Expected Visual Preview 12 source marker');
  assert(expectedJson(path.join(root, 'package.json')).version === '0.7.1', 'Expected v0.7.1 Preview baseline');
  for (const file of ['tests/hotfix-001-instant-navigation.test.cjs',
    'tests/hotfix-002-rtss-catalog.test.cjs', 'tests/hotfix-003-rtss-winget.test.cjs']) {
    assert(fs.existsSync(path.join(root, file)), `Required hotfix missing: ${file}`);
  }
  assert(sha(path.join(root, 'src-tauri/src/lib.rs')) === '743f50b5a47f184c10253d0367566c149cd6243ee54e80894b563ea3cff3d7bb', 'Hotfix 003 Rust source mismatch');
  assert(sha(path.join(root, 'web/renderer.js')) === '95b0563629da2f195dfa1a03d82788bf4f8bf1fa6b08e68e43d63166df94af5e', 'Hotfix 003 renderer mismatch');
  const workspace = path.resolve(workspaceParent || path.join(root, 'ReleaseCandidate-Work'));
  assert(workspace !== root && !root.startsWith(workspace + path.sep), 'Unsafe RC destination');
  const folder = `SoftwareHub_v0.7.2_RC1_${formatTimestamp()}_${crypto.randomBytes(3).toString('hex')}`;
  const stage = path.join(workspace, folder);
  assert(!fs.existsSync(stage), 'Release candidate destination already exists');
  fs.mkdirSync(stage, { recursive: true });
  try {
    for (const file of TOP) {
      const from = path.join(root, file);
      assert(fs.existsSync(from), `Missing source file: ${file}`);
      copyFile(from, path.join(stage, file));
    }
    for (const dir of DIRS) {
      const from = path.join(root, dir);
      assert(fs.statSync(from).isDirectory(), `Missing source directory: ${dir}`);
      fs.mkdirSync(path.join(stage, dir), { recursive: true });
      copyTree(from, path.join(stage, dir));
    }
    // 0.7.1 Stable is not modified, and the RC receives its own consistent version.
    const pkg = expectedJson(path.join(stage, 'package.json'));
    pkg.version = VERSION;
    pkg.description = 'Software Hub v0.7.2 RC1 - Windows x64 portable release candidate';
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    const npmLock = expectedJson(path.join(stage, 'package-lock.json'));
    npmLock.version = VERSION;
    npmLock.packages[''].version = VERSION;
    fs.writeFileSync(path.join(stage, 'package-lock.json'), JSON.stringify(npmLock, null, 2) + '\n');
    const confPath = path.join(stage, 'src-tauri', 'tauri.conf.json');
    const conf = expectedJson(confPath);
    conf.version = VERSION;
    fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
    for (const file of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
      const p = path.join(stage, file);
      const source = fs.readFileSync(p, 'utf8');
      const updated = file.endsWith('Cargo.toml')
        ? source.replace(/^version = "0\.7\.1"$/m, `version = "${VERSION}"`)
        : source.replace(/(\[\[package\]\]\r?\nname = "software-hub-tauri"\r?\nversion = ")0\.7\.1("\r?\n)/, `$1${VERSION}$2`);
      assert(updated !== source, `Cannot synchronize version in ${file}`);
      fs.writeFileSync(p, updated);
    }
    fs.writeFileSync(path.join(stage, '.SOFTWARE_HUB_RC_ONLY'), `Software Hub ${VERSION}: isolated RC source. Never publish as Stable.\n`);
    // It is deliberately not a Preview, so the publisher can create a release candidate.
    assert(!fs.existsSync(path.join(stage, '.VISUAL_PREVIEW_ONLY')), 'Preview marker leaked into RC staging');
    return stage;
  } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
}
if (require.main === module) {
  try { process.stdout.write(prepareStage(path.resolve(__dirname, '..')) + '\n'); }
  catch (error) { console.error(`RC PREPARATION FAILED: ${error.message}`); process.exitCode = 1; }
}
module.exports = { prepareStage, VERSION };
