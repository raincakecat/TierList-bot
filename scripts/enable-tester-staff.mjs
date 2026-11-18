import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {REST,Routes} from 'discord.js';

const apply=process.argv.includes('--apply');
const mainPath=process.env.MAIN_CONFIG??'config.json';
const supportPath=process.env.SUPPORT_CONFIG??'data/configs/support.json';
const main=JSON.parse(await readFile(mainPath,'utf8'));
const support=JSON.parse(await readFile(supportPath,'utf8'));
if(main.community.guildId===support.community.guildId||support.roleSync?.sourceGuildId!==main.community.guildId)throw Error('Expected the configured main and support guilds.');
const testerSources=new Set([...main.testerUmbrellaRoleIds,...main.gameModes.flatMap(mode=>mode.testerRoleIds)]);
if(testerSources.size<main.gameModes.length+1)throw Error('Expected distinct mode and umbrella tester roles.');
const testerMappings=support.roleSync.mappings.filter(rule=>testerSources.has(rule.sourceRoleId));
if(testerMappings.length!==testerSources.size)throw Error(`Only ${testerMappings.length}/${testerSources.size} tester roles are mapped to support.`);
const supportTesters=new Set(testerMappings.map(rule=>rule.targetRoleId));
if(supportTesters.size!==testerSources.size)throw Error('Support tester mappings overlap.');
if(!main.permissionGroups.staff.length||!support.permissionGroups.staff.length)throw Error('Shared Staff roles are missing.');
const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
for(const [config,ids] of [[main,testerSources],[support,supportTesters]]){
  const roles=new Map((await rest.get(Routes.guildRoles(config.community.guildId))).map(role=>[role.id,role]));
  for(const id of ids)if(!roles.has(id))throw Error(`Tester role ${id} is missing in ${config.community.name}.`);
  if(!roles.has(config.permissionGroups.staff[0]))throw Error(`Staff role is missing in ${config.community.name}.`);
}
const changed=[];
for(const [config,ids] of [[main,testerSources],[support,supportTesters]]){
  const before=config.staffTitles.staffRoleIds;
  config.staffTitles.staffRoleIds=[...new Set([...before,...ids])];
  changed.push({guild:config.community.name,added:config.staffTitles.staffRoleIds.length-before.length,testerRoles:ids.size});
}
console.log(JSON.stringify({apply,changed}));
if(!apply)process.exit(0);
await mkdir('data/tester-staff-backups',{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-');
await copyFile(mainPath,`data/tester-staff-backups/${stamp}-main.json`);
await copyFile(supportPath,`data/tester-staff-backups/${stamp}-support.json`);
await writeFile(mainPath,JSON.stringify(main,null,2)+'\n',{mode:0o600});
await writeFile(supportPath,JSON.stringify(support,null,2)+'\n',{mode:0o600});
