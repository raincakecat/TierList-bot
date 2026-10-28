import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import type pg from 'pg';
import { emptyState, type State } from '../src/domain/types.js';
import { PostgreSQLAdapter, SupabaseAdapter, Store, encodeRemoteState, decodeRemoteState } from '../src/storage/store.js';
const guild='100000000000000001';

test('PostgreSQL adapter contract exercises SQL/CAS against an emulated server',async()=>{
  const database=newDb(),driver=database.adapters.createPg(),pool=new driver.Pool() as unknown as pg.Pool;
  const adapter=await PostgreSQLAdapter.open('unused',guild,pool),store=new Store(adapter);
  try{const first=await adapter.read();assert.equal(first.revision,0);const next=structuredClone(first.state);next.maintenance=true;assert.equal(await adapter.compareAndSwap(0,next),true);assert.equal(await adapter.compareAndSwap(0,first.state),false);await Promise.all(Array.from({length:8},(_,i)=>store.change(s=>s.audit.push({id:String(i),at:i,actor:guild,action:'contract',target:guild}))));assert.equal((await store.read()).audit.length,8);}finally{await adapter.close();}
});

test('Supabase adapter contract uses service-only REST and atomic RPC without overwriting startup data',async()=>{
  let row:{guild:string;revision:number;body:State}|undefined;const requests:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url);requests.push(`${request.method} ${url.pathname}`);
    if(url.pathname==='/rest/v1/crystal_state'&&request.method==='POST'){const incoming=await request.json() as NonNullable<typeof row>;row??=structuredClone(incoming);return new Response(null,{status:201});}
    if(url.pathname==='/rest/v1/crystal_state'&&request.method==='GET')return Response.json({revision:row!.revision,body:row!.body});
    if(url.pathname==='/rest/v1/rpc/crystal_commit'){const body=await request.json() as {p_guild:string;p_revision:number;p_body:State};if(body.p_guild!==guild||body.p_revision!==row!.revision)return Response.json(false);row!.revision++;row!.body=structuredClone(body.p_body);return Response.json(true);}
    throw new Error('Unexpected REST call');
  };
  const a=await SupabaseAdapter.open('https://example.supabase.co','test-only-key',guild,fetcher),store=new Store(a);await store.change(s=>s.maintenance=true);
  await SupabaseAdapter.open('https://example.supabase.co','test-only-key',guild,fetcher);assert.equal((await a.read()).state.maintenance,true);const snapshot=await a.read();assert.equal(await a.compareAndSwap(snapshot.revision-1,emptyState(guild)),false);
  await Promise.all(Array.from({length:8},(_,i)=>store.change(s=>s.audit.push({id:String(i),at:i,actor:guild,action:'contract',target:guild}))));assert.equal((await store.read()).audit.length,8);assert(requests.some(r=>r.includes('/rpc/crystal_commit')));await a.close();
});

test('Supabase failures report no credentials',async()=>{const key='DO-NOT-LOG-THIS';await assert.rejects(SupabaseAdapter.open('https://example.supabase.co',key,guild,async()=>Response.json({message:key},{status:403})),e=>e instanceof Error&&!e.message.includes(key));});


test('Supabase snapshots coalesce reads, isolate callers, and refresh after CAS conflicts',async()=>{
 let row={revision:0,state:emptyState(guild)},gets=0,rpcs=0;
 const fetcher:typeof fetch=async(input,init)=>{const request=new Request(input,init),url=new URL(request.url);
  if(request.method==='POST'&&url.pathname.endsWith('/crystal_state'))return new Response(null,{status:201});
  if(request.method==='GET'){gets++;await new Promise(r=>setTimeout(r,5));return Response.json({revision:row.revision,body:row.state});}
  const body=await request.json() as {p_revision:number;p_body:State};rpcs++;if(body.p_revision!==row.revision)return Response.json(false);row={revision:row.revision+1,state:structuredClone(body.p_body)};return Response.json(true);
 };
 const a=await SupabaseAdapter.open('https://example.supabase.co','test-only-key',guild,fetcher),store=new Store(a);
 const snapshots=await Promise.all(Array.from({length:8},()=>a.read()));assert.equal(gets,1);snapshots[0]!.state.maintenance=true;assert.equal((await a.read()).state.maintenance,false);
 row.revision++;row.state.initialized=true;
 await store.change(s=>s.maintenance=true);assert.equal(rpcs,2);assert.equal(row.state.initialized,true);assert.equal((await a.read()).state.maintenance,true);
 const before=gets;row.state.initialized=false;row.revision++;await new Promise(r=>setTimeout(r,1050));assert.equal((await a.read()).state.initialized,false);assert.equal(gets,before+2);
});

