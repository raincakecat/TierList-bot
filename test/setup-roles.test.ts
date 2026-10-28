import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Collection,type Guild} from 'discord.js';
import {ConfigFile,configSchema} from '../src/config.js';
import {provision,validateDiscord} from '../src/discord/setup.js';

test('existing owner roles may remain above the bot while roles it assigns must be below it',async()=>{
  const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));
  c.community.guildId='100000000000000001';for(const k of Object.keys(c.modules) as (keyof typeof c.modules)[])c.modules[k]=false;
  const owner='100000000000000002',staff='100000000000000003';c.permissionGroups.owner=[owner];c.permissionGroups.staff=[staff];
  const roles=new Collection([[owner,{id:owner,name:'Owner',managed:false,position:200}],[staff,{id:staff,name:'Staff',managed:false,position:50}]]);
  const guild={id:c.community.guildId,members:{fetchMe:async()=>({roles:{highest:{position:100}},permissions:{has:()=>true}})},roles:{fetch:async()=>roles},channels:{fetch:async()=>new Collection()}} as unknown as Guild;
  let errors=await validateDiscord(c,guild);assert(!errors.some(e=>e.includes('Role Owner')));assert(!errors.some(e=>e.includes('Role Staff')));
  roles.get(staff)!.position=150;errors=await validateDiscord(c,guild);assert(errors.some(e=>e.includes('Role Staff')));
  roles.delete(owner);errors=await validateDiscord(c,guild);assert(errors.some(e=>e===`Missing role ${owner}`));
});

test('initial setup reuses existing Owner membership without attempting to assign that higher role',async()=>{
  const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));
  const owner='100000000000000002',actor='100000000000000003',text='100000000000000004';
  for(const k of Object.keys(c.modules) as (keyof typeof c.modules)[])c.modules[k]=false;
  for(const k of Object.keys(c.permissionGroups) as (keyof typeof c.permissionGroups)[])c.permissionGroups[k]=[owner];
  for(const k of Object.keys(c.channels) as (keyof typeof c.channels)[])c.channels[k]=text;
  let grants=0;
  const guild={members:{me:{id:text},fetch:async()=>({roles:{cache:new Collection([[owner,{}]]),add:async()=>{grants++;throw new Error('Role above bot');}}})}} as unknown as Guild;
  await provision(new ConfigFile('unused-existing-config',c),guild,actor,true);assert.equal(grants,0);
});
