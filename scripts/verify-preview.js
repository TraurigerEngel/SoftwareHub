'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function assert(cond, message) { if (!cond) throw new Error(message); }
const pkg = JSON.parse(read('package.json'));
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargoVersion = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
assert(['0.7.1', '0.7.2-rc.1', '0.7.2', '0.7.3'].includes(pkg.version) && tauriConfig.version === pkg.version && cargoVersion === pkg.version,
  'Stable source version must be consistent across npm, Cargo and Tauri');
const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(read('package-lock.json'));
  assert(lock.version === pkg.version && lock.packages?.['']?.version === pkg.version,
    'package-lock.json has stale version; synchronize lockfile before build');
}
const programs = JSON.parse(read('data/programs.json'));
const sources = JSON.parse(read('data/sources.json'));
assert(programs.length === 126, 'Expected 126 catalog entries after removing ZStartup and BetterTrumpet');
assert(Object.keys(sources).length === 9, 'Expected 9 untouched version source definitions');
assert(programs.filter(p => p.type === 'site').length === 40, 'Expected 40 sites');
assert(programs.find(p => p.id === 'cpu-z')?.website?.includes('techpowerup.com'), 'CPU-Z TechPowerUp routing changed');
assert(programs.find(p => p.id === 'atk-hub')?.versionSource == null, 'ATK HUB metadata changed');
const visualCpp = programs.find(p => p.id === 'visualcpp');
assert(visualCpp?.versionSource?.sourceId == null && visualCpp?.versionSource?.showLatestVersion === false && visualCpp?.versionSource?.showSource === false, 'Visual C++ must be manual-only and versionless');
assert(!programs.some(p=>p.id==='bettertrumpet' || p.versionSource?.repo==='xammen/BetterTrumpet'), 'BetterTrumpet must be absent from catalog and version checks');
const frontend = read('web/index.html');
assert(frontend.includes('bridge.js') && frontend.indexOf('bridge.js') < frontend.indexOf('renderer.js'), 'Tauri bridge must precede renderer');
assert(!frontend.includes('node_modules/'), 'HTML includes Electron path');
assert(!read('src-tauri/Cargo.toml').includes('electron'), 'Cargo must not contain Electron');
assert(!read('package.json').includes('"electron"'), 'Electron dependency still present');
const bridge = read('web/bridge.js');
for (const command of ['get_catalog','get_version_cache','set_version_cache','check_version','get_startup_refresh_ids','open_external','copy_catalog_text','is_internet_available']) {
  assert(bridge.includes(`'${command}'`) && read('src-tauri/src/lib.rs').includes(`fn ${command}`), `Missing bridge/backend pair: ${command}`);
}
console.log('SOFTWARE HUB SOURCE VERIFY OK: 126 cards, 40 sites, 9 sources, 8 IPC pairs, no Electron dependency');
