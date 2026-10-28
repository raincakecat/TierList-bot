import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Config } from '../config.js';
import { emptyState, type State } from '../domain/types.js';
import { Operations } from './operations.js';
import { deflateSync, inflateSync } from 'node:zlib';

/** Backward-compatible reader; only large remote documents use compression. */
export function encodeRemoteState(state:State):State|{format:'crystal-deflate-v1';payload:string}{
  const json=JSON.stringify(state),bytes=Buffer.byteLength(json);if(bytes>64*1024*1024)throw new Error('Saved state exceeds the supported remote document size');if(bytes<64*1024)return state;
  return {format:'crystal-deflate-v1',payload:deflateSync(Buffer.from(json),{level:3}).toString('base64')};
}
export function decodeRemoteState(body:unknown):State {
  const stored=body as {format?:string;payload?:string};
  if(stored?.format==='crystal-deflate-v1'){
    if(typeof stored.payload!=='string'||stored.payload.length>90*1024*1024)throw new Error('Invalid compressed database state');
    const state=JSON.parse(inflateSync(Buffer.from(stored.payload,'base64'),{maxOutputLength:64*1024*1024}).toString('utf8')) as State;
    if(state.version!==1||typeof state.guildId!=='string')throw new Error('Invalid compressed database state');return state;
  }
  return body as State;
}

export function boundedFetch(fetcher:typeof fetch,timeoutMs=15_000):typeof fetch {
  return (input,init)=>fetcher(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(timeoutMs),...(init?.signal?[init.signal]:[]),...(input instanceof Request?[input.signal]:[])])});
}

