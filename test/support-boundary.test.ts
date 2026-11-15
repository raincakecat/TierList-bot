import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,type Player} from '../src/domain/types.js';
import {MemoryAdapter,Store} from '../src/storage/store.js';
import {SharedDeployment} from '../src/storage/deployment.js';
import {ConfigFile} from '../src/config.js';
import {commandDefinitions} from '../src/discord/commands.js';
import {allowed,rolesFor} from '../src/domain/permissions.js';

const MAIN='100000000000000001',SUPPORT='100000000000000002',USER='100000000000000003';
const player=(tier:Player['tier']):Player=>({id:USER,tier,uuid:'a'.repeat(32),ign:'Player',region:'NA',preferredServer:'server',waitlist:false,cooldownUntil:44});
test('staff reports can exclude Overseer while normal support pings Ticket Support',async()=>{const file=await ConfigFile.load('config.support.example.json'),c=file.value;const overseer='100000000000000010',manager='100000000000000011',ticketSupport='100000000000000012';c.permissionGroups.highStaff=[overseer];c.permissionGroups.managerPlus=[manager];c.permissionGroups.ticketSupport=[ticketSupport];const report=c.supportTicketTypes.find(t=>t.key==='staff-report')!,general=c.supportTicketTypes.find(t=>t.key==='general-support')!;report.accessGroups=['managerPlus'];general.openingPingGroups=['ticketSupport'];assert.equal(allowed(c,{id:USER,roles:[overseer],administrator:false},'managerPlus'),false);assert.equal(allowed(c,{id:USER,roles:[manager],administrator:false},'managerPlus'),true);assert.deepEqual(rolesFor(c,general.openingPingGroups),[ticketSupport]);});
test('support unrestriction updates only Crystal ranks and records both audit trails',async()=>{
  const root=emptyState(MAIN),support=emptyState(SUPPORT);root.initialized=support.initialized=true;root.players[USER]=player('HT3');root.modes={sword:{players:{[USER]:player('LT2')},queues:{NA:[],EU:[],AS:[]},lists:{}}};root.restrictions=[{id:'restriction',playerId:USER,uuid:'a'.repeat(32),reason:'reason',until:null,actor:'moderator',previousTier:'LT3',previousTiers:{crystal:'LT3',sword:'HT2'}}];root.servers={[SUPPORT]:support};
  const store=new Store(new MemoryAdapter(root)),deployment=new SharedDeployment(store);await deployment.unrestrictFromSupport(MAIN,SUPPORT,'reviewer',USER);const result=await store.read(false);
  assert.deepEqual(result.restrictions,[]);assert.equal(result.players[USER]!.tier,'LT3');assert.equal(result.modes!.sword!.players[USER]!.tier,'HT2');assert.equal(result.players[USER]!.cooldownUntil,44);
  assert.equal(result.audit.at(-1)!.actor,'reviewer');assert.equal(result.servers![SUPPORT]!.audit.at(-1)!.actor,'reviewer');assert(Object.values(result.jobs).some(j=>j.data.modeId==='sword'));
  await assert.rejects(deployment.unrestrictFromSupport(MAIN,SUPPORT,'reviewer',USER),/No restriction/);
});

test('support Regulator can migrate one selected mode and Partnership Manager cannot',async()=>{
  const main=await ConfigFile.load('config.consolidated.example.json'),support=await ConfigFile.load('config.support.example.json');
  main.value.community.guildId=MAIN;main.value.permissionGroups.regulator=['100000000000000011'];
  support.value.community.guildId=SUPPORT;support.value.supportTargetGuildId=MAIN;support.value.permissionGroups.regulator=['100000000000000012'];support.value.permissionGroups.partnershipManager=['100000000000000013'];
  const root=emptyState(MAIN),other=emptyState(SUPPORT);root.initialized=other.initialized=true;root.defaultModeId='crystal';root.players[USER]=player('HT3');root.modes={sword:{players:{[USER]:player('LT3')},queues:{NA:[],EU:[],AS:[]},lists:{}}};root.servers={[SUPPORT]:other};
  const store=new Store(new MemoryAdapter(root)),deployment=new SharedDeployment(store,[main,support]);
  const member={id:'100000000000000014',roles:['100000000000000012'],administrator:false};
  await deployment.migrateFromSupport(MAIN,SUPPORT,member,USER,'sword','LT2','EU',undefined,'Previous tier list');
  const result=await store.read(false);assert.equal(result.modes!.sword!.players[USER]!.tier,'LT2');assert.equal(result.players[USER]!.tier,'HT3');assert.equal(result.players[USER]!.region,'EU');
  const job=Object.values(result.jobs).find(j=>j.kind==='result'&&j.data.modeId==='sword');assert.equal(job?.data.migration,true);assert.equal(job?.data.source,'Previous tier list');assert.equal(result.audit.at(-1)?.actor,member.id);
  await assert.rejects(deployment.migrateFromSupport(MAIN,SUPPORT,{...member,roles:['100000000000000013']},USER,'sword','HT2','EU',undefined,'Previous tier list'),/permission/);
  const command=commandDefinitions(support.value).find(c=>c.name==='migrate');assert(command);assert(command.options?.some(o=>o.name==='mode'&&o.required));
});

test('profiles in either server list every configured game mode',async()=>{
 const main=await ConfigFile.load('config.consolidated.example.json'),support=await ConfigFile.load('config.support.example.json');main.value.community.guildId=MAIN;support.value.community.guildId=SUPPORT;
 const root=emptyState(MAIN);root.defaultModeId='crystal';root.players[USER]=player('HT3');root.modes={sword:{players:{[USER]:player('LT2')},queues:{NA:[],EU:[],AS:[]},lists:{}}};
 const deployment=new SharedDeployment(new Store(new MemoryAdapter(root)),[main,support]),profile=await deployment.profileRanks(MAIN,USER);
 assert.equal(profile.player?.ign,'Player');assert.equal(profile.ranks.length,main.value.gameModes.length);assert.equal(profile.ranks.find(rank=>rank.name==='Crystal')?.tier,'HT3');assert.equal(profile.ranks.find(rank=>rank.name==='Sword')?.tier,'LT2');assert.equal(profile.ranks.find(rank=>rank.name==='Axe')?.tier,'Unranked');
});
