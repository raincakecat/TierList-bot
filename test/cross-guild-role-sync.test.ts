import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import type {Client} from 'discord.js';
import {configSchema} from '../src/config.js';
import {CrossGuildRoleSync} from '../src/discord/cross-guild-role-sync.js';
import {emptyState} from '../src/domain/types.js';
import {MemoryAdapter,Store} from '../src/storage/store.js';

const SOURCE='100000000000000001',TARGET='100000000000000002',USER='100000000000000003',SOURCE_ROLE='100000000000000004',TARGET_ROLE='100000000000000005';
test('support roles mirror main-server roles and preserve manual grants',async()=>{
 const config=configSchema.parse(JSON.parse(await readFile('config.support.example.json','utf8')));config.community.guildId=TARGET;config.roleSync={sourceGuildId:SOURCE,mappings:[{sourceRoleId:SOURCE_ROLE,targetRoleId:TARGET_ROLE}]};
 const source=new Set<string>(),target=new Set<string>();let after=0;
 const member={id:USER,roles:{cache:{has:(id:string)=>target.has(id)},add:async(ids:string[])=>{ids.forEach(id=>target.add(id));},remove:async(ids:string[])=>{ids.forEach(id=>target.delete(id));}}};
 const sourceMember={id:USER,roles:{cache:{has:(id:string)=>source.has(id)}}};
 const client={guilds:{fetch:async(id:string)=>id===SOURCE?{members:{fetch:async()=>sourceMember}}:{members:{fetch:async()=>member}}}} as unknown as Client;
 const store=new Store(new MemoryAdapter(emptyState(TARGET))),sync=new CrossGuildRoleSync(client,store,()=>config,async()=>{after++;});
 source.add(SOURCE_ROLE);await sync.sync(USER);assert(target.has(TARGET_ROLE));assert.deepEqual((await store.read()).roleSyncGrants?.[USER],[TARGET_ROLE]);
 source.delete(SOURCE_ROLE);await sync.sync(USER);assert(!target.has(TARGET_ROLE));
 target.add(TARGET_ROLE);source.add(SOURCE_ROLE);await sync.sync(USER);source.delete(SOURCE_ROLE);await sync.sync(USER);assert(target.has(TARGET_ROLE));assert.equal(after,4);
});
