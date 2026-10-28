import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChannelType, Collection, PermissionsBitField, PermissionFlagsBits, type APIEmbed, type Client, type MessageCreateOptions } from 'discord.js';
import { configSchema } from '../src/config.js';
import { emptyState, type Job, type Ticket } from '../src/domain/types.js';
import { Store, MemoryAdapter } from '../src/storage/store.js';
import { Gateway, supportTicketName, testingTicketName } from '../src/discord/gateway.js';
import { LeaveService } from '../src/domain/loa.js';
import { LeaveGateway } from '../src/discord/loa-gateway.js';

const GUILD='100000000000000001',USER='100000000000000002',BOT='100000000000000003',SOURCE='100000000000000004',ARCHIVE='100000000000000005';
interface FakeMessage {id:string;author:{id:string;username:string};createdTimestamp:number;content:string;attachments:Collection<string,{id?:string;name:string;url:string;contentType:string;size?:number}>;embeds:APIEmbed[];reactions:string[];react:(emoji:string)=>Promise<void>;pin:()=>Promise<void>;edit:()=>Promise<void>;delete:()=>Promise<void>}
function fakeChannel(id:string){let deleted=false,nextId=0;const messages=new Collection<string,FakeMessage>(),sent:MessageCreateOptions[]=[];
  function makeMessage(options:MessageCreateOptions):FakeMessage{const key=String(200000000000000000n+BigInt(nextId++));return {id:key,author:{id:BOT,username:'Bot'},createdTimestamp:1000,content:options.content??'',attachments:new Collection(),embeds:(options.embeds??[]).map(e=>'toJSON'in e?e.toJSON():e),reactions:[] as string[],react:async function(emoji:string){this.reactions.push(emoji);},pin:async()=>{},edit:async()=>{},delete:async()=>{messages.delete(key);}};}
  const channel={id,name:'test-example-na',type:ChannelType.GuildText,parentId:null,permissionOverwrites:{set:async()=>{},edit:async()=>{},delete:async()=>{}},messages:{fetch:async(arg:string|{before?:string})=>typeof arg==='string'?(messages.get(arg)??Promise.reject(new Error('not found'))):new Collection([...messages].filter(([id])=>!arg.before||id<arg.before).sort(([a],[b])=>b.localeCompare(a)).slice(0,100)),edit:async()=>{}},send:async(options:MessageCreateOptions)=>{sent.push(options);const m=makeMessage(options);messages.set(m.id,m);return m;},delete:async()=>{deleted=true;},setName:async()=>{},setParent:async()=>{}};
  return {channel,messages,sent,isDeleted:()=>deleted,makeMessage};
}
async function setup(copyImages=false){const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8'))),dir=await mkdtemp(join(tmpdir(),'crystal-gateway-'));c.community.guildId=GUILD;c.archival.directory=dir;c.channels.results=ARCHIVE;c.modules.testing=false;c.modules.tierLists=false;
  const source=fakeChannel(SOURCE),archive=fakeChannel(ARCHIVE),channels=new Collection([[SOURCE,source.channel],[ARCHIVE,archive.channel]]),guild={id:GUILD,channels:{fetch:async(id?:string)=>id?channels.get(id):channels},members:{fetch:async(id:string)=>({id,user:{username:'DiscordName'}})}};
  const client={user:{id:BOT},guilds:{fetch:async()=>guild}} as unknown as Client;
  const state=emptyState(GUILD);state.initialized=true;state.players[USER]={id:USER,tier:'HT3',uuid:'a'.repeat(32),ign:'Example',region:'NA',preferredServer:'server',waitlist:true,cooldownUntil:0};
  const t:Ticket={id:'11111111-1111-4111-8111-111111111111',channelId:SOURCE,type:'test',opener:USER,region:'NA',openingTier:'LT3',openingIgn:'Example',openingUuid:'a'.repeat(32),tester:BOT,target:'HT3',passed:true,status:'closing',participants:[BOT],openedAt:1000,closedAt:2000,outcome:'HT3',accessRoles:[],closingRoles:[],archiveChannelId:ARCHIVE,copyImages,imageRetentionDays:10,categoryId:GUILD,name:'example-ht3-na'};state.tickets[t.id]=t;const store=new Store(new MemoryAdapter(state)),gateway=new Gateway(client,store,()=>c);
  return {c,dir,source,archive,t,store,gateway,client,guild};
}
function job(kind:Job['kind'],t:Ticket):Job{return {id:'22222222-2222-4222-8222-222222222222',kind,data:{ticketId:t.id,actor:BOT,reason:'done'},status:'pending',nextAt:0,attempts:0,checkpoints:{}};}
test('archival saves transcript and YouTube/video links before deletion, then recovers safely',async()=>{const f=await setup();try{
  const message=f.source.makeMessage({content:'Evidence: https://www.youtube.com/watch?v=example'});message.attachments.set('video',{name:'video.mp4',url:'https://cdn.discordapp.com/attachments/example/video.mp4',contentType:'video/mp4'} as never);f.source.messages.set(message.id,message);
  const j=job('archive',f.t),save=async(k:string,v:unknown)=>{j.checkpoints[k]=v;};await assert.rejects(f.gateway.job(j,save),/deletion delay/);assert.equal(f.source.isDeleted(),false);assert(j.checkpoints.archived);assert.equal(f.archive.sent.length,1);
  const text=await readFile(join(f.dir,f.t.id,'transcript.md'),'utf8');assert(text.includes('youtube.com'));assert(text.includes('video.mp4'));assert.equal((await readdir(join(f.dir,f.t.id))).some(n=>n.startsWith('image-')),false);
  j.checkpoints.archived=Date.now()-11000;await f.gateway.job(j,save);assert.equal(f.source.isDeleted(),true);assert.equal((await f.store.read()).tickets[f.t.id]!.status,'closed');assert.equal(f.archive.sent.length,1);
 }finally{await rm(f.dir,{recursive:true});}});
