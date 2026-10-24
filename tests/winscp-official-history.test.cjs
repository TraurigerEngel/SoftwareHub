"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const programs=JSON.parse(fs.readFileSync(path.join(__dirname,'..','data','programs.json'),'utf8'));
const win=programs.find(p=>p.id==='winscp');
test('WinSCP checks official history and keeps original download',()=>{
 assert.equal(programs.length,126);
 assert.equal(win.website,'https://winscp.net/eng/download.php');
 assert.deepEqual(win.actions,[{label:'Скачать',url:'https://winscp.net/eng/download.php'}]);
 assert.equal(win.versionSource.url,'https://winscp.net/eng/docs/history');
 assert.equal(win.versionSource.sourceId,'official-page');
 assert.equal(win.versionSource.versionPick,'highest');
 assert.equal(win.versionSource.fallbackVersion,'6.7');
});
test('WinSCP history parser ignores pending and release candidates',()=>{
 const p=win.versionSource;
 const rx=new RegExp(p.versionPattern,p.versionPatternFlags+'g');
 const sample='6.8 (not released yet) 2026-10-22 6.7.1 (not released yet) 2026-10-23 6.7 2026-10-14 6.6.4 RC 2026-10-07 6.5.7 2026-09-09';
 const versions=[...sample.matchAll(rx)].map(x=>x[1]);
 assert.deepEqual(versions,['6.7','6.5.7']);
});