test('Supabase leases use a small separate row and keep state revisions unchanged on heartbeat',async()=>{
 const rows=new Map<string,{revision:number;body:State}>(),writes:{guild:string;bytes:number}[]=[];let active=0,peak=0;
 const fetcher:typeof fetch=async(input,init)=>{const req=new Request(input,init),url=new URL(req.url);
  if(req.method==='POST'&&url.pathname.endsWith('/crystal_state')){const row=await req.json() as {guild:string;revision:number;body:State};if(!rows.has(row.guild))rows.set(row.guild,{revision:row.revision,body:structuredClone(row.body)});return new Response(null,{status:201});}
  if(req.method==='GET'){const key=url.searchParams.get('guild')!.slice(3),row=rows.get(key)!;return Response.json({revision:row.revision,body:row.body});}
  const body=await req.json() as {p_guild:string;p_revision:number;p_body:State};active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;const row=rows.get(body.p_guild)!;if(row.revision!==body.p_revision)return Response.json(false);row.revision++;row.body=structuredClone(body.p_body);writes.push({guild:body.p_guild,bytes:Buffer.byteLength(JSON.stringify(body.p_body))});return Response.json(true);
 };
 const adapter=await SupabaseAdapter.open('https://example.supabase.co','test-only-key',guild,fetcher),store=new Store(adapter);
 await store.change(s=>s.audit.push({id:'large',at:1,actor:guild,action:'x'.repeat(100000),target:guild}));const stateRevision=rows.get(guild)!.revision;
 await store.acquireLease('one',Date.now()+60000);await store.renewLease('one',Date.now()+90000);assert.equal(rows.get(guild)!.revision,stateRevision);assert(writes.filter(w=>w.guild!==guild).every(w=>w.bytes<1000));assert.equal((await store.read()).runtimeLease!.owner,'one');
 const competitor=new Store(await SupabaseAdapter.open('https://example.supabase.co','test-only-key',guild,fetcher));await assert.rejects(competitor.acquireLease('two',Date.now()+60000),/Another bot/);await assert.rejects(competitor.renewLease('two',Date.now()+60000),/lease lost/);
 await store.releaseLease('one');await competitor.acquireLease('two',Date.now()+60000);await assert.rejects(store.renewLease('one',Date.now()+60000),/lease lost/);
 await Promise.all(Array.from({length:6},(_,n)=>store.change(s=>s.audit.push({id:String(n),at:n,actor:guild,action:'parallel',target:guild}))));assert.equal(decodeRemoteState(rows.get(guild)!.body).audit.length,7);assert.equal(peak,1);
});

test('unchanged Supabase polling downloads only revisions, while external changes fetch fresh state',async()=>{
 let revision=0,body=emptyState(guild),fullReads=0,checks=0,failChecks=false,bytes=0;
 body.audit.push({id:'large',at:1,actor:guild,action:'x'.repeat(100000),target:guild});
 const fetcher:typeof fetch=async(input,init)=>{const request=new Request(input,init),url=new URL(request.url);
  if(request.method==='POST')return new Response(null,{status:201});
  const full=url.searchParams.get('select')==='revision,body';if(full)fullReads++;else checks++;
  if(!full&&failChecks)return Response.json({message:'test failure'},{status:503});
  const payload=full?{revision,body}:{revision};bytes+=Buffer.byteLength(JSON.stringify(payload));return Response.json(payload);
 };
 const adapter=await SupabaseAdapter.open('https://example.supabase.co','test-only-key',guild,fetcher);await adapter.read();const initialBytes=bytes;
 await new Promise(r=>setTimeout(r,1050));const snapshots=await Promise.all(Array.from({length:10},()=>adapter.read()));assert.equal(fullReads,1);assert.equal(checks,1);assert(bytes-initialBytes<100);snapshots[0]!.state.audit=[];assert.equal((await adapter.read()).state.audit.length,1);
 body.maintenance=true;revision++;await new Promise(r=>setTimeout(r,1050));assert.equal((await adapter.read()).state.maintenance,true);assert.equal(fullReads,2);
 failChecks=true;await new Promise(r=>setTimeout(r,1050));await assert.rejects(adapter.read(),/revision check failed/);
});

test('readers reuse committed snapshots while a Supabase write is in flight',async()=>{
 let release!:()=>void,started!:()=>void;const hold=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);let reads=0;
 const fetcher:typeof fetch=async(input,init)=>{const req=new Request(input,init),url=new URL(req.url);if(req.method==='GET'){reads++;return Response.json({revision:0,body:emptyState(guild)});}if(url.pathname.endsWith('/crystal_state'))return new Response(null,{status:201});started();await hold;return Response.json(true);};
 const adapter=await SupabaseAdapter.open('https://example.supabase.co','test-only-key',guild,fetcher),before=await adapter.read(),next=structuredClone(before.state);next.maintenance=true;const write=adapter.compareAndSwap(before.revision,next);await entered;
 assert.equal((await adapter.read()).state.maintenance,false);assert.equal(reads,1);release();assert.equal(await write,true);assert.equal((await adapter.read()).state.maintenance,true);assert.equal(reads,1);
});

