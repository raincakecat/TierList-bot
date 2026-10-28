import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { configSchema } from '../src/config.js';
import { emptyState, type Actor } from '../src/domain/types.js';
import { Store, MemoryAdapter } from '../src/storage/store.js';
import { Operations } from '../src/storage/operations.js';
import { Worker } from '../src/storage/jobs.js';
import { Backups } from '../src/storage/backups.js';
import { healthSummary } from '../src/discord/health.js';
import { paginateLines } from '../src/discord/pages.js';
import { enqueue } from '../src/domain/service.js';
import { queuePanels } from '../src/discord/queue-panel.js';
import { alreadyVerified } from '../src/discord/verification.js';
import { WizardSessions, wizardView, wizardModal, wizardPolicy, wizardResources } from '../src/discord/wizard.js';

const ID='100000000000000001',ROLE='100000000000000002';
const admin:Actor={id:ID,roles:[ROLE],administrator:true};
const template=()=>readFile('config.example.json','utf8').then(raw=>configSchema.parse(JSON.parse(raw)));
function latch(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}

test('recovery drains a running job, fences new writes, and permits lease renewal',async()=>{
  const state=emptyState(ID);state.maintenance=true;state.runtimeLease={owner:'lease',until:10};state.jobs.one={id:'one',kind:'notice',data:{},status:'pending',attempts:0,nextAt:0,checkpoints:{}};
  const store=new Store(new MemoryAdapter(state)),entered=latch(),finish=latch(),order:string[]=[];
  const worker=new Worker(store,async()=>{entered.release();await finish.promise;order.push('job finished');},async()=>{});
  const running=worker.runOnce();await entered.promise;
  const recovery=store.operations.exclusive(async()=>{order.push('recovery');await store.renewLease('lease',500);await store.change(s=>s.initialized=true);});
  const write=store.change(s=>{order.push('write');s.maintenance=false;});await delay(5);assert.deepEqual(order,[]);await store.renewLease('lease',100);assert.equal((await store.read()).runtimeLease!.until,100);
  finish.release();await Promise.all([running,recovery,write]);assert.deepEqual(order,['job finished','recovery','write']);assert.equal((await store.read()).jobs.one!.status,'done');
});
test('recovery timeout never executes its mutation and releases waiting operations',async()=>{const operations=new Operations(),entered=latch(),finish=latch();let mutated=false;const running=operations.shared(async()=>{entered.release();await finish.promise;});await entered.promise;await assert.rejects(operations.exclusive(async()=>{mutated=true;},10),/timed out/);assert.equal(mutated,false);finish.release();await running;assert.equal(await operations.shared(async()=>true),true);});
test('failed exclusive operation releases its fence; malformed restore leaves source intact',async()=>{const state=emptyState(ID);state.maintenance=true;const store=new Store(new MemoryAdapter(state)),dir=await mkdtemp(join(tmpdir(),'crystal-recovery-'));try{await assert.rejects(store.operations.exclusive(async()=>{throw Error('failed');}),/failed/);await assert.rejects(new Backups(store,dir).restore(join(dir,'missing.json')));assert.deepEqual(await store.read(),state);assert.equal(store.operations.recovering,false);}finally{await rm(dir,{recursive:true});}});
test('restore captures the live lease after draining active work',async()=>{const state=emptyState(ID);state.maintenance=true;state.runtimeLease={owner:'lease',until:10};const store=new Store(new MemoryAdapter(state)),dir=await mkdtemp(join(tmpdir(),'crystal-restore-'));try{const backups=new Backups(store,dir),file=await backups.create();await store.change(s=>s.initialized=true);await store.renewLease('lease',500);await backups.restore(file);const restored=await store.read();assert.equal(restored.initialized,false);assert.equal(restored.runtimeLease!.until,500);assert.equal(restored.maintenance,true);}finally{await rm(dir,{recursive:true});}});
test('health reports job, backup, and configuration information without backend errors',async()=>{const c=await template(),state=emptyState(ID);state.lastAutomaticBackupAt=1000;state.jobs.j={id:'j',kind:'notice',data:{},status:'pending',attempts:3,nextAt:2000,createdAt:500,checkpoints:{}};const store=new Store(new MemoryAdapter(state));const text=await healthSummary(store,c,0,2,3000);assert(text.includes('retrying: 1'));assert(text.includes('1970-01-01T00:00:00.500Z'));assert(text.includes('Database: available'));const broken=new Store({read:async()=>{throw Error('secret connection password');},compareAndSwap:async()=>false,close:async()=>{}});const failed=await healthSummary(broken,c,0,0);assert(failed.includes('Database: unavailable'));assert(!failed.includes('password'));});
test('pagination preserves 1000 complete mentions and line numbering within embed limits',()=>{const lines=Array.from({length:1000},(_,index)=>`${index+1}. <@${100000000000000000n+BigInt(index)}>`),pages=paginateLines(lines);assert(pages.length>1);assert(pages.every(p=>p.length<=3800));assert.deepEqual(pages.join('\n').split('\n'),lines);});
test('already verified embed shows saved account and preserves rank and cooldown',async()=>{const c=await template(),p={id:ID,tier:'HT3' as const,uuid:'a'.repeat(32),ign:'Example',region:'NA' as const,preferredServer:'server',waitlist:true,cooldownUntil:9000},before=structuredClone(p);const embed=alreadyVerified(c,p)!.toJSON();assert.equal(embed.title,'Already Verified');assert.equal(embed.fields!.find(x=>x.name==='UUID')!.value,p.uuid);assert(embed.thumbnail!.url.includes(p.uuid));assert.deepEqual(p,before);assert.equal(alreadyVerified(c,{...p,uuid:null}),null);});
test('wizard rejects unauthorized users, expired sessions, changed configurations, and live admins without Owner',async()=>{const c=await template();c.permissionGroups.owner=[ROLE];let now=0;const sessions=new WizardSessions(()=>now);assert.throws(()=>sessions.create(c,{...admin,administrator:false,roles:[]},{initialized:false}),/Administrator/);const session=sessions.create(c,admin,{initialized:false});assert.throws(()=>sessions.find(session.id,{...admin,id:ROLE},c,{initialized:false}),/another operator/);assert.throws(()=>sessions.find(session.id,admin,{...c,community:{...c.community,name:'Changed'}},{initialized:false}),/Configuration changed/);now=900001;assert.throws(()=>sessions.find(session.id,admin,c,{initialized:false}),/expired/);assert.throws(()=>sessions.create(c,{...admin,roles:[]},{initialized:true}),/Owner/);});
test('wizard edits draft settings and mappings, validates input, and cancellation does not save',async()=>{const c=await template();c.community.guildId=ID;const sessions=new WizardSessions(),session=sessions.create(c,admin,{initialized:false});sessions.edit(session,'community',{name:'Example Community',timezone:'Europe/London'});sessions.edit(session,'policy',{normal:'0',high:'7d',quota:'10',capacity:'100'});sessions.select(session,'regions',['NA','EU']);sessions.select(session,'modules',['testing','supportTickets','tierLists','testerQuotas']);const index=wizardResources(c).findIndex(x=>x.path==='permissionGroups.owner');sessions.edit(session,`map-${index}`,{ids:ROLE});assert.equal(session.draft.permissionGroups.owner[0],ROLE);assert.equal(session.draft.regions.AS.enabled,false);assert.equal(wizardPolicy(session.draft).length,0);assert.equal(c.community.name,'Crystal Community');assert.throws(()=>sessions.edit(session,'community',{name:'a',timezone:'bad-timezone'}),/Check/);assert.throws(()=>sessions.edit(session,'policy',{normal:'bad',high:'7d',quota:'0',capacity:'20'}));assert.throws(()=>sessions.edit(session,`map-${index}`,{ids:'invalid'}),/Discord IDs/);sessions.remove(session.id);assert.throws(()=>sessions.find(session.id,admin,c,{initialized:false}),/expired/);});
test('all wizard screens and resource pages obey Discord component limits',async()=>{const c=await template(),sessions=new WizardSessions(),s=sessions.create(c,admin,{initialized:false});for(const view of ['home','features','resources'] as const){s.view=view;for(let page=0;page<5;page++){s.resourcePage=page;const payload=wizardView(s);assert(payload.components.length<=5);for(const row of payload.components){const data=row.toJSON();assert(data.components.length<=5);for(const component of data.components)if('options' in component)assert(component.options.length<=25);}}}for(const action of ['community','policy','map-0'])assert(wizardModal(s,action).toJSON().components!.length<=5);});