test('failed required image evidence retains channel and never posts a completed archive',async()=>{const f=await setup(true);try{const m=f.source.makeMessage({content:'Image'});m.attachments.set('image',{id:'100000000000000006',name:'image.png',url:'https://untrusted.invalid/image.png',contentType:'image/png',size:10} as never);f.source.messages.set(m.id,m);const j=job('archive',f.t);await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/attachment host/);assert.equal(f.source.isDeleted(),false);assert.equal(f.archive.sent.length,0);assert.equal(j.checkpoints.transcript,undefined);}finally{await rm(f.dir,{recursive:true});}});
test('result uses ticket opening rank and adds exactly the six agreed reactions',async()=>{const f=await setup();try{const j=job('result',f.t),save=async(k:string,v:unknown)=>{j.checkpoints[k]=v;};await f.gateway.job(j,save);await f.gateway.job(j,save);assert.equal(f.archive.sent.length,1);const m=f.archive.messages.first()!;assert.equal(m.embeds[0]!.fields!.find(x=>x.name==='Previous Rank')!.value,'Low Tier 3');assert.deepEqual(m.reactions.slice(0,6),['👑','🥳','😱','😭','😂','💀']);assert.deepEqual(f.archive.sent[0]!.allowedMentions!.users,[USER]);}finally{await rm(f.dir,{recursive:true});}});

test('legacy support adoption preserves read-only access and names, snapshots roles, and avoids mention pings',async()=>{const f=await setup();try{const role='100000000000000008',readonly=new PermissionsBitField([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory]);let resets=0,edits=0;Object.assign(f.source.channel.permissionOverwrites,{cache:new Collection([[GUILD,{id:GUILD,type:0,allow:new PermissionsBitField(),deny:new PermissionsBitField(PermissionFlagsBits.ViewChannel)}],[role,{id:role,type:0,allow:readonly,deny:new PermissionsBitField()}]])});f.source.channel.permissionOverwrites.set=async()=>{resets++;};f.source.channel.permissionOverwrites.edit=async()=>{edits++;};await f.store.change(s=>{s.tickets[f.t.id]!.type='general-support';s.tickets[f.t.id]!.status='opening';s.tickets[f.t.id]!.tester=null;});const j=job('open',f.t);Object.assign(j.data,{adopt:true,preserveAccess:true,silentAdoption:true});await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});assert.equal(resets,0);assert.equal(edits,1);assert.equal(readonly.has(PermissionFlagsBits.SendMessages),false);assert.deepEqual((await f.store.read()).tickets[f.t.id]!.accessRoles,[role]);assert.equal((await f.store.read()).tickets[f.t.id]!.name,f.t.name);assert.deepEqual(f.source.sent[0]!.allowedMentions,{parse:[],users:[],roles:[]});}finally{await rm(f.dir,{recursive:true});}});

test('legacy adoption refuses a channel without an explicit private visibility boundary',async()=>{const f=await setup();try{Object.assign(f.source.channel.permissionOverwrites,{cache:new Collection()});const j=job('open',f.t);Object.assign(j.data,{adopt:true,preserveAccess:true});await assert.rejects(f.gateway.job(j,async()=>{}),/private channel/);assert.equal(f.source.sent.length,0);}finally{await rm(f.dir,{recursive:true});}});

