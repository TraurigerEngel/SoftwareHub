'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const html = read('web/index.html');
const css = read('web/styles.css');
const newStyles = css.slice(css.indexOf('/* Visual Preview 9 — Single compact catalog toolbar'));

function between(src, first, last) {
  const a=src.indexOf(first), b=src.indexOf(last,a);
  assert.ok(a>=0 && b>a, `Expected ${first} before ${last}`);
  return src.slice(a,b);
}

test('catalog has no duplicate brand heading; the centered window title remains', () => {
  assert.equal((html.match(/<h1\b/g)||[]).length, 0);
  assert.doesNotMatch(html, /class="brand-block"/);
  assert.equal((html.match(/class="window-titlebar-title"[^>]*>Software Hub<\/div>/g)||[]).length,1);
  assert.match(html, /id="windowMinimize"/);
  assert.match(html, /id="windowClose"/);
  assert.doesNotMatch(html, /id="windowMaximize"/);
});

test('search, category filter, stats and refresh use one shared topbar row', () => {
  const top = between(html,'<header class="topbar">','</header>');
  const toolbar = between(top,'<div class="toolbar">','<div class="top-actions">');
  assert.match(toolbar,/id="search"/);
  assert.match(toolbar,/id="programFilterBtn"/);
  assert.match(toolbar,/id="programFilterPopover"/);
  assert.match(top,/id="stats"/);
  assert.match(top,/id="refreshBtn"/);
  assert.ok(top.indexOf('id="programFilterBtn"')<top.indexOf('id="stats"'));
  for (const id of ['search','programFilterBtn','programFilterPopover','stats','refreshBtn']) {
    assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} remains unique`);
  }
});

test('compact controls stay 42px tall and category popup stacks over cards', () => {
  assert.match(newStyles,/\.app-shell > \.topbar\s*\{[^}]*z-index:\s*4/s);
  assert.match(newStyles,/\.topbar > \.toolbar\s*\{[^}]*margin:\s*0;/s);
  assert.match(newStyles,/\.topbar > \.toolbar > \.search-box\s*\{[^}]*max-width:\s*500px;/s);
  assert.match(css,/\.search-box\s*\{[^}]*height:\s*42px;/s);
  assert.match(css,/\.filter-button\s*\{[^}]*height:\s*42px;/s);
  assert.match(newStyles,/@media \(max-width: 1080px\)/);
  assert.match(newStyles,/@media \(max-width: 920px\)/);
});

test('original starfield, full work-area window and startup splash remain untouched', () => {
  assert.match(html,/<canvas id="shubParticleField"/);
  assert.match(html,/<script src="\.\/particles\.js"><\/script>/);
  assert.match(css,/grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css,/transition:\s*opacity 200ms ease-in-out 1000ms/);
  assert.match(css,/transition:\s*opacity 480ms ease-in-out 1250ms, visibility 0s linear 1730ms/);
  const config=JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(config.app.windows[0].maximized,true);
  assert.notEqual(config.app.windows[0].fullscreen,true);
  assert.equal(config.app.windows[0].decorations,false);
});

test('narrow windows keep controls within the viewport instead of a tall flex-basis overflow', () => {
  assert.match(newStyles, /@media \(max-width: 920px\)\s*\{[\s\S]*?\.topbar > \.toolbar,\s*\.topbar > \.top-actions\s*\{\s*flex:\s*0 0 auto;/);
  assert.match(newStyles, /\.topbar > \.toolbar > \.search-box\s*\{\s*flex:\s*0 0 auto;\s*height:\s*42px;/);
});
