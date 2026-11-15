import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configSchema} from '../src/config.js';
import {ActivityService} from '../src/domain/activity.js';
import {emptyState} from '../src/domain/types.js';
import {MemoryAdapter,Store} from '../src/storage/store.js';

test('activity responses, close deadline and LOA exemptions survive stored state',async()=>{
  const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));
  c.permissionGroups.highStaff=['111111111111111111'];c.permissionGroups.botAdmin=['222222222222222222'];c.permissionGroups.owner=['333333333333333333'];
  const s=emptyState('444444444444444444');s.initialized=true;const store=new Store(new MemoryAdapter(s));let now=1000;
  const service=new ActivityService(store,()=>c,()=>now),admin={id:'admin',roles:c.permissionGroups.highStaff,administrator:false,channelAccess:true};
  const notice=await service.start(admin,['a','b','c','screensharer','both','departed'],'notice','report',['staff'],'loa');
  await assert.rejects(()=>service.start(admin,[],'notice','report',['staff'],'loa'),/already running/);
  await service.posted(notice.id,'message',now);
  const person={id:'a',roles:['staff'],administrator:false,channelAccess:true};
  await service.respond(person,notice.id,'notice','message');
  await assert.rejects(()=>service.respond(person,notice.id,'notice','message'),/already recorded/);
  await assert.rejects(()=>service.respond({...person,id:'new'},notice.id,'notice','message'),/eligible/);
  now+=86_400_000;
  await assert.rejects(()=>service.respond({...person,id:'b'},notice.id,'notice','message'),/closed/);
  const afterRestart=new ActivityService(store,()=>c,()=>now);
  assert.deepEqual(await afterRestart.finish(notice.id,['a','b','c','screensharer','both'],['c','both'],['screensharer','both']),{missing:['b'],exempt:['c','both']});
  const result=(await store.read()).activityNotices![notice.id]!;assert.equal(result.status,'closing');assert.deepEqual(result.roleExempt,['screensharer']);
});

test('only high staff, bot admins or owners can start',async()=>{
  const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));c.permissionGroups.owner=[];c.permissionGroups.highStaff=[];c.permissionGroups.botAdmin=[];
  const s=emptyState('444444444444444444');s.initialized=true;const service=new ActivityService(new Store(new MemoryAdapter(s)),()=>c);
  await assert.rejects(()=>service.start({id:'staff',roles:['staff'],administrator:false},[],'notice','report',['staff'],'loa'),/permission/);
});
