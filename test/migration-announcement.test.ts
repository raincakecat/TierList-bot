import test from 'node:test';
import assert from 'node:assert/strict';
import {ConfigFile} from '../src/config.js';
import {Gateway} from '../src/discord/gateway.js';
import {emptyState,type Job} from '../src/domain/types.js';
import type {Client} from 'discord.js';
import type {Store} from '../src/storage/store.js';

test('migrations use their own channel and normal results keep reactions',async()=>{
  const c=(await ConfigFile.load('config.consolidated.example.json')).value;
  c.channels.results='100000000000000021';c.channels.migrations='100000000000000022';
  const state=emptyState('100000000000000020'),id='100000000000000023';
  state.players[id]={id,uuid:null,ign:'Example',region:'NA',preferredServer:null,tier:'LT2',waitlist:false,cooldownUntil:0};
  const gateway=new Gateway({} as Client,{} as Store,()=>c),sent:{channel:string;title:string}[]=[],reactions:string[]=[];
  Object.assign(gateway,{guild:async()=>({}),member:async()=>null,text:async(channel:string)=>channel,sendOnce:async(channel:string,_job:Job,payload:{embeds:{data:{title:string}}[]})=>{sent.push({channel,title:payload.embeds[0]!.data.title});return {react:async(emoji:string)=>{reactions.push(emoji);}};}});
  const base={id:'job',kind:'result',status:'pending',attempts:0,nextAt:0,createdAt:0,checkpoints:{},data:{playerId:id,previousTier:'LT3',earnedTier:'LT2',region:'NA',actor:'100000000000000024'}} as Job;
  const run=(job:Job)=>(gateway as unknown as {result:(job:Job,ticket:undefined,snapshot:typeof state,save:()=>Promise<void>)=>Promise<void>}).result(job,undefined,state,async()=>{});
  await run({...base,data:{...base.data,migration:true,source:'Previous tier list'}});
  assert.deepEqual(sent,[{channel:c.channels.migrations,title:'Crystal | Rank Migration'}]);assert.equal(reactions.length,0);
  await run({...base,data:{...base.data,migration:false}});
  assert.equal(sent[1]?.channel,c.channels.results);assert.equal(reactions.length,6);
});
