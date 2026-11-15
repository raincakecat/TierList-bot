import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PermissionFlagsBits} from 'discord.js';
import {configSchema} from '../src/config.js';
import {emptyState} from '../src/domain/types.js';
import {cooldownSummary,dashboardEmbed,dashboardChannelSafe} from '../src/discord/staff-dashboard.js';

test('cooldown and dashboard keep game modes separate and contain counts only',async()=>{
  const raw=JSON.parse(await readFile('config.multimode.example.json','utf8')),c=configSchema.parse(raw),s=emptyState('123456789012345678');
  const [first,second]=c.gameModes;s.defaultModeId=first!.key;
  s.players.u={id:'u',tier:'LT3',uuid:null,ign:null,region:null,preferredServer:null,waitlist:false,cooldownUntil:200000};
  s.modes={[second!.key]:{players:{u:{...s.players.u,cooldownUntil:0}},queues:{NA:['u'],EU:[],AS:[]},lists:{}}};
  s.testers={u:'NA'};s.testerModes={u:second!.key};
  const text=cooldownSummary(s,c,'u',100000);assert.match(text,/<t:200:R>/);assert.match(text,/No active cooldown/);
  const embed=dashboardEmbed(s,c).toJSON();assert.match(embed.description!,/NA 1/);assert.match(embed.description!,/Testers 1/);assert.doesNotMatch(embed.description!,/<@/);assert.ok(embed.description!.length<4096);
});
test('dashboard rejects public or extra role visibility',async()=>{
  const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));c.permissionGroups.staff=['staff'];c.permissionGroups.highStaff=['high'];
  const channel:any={guild:{roles:{everyone:{}}},permissionsFor:()=>({has:()=>false}),permissionOverwrites:{cache:new Map([['staff',{id:'staff',allow:{has:(p:bigint)=>p===PermissionFlagsBits.ViewChannel}}]])}};
  assert.equal(dashboardChannelSafe(channel,c,'bot'),true);channel.permissionOverwrites.cache.set('other',{id:'other',allow:{has:()=>true}});assert.equal(dashboardChannelSafe(channel,c,'bot'),false);
  channel.permissionOverwrites.cache.delete('other');channel.permissionsFor=()=>({has:()=>true});assert.equal(dashboardChannelSafe(channel,c,'bot'),false);
});
