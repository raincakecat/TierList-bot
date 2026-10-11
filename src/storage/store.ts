import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Config } from '../config.js';
import { emptyState, type State } from '../domain/types.js';

export interface Snapshot { revision:number; state:State }
export interface Adapter {
  read():Promise<Snapshot>;
  compareAndSwap(revision:number,state:State):Promise<boolean>;
  close():Promise<void>;
}
export class Store {
  constructor(public adapter:Adapter){}
  async read():Promise<State>{return (await this.adapter.read()).state;}
  // Mutators are synchronous and side-effect free; a CAS conflict replays them.
  async change<T>(fn:(state:State)=>T):Promise<T>{
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
  private constructor(url:string,key:string,private guild:string,fetcher?:typeof fetch){this.client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},...(fetcher?{global:{fetch:fetcher}}:{})});}
  static async open(url:string,key:string,guild:string,fetcher?:typeof fetch){const a=new SupabaseAdapter(url,key,guild,fetcher);const {error}=await a.client.from('crystal_state').upsert({guild,revision:0,body:emptyState(guild)},{onConflict:'guild',ignoreDuplicates:true});if(error)throw new Error('Supabase initialization failed. Apply sql/supabase.sql and verify server credentials.');return a;}
  async read(){const {data,error}=await this.client.from('crystal_state').select('revision,body').eq('guild',this.guild).single();if(error)throw new Error('Supabase read failed');return {revision:Number(data.revision),state:data.body as State};}
  async compareAndSwap(revision:number,state:State){const {data,error}=await this.client.rpc('crystal_commit',{p_guild:this.guild,p_revision:revision,p_body:state});if(error)throw new Error('Supabase transaction failed');return data===true;}
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