test('concurrent state changes share one CAS and failed mutations cannot leak into other changes',async()=>{
 const state=emptyState(guild),adapter=new (await import('../src/storage/store.js')).MemoryAdapter(state);let writes=0;const original=adapter.compareAndSwap.bind(adapter);adapter.compareAndSwap=async(r,s)=>{writes++;return original(r,s);};const store=new Store(adapter);
 const results=await Promise.allSettled([store.change(s=>{s.initialized=true;return 1;}),store.change(s=>{s.maintenance=true;throw Error('denied');}),store.change(s=>{s.audit.push({id:'one',at:1,actor:guild,action:'test',target:guild});return 3;})]);assert.equal(writes,1);assert.equal(results[1]!.status,'rejected');assert.equal((await store.read()).maintenance,false);assert.equal((await store.read()).initialized,true);assert.equal((await store.read()).audit.length,1);
});
test('batched changes replay atomically on CAS conflict and resolve only after commit',async()=>{
 const {MemoryAdapter}=await import('../src/storage/store.js'),adapter=new MemoryAdapter(emptyState(guild));const original=adapter.compareAndSwap.bind(adapter);let writes=0,committed=false;adapter.compareAndSwap=async(r,s)=>{if(writes++===0){const external=await adapter.read();external.state.maintenance=true;await original(external.revision,external.state);return false;}const result=await original(r,s);committed=result;return result;};const store=new Store(adapter);await Promise.all([store.change(s=>s.initialized=true).then(()=>assert(committed)),store.change(s=>s.audit.push({id:'one',at:1,actor:guild,action:'test',target:guild})).then(()=>assert(committed))]);assert.equal(writes,2);assert.equal((await store.read()).maintenance,true);assert.equal((await store.read()).audit.length,1);
});

test('remote compression preserves large state and reads legacy uncompressed state',()=>{const state=emptyState(guild);state.audit.push({id:'one',at:1,actor:guild,action:'large '.repeat(50000),target:guild});const encoded=encodeRemoteState(state);assert(Buffer.byteLength(JSON.stringify(encoded))<Buffer.byteLength(JSON.stringify(state))/10);assert.deepEqual(decodeRemoteState(encoded),state);assert.deepEqual(decodeRemoteState(state),state);assert.deepEqual(encodeRemoteState(emptyState(guild)),emptyState(guild));assert.throws(()=>decodeRemoteState({format:'crystal-deflate-v1',payload:'invalid'}));});
test('compressed Supabase state round-trips after process restart and retains CAS conflict protection',async()=>{
 let row:{revision:number;body:unknown}={revision:0,body:emptyState(guild)};
 const fetcher:typeof fetch=async(input,init)=>{const req=new Request(input,init),url=new URL(req.url);if(url.pathname.endsWith('/crystal_state')&&req.method==='POST')return new Response(null,{status:201});if(req.method==='GET')return Response.json(url.searchParams.get('select')==='revision'?{revision:row.revision}:row);const body=await req.json() as {p_revision:number;p_body:unknown};if(body.p_revision!==row.revision)return Response.json(false);row={revision:row.revision+1,body:body.p_body};return Response.json(true);};
 const first=new Store(await SupabaseAdapter.open('https://example.supabase.co','test',guild,fetcher));await first.change(s=>s.audit.push({id:'one',at:1,actor:guild,action:'a'.repeat(100000),target:guild}));assert.equal((row.body as {format:string}).format,'crystal-deflate-v1');
 const second=new Store(await SupabaseAdapter.open('https://example.supabase.co','test',guild,fetcher));assert.equal((await second.read()).audit[0]!.action.length,100000);await second.change(s=>s.maintenance=true);await first.change(s=>s.initialized=true);const state=await second.read();assert.equal(decodeRemoteState(row.body).maintenance,true);assert.equal(decodeRemoteState(row.body).initialized,true);assert.equal(state.audit.length,1);
});

test('ordinary state reads can skip external lease lookups without affecting explicit lease reads',async()=>{const {MemoryAdapter}=await import('../src/storage/store.js');const adapter=new MemoryAdapter(emptyState(guild));let reads=0;Object.assign(adapter,{readRuntimeLease:async()=>{reads++;return {owner:'active',until:1000};}});const store=new Store(adapter);assert.equal((await store.read(false)).runtimeLease,undefined);assert.equal(reads,0);assert.equal((await store.read()).runtimeLease!.owner,'active');assert.equal(reads,1);});
