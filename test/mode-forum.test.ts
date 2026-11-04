import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ChannelType,Collection,EmbedBuilder,type Client,type MessageCreateOptions} from 'discord.js';
import {configSchema} from '../src/config.js';
import {emptyState} from '../src/domain/types.js';
import {Store,MemoryAdapter} from '../src/storage/store.js';
import {Gateway} from '../src/discord/gateway.js';
import {setupRequirements,setupCapacity} from '../src/discord/setup.js';

const G='100000000000000001',BOT='100000000000000002',FORUM='100000000000000003',THREAD='100000000000000004';
async function fixture(){
 const c=configSchema.parse(JSON.parse(await readFile('config.multimode.example.json','utf8')));c.community.guildId=G;c.activeMode={key:'sword',name:'Sword'};c.modeForum.channelId=FORUM;
 const store=new Store(new MemoryAdapter(emptyState(G))),messages=new Map<string,{id:string;author:{id:string};edit:()=>Promise<void>;delete:()=>Promise<void>}>();let created=0,edits=0,deleted=0,active=true,next=0;
 const send=async()=>{const id=String(200000000000000000n+BigInt(next++)),message={id,author:{id:BOT},edit:async()=>{edits++;},delete:async()=>{messages.delete(id);deleted++;}};messages.set(id,message);return message;};
 const thread={id:THREAD,type:ChannelType.PublicThread,parentId:FORUM,ownerId:BOT,name:'Sword High List',archived:false,locked:false,isThread:()=>true,setLocked:async(value:boolean)=>{thread.locked=value;},setArchived:async(value:boolean)=>{thread.archived=value;},fetchStarterMessage:async()=>messages.values().next().value,messages:{fetch:async(id:string)=>{if(messages.has(id))return messages.get(id);throw Object.assign(new Error('Missing'),{code:10008});}},send};
 const forum={id:FORUM,type:ChannelType.GuildForum,threads:{fetchActive:async()=>({threads:new Collection(active?[[THREAD,thread]]:[])}),fetchArchived:async()=>({threads:new Collection(thread.archived?[[THREAD,thread]]:[]),hasMore:false}),create:async()=>{created++;active=true;await send();return thread;}}};
 const guild={channels:{fetch:async(id:string)=>id===FORUM?forum:id===THREAD?thread:null}},gateway=new Gateway({user:{id:BOT},guilds:{fetch:async()=>guild}} as unknown as Client,store,()=>c);
 const update=(n:number)=> (gateway as unknown as {forumList:(pages:MessageCreateOptions[])=>Promise<void>}).forumList(Array.from({length:n},(_,i)=>({embeds:[new EmbedBuilder().setTitle('Sword High List').setDescription(`Page ${i}`)]})));
 return {store,thread,messages,update,disableActive:()=>{active=false;},counts:()=>({created,edits,deleted})};
}
test('mode forum edits saved pages, removes obsolete pages and recovers an archived post after restart',async()=>{
 const f=await fixture();f.disableActive();await f.update(3);assert.equal(f.counts().created,1);assert.equal(f.messages.size,3);await f.update(1);assert.equal(f.messages.size,1);assert.equal(f.counts().deleted,2);
 f.thread.archived=true;f.thread.locked=true;await f.update(1);assert.equal(f.thread.archived,false);assert.equal(f.thread.locked,false);assert.equal(f.counts().created,1);
 await f.store.change(s=>{delete s.panels['forum:sword'];});f.thread.archived=true;f.disableActive();await f.update(1);assert.equal(f.counts().created,1);assert.equal((await f.store.read()).panels['forum:sword'],THREAD);
});
test('multi-mode setup capacity refuses category overflow before resource creation',async()=>{
 const c=configSchema.parse(JSON.parse(await readFile('config.multimode.example.json','utf8')));c.supportTicketTypes=[];c.queueLayout='per-mode';assert.equal(setupRequirements(c).categories,32);
 const guild={channels:{fetch:async()=>new Collection(Array.from({length:20},(_,i)=>[String(i),{type:ChannelType.GuildCategory}]))},roles:{fetch:async()=>new Collection()}};
 const errors=await setupCapacity(c,guild as never);assert(errors.some(e=>e.includes('32 more categories')));
});


test('regional layout needs three shared queue categories and eight mode High Tests categories',async()=>{const c=configSchema.parse(JSON.parse(await readFile('config.multimode.example.json','utf8')));c.supportTicketTypes=[];assert.equal(c.queueLayout,'regional');assert.equal(setupRequirements(c).categories,11);c.gameModes[0]!.regions.NA.testCategoryId=THREAD;assert.equal(setupRequirements(c).categories,10);const legacy=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));assert.equal(legacy.queueLayout,'per-mode');});
