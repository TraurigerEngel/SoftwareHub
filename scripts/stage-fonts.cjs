'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const from = path.join(root, 'node_modules', '@fontsource-variable', 'inter');
const target = path.join(root, 'web', 'fonts');
if (!fs.existsSync(from)) {
  console.error('Не найден Inter. Выполните npm ci в корне проекта.');
  process.exit(1);
}
fs.mkdirSync(target, { recursive: true });
const css = fs.readFileSync(path.join(from, 'wght.css'), 'utf8');
// Original wght.css must be staged with all precisely referenced woff2 assets.
const files = new Set([...css.matchAll(/url\(['"]?\.\/files\/([^)'"?]+)['"]?\)/g)].map(m => m[1]));
if (!files.size) throw new Error('Unknown Inter @fontsource CSS layout: no referenced font files');
fs.mkdirSync(path.join(target, 'files'), { recursive: true });
for (const name of files) {
  const source = path.join(from, 'files', name);
  if (!fs.existsSync(source)) throw new Error(`Missing Inter asset: ${name}`);
  fs.copyFileSync(source, path.join(target, 'files', name));
}
fs.writeFileSync(path.join(target, 'wght.css'), css);
console.log(`FONT STAGE OK: ${files.size} pinned Inter woff2 files`);
