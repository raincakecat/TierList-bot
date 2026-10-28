import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../src/domain/types.js';
import {MemoryAdapter,Store} from '../src/storage/store.js';
import {allTimeTests,importLegacyStatistics,prepareLegacyStatistics} from '../src/storage/legacy-statistics.js';
import {validateState} from '../src/storage/backups.js';
import {readFile} from 'node:fs/promises';
import {configSchema} from '../src/config.js';
import {Service} from '../src/domain/service.js';
const G='100000000000000001',P='100000000000000002';
const source={tester_quotas:[{tester_id:P,count:12,all_time_count:41}],players:[{discord_id:P,last_tested:1700000000}]};
function fixture(){const state=emptyState(G);state.maintenance=true;state.players[P]={id:P,tier:'HT3',uuid:null,ign:null,region:null,preferredServer:null,waitlist:false,cooldownUntil:1000};return new Store(new MemoryAdapter(state));}
test('historical totals are imported once without manufacturing dated completions or changing ranks/cooldowns',async()=>{
  const store=fixture(),raw=JSON.stringify(source);assert.equal(await importLegacyStatistics(store,raw,2000000000000),true);
  let s=await store.read();assert.equal(allTimeTests(s,P),41);assert.equal(s.completions.length,0);assert.equal(s.players[P]!.previousTestAt,1700000000000);assert.equal(s.players[P]!.tier,'HT3');assert.equal(s.players[P]!.cooldownUntil,1000);assert.equal(s.legacyStatistics!.testers[P]!.undatedPeriodCount,12);
  await store.change(s=>s.completions.push({ticketId:'new-test',tester:P,at:2000000001000}));assert.equal(await importLegacyStatistics(store,raw),false);s=await store.read();assert.equal(allTimeTests(s,P),42);validateState(s,G);
  await assert.rejects(importLegacyStatistics(store,JSON.stringify({...source,players:[]})),/another snapshot/);
});
test('legacy totals reject inconsistent/duplicate records and unsafe import timing',async()=>{
  assert.throws(()=>prepareLegacyStatistics({...source,tester_quotas:[{tester_id:P,count:50,all_time_count:41}]}),/inconsistent/);
  assert.throws(()=>prepareLegacyStatistics({...source,tester_quotas:[...source.tester_quotas,...source.tester_quotas]}),/Duplicate/);
  const store=fixture();await store.change(s=>s.maintenance=false);await assert.rejects(importLegacyStatistics(store,JSON.stringify(source)),/maintenance/);
  await store.change(s=>{s.maintenance=true;s.completions.push({ticketId:'existing',tester:P,at:1});});await assert.rejects(importLegacyStatistics(store,JSON.stringify(source)),/before recording/);
});
test('portable backups accept old state but reject corrupt legacy counters and previous-test times',async()=>{
  const store=fixture();validateState(await store.read(),G);await importLegacyStatistics(store,JSON.stringify(source));const s=await store.read();s.legacyStatistics!.testers[P]!.allTimeCount=-1;assert.throws(()=>validateState(s,G),/legacy tester/);s.legacyStatistics!.testers[P]!.allTimeCount=41;s.players[P]!.previousTestAt=-1;assert.throws(()=>validateState(s,G),/previous-test/);
});

test('the first new testing ticket uses the saved legacy previous-test date',async()=>{
  const store=fixture();await importLegacyStatistics(store,JSON.stringify(source));
  const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));c.community.guildId=G;c.permissionGroups.owner=[P];c.regions.NA.testCategoryId=G;c.categories.highTests=G;c.channels.testingArchives=G;
  await store.change(s=>{s.initialized=true;s.maintenance=false;Object.assign(s.players[P]!,{uuid:'a'.repeat(32),ign:'Player',region:'NA'});});
  const service=new Service(store,()=>c,()=>2000000000000),t=await service.forceTest({id:P,roles:[P],administrator:false,channelAccess:true},P,'NA');assert.equal(t.previousTestAt,1700000000000);
});
