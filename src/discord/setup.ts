import { ChannelType, PermissionFlagsBits, type Guild } from 'discord.js';
import { ConfigFile, readiness, type Config } from '../config.js';
import { rolesFor } from '../domain/permissions.js';
import { GROUPS, REGIONS } from '../domain/types.js';

export function setupPreview(c:Config):string {
  const lines=['Setup will create missing resources, keep supplied IDs, and record each successful creation.'];
  for(const g of GROUPS)if(!c.permissionGroups[g].length)lines.push(`Role: ${g}`);
  if(c.modules.testing){for(const [tier,id]of Object.entries(c.tierRoleIds))if(!id)lines.push(`Role: ${tier}`);for(const r of REGIONS)if(c.regions[r].enabled){const v=c.regions[r];if(!v.regionRoleId)lines.push(`Role: ${r}`);if(!v.waitlistRoleId)lines.push(`Role: ${r} Waitlist`);if(!v.testCategoryId)lines.push(`Category: ${r} Testing (private)`);if(!v.queueChannelId)lines.push(`Channel: ${r} Queue (waitlist + staff)`);}if(!c.categories.highTests)lines.push('Category: High Tests (private)');}
  for(const [key,id]of Object.entries(c.channels))if(!id&&!(key==='quotaReports'&&!c.modules.testerQuotas)&&!(key==='verificationPanel'&&!c.modules.testing)&&!(key==='supportPanel'&&!c.modules.supportTickets))lines.push(`Channel: ${key}`);
  if(c.modules.tierLists)for(const [tier,id]of Object.entries(c.tierLists.channelIds))if(!id)lines.push(`Channel: ${tier} List`);
  if(c.modules.supportTickets)for(const t of c.supportTicketTypes.filter(t=>t.enabled)){if(!t.categoryId)lines.push(`Category: ${t.name} (type-based staff access)`);if(!t.archiveChannelId)lines.push(`Channel: ${t.name} Archives (type-based staff access)`);}
  lines.push('On first setup: assign the configured Owner role to the confirming administrator.');
  const unresolved=readiness(c).filter(e=>e.includes('Cooldown')||e.includes('monthlyTesterQuota'));if(unresolved.length)lines.push('Before enabling requests: '+unresolved.join('; '));return lines.join('\n');
}
export async function provision(file:ConfigFile,guild:Guild,actor:string,initial:boolean){
  let c=structuredClone(file.value);
  const save=async()=>{await file.save(c);c=structuredClone(file.value);};
  const role=async(name:string)=>{const r=await guild.roles.create({name,permissions:[],reason:'Confirmed bot setup'});return r.id;};
  const access=(roles:string[],publicView=false)=>[{id:guild.id,deny:publicView?[PermissionFlagsBits.SendMessages]:[PermissionFlagsBits.ViewChannel]},{id:guild.members.me!.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]},...roles.map(id=>({id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}))];
  const category=async(name:string,roles:string[])=> (await guild.channels.create({name,type:ChannelType.GuildCategory,permissionOverwrites:access(roles)})).id;
  const channel=async(name:string,roles:string[],parent?:string,publicView=false)=> (await guild.channels.create({name:name.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()).replace(/^-/,''),type:ChannelType.GuildText,parent,permissionOverwrites:access(roles,publicView)})).id;
  for(const g of GROUPS)if(!c.permissionGroups[g].length){c.permissionGroups[g]=[await role(g.replace(/([A-Z])/g,' $1'))];await save();}
  const owners=rolesFor(c,['owner']),admins=rolesFor(c,['owner','botAdmin']),staff=rolesFor(c,['owner','staff']);
  if(c.modules.testing){for(const tier of Object.keys(c.tierRoleIds) as (keyof Config['tierRoleIds'])[])if(!c.tierRoleIds[tier]){c.tierRoleIds[tier]=await role(tier);await save();}
    for(const r of REGIONS)if(c.regions[r].enabled){if(!c.regions[r].regionRoleId){c.regions[r].regionRoleId=await role(r);await save();}if(!c.regions[r].waitlistRoleId){c.regions[r].waitlistRoleId=await role(`${r} Waitlist`);await save();}const accessRoles=[...staff,c.regions[r].waitlistRoleId!];if(!c.regions[r].testCategoryId){c.regions[r].testCategoryId=await category(`${r} Testing`,accessRoles);await save();}if(!c.regions[r].queueChannelId){c.regions[r].queueChannelId=await channel(`${r.toLowerCase()}-queue`,accessRoles,c.regions[r].testCategoryId!);await save();}}
    if(!c.categories.highTests){c.categories.highTests=await category('High Tests',staff);await save();}
  }
  for(const key of Object.keys(c.channels) as (keyof Config['channels'])[]){if(c.channels[key]||(key==='quotaReports'&&!c.modules.testerQuotas)||(key==='verificationPanel'&&!c.modules.testing)||(key==='supportPanel'&&!c.modules.supportTickets))continue;
    const isPublic=['verificationPanel','supportPanel','results'].includes(key);const r=['operationalLog','botReview'].includes(key)?admins:staff;c.channels[key]=await channel(key,r,undefined,isPublic);await save();}
  if(c.modules.tierLists)for(const t of Object.keys(c.tierLists.channelIds) as (keyof Config['tierLists']['channelIds'])[])if(!c.tierLists.channelIds[t]){c.tierLists.channelIds[t]=await channel(`${t.toLowerCase()}-list`,owners,undefined,true);await save();}
  if(c.modules.supportTickets)for(const key of c.supportTicketTypes.filter(t=>t.enabled).map(t=>t.key)){let t=c.supportTicketTypes.find(t=>t.key===key)!;const r=rolesFor(c,[...t.accessGroups,'owner']);if(!t.categoryId){t.categoryId=await category(t.name,r);await save();}t=c.supportTicketTypes.find(t=>t.key===key)!;if(!t.archiveChannelId){t.archiveChannelId=await channel(`${key}-archives`,r);await save();}}
  if(initial){const member=await guild.members.fetch(actor);await member.roles.add(c.permissionGroups.owner[0]!,'Confirmed first setup');}
  return c;
}
export async function validateDiscord(c:Config,guild:Guild):Promise<string[]>{
  const errors=readiness(c),me=await guild.members.fetchMe(),roles=await guild.roles.fetch(),channels=await guild.channels.fetch();
  const roleIds=[...Object.values(c.permissionGroups).flat(),...Object.values(c.tierRoleIds),...REGIONS.filter(r=>c.regions[r].enabled).flatMap(r=>[c.regions[r].regionRoleId,c.regions[r].waitlistRoleId])].filter((x):x is string=>!!x);
  for(const id of new Set(roleIds)){const role=roles.get(id);if(!role)errors.push(`Missing role ${id}`);else if(role.managed||role.id===guild.id||role.position>=me.roles.highest.position)errors.push(`Role ${role.name} must be assignable and below the bot role`);}
  const textIds=[...Object.values(c.channels),...(c.modules.tierLists?Object.values(c.tierLists.channelIds):[]),...REGIONS.filter(r=>c.regions[r].enabled).map(r=>c.regions[r].queueChannelId),...c.supportTicketTypes.filter(t=>t.enabled).map(t=>t.archiveChannelId)].filter((x):x is string=>!!x);
  for(const id of new Set(textIds)){const ch=channels.get(id);if(!ch||ch.type!==ChannelType.GuildText)errors.push(`Missing text channel ${id}`);else if(!ch.permissionsFor(me).has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]))errors.push(`Missing read/send/archive permissions in ${ch.name}`);}
  for(const id of [c.categories.highTests,...c.categories.overflow,...REGIONS.filter(r=>c.regions[r].enabled).map(r=>c.regions[r].testCategoryId),...c.supportTicketTypes.filter(t=>t.enabled).map(t=>t.categoryId)].filter((x):x is string=>!!x))if(channels.get(id)?.type!==ChannelType.GuildCategory)errors.push(`Missing category ${id}`);
  if(!me.permissions.has([PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageRoles]))errors.push('Bot needs Manage Channels and Manage Roles');return [...new Set(errors)];
}