test('shrinking tier lists removes stale bot pages and preserves unrelated messages',async()=>{const f=await setup();try{f.c.modules.tierLists=true;f.c.tierLists.channelIds.HT3=ARCHIVE;await f.store.change(s=>{s.lists.HT3={NA:Array.from({length:400},(_,i)=>String(300000000000000000n+BigInt(i)))};});await f.gateway.lists();const old=Object.keys((await f.store.read()).panels).filter(k=>k.startsWith('list:HT3:'));assert(old.length>1);const unrelated=f.archive.makeMessage({content:'Keep me'});f.archive.messages.set(unrelated.id,unrelated);await f.store.change(s=>s.lists.HT3={NA:[USER]});await f.gateway.lists();assert.deepEqual(Object.keys((await f.store.read()).panels).filter(k=>k.startsWith('list:HT3:')),['list:HT3:0']);assert(f.archive.messages.has(unrelated.id));}finally{await rm(f.dir,{recursive:true});}});
test('queue pages keep complete mentions and remove stale overflow pages after clearing',async()=>{const f=await setup();try{f.c.modules.testing=true;f.c.regions.EU.enabled=false;f.c.regions.AS.enabled=false;f.c.regions.NA.queueChannelId=ARCHIVE;await f.store.change(s=>{s.testers[BOT]='NA';s.queues.NA=Array.from({length:1000},(_,i)=>String(300000000000000000n+BigInt(i)));});await f.gateway.queues();const pages=f.archive.sent.map(p=>(p.embeds![0] as {toJSON:()=>APIEmbed}).toJSON().description!);assert(pages.length>1);assert(pages.every(p=>p.length<=3800));assert.equal(pages.join('\n').match(/<@\d+>/g)!.length,1001);await f.store.change(s=>s.queues.NA=[]);await f.gateway.queues();assert.deepEqual(Object.keys((await f.store.read()).panels).filter(k=>k.startsWith('queue:NA')),['queue:NA']);}finally{await rm(f.dir,{recursive:true});}});
test('retention cleans historic ticket folders but preserves transcripts, unknown files and fresh evidence',async()=>{const f=await setup(),historic=await mkdtemp(join(tmpdir(),'crystal-historic-'));try{const old=join(historic,f.t.id),fresh=join(f.dir,'33333333-3333-4333-8333-333333333333');await mkdir(old);await mkdir(fresh);await writeFile(join(old,'retention.json'),JSON.stringify({archivedAt:Date.now()-11*86400000,imageRetentionDays:10}));for(const name of ['image-1.bin','transcript.md','notes.txt'])await writeFile(join(old,name),'keep');await writeFile(join(fresh,'retention.json'),JSON.stringify({archivedAt:Date.now(),imageRetentionDays:10}));await writeFile(join(fresh,'image-2.bin'),'keep');await f.store.change(s=>s.tickets[f.t.id]!.archiveDirectory=historic);await f.gateway.cleanupImages();assert.deepEqual((await readdir(old)).sort(),['notes.txt','retention.json','transcript.md']);assert((await readdir(fresh)).includes('image-2.bin'));}finally{await rm(f.dir,{recursive:true});await rm(historic,{recursive:true});}});
test('long transcript paginates Discord history and splits oversized transcripts before source deletion',async()=>{const f=await setup();try{for(let i=0;i<2200;i++){const m=f.source.makeMessage({content:'x'.repeat(4000)});f.source.messages.set(m.id,m);}const j=job('archive',f.t);await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/deletion delay/);assert(j.checkpoints.lastPage);assert.equal(f.source.isDeleted(),false);assert.equal(f.archive.sent.length,2);const text=await readFile(join(f.dir,f.t.id,'transcript.md'),'utf8');assert(text.length>8*1024*1024);}finally{await rm(f.dir,{recursive:true});}});

async function loaSetup(){const f=await setup();f.c.modules.loa=true;f.c.permissionGroups.staff=[BOT];f.c.permissionGroups.loaAdmin=[BOT];f.c.loa.roleId='100000000000000009';f.c.channels.requestLoa=SOURCE;f.c.channels.loaInProgress=SOURCE;f.c.channels.acceptedLoa=ARCHIVE;f.c.channels.operationalLog=ARCHIVE;const roles=new Collection<string,unknown>();f.guild.members.fetch=async()=>({id:USER,user:{username:'DiscordName'},roles:{cache:roles,add:async(id:string)=>{roles.set(id,{});},remove:async(id:string)=>{roles.delete(id);}}});return {...f,roles,leave:new LeaveService(f.store,()=>f.c),actor:{id:USER,roles:[BOT],administrator:false}};}
test('LOA denied DM failure is recorded privately without reversing the decision or retrying forever',async()=>{const f=await loaSetup();try{Object.defineProperty(f.client,'users',{value:{fetch:async()=>({createDM:async()=>{throw Object.assign(Error('DM blocked'),{code:50007});}})}});const l=await f.leave.request(f.actor,'Example','7d','travel');await f.leave.decide(f.actor,l.id,'deny','Need coverage');const j=Object.values((await f.store.read()).jobs).find(j=>j.data.event==='deny')!;await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});let s=await f.store.read();assert.equal(s.leaves![l.id]!.status,'denied');assert.equal(s.leaves![l.id]!.notifications!.deny,'blocked');assert(s.audit.some(e=>e.action==='loa-dm-blocked'));assert(Object.values(s.jobs).some(j=>j.id.startsWith('loa-dm-blocked-')));await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});s=await f.store.read();assert.equal(s.audit.filter(e=>e.action==='loa-dm-blocked').length,1);}finally{await rm(f.dir,{recursive:true});}});
test('LOA approvals ping admins, restore only active roles on rejoin and keep one accepted post across retries',async()=>{const f=await loaSetup();try{const dm=fakeChannel('100000000000000010');Object.defineProperty(f.client,'users',{value:{fetch:async()=>({createDM:async()=>dm.channel})}});const l=await f.leave.request(f.actor,'Example','7d','travel');const request=Object.values((await f.store.read()).jobs).find(j=>j.data.event==='request')!;await f.gateway.job(request,async(k,v)=>{request.checkpoints[k]=v;});assert.deepEqual(f.source.sent[0]!.allowedMentions!.roles,[BOT]);assert.equal(f.source.sent[0]!.components!.length,1);await f.leave.decide(f.actor,l.id,'accept');const approval=Object.values((await f.store.read()).jobs).find(j=>j.data.event==='accept')!;await f.gateway.job(approval,async(k,v)=>{approval.checkpoints[k]=v;});await f.gateway.job(approval,async(k,v)=>{approval.checkpoints[k]=v;});assert(f.roles.has(f.c.loa.roleId!));assert.equal(f.archive.sent.length,1);assert.equal(dm.sent.length,1);const adapter=new LeaveGateway(f.client,f.store,()=>f.c,f.gateway);f.roles.clear();await adapter.syncRole(USER);assert(f.roles.has(f.c.loa.roleId!));await f.leave.end(f.actor,l.id);await f.gateway.job(approval,async(k,v)=>{approval.checkpoints[k]=v;});assert.equal(f.roles.has(f.c.loa.roleId!),false);assert.equal(f.archive.sent.length,1);assert(Object.keys((await f.store.read()).panels).includes('loa-active:0'));}finally{await rm(f.dir,{recursive:true});}});