export interface Snapshot { revision:number; state:State }
export interface Adapter {
  read():Promise<Snapshot>;
  compareAndSwap(revision:number,state:State):Promise<boolean>;
  close():Promise<void>;
  readRuntimeLease?():Promise<State['runtimeLease']>;
  acquireRuntimeLease?(owner:string,until:number):Promise<void>;
  renewRuntimeLease?(owner:string,until:number):Promise<void>;
  releaseRuntimeLease?(owner:string):Promise<void>;
}
export class Store {
  readonly operations=new Operations();
  private committing=false;
  private pending:{apply:(state:State)=>unknown;resolve:(value:unknown)=>void;reject:(error:unknown)=>void}[]=[];
  constructor(public adapter:Adapter){}
  async read(includeLease=true):Promise<State>{const state=(await this.adapter.read()).state;if(includeLease&&this.adapter.readRuntimeLease){const lease=await this.adapter.readRuntimeLease();if(lease)state.runtimeLease=lease;}return state;}
  // Mutators are synchronous and side-effect free; a CAS conflict replays them.
  async change<T>(fn:(state:State)=>T):Promise<T>{
    return this.operations.shared(()=>this.commit(fn));
  }
  // Only the process lease bypasses the recovery fence; no domain writes bypass it.
  async acquireLease(owner:string,until:number){if(this.adapter.acquireRuntimeLease)return this.adapter.acquireRuntimeLease(owner,until);return this.commit(s=>{if(s.runtimeLease&&s.runtimeLease.until>Date.now())throw new Error('Another bot instance is already using this database.');s.runtimeLease={owner,until};});}
  async renewLease(owner:string,until:number){if(this.adapter.renewRuntimeLease)return this.adapter.renewRuntimeLease(owner,until);return this.commit(s=>{if(s.runtimeLease?.owner!==owner)throw new Error('Instance lease lost');s.runtimeLease.until=until;});}
  async releaseLease(owner:string){if(this.adapter.releaseRuntimeLease)return this.adapter.releaseRuntimeLease(owner);return this.commit(s=>{if(s.runtimeLease?.owner===owner)delete s.runtimeLease;});}
  private async commit<T>(fn:(state:State)=>T):Promise<T>{
    return new Promise<T>((resolve,reject)=>{this.pending.push({apply:fn,resolve:value=>resolve(value as T),reject});if(!this.committing){this.committing=true;queueMicrotask(()=>void this.flush());}});
  }
  private async flush(){
    while(this.pending.length){
      const batch=this.pending.splice(0,32);
      try{
        const results=await this.commitNow(state=>{
          let candidate=structuredClone(state);const outcomes:{ok:boolean;value:unknown}[]=[];
          for(const entry of batch){const draft=structuredClone(candidate);try{const value=entry.apply(draft);candidate=draft;outcomes.push({ok:true,value:structuredClone(value)});}catch(error){outcomes.push({ok:false,value:error});}}
          for(const key of Object.keys(state))delete (state as unknown as Record<string,unknown>)[key];Object.assign(state,candidate);return outcomes;
        });
        batch.forEach((entry,index)=>{const result=results[index]!;if(result.ok)entry.resolve(result.value);else entry.reject(result.value);});
      }catch(error){for(const entry of batch)entry.reject(error);}
    }
    this.committing=false;
  }
  private async commitNow<T>(fn:(state:State)=>T):Promise<T>{
    for(let attempt=0;attempt<30;attempt++){
      const {revision,state}=await this.adapter.read(),before=JSON.stringify(state);const result=fn(state);
      if(JSON.stringify(state)===before)return result;
      if(await this.adapter.compareAndSwap(revision,state))return result;
      await delay(Math.min(attempt*5,100));
    }
    throw new Error('Database busy; retry the action.');
  }
  close(){return this.adapter.close();}
}
export class MemoryAdapter implements Adapter {
  private revision=0;
  constructor(private state:State){}
  async read(){return {revision:this.revision,state:structuredClone(this.state)};}
  async compareAndSwap(revision:number,state:State){if(revision!==this.revision)return false;this.state=structuredClone(state);this.revision++;return true;}
  async close(){}
}
export class SQLiteAdapter implements Adapter {
  private db:DatabaseSync;
  constructor(file:string,private guild:string){
    this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS crystal_state (guild TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL) STRICT;');
    this.db.prepare('INSERT OR IGNORE INTO crystal_state VALUES (?,0,?)').run(guild,JSON.stringify(emptyState(guild)));
  }
  async read(){const r=this.db.prepare('SELECT revision,body FROM crystal_state WHERE guild=?').get(this.guild)!;return {revision:Number(r.revision),state:JSON.parse(String(r.body)) as State};}
  async compareAndSwap(revision:number,state:State){return this.db.prepare('UPDATE crystal_state SET revision=revision+1,body=? WHERE guild=? AND revision=?').run(JSON.stringify(state),this.guild,revision).changes===1;}
  async close(){this.db.close();}
}
export class PostgreSQLAdapter implements Adapter {
  private pool:pg.Pool;
  private constructor(connection:string,private guild:string,pool?:pg.Pool){this.pool=pool??new pg.Pool({connectionString:connection,max:5});}
  static async open(connection:string,guild:string,pool?:pg.Pool){
    const a=new PostgreSQLAdapter(connection,guild,pool);
    await a.pool.query('CREATE SCHEMA IF NOT EXISTS crystal; CREATE TABLE IF NOT EXISTS crystal.state (guild text PRIMARY KEY, revision bigint NOT NULL, body jsonb NOT NULL);');
    await a.pool.query('INSERT INTO crystal.state VALUES ($1,0,$2) ON CONFLICT DO NOTHING',[guild,emptyState(guild)]);return a;
  }
  async read(){const r=(await this.pool.query('SELECT revision,body FROM crystal.state WHERE guild=$1',[this.guild])).rows[0];return {revision:Number(r.revision),state:r.body as State};}
  async compareAndSwap(revision:number,state:State){return (await this.pool.query('UPDATE crystal.state SET revision=revision+1,body=$1 WHERE guild=$2 AND revision=$3',[state,this.guild,revision])).rowCount===1;}
  async close(){await this.pool.end();}
}
export class SupabaseAdapter implements Adapter {
  private client:SupabaseClient;
  private cached?:{snapshot:Snapshot;until:number};
  private pendingRead?:Promise<Snapshot>;
  private epoch=0;
  private leaseStorePromise?:Promise<Store>;
  private leaseAdapter?:SupabaseAdapter;
  private constructor(url:string,key:string,private guild:string,fetcher?:typeof fetch,client?:SupabaseClient){this.client=client??createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:boundedFetch(fetcher??fetch)}});}
  static async open(url:string,key:string,guild:string,fetcher?:typeof fetch){const a=new SupabaseAdapter(url,key,guild,fetcher);const {error}=await a.client.from('crystal_state').upsert({guild,revision:0,body:emptyState(guild)},{onConflict:'guild',ignoreDuplicates:true});if(error)throw new Error('Supabase initialization failed. Apply sql/supabase.sql and verify server credentials.');return a;}
  private async leases(){
    if(!this.leaseStorePromise)this.leaseStorePromise=(async()=>{const guild=`${this.guild}:runtime-lease`,lease=new SupabaseAdapter('', '',guild,undefined,this.client);
      const {error}=await this.client.from('crystal_state').upsert({guild,revision:0,body:emptyState(guild)},{onConflict:'guild',ignoreDuplicates:true});if(error)throw new Error('Supabase lease initialization failed');
      this.leaseAdapter=lease;return new Store({read:()=>lease.read(),compareAndSwap:(revision,state)=>lease.compareAndSwap(revision,state),close:async()=>{}});
    })().catch(error=>{this.leaseStorePromise=undefined;throw error;});return this.leaseStorePromise;
  }
  async readRuntimeLease(){return (await(await this.leases()).read()).runtimeLease;}
  async acquireRuntimeLease(owner:string,until:number){const legacy=(await this.read()).state.runtimeLease;if(legacy&&legacy.until>Date.now())throw new Error('Another bot instance is already using this database.');const store=await this.leases();this.leaseAdapter!.epoch++;this.leaseAdapter!.cached=undefined;this.leaseAdapter!.pendingRead=undefined;await store.acquireLease(owner,until);}
  async renewRuntimeLease(owner:string,until:number){await(await this.leases()).renewLease(owner,until);}
  async releaseRuntimeLease(owner:string){await(await this.leases()).releaseLease(owner);}
  async read():Promise<Snapshot>{
    if(this.cached&&this.cached.until>Date.now())return structuredClone(this.cached.snapshot);
    if(this.pendingRead)return structuredClone(await this.pendingRead);
    const epoch=this.epoch,cached=this.cached;
    const pending=(async()=>{
      if(cached){
        const {data,error}=await this.client.from('crystal_state').select('revision').eq('guild',this.guild).single();
        if(error)throw new Error('Supabase revision check failed');
        if(Number(data.revision)===cached.snapshot.revision){if(epoch===this.epoch)this.cached={snapshot:cached.snapshot,until:Date.now()+1000};return cached.snapshot;}
      }
      const {data,error}=await this.client.from('crystal_state').select('revision,body').eq('guild',this.guild).single();
      if(error)throw new Error('Supabase read failed');const snapshot={revision:Number(data.revision),state:decodeRemoteState(data.body)};if(epoch===this.epoch)this.cached={snapshot,until:Date.now()+1000};return snapshot;
    })();
    this.pendingRead=pending;try{return structuredClone(await pending);}finally{if(this.pendingRead===pending)this.pendingRead=undefined;}
  }
  async compareAndSwap(revision:number,state:State){
    // Keep the last committed snapshot available to readers during the write.
    // Success replaces it; failure/conflict discards it before the CAS retry.
    this.epoch++;this.pendingRead=undefined;
    let response;try{response=await this.client.rpc('crystal_commit',{p_guild:this.guild,p_revision:revision,p_body:encodeRemoteState(state)});}catch{this.epoch++;this.cached=undefined;this.pendingRead=undefined;throw new Error('Supabase transaction failed');}
    const {data,error}=response;
    this.epoch++;this.pendingRead=undefined;
    if(error){this.cached=undefined;throw new Error('Supabase transaction failed');}
    if(data===true)this.cached={snapshot:{revision:revision+1,state:structuredClone(state)},until:Date.now()+1000};else this.cached=undefined;
    return data===true;
  }
  async close(){}
}
export async function openStore(c:Config,env:NodeJS.ProcessEnv=process.env):Promise<Store>{
  if(!c.community.guildId)throw new Error('Set community.guildId before connecting the bot.');
  const secret=(name:string)=>{const value=env[name];if(!value)throw new Error(`Missing environment variable: ${name}`);return value;};
  switch(c.database.backend){
    case 'sqlite':await mkdir(dirname(c.database.sqlite.file),{recursive:true});return new Store(new SQLiteAdapter(c.database.sqlite.file,c.community.guildId));
    case 'postgresql':return new Store(await PostgreSQLAdapter.open(secret(c.database.postgresql.connectionStringEnv),c.community.guildId));
    case 'supabase':return new Store(await SupabaseAdapter.open(secret(c.database.supabase.urlEnv),secret(c.database.supabase.serviceKeyEnv),c.community.guildId));
  }
}
