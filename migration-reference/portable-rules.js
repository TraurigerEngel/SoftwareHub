'use strict';

const path = require('node:path');

function resolvePortableBaseDir({ isDev, appPath, exePath, portableExecutableDir }) {
  if (isDev) return path.resolve(String(appPath || '.'));
  const explicit = String(portableExecutableDir || '').trim();
  if (explicit && path.isAbsolute(explicit)) return path.resolve(explicit);
  return path.dirname(path.resolve(String(exePath || '.')));
}

function portableDataDir(baseDir) {
  return path.join(path.resolve(String(baseDir || '.')), 'portable-data');
}

function transientSessionDataDir(tempDir) {
  return path.join(path.resolve(String(tempDir || '.')), 'SoftwareHubSessionData');
}

module.exports = { resolvePortableBaseDir, portableDataDir, transientSessionDataDir };
