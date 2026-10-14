import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Store, SQLiteAdapter } from '../dist/src/storage/store.js';
import { Service } from '../dist/src/domain/service.js';
import { configSchema } from '../dist/src/config.js';
import { paginateLines } from '../dist/src/discord/pages.js';

const root=await mkdtemp(join(tmpdir(),'crystal-load-')),guild='100000000000000001',role='100000000000000002';
const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));c.community.guildId=guild;c.database.backend='sqlite';c.categories.highTests=role;c.channels.testingArchives=role;c.testing.normalCooldown='0';c.testing.highCooldown='0';for(const key of Object.keys(c.permissionGroups))c.permissionGroups[key]=[role];for(const r of Object.values(c.regions))r.testCategoryId=role;
const store=new Store(new SQLiteAdapter(join(root,'load.sqlite'),guild));
try{
  const t0=performance.now();await store.change(s=>{s.initialized=true;for(let i=0;i<5000;i++){const id=String(300000000000000000n+BigInt(i));s.players[id]={id,tier:'LT3',uuid:i.toString(16).padStart(32,'0'),ign:`Player${i}`,region:'NA',preferredServer:'test',waitlist:true,cooldownUntil:0};if(i<1000)s.queues.NA.push(id);s.jobs[`history-${i}`]={id:`history-${i}`,kind:'notice',data:{},status:'done',attempts:0,nextAt:0,checkpoints:{}};}for(let i=0;i<10;i++)s.testers[String(400000000000000000n+BigInt(i))]='NA';});
  const seedMs=performance.now()-t0,service=new Service(store,()=>c),t1=performance.now();const tickets=await Promise.all(Array.from({length:10},(_,i)=>service.next({id:String(400000000000000000n+BigInt(i)),roles:[role],administrator:false,channelAccess:true})));const reservationsMs=performance.now()-t1;
  assert.equal(new Set(tickets.map(t=>t.opener)).size,10);assert.deepEqual(tickets.map(t=>t.opener).sort(),Array.from({length:10},(_,i)=>String(300000000000000000n+BigInt(i))));const t2=performance.now(),state=await store.read(),readMs=performance.now()-t2;
  const pages=paginateLines(state.queues.NA.map((id,index)=>`${index+1}. <@${id}>`));assert(pages.every(p=>p.length<=3800));assert.equal(pages.join('\n').match(/<@\d+>/g).length,1000);
  const report={environment:{platform:process.platform,node:process.version},players:5000,historicalJobs:5000,queuedPlayers:1000,concurrentReservations:10,queuePages:pages.length,stateBytes:Buffer.byteLength(JSON.stringify(state)),seedMs:Math.round(seedMs),reservationsMs:Math.round(reservationsMs),readMs:Math.round(readMs),result:'passed',limitations:'Local SQLite only; Discord transport and remote database throughput are not measured.'};console.log(JSON.stringify(report,null,2));if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
}finally{await store.close();if(!resolve(root).startsWith(resolve(tmpdir())+sep))throw Error('Unsafe cleanup path');await rm(root,{recursive:true,force:true});}