test('support channel names use the ticket type and server nickname',()=>{
 assert.equal(supportTicketName('general-support','Rain Cake',USER),'support-rain-cake');
 assert.equal(supportTicketName('player-report','Nickname',USER),'player-report-nickname');
 assert.equal(supportTicketName('restriction-appeal','Nickname',USER),'restriction-appeal-nickname');
 assert.equal(supportTicketName('general-support','✨',USER),`support-${USER}`);
 assert(supportTicketName('partnership-request','n'.repeat(200),USER).length<=90);
});


test('closure request publication is restart-safe and decision disables the original message',async()=>{const f=await setup();try{
 const request={id:'33333333-3333-4333-8333-333333333333',requestedBy:BOT,reason:'Resolved',requestedAt:1000,expiresAt:3601000,status:'pending' as const};
 await f.store.change(s=>{s.tickets[f.t.id]!.status='open';s.tickets[f.t.id]!.closeRequests=[request];});const j=job('notice',f.t);j.data.event='close-request';j.data.requestId=request.id;const save=async(k:string,v:unknown)=>{j.checkpoints[k]=v;};
 await f.gateway.job(j,save);await f.gateway.job(j,save);assert.equal(f.source.sent.length,1);assert.deepEqual(f.source.sent[0]!.allowedMentions,{parse:[],users:[USER]});
 const state=await f.store.read(),message=f.source.messages.get(state.tickets[f.t.id]!.closeRequests![0]!.messageId!)!;let edits=0;message.edit=async function(){edits++;};await f.store.change(s=>s.tickets[f.t.id]!.closeRequests![0]!.status='denied');
 const update=job('notice',f.t);update.id='44444444-4444-4444-8444-444444444444';update.data.event='close-request-update';update.data.requestId=request.id;await f.gateway.job(update,async()=>{});assert.equal(edits,1);
}finally{await rm(f.dir,{recursive:true});}});


test('high testing openings ping Staff while normal tests and silent imports do not',async()=>{
 for(const mode of ['high','normal','silent'] as const){const f=await setup();try{const role='100000000000000009';f.c.permissionGroups.staff=[role];await f.store.change(s=>{const t=s.tickets[f.t.id]!;t.status='opening';t.target=mode==='normal'?null:'LT2';});const j=job('open',f.t);if(mode==='silent')Object.assign(j.data,{adopt:true,silentAdoption:true});await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});const message=f.source.sent[0]!,mentions=message.allowedMentions as {roles:string[];users:string[];parse:string[]};assert.equal(mentions.roles.includes(role),mode==='high');assert.equal(message.content!.includes(`<@&${role}>`),mode!=='normal');assert.deepEqual(mentions.parse,[]);if(mode!=='silent')assert(mentions.users.includes(USER));else assert.deepEqual(mentions.users,[]);
 }finally{await rm(f.dir,{recursive:true});}}
});


test('fresh deliveries skip history scans and add no visible reference embeds',async()=>{const f=await setup();try{
 f.source.channel.messages.fetch=async()=>{throw Error('Fresh delivery should not scan history');};const j=job('notice',f.t);await f.gateway.sendOnce(f.source.channel as never,j,{content:'Hello'},async(k,v)=>{j.checkpoints[k]=v;});assert.equal(f.source.sent.length,1);assert.equal(f.source.sent[0]!.embeds,undefined);
}finally{await rm(f.dir,{recursive:true});}});

