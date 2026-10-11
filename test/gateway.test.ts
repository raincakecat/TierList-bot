import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChannelType, Collection, type APIEmbed, type Client, type MessageCreateOptions } from 'discord.js';
import { configSchema } from '../src/config.js';
import { emptyState, type Job, type Ticket } from '../src/domain/types.js';
import { Store, MemoryAdapter } from '../src/storage/store.js';
import { Gateway } from '../src/discord/gateway.js';

const GUILD='100000000000000001',USER='100000000000000002',BOT='100000000000000003',SOURCE='100000000000000004',ARCHIVE='100000000000000005';
interface FakeMessage {id:string;author:{id:string;username:string};createdTimestamp:number;content:string;attachments:Collection<string,{id?:string;name:string;url:string;contentType:string;size?:number}>;embeds:APIEmbed[];reactions:string[];react:(emoji:string)=>Promise<void>;pin:()=>Promise<void>;edit:()=>Promise<void>;delete:()=>Promise<void>}
function fakeChannel(id:string){let deleted=false;const messages=new Collection<string,FakeMessage>(),sent:MessageCreateOptions[]=[];
  function makeMessage(options:MessageCreateOptions):FakeMessage{const key=String(200000000000000000n+BigInt(messages.size));return {id:key,author:{id:BOT,username:'Bot'},createdTimestamp:1000,content:options.content??'',attachments:new Collection(),embeds:(options.embeds??[]).map(e=>'toJSON'in e?e.toJSON():e),reactions:[] as string[],react:async function(emoji:string){this.reactions.push(emoji);},pin:async()=>{},edit:async()=>{},delete:async()=>{messages.delete(key);}};}
  const channel={id,name:'test-example-na',type:ChannelType.GuildText,parentId:null,permissionOverwrites:{set:async()=>{},edit:async()=>{},delete:async()=>{}},messages:{fetch:async(arg:string|{before?:string})=>typeof arg==='string'?(messages.get(arg)??Promise.reject(new Error('not found'))):new Collection([...messages].filter(([id])=>!arg.before||id<arg.before)),edit:async()=>{}},send:async(options:MessageCreateOptions)=>{sent.push(options);const m=makeMessage(options);messages.set(m.id,m);return m;},delete:async()=>{deleted=true;},setName:async()=>{},setParent:async()=>{}};
  return {channel,messages,sent,isDeleted:()=>deleted,makeMessage};
}
async function setup(copyImages=false){const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8'))),dir=await mkdtemp(join(tmpdir(),'crystal-gateway-'));c.community.guildId=GUILD;c.archival.directory=dir;c.channels.results=ARCHIVE;c.modules.testing=false;c.modules.tierLists=false;
  const source=fakeChannel(SOURCE),archive=fakeChannel(ARCHIVE),channels=new Collection([[SOURCE,source.channel],[ARCHIVE,archive.channel]]),guild={id:GUILD,channels:{fetch:async(id?:string)=>id?channels.get(id):channels},members:{fetch:async(id:string)=>({id,user:{username:'DiscordName'}})}};
  const client={user:{id:BOT},guilds:{fetch:async()=>guild}} as unknown as Client;
  const state=emptyState(GUILD);state.initialized=true;state.players[USER]={id:USER,tier:'HT3',uuid:'a'.repeat(32),ign:'Example',region:'NA',preferredServer:'server',waitlist:true,cooldownUntil:0};
  const t:Ticket={id:'11111111-1111-4111-8111-111111111111',channelId:SOURCE,type:'test',opener:USER,region:'NA',openingTier:'LT3',openingIgn:'Example',openingUuid:'a'.repeat(32),tester:BOT,target:'HT3',passed:true,status:'closing',participants:[BOT],openedAt:1000,closedAt:2000,outcome:'HT3',accessRoles:[],closingRoles:[],archiveChannelId:ARCHIVE,copyImages,imageRetentionDays:10,categoryId:GUILD,name:'example-ht3-na'};state.tickets[t.id]=t;const store=new Store(new MemoryAdapter(state)),gateway=new Gateway(client,store,()=>c);
  return {c,dir,source,archive,t,store,gateway};
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