test('parallel workers reserve capacity for ticket opens while background archives wait',async()=>{
 const s=emptyState(ID);for(const id of ['a','b','c'])enqueue(s,'archive',{ticketId:id},0,id);const store=new Store(new MemoryAdapter(s)),finish=latch(),started:string[]=[];
 const worker=new Worker(store,async j=>{started.push(j.id);if(j.kind==='archive')await finish.promise;},async()=>{},3);
 const a=worker.runOnce(),b=worker.runOnce();while(started.length<2)await delay(1);assert.equal(await worker.runOnce(),false);
 await store.change(s=>{enqueue(s,'open',{ticketId:'new'},0,'new');});assert.equal(await worker.runOnce(),true);assert(started.includes('new'));finish.release();await Promise.all([a,b]);assert.equal((await store.read()).jobs.c!.status,'pending');
});

test('parallel workers serialize the same ticket while unrelated tickets proceed',async()=>{
 const s=emptyState(ID);enqueue(s,'open',{ticketId:'one'},0,'first');enqueue(s,'notice',{ticketId:'one'},0,'later');enqueue(s,'open',{ticketId:'two'},0,'other');const store=new Store(new MemoryAdapter(s)),finish=latch(),started:string[]=[];
 const worker=new Worker(store,async j=>{started.push(j.id);if(j.id==='first')await finish.promise;},async()=>{},3);const a=worker.runOnce();while(!started.length)await delay(1);await worker.runOnce();assert.deepEqual(started,['first','other']);assert.equal(await worker.runOnce(),false);finish.release();await a;await worker.runOnce();assert.deepEqual(started,['first','other','later']);
});

