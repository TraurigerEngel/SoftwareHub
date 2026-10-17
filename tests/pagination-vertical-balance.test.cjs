'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.resolve(__dirname, '../web/styles.css'), 'utf8');
const html = fs.readFileSync(path.resolve(__dirname, '../web/index.html'), 'utf8');
const renderer = fs.readFileSync(path.resolve(__dirname, '../web/renderer.js'), 'utf8');
const fix = css.slice(css.lastIndexOf('/* Pagination Position Hotfix 1 —'));

test('pagination stays at the screenshot bottom offset without moving any cards', () => {
  assert.match(html, /<main id="grid" class="grid"[^>]*><\/main>\s*<div id="pagination" class="pagination hidden"/);
  assert.match(fix, /\.app-shell:has\(> \.pagination:not\(\.hidden\)\)\s*\{\s*padding-bottom:\s*43px;/);
  assert.match(fix, /\.app-shell:has\(> \.pagination:not\(\.hidden\)\) > \.grid\s*\{\s*flex:\s*1 1 auto;\s*min-height:\s*0;\s*overflow-y:\s*hidden;/);
  assert.match(fix, /\.app-shell > \.pagination:not\(\.hidden\)\s*\{\s*flex:\s*0 0 36px;\s*min-height:\s*36px;\s*max-height:\s*36px;\s*margin-top:\s*0;/);
  assert.doesNotMatch(fix, /(?:flex:\s*1 0 36px|max-height:\s*none|grid-auto-rows|\.card\s*\{|\.window-titlebar|\.shub-particle-field\s*\{)/);
  assert.match(css, /\.grid\s*\{[^}]*grid-auto-rows:\s*186px;/s);
  assert.match(renderer, /const PAGE_SIZE = 20/);
});

test('desktop catalog does not scroll while single-page hiding and narrow layout remain intact', () => {
  assert.match(fix, /overflow-y:\s*hidden;/);
  assert.match(fix, /@media \(max-width:\s*920px\)\s*\{[\s\S]*?overflow-y:\s*visible;/);
  assert.match(renderer, /pagination\.classList\.toggle\('hidden', pages <= 1\)/);
  assert.match(css, /\.pagination-controls\s*\{[^}]*justify-content:\s*center;/);
});