test('interrupted clean deliveries recover from recent payloads without posting twice',async()=>{const f=await setup();try{
 const j=job('notice',f.t);j.createdAt=500;j.checkpoints.deliveryStartedAt=500;await assert.rejects(f.gateway.sendOnce(f.source.channel as never,j,{content:'Hello'},async()=>{throw Error('Lost checkpoint');}),/Lost checkpoint/);j.attempts=1;await f.gateway.sendOnce(f.source.channel as never,j,{content:'Hello'},async(k,v)=>{j.checkpoints[k]=v;});assert.equal(f.source.sent.length,1);assert(j.checkpoints.messageId);
}finally{await rm(f.dir,{recursive:true});}});

test('queue opening ping stays while testers are active, survives restart, and is deleted when the queue closes',async()=>{const f=await setup();try{
 f.c.modules.testing=true;f.c.regions.EU.enabled=false;f.c.regions.AS.enabled=false;f.c.regions.NA.queueChannelId=SOURCE;f.c.regions.NA.waitlistRoleId=USER;
 await f.store.change(s=>{s.testers[BOT]='NA';s.lastTestingSession={NA:1234};});const j=job('notice',f.t);j.data={here:true,region:'NA',sessionAt:1234,channelId:SOURCE};const save=async(k:string,v:unknown)=>{j.checkpoints[k]=v;};
 await f.gateway.job(j,save);const pingId=f.source.messages.first()!.id;assert.equal(f.source.sent[0]!.content,`<@&${USER}>`);assert.equal(f.source.sent[0]!.embeds,undefined);assert.deepEqual(f.source.sent[0]!.allowedMentions,{parse:[],roles:[USER]});assert.equal((await f.store.read()).jobs[`delete-${j.id}`],undefined);
 await f.gateway.queues();assert(f.source.messages.has(pingId));await f.gateway.job(j,save);assert.equal(f.source.sent.filter(p=>p.content===`<@&${USER}>`).length,1);
 const restarted=new Gateway(f.client,f.store,()=>f.c);await f.store.change(s=>{s.testers[USER]='NA';delete s.testers[BOT];});await restarted.queues();assert(f.source.messages.has(pingId));
 await f.store.change(s=>{s.testers={};});await restarted.queues();assert(!f.source.messages.has(pingId));assert(!Object.keys((await f.store.read()).panels).some(k=>k.startsWith('queue-ping:')));await f.gateway.job(j,save);assert.equal(f.source.sent.filter(p=>p.content===`<@&${USER}>`).length,1);
}finally{await rm(f.dir,{recursive:true});}});

test('reopening a queue removes its old ping and stale queued notifications do not ping a new session',async()=>{const f=await setup();try{
 f.c.modules.testing=true;f.c.regions.EU.enabled=false;f.c.regions.AS.enabled=false;f.c.regions.NA.queueChannelId=SOURCE;f.c.regions.NA.waitlistRoleId=USER;
 await f.store.change(s=>{s.testers[BOT]='NA';s.lastTestingSession={NA:100};});const j=job('notice',f.t);j.data={here:true,region:'NA',sessionAt:100,channelId:SOURCE};await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});const old=f.source.messages.first()!.id;
 await f.store.change(s=>{s.lastTestingSession!.NA=200;});await f.gateway.queues();assert(!f.source.messages.has(old));
 const stale={...j,id:'stale',checkpoints:{}};await f.gateway.job(stale,async()=>{});assert.equal(f.source.sent.filter(p=>p.content===`<@&${USER}>`).length,1);
 const fresh={...j,id:'fresh',data:{...j.data,sessionAt:200},checkpoints:{}};await f.gateway.job(fresh,async()=>{});assert.equal(f.source.sent.filter(p=>p.content===`<@&${USER}>`).length,2);
 await f.store.change(s=>{s.maintenance=true;});await f.gateway.queues();assert(!Object.keys((await f.store.read()).panels).some(k=>k.startsWith('queue-ping:')));
}finally{await rm(f.dir,{recursive:true});}});


test('queue notifications allow only the configured regional waitlist role for all three regions',async()=>{for(const [n,region]of (['NA','EU','AS'] as const).entries()){const f=await setup();try{
 f.c.modules.testing=true;const role=String(400000000000000000n+BigInt(n));f.c.regions[region].waitlistRoleId=role;
 await f.store.change(s=>{s.testers[BOT]=region;s.lastTestingSession={[region]:123};});const j=job('notice',f.t);j.data={queueOpening:true,region,sessionAt:123,channelId:SOURCE};await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});
 assert.equal(f.source.sent[0]!.content,`<@&${role}>`);assert.deepEqual(f.source.sent[0]!.allowedMentions,{parse:[],roles:[role]});assert(!f.source.sent[0]!.content!.includes('@here'));
}finally{await rm(f.dir,{recursive:true});}}});

test('evaluation and high testing channel names use server nicknames rather than Minecraft IGNs',()=>{const t={opener:USER,region:'NA' as const,target:null};assert.equal(testingTicketName(t,'Server Nickname'),'test-server-nickname-na');assert.equal(testingTicketName({...t,target:'LT2'},'Server Nickname'),'server-nickname-lt2-na');});