test('independent background jobs remain inside the recovery fence after their caller returns',async()=>{
 const operations=new Operations(),entered=latch(),finish=latch();let job:Promise<void>|undefined,restored=false;
 await operations.shared(async()=>{job=operations.independent(async()=>{entered.release();await finish.promise;});await entered.promise;});
 const recovery=operations.exclusive(async()=>{restored=true;});await delay(5);assert.equal(restored,false);finish.release();await job;await recovery;assert.equal(restored,true);
});

test('queue refreshes coalesce and panels preserve the last actual session timestamp',async()=>{
 const c=await template(),s=emptyState(ID);enqueue(s,'queues',{},1,'one');enqueue(s,'queues',{},2,'two');enqueue(s,'lists',{},1,'list1');enqueue(s,'lists',{},2,'list2');assert.equal(Object.keys(s.jobs).length,2);
 s.lastTestingSession={NA:1792800000000};const panel=queuePanels(c,s,'NA')[0]!.embeds[0]!.toJSON();assert(panel.fields!.some(f=>f.name==='Last testing session'&&f.value.includes('<t:1792800000:f>')));assert.equal(panel.footer,undefined);
});


test('a long running local job is not reclaimed even if its saved lease becomes old',async()=>{const s=emptyState(ID);enqueue(s,'open',{ticketId:'one'},0,'one');const store=new Store(new MemoryAdapter(s)),finish=latch(),entered=latch();let calls=0;const worker=new Worker(store,async()=>{calls++;entered.release();await finish.promise;},async()=>{},3);const work=worker.runOnce();await entered.promise;await store.change(s=>s.jobs.one!.leaseUntil=0);assert.equal(await worker.runOnce(),false);finish.release();await work;assert.equal(calls,1);});


