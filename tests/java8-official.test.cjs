'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const programs = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/programs.json'), 'utf8'));
const original = programs.find(p => p.id === 'java8');
const source = original.versionSource;

// The public Java 8 update page has the heading + date on one visible release block.
const current = `Free Java Update 8 Version 8 Update 503 Release date: August 18, 2026 Important Oracle Java License Information`;
const old = `Free Java Update 8 Version 8 Update 501 Release date: July 21, 2026`;
const unrelated = `Free Java Update 8 Release date: August 18, 2026 Java 21.0.9 Oracle Java License Information`;
const pre = `Java 9 Beta Update 999 Release date: October 20, 2026`;

function matchVersion(text) {
  const re = new RegExp(source.versionPattern, 'gi');
  const captures = [...text.matchAll(re)];
  return captures.map(m => m[1]);
}
function matchDate(text) {
  const re = new RegExp(source.publishedAtPattern, 'gi');
  return [...text.matchAll(re)].map(m => m[1]);
}

test('Java 8 metadata is taken from the official public update page; download button stays original', () => {
  assert.equal(programs.length, 126);
  assert.equal(source.sourceId, 'official-page');
  assert.equal(source.url, 'https://www.java.com/en/download/java8_update.jsp');
  assert.deepEqual(source.urls, [source.url]);
  assert.equal(original.website, 'https://www.java.com/en/download/');
  assert.equal(original.actions.find(a => a.label === 'Скачать').url, original.website);
  assert.equal(source.versionFormat, '8 Update {1}');
  assert.equal(source.publishedAtFormat, 'month-name-day-year-comma');
  assert.equal(source.fallbackVersion, undefined);
});

test('Java 8 parser matches only explicit Update heading and its associated release date', () => {
  assert.deepEqual(matchVersion(current), ['503']);
  assert.deepEqual(matchDate(current), ['August 18, 2026']);
  assert.deepEqual(matchVersion(old), ['501']);
  assert.deepEqual(matchDate(old), ['July 21, 2026']);
  assert.deepEqual(matchVersion(unrelated), []);
  assert.deepEqual(matchDate(unrelated), []);
  assert.deepEqual(matchVersion(pre), []);
  assert.deepEqual(matchDate(pre), []);
  // A loose page-wide Release date match would pass this case incorrectly.
  assert.deepEqual(matchDate('Version 8 Update 503 Important information Release date: May 3, 2022'), []);
});

test('Java 8 release remains optional and is not hardcoded to any 2026 version', () => {
  assert.doesNotMatch(source.versionPattern, /503/);
  assert.doesNotMatch(source.publishedAtPattern, /2026/);
  assert.equal(source.fallbackPublishedAt, undefined);
  assert.equal(source.fallbackPublishedAtText, undefined);
});
