// Synthetic local-state check; does not connect to Discord or a live database.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {configSchema,ConfigFile} from '../dist/src/config.js';
import {ModeScope,modeConfig} from '../dist/src/modes.js';
import {Store,SQLiteAdapter} from '../dist/src/storage/store.js';
import {SharedDeployment,ContextStore} from '../dist/src/storage/deployment.js';
import {Service,player} from '../dist/src/domain/service.js';
import {modeListPanels} from '../dist/src/discord/mode-list.js';
import {validateState} from '../dist/src/storage/backups.js';
const guild='100000000000000001',role='100000000000000002';
const config=configSchema.parse(JSON.parse(await readFile('config.multimode.example.json','utf8')));
config.community.guildId=guild;
for(const group of Object.keys(config.permissionGroups))config.permissionGroups[group]=[role];
for(const key of Object.keys(config.channels))config.channels[key]=role;
for(const mode of config.gameModes){mode.testerRoleIds=[role];for(const region of Object.values(mode.regions)){region.waitlistRoleId=role;region.queueChannelId=role;region.testCategoryId=role;}mode.highTestsCategoryId=role;mode.normalCooldown='0';mode.highCooldown='0';}
const dir=await mkdtemp(join(tmpdir(),'lunar-24-queues-')),parent=new Store(new SQLiteAdapter(join(dir,'load.sqlite'),guild));
try{
 const deployment=new SharedDeployment(parent);await deployment.attach(guild,'sword');
 const scope=new ModeScope(new ConfigFile('unused',config)),store=new ContextStore(deployment,guild,scope),service=new Service(store,()=>scope.file.value);
 const start=performance.now();await deployment.guildStore(guild).change(s=>{s.initialized=true;for(let n=0;n<300;n++){const p=player(s,String(200000000000000000n+BigInt(n)));p.region=['NA','EU','AS'][n%3];p.ign=`Player${n}`;p.uuid=n.toString(16).padStart(32,'0');p.preferredServer='example';}});
 await Promise.all(config.gameModes.map(mode=>scope.run(mode.key,()=>store.change(s=>{for(const p of Object.values(s.players)){p.waitlist=true;s.queues[p.region].push(p.id);}for(const r of ['NA','EU','AS']){const id=String(300000000000000000n+BigInt(config.gameModes.indexOf(mode)*3+['NA','EU','AS'].indexOf(r)));s.testers[id]=r;}s.lists.HT3={NA:s.queues.NA.slice(),EU:s.queues.EU.slice(),AS:s.queues.AS.slice()};}))));
 const seeded=performance.now(),latencies=[];
 await Promise.all(config.gameModes.flatMap((mode,m)=>['NA','EU','AS'].map((region,r)=>scope.run(mode.key,async()=>{const actor={id:String(300000000000000000n+BigInt(m*3+r)),roles:[role],administrator:false,channelAccess:true};const at=performance.now();await service.next(actor);latencies.push(performance.now()-at);}))))
 const end=performance.now(),state=await deployment.guildStore(guild).read();validateState(state,guild);assert.equal(Object.values(state.tickets).length,24);assert.equal(new Set(Object.values(state.tickets).map(t=>`${t.modeId}:${t.region}`)).size,24);
 let pages=0;for(const mode of config.gameModes)await scope.run(mode.key,async()=>{const s=await store.read();assert.equal(Object.values(s.tickets).length,3);assert.equal(Object.values(s.queues).reduce((n,q)=>n+q.length,0),300);pages+=modeListPanels(modeConfig(config,mode.key),s,new Map()).length;});
 latencies.sort((a,b)=>a-b);console.log(JSON.stringify({scenario:'24 queues, 300 shared players, 24 concurrent test reservations',seedMs:Math.round(seeded-start),reservationsMs:Math.round(end-seeded),p50Ms:Math.round(latencies[Math.floor(latencies.length*.5)]),p95Ms:Math.round(latencies[Math.floor(latencies.length*.95)]),stateBytes:Buffer.byteLength(JSON.stringify(state)),listPages:pages,verifiedTickets:24},null,2));
}finally{await parent.close();await rm(dir,{recursive:true});}