test('queue cards match open and closed layouts with controls only while open',async()=>{const c=await template(),s=emptyState(ID);s.lastTestingSession={NA:1792800000000};const closed=queuePanels(c,s,'NA')[0]!;assert.equal(closed.embeds[0]!.toJSON().title,'No Testers Online');assert.equal(closed.components.length,0);s.testers[ROLE]='NA';s.queues.NA=[ID];const open=queuePanels(c,s,'NA')[0]!,embed=open.embeds[0]!.toJSON();assert.equal(embed.title,'Tester(s) Available!');assert(embed.description!.includes('1. <@'+ID+'>'));assert(embed.description!.includes('**Testers**'));assert.equal(embed.fields,undefined);assert.equal(open.components[0]!.toJSON().components.length,1);s.maintenance=true;assert.equal(queuePanels(c,s,'NA')[0]!.components.length,0);});

test('scheduled archive safety waits retain checkpoints without failure backoff or alerts',async()=>{
 const {JobDeferred}=await import('../src/domain/types.js');const s=emptyState(ID);enqueue(s,'archive',{ticketId:'ticket'},0,'archive');s.jobs.archive!.attempts=250;const store=new Store(new MemoryAdapter(s));let reports=0;const retryAt=Date.now()+10000;
 const worker=new Worker(store,async(_j,save)=>{await save('archived',Date.now());throw new JobDeferred(retryAt,'Waiting for safe deletion delay');},async()=>{reports++;});await worker.runOnce();const j=(await store.read()).jobs.archive!;
 assert.equal(j.status,'pending');assert.equal(j.attempts,250);assert.equal(j.nextAt,retryAt);assert(j.checkpoints.archived);assert.equal(j.leaseUntil,undefined);assert.equal(reports,0);
});

test('worker preserves safe failure codes without persisting error messages or unknown code contents',async()=>{for(const code of [50013,'PRIVATE_SECRET_VALUE']){const state=emptyState(ID);enqueue(state,'notice',{},0,'failed');const store=new Store(new MemoryAdapter(state));const worker=new Worker(store,async()=>{throw Object.assign(Error('SECRET_DATABASE_PASSWORD'),{code});},async()=>{});await worker.runOnce();const j=(await store.read()).jobs.failed!;assert.equal(j.lastFailureCode,code===50013?'Discord_50013':'OperationError');assert(j.lastFailureAt);assert(!JSON.stringify(j).includes('SECRET'));}});

test('restore preserves an external runtime lease without putting it in backups or primary state',async()=>{
 const state=emptyState(ID);state.maintenance=true;let until=1000;const adapter=new MemoryAdapter(state);Object.assign(adapter,{readRuntimeLease:async()=>({owner:'external-owner',until})});const store=new Store(adapter),dir=await mkdtemp(join(tmpdir(),'external-lease-restore-'));
 try{const backups=new Backups(store,dir),file=await backups.create();assert.equal(JSON.parse(await readFile(file,'utf8')).state.runtimeLease,undefined);await store.change(s=>s.initialized=true);until=5000;await backups.restore(file);assert.equal((await store.read()).runtimeLease!.owner,'external-owner');assert.equal((await store.read()).runtimeLease!.until,5000);assert.equal((await adapter.read()).state.runtimeLease,undefined);}finally{await rm(dir,{recursive:true});}
});

test('ticket archival can proceed while its result message is delayed',async()=>{
 const s=emptyState(ID);enqueue(s,'result',{ticketId:'ticket'},0,'result');const store=new Store(new MemoryAdapter(s)),hold=latch(),started:string[]=[];const worker=new Worker(store,async j=>{started.push(j.id);if(j.kind==='result')await hold.promise;},async()=>{},3);const first=worker.runOnce();while(!started.length)await delay(1);await store.change(s=>enqueue(s,'archive',{ticketId:'ticket'},1,'archive'));await worker.runOnce();assert(started.includes('archive'));hold.release();await first;
});