test('delivery recovery never mistakes another transcript filename for its own archive',async()=>{const f=await setup();try{const old=f.source.makeMessage({content:'Archived ticket'});old.attachments.set('other',{name:'other-ticket.md',url:'https://cdn.discordapp.com/other',contentType:'text/plain'});f.source.messages.set(old.id,old);const j=job('notice',f.t);j.attempts=1;j.createdAt=500;await f.gateway.sendOnce(f.source.channel as never,j,{content:'Archived ticket',files:[{attachment:Buffer.from('transcript'),name:'correct-ticket.md'}]},async(k,v)=>{j.checkpoints[k]=v;});assert.equal(f.source.sent.length,1);assert.notEqual(j.checkpoints.messageId,old.id);}finally{await rm(f.dir,{recursive:true});}});


test('new ticket channel names use the account username even when the server nickname differs',async()=>{for(const type of ['test','general-support']){const f=await setup();try{const created:string[]=[];Object.assign(f.guild.members,{fetch:async(id:string)=>({id,user:{username:'discord_username'},displayName:'ADD TO HT3 AND LT2'})});Object.assign(f.guild.channels,{create:async(options:{name:string})=>{created.push(options.name);return f.source.channel;}});const gateway=new Gateway(f.client,f.store,()=>f.c);(gateway as unknown as {destination:()=>Promise<string>}).destination=async()=>GUILD;await f.store.change(s=>{const t=s.tickets[f.t.id]!;t.channelId=null;t.type=type;t.status='opening';t.target=type==='test'?'LT2':null;});const j=job('open',f.t);await gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});assert.equal(created[0],type==='test'?'discord_username-lt2-na':'support-discord_username');const t=(await f.store.read()).tickets[f.t.id]!;assert.equal(t.openingDiscordUsername,'discord_username');assert.equal(t.openingIgn,'Example');}finally{await rm(f.dir,{recursive:true});}}});


test('list refresh removes confirmed absent members from every list and preserves profiles',async()=>{const f=await setup();try{f.c.modules.tierLists=true;f.c.tierLists.channelIds.HT3=ARCHIVE;await f.store.change(s=>{s.lists.HT3={NA:[USER,BOT]};s.lists.LT2={EU:[BOT]};});const before=(await f.store.read()).players[USER];Object.assign(f.guild.members,{fetch:async(arg:{user:string;force:boolean})=>{assert.equal(arg.force,true);if(arg.user===BOT)throw Object.assign(new Error('Unknown Member'),{code:10007});return{id:arg.user,displayName:'Present',user:{username:'present'}};}});await f.gateway.lists();const s=await f.store.read();assert.deepEqual(s.lists.HT3?.NA,[USER]);assert.deepEqual(s.lists.LT2?.EU,[]);assert.deepEqual(s.players[USER],before);const description=(f.archive.sent[0]!.embeds![0] as {toJSON:()=>APIEmbed}).toJSON().description!;assert(description.includes(`<@${USER}>`));assert(!description.includes(`<@${BOT}>`));}finally{await rm(f.dir,{recursive:true});}});

test('temporary Discord lookup failures never remove list members',async()=>{const f=await setup();try{f.c.modules.tierLists=true;f.c.tierLists.channelIds.HT3=ARCHIVE;await f.store.change(s=>s.lists.HT3={NA:[USER,BOT]});Object.assign(f.guild.members,{fetch:async(arg:{user:string})=>{throw Object.assign(new Error('lookup failed'),{code:arg.user===BOT?10007:503});}});await assert.rejects(f.gateway.lists(),/lookup failed/);assert.deepEqual((await f.store.read()).lists.HT3?.NA,[USER,BOT]);assert.equal(f.archive.sent.length,0);}finally{await rm(f.dir,{recursive:true});}});


test('ticket notification overrides ping only the configured role without changing access',async()=>{for(const type of ['test','general-support']){const f=await setup();try{const staff='100000000000000008',mod='100000000000000009';f.c.permissionGroups.staff=[staff];f.c.ticketNotifications.highTestingRoleIds=[mod];f.c.ticketNotifications.supportRoleIds=[mod];const groups=structuredClone(f.c.permissionGroups);await f.store.change(s=>{const t=s.tickets[f.t.id]!;t.type=type;t.status='opening';t.target=type==='test'?'LT2':null;t.accessRoles=[staff];});const j=job('open',f.t);await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});const message=f.source.sent[0]!,mentions=message.allowedMentions as {roles:string[]};assert.deepEqual(mentions.roles,[mod]);assert(message.content!.includes(`<@&${mod}>`));assert(!message.content!.includes(`<@&${staff}>`));assert.deepEqual((await f.store.read()).tickets[f.t.id]!.accessRoles,[staff]);assert.deepEqual(f.c.permissionGroups,groups);}finally{await rm(f.dir,{recursive:true});}}});

