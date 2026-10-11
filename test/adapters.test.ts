import test from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import type pg from 'pg';
import { emptyState, type State } from '../src/domain/types.js';
import { PostgreSQLAdapter, SupabaseAdapter, Store } from '../src/storage/store.js';
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
