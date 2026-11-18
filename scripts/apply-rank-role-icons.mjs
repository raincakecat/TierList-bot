import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {REST,Routes} from 'discord.js';

const apply=process.argv.includes('--apply');
const config=JSON.parse(await readFile(process.env.MAIN_CONFIG??'data/configs/crystal-consolidated.json','utf8'));
const guild=config.community.guildId;
if(!guild||!process.env.DISCORD_TOKEN)throw Error('Main guild configuration and DISCORD_TOKEN are required.');
const ranks=['HT1','LT1','HT2','LT2','HT3','LT3'];
const modes=config.gameModes.length?config.gameModes:[{key:'crystal',tierRoleIds:config.tierRoleIds}];
const targets=new Map();
for(const mode of modes)for(const rank of ranks){
  const id=mode.tierRoleIds[rank];if(!id||targets.has(id))throw Error(`Missing or duplicate ${mode.key} ${rank} role`);
  targets.set(id,{mode:mode.key,rank});
}
const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
const roles=await rest.get(Routes.guildRoles(guild));
const byId=new Map(roles.map(role=>[role.id,role]));
for(const [id,{mode,rank}] of targets){const role=byId.get(id);if(!role||role.managed)throw Error(`Unavailable ${mode} ${rank} role: ${id}`);}
const untargeted=modes.flatMap(mode=>['HT4','LT4','HT5','LT5'].map(rank=>({mode:mode.key,rank,id:mode.tierRoleIds[rank]})));
for(const item of untargeted)if(!item.id||!byId.has(item.id))throw Error(`Unavailable ${item.mode} ${item.rank} role`);
const icons=Object.fromEntries(await Promise.all(ranks.map(async rank=>[rank,await readFile(`branding/role-icons/${rank}.png`)])));
for(const [rank,buffer] of Object.entries(icons))if(buffer.length>256*1024||buffer.subarray(1,4).toString()!=='PNG')throw Error(`Invalid ${rank} PNG`);
const snapshot={at:new Date().toISOString(),guild,roles:[...targets.keys(),...untargeted.map(x=>x.id)].map(id=>{const role=byId.get(id);return {id,name:role.name,color:role.color,position:role.position,icon:role.icon??null};})};
console.log(JSON.stringify({guild,rankedRoles:targets.size,withoutIcons:untargeted.length,existingIcons:snapshot.roles.filter(x=>x.icon).length,apply}));
if(!apply)process.exit(0);
await mkdir('data/role-icon-backups',{recursive:true});
const stamp=new Date().toISOString().replaceAll(':','-');
await writeFile(`data/role-icon-backups/${stamp}.json`,JSON.stringify(snapshot,null,2)+'\n',{mode:0o600});
for(const role of snapshot.roles.filter(x=>x.icon)){
  const url=`https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.png?size=64`;
  const response=await fetch(url);if(!response.ok)throw Error(`Cannot back up icon for ${role.name}: ${response.status}`);
  await writeFile(`data/role-icon-backups/${stamp}-${role.id}.png`,Buffer.from(await response.arrayBuffer()),{mode:0o600});
}
let changed=0;
for(const [id,{mode,rank}] of targets){
  const role=byId.get(id),old=role.icon;
  if(old){const response=await fetch(`https://cdn.discordapp.com/role-icons/${id}/${old}.png?size=64`);if(response.ok&&Buffer.from(await response.arrayBuffer()).equals(icons[rank]))continue;}
  const icon=`data:image/png;base64,${icons[rank].toString('base64')}`;
  await rest.patch(Routes.guildRole(guild,id),{body:{icon},reason:`TierList ${mode} ${rank} trophy icon`});
  changed++;console.log(`Set ${mode} ${rank}`);
}
for(const {mode,rank,id} of untargeted)if(byId.get(id).icon){await rest.patch(Routes.guildRole(guild,id),{body:{icon:null},reason:`TierList ${mode} ${rank} has no trophy icon`});changed++;console.log(`Cleared ${mode} ${rank}`);}
const verified=new Map((await rest.get(Routes.guildRoles(guild))).map(role=>[role.id,role]));
const missing=[...targets].filter(([id])=>!verified.get(id)?.icon);
const unexpected=untargeted.filter(x=>verified.get(x.id)?.icon);
if(missing.length||unexpected.length)throw Error(`Verification failed: ${missing.length} missing and ${unexpected.length} unexpected icons`);
console.log(JSON.stringify({changed,verifiedRanked:targets.size,verifiedWithoutIcons:untargeted.length}));
