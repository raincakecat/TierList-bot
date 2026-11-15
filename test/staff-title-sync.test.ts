import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configSchema} from '../src/config.js';
import {StaffTitleSync} from '../src/discord/staff-title-sync.js';
import {emptyState} from '../src/domain/types.js';
import {MemoryAdapter,Store} from '../src/storage/store.js';
import type {GuildMember} from 'discord.js';

const G='100000000000000001',USER='100000000000000002',STAFF='100000000000000003',HIGH='100000000000000004',MOD='100000000000000005',MANAGER='100000000000000006';
test('staff titles grant shared roles and remove only bot-granted access',async()=>{
  const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));c.permissionGroups.staff=[STAFF];c.permissionGroups.highStaff=[HIGH];c.staffTitles={staffRoleIds:[MOD],highStaffRoleIds:[MANAGER]};
  const store=new Store(new MemoryAdapter(emptyState(G))),held=new Set([MOD]);
  const member={id:USER,roles:{cache:{has:(id:string)=>held.has(id)},add:async(id:string)=>{held.add(id);},remove:async(id:string)=>{held.delete(id);}}} as unknown as GuildMember;
  const sync=new StaffTitleSync(store,()=>c);await sync.sync(member);assert(held.has(STAFF));assert(!held.has(HIGH));
  held.add(MANAGER);await sync.sync(member);assert(held.has(HIGH));held.delete(MANAGER);await sync.sync(member);assert(!held.has(HIGH));assert(held.has(STAFF));
  held.delete(MOD);await sync.sync(member);assert(!held.has(STAFF));
  held.add(STAFF);held.add(MOD);await sync.sync(member);held.delete(MOD);await sync.sync(member);assert(held.has(STAFF));
});