test('archival skips departed targets but still saves transcript before deleting the channel',async()=>{const f=await setup();try{
 f.source.channel.permissionOverwrites.edit=async()=>{throw Object.assign(new Error('Unknown Member'),{code:10007});};
 const j=job('archive',f.t);await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/deletion delay/);assert(j.checkpoints.transcript);assert(j.checkpoints.archived);assert.equal(f.source.isDeleted(),false);
 j.checkpoints.archived=Date.now()-11000;await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});assert.equal(f.source.isDeleted(),true);assert.equal(f.archive.sent.length,1);
 }finally{await rm(f.dir,{recursive:true});}
});

test('archival does not ignore permission or transient Discord failures',async()=>{for(const code of [50013,429]){const f=await setup();try{
 f.source.channel.permissionOverwrites.edit=async()=>{throw Object.assign(new Error('Cannot lock'),{code});};const j=job('archive',f.t);
 await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/Cannot lock/);assert.equal(j.checkpoints.locked,undefined);assert.equal(f.source.isDeleted(),false);assert.equal(f.archive.sent.length,0);
 }finally{await rm(f.dir,{recursive:true});}}
});

test('archive locking supplies explicit overwrite types for uncached users and roles',async()=>{const f=await setup();try{
 const role='100000000000000009',calls:{id:string;type:number}[]=[];await f.store.change(s=>s.tickets[f.t.id]!.accessRoles=[role]);
 Object.assign(f.source.channel.permissionOverwrites,{edit:async(id:string,_permissions:unknown,options:{type:number})=>{assert(options);calls.push({id,type:options.type});}});
 const j=job('archive',f.t);await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/deletion delay/);
 assert(calls.some(x=>x.id===USER&&x.type===1));assert(calls.some(x=>x.id===BOT&&x.type===1));assert(calls.some(x=>x.id===role&&x.type===0));assert(j.checkpoints.archived);
 }finally{await rm(f.dir,{recursive:true});}
});

test('Unknown Overwrite is skipped only after confirming that the member has left',async()=>{for(const missing of [true,false]){const f=await setup();try{
 Object.assign(f.source.channel.permissionOverwrites,{edit:async(id:string)=>{if(id===USER)throw Object.assign(new Error('Unknown Overwrite'),{code:10009});}});
 Object.assign(f.guild.members,{fetch:async()=>{if(missing)throw Object.assign(new Error('Unknown Member'),{code:10007});return {id:USER};}});
 const j=job('archive',f.t);await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),missing?/deletion delay/:/Unknown Overwrite/);assert.equal(!!j.checkpoints.archived,missing);assert.equal(f.source.isDeleted(),false);
 }finally{await rm(f.dir,{recursive:true});}}
});

test('concurrent panel refreshes create one durable message',async()=>{const f=await setup();try{
 const internal=f.gateway as unknown as {upsertPanel:(key:string,ch:unknown,payload:MessageCreateOptions)=>Promise<void>};
 await Promise.all(Array.from({length:8},()=>internal.upsertPanel('audit-panel',f.source.channel,{content:'Panel'})));assert.equal(f.source.sent.length,1);assert.equal((await f.store.read()).panels['audit-panel'],f.source.messages.first()!.id);
 }finally{await rm(f.dir,{recursive:true});}
});
test('panel fetch failures never create duplicates, while a confirmed missing message is recreated',async()=>{for(const code of [50013,10008]){const f=await setup();try{
 await f.store.change(s=>s.panels['audit-panel']='old');f.source.channel.messages.fetch=async()=>{throw Object.assign(Error('Fetch failed'),{code});};const internal=f.gateway as unknown as {upsertPanel:(key:string,ch:unknown,payload:MessageCreateOptions)=>Promise<void>};const call=internal.upsertPanel('audit-panel',f.source.channel,{content:'Panel'});
 if(code===10008){await call;assert.equal(f.source.sent.length,1);}else{await assert.rejects(call,/Fetch failed/);assert.equal(f.source.sent.length,0);assert.equal((await f.store.read()).panels['audit-panel'],'old');}
 }finally{await rm(f.dir,{recursive:true});}}
});
test('temporary member lookup failures keep role synchronization retryable',async()=>{const f=await setup();try{
 f.guild.members.fetch=async()=>{throw Object.assign(Error('Temporary member failure'),{code:50013});};const p=(await f.store.read()).players[USER]!;await assert.rejects(f.gateway.playerRoles(p),/Temporary member failure/);
 f.guild.members.fetch=async()=>{throw Object.assign(Error('Unknown Member'),{code:10007});};await f.gateway.playerRoles(p);
 }finally{await rm(f.dir,{recursive:true});}
});

test('transcript parts preserve Unicode and every original byte',async()=>{const {transcriptParts}=await import('../src/discord/gateway.js');const original=Buffer.from('😀é漢字'.repeat(100));const parts=transcriptParts(original,17);assert(parts.every(p=>p.length<=17&&!p.toString('utf8').includes('�')));assert.deepEqual(Buffer.concat(parts),original);});
test('obsolete ticket access notices cannot hold a closing ticket open',async()=>{const f=await setup();try{f.source.channel.permissionOverwrites.edit=async()=>{throw Error('Should not replay an obsolete access update');};const j=job('notice',f.t);j.data.event='access';await f.gateway.job(j,async()=>{});assert.equal(f.source.sent.length,0);}finally{await rm(f.dir,{recursive:true});}});

