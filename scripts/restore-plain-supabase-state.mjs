// Run only with the bot stopped: node --env-file=.env scripts/restore-plain-supabase-state.mjs --confirm
import {createClient} from '@supabase/supabase-js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {ConfigFile} from '../dist/src/config.js';
import {decodeRemoteState} from '../dist/src/storage/store.js';
if(process.argv[2]!=='--confirm')throw Error('Stop the bot first, then run with --confirm to restore the legacy storage format.');
const c=(await ConfigFile.load(process.env.BOT_CONFIG??'config.json')).value;
if(c.database.backend!=='supabase')throw Error('This utility is only for Supabase.');
const db=createClient(process.env[c.database.supabase.urlEnv],process.env[c.database.supabase.serviceKeyEnv],{auth:{persistSession:false,autoRefreshToken:false}}),guild=c.community.guildId;
const {data:lease,error:leaseError}=await db.from('crystal_state').select('body').eq('guild',guild+':runtime-lease').maybeSingle();
if(leaseError)throw Error('Cannot verify that the bot is stopped.');
if(lease&&((decodeRemoteState(lease.body).runtimeLease?.until??0)>Date.now()))throw Error('A runtime lease is still active. Stop the bot and wait for lease expiry.');
const {data,error}=await db.from('crystal_state').select('revision,body').eq('guild',guild).single();if(error)throw Error('State could not be read.');
const state=decodeRemoteState(data.body);if((state.runtimeLease?.until??0)>Date.now())throw Error('A legacy runtime lease is still active.');
await mkdir('data/preflight',{recursive:true});await writeFile(`data/preflight/plain-format-recovery-${Date.now()}.json`,JSON.stringify({format:'crystal-bot',version:1,createdAt:new Date().toISOString(),state}),{mode:0o600});
const {data:ok,error:commitError}=await db.rpc('crystal_commit',{p_guild:guild,p_revision:data.revision,p_body:state});if(commitError||ok!==true)throw Error('State changed or update failed; no stale overwrite was performed.');
const check=await db.from('crystal_state').select('body').eq('guild',guild).single();if(check.error||JSON.stringify(check.data.body)!==JSON.stringify(state)){
 // JSONB may reorder keys: compare the data structurally.
 const {isDeepStrictEqual}=await import('node:util');if(check.error||!isDeepStrictEqual(check.data.body,state))throw Error('Format verification failed. Keep the bot stopped.');
}
console.log('Plain Supabase state format restored and verified. It is safe to start a compatible older runtime.');
