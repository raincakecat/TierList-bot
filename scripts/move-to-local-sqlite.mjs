// Stopped-bot migration: node --env-file=.env scripts/move-to-local-sqlite.mjs --confirm
import {access, chmod, mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {createHash} from 'node:crypto';
import {ConfigFile} from '../dist/src/config.js';
import {openStore, SQLiteAdapter} from '../dist/src/storage/store.js';
import {validateState, decodeBackup} from '../dist/src/storage/backups.js';

if(process.argv[2]!=='--confirm')throw Error('Stop the bot service before running this command with --confirm.');
const file=await ConfigFile.load(process.env.BOT_CONFIG??'config.json'), c=file.value;
if(c.database.backend!=='supabase')throw Error('Expected Supabase source; configuration has not been changed.');
const target=resolve('data/lunar.sqlite');
try{await access(target);throw Error('Destination already exists; refusing to overwrite it.');}catch(e){if(e.code!=='ENOENT')throw e;}
const directory=resolve('data/preflight',`sqlite-cutover-${Date.now()}`);
await mkdir(directory,{recursive:true,mode:0o700});
await writeFile(join(directory,'config-before.json'),await readFile(file.path),{mode:0o600});
const source=await openStore(c);
let destination;
try{
  const original=await source.read();
  if(original.runtimeLease?.until>Date.now())throw Error('Source has an active runtime lease. Stop the bot and wait for its lease to release.');
  validateState(original,c.community.guildId);
  const backup={format:'crystal-bot',version:1,createdAt:new Date().toISOString(),state:original};
  const raw=JSON.stringify(backup);
  decodeBackup(raw,c.community.guildId);
  await writeFile(join(directory,'source-backup.json'),raw,{mode:0o600});
  const state=structuredClone(original);delete state.runtimeLease;
  for(const job of Object.values(state.jobs))if(job.status==='working'){job.status='pending';delete job.leaseUntil;}
  // A stopped transfer must not expire otherwise resumable active tester sessions.
  if((state.sessionResumeUntil??0)>Date.now())state.sessionResumeUntil=Date.now()+120_000;
  validateState(state,c.community.guildId);
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  destination=new SQLiteAdapter(target,c.community.guildId);
  if(!await destination.compareAndSwap(0,state))throw Error('Destination changed unexpectedly.');
  const saved=(await destination.read()).state;
  if(JSON.stringify(saved)!==JSON.stringify(state))throw Error('Transferred state does not match. Configuration unchanged.');
  const latest=await source.read();
  if(JSON.stringify(latest)!==JSON.stringify(original))throw Error('Source changed during transfer. Configuration unchanged.');
  await destination.close();destination=undefined;await chmod(target,0o600);
  const next=structuredClone(c);next.database.backend='sqlite';next.database.sqlite.file='data/lunar.sqlite';
  await file.save(next);
  const report={backend:'sqlite',players:Object.keys(saved.players).length,tickets:Object.keys(saved.tickets).length,jobs:Object.keys(saved.jobs).length,leaves:Object.keys(saved.leaves??{}).length,maintenance:saved.maintenance,sourceBackupSha256:createHash('sha256').update(raw).digest('hex'),verified:true,sourceUnchanged:true};
  await writeFile(join(directory,'verification.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({directory,...report}));
}finally{await destination?.close();await source.close();}