test('archive rebuilds a missing local transcript after restart before deleting anything',async()=>{const f=await setup();try{const j=job('archive',f.t);j.checkpoints.transcript=true;await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/deletion delay/);assert(j.checkpoints.archived);assert((await readFile(join(f.dir,f.t.id,'transcript.md'),'utf8')).includes('Ticket'));assert.equal(f.source.isDeleted(),false);}finally{await rm(f.dir,{recursive:true});}});

test('multipart archival retries missing parts without deleting evidence or reposting saved parts',async()=>{const f=await setup();try{
 await mkdir(join(f.dir,f.t.id),{recursive:true});await writeFile(join(f.dir,f.t.id,'transcript.md'),Buffer.alloc(9*1024*1024,120));const j=job('archive',f.t);j.checkpoints.transcript=true;
 let sends=0;const original=f.archive.channel.send;f.archive.channel.send=async options=>{if(++sends===2)throw Error('Upload interrupted');return original(options);};
 await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/Upload interrupted/);assert(j.checkpoints['archivePartMessageId:0']);assert.equal(j.checkpoints.archived,undefined);assert.equal(f.source.isDeleted(),false);
 await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/deletion delay/);assert.equal(f.archive.sent.length,2);assert(j.checkpoints.archived);j.checkpoints.archived=Date.now()-11000;await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});assert.equal(f.source.isDeleted(),true);
 }finally{await rm(f.dir,{recursive:true});}
});

test('adopted testing channel overwrites carry explicit role/member types after restart',async()=>{const f=await setup();try{const role='100000000000000009';await f.store.change(s=>{s.tickets[f.t.id]!.status='opening';s.tickets[f.t.id]!.accessRoles=[role];});let overwrites:{id:string;type:number}[]=[];Object.assign(f.source.channel.permissionOverwrites,{set:async(values:{id:string;type:number}[])=>{overwrites=values;}});const j=job('open',f.t);await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});assert(overwrites.every(o=>o.type===0||o.type===1));assert.equal(overwrites.find(o=>o.id===role)!.type,0);assert.equal(overwrites.find(o=>o.id===USER)!.type,1);assert.equal(overwrites.find(o=>o.id===BOT)!.type,1);}finally{await rm(f.dir,{recursive:true});}});

test('type-change role pings are not repeated when the subsequent confirmation fails',async()=>{const f=await setup();try{
 const role='100000000000000009';f.c.ticketNotifications.supportRoleIds=[role];await f.store.change(s=>{s.tickets[f.t.id]!.status='open';s.tickets[f.t.id]!.type='general-support';s.tickets[f.t.id]!.accessRoles=[];});(f.gateway as unknown as {destination:()=>Promise<string>}).destination=async()=>GUILD;
 const original=f.source.channel.send;let failed=false;f.source.channel.send=async options=>{if(options.content==='switched'&&!failed){failed=true;throw Error('Confirmation failed');}return original(options);};const j=job('notice',f.t);Object.assign(j.data,{event:'type',previousRoles:[],content:'switched'});
 await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/Confirmation failed/);j.attempts=1;await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});assert.equal(f.source.sent.filter(p=>p.content===`<@&${role}>`).length,1);
 }finally{await rm(f.dir,{recursive:true});}
});

test('archival locks existing overwrites in one request while preserving visibility and bot access',async()=>{const f=await setup();try{
 let sets=0;const allow=new PermissionsBitField([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]);Object.assign(f.source.channel.permissionOverwrites,{cache:new Collection([[USER,{id:USER,type:1,allow,deny:new PermissionsBitField()}],[BOT,{id:BOT,type:1,allow,deny:new PermissionsBitField()}]]),set:async(values:{id:string;allow:bigint;deny:bigint}[])=>{sets++;const user=values.find(x=>x.id===USER)!,bot=values.find(x=>x.id===BOT)!;assert(user.deny&PermissionFlagsBits.SendMessages);assert.equal(user.allow&PermissionFlagsBits.SendMessages,0n);assert(user.allow&PermissionFlagsBits.ViewChannel);assert(bot.allow&PermissionFlagsBits.SendMessages);},edit:async()=>{throw Error('Should use one bulk lock');}});
 const j=job('archive',f.t);await assert.rejects(f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;}),/deletion delay/);assert.equal(sets,1);assert(j.checkpoints.archived);
 }finally{await rm(f.dir,{recursive:true});}
});
test('zero extra closure delay deletes immediately after confirmed archive upload',async()=>{const f=await setup();try{
 await f.store.change(s=>s.tickets[f.t.id]!.minimumDeletionDelaySeconds=0);const j=job('archive',f.t);await f.gateway.job(j,async(k,v)=>{j.checkpoints[k]=v;});assert(j.checkpoints.archived);assert.equal(f.source.isDeleted(),true);assert.equal(f.archive.sent.length,1);
 }finally{await rm(f.dir,{recursive:true});}
});
