import {EmbedBuilder,PermissionFlagsBits,type TextChannel} from 'discord.js';
import type {Config} from '../config.js';
import type {State} from '../domain/types.js';

export function cooldownSummary(s:State,c:Config,id:string,now=Date.now()):string{
  const modes=c.gameModes.length?c.gameModes.map(m=>({key:m.key,name:m.name})):[{key:s.defaultModeId??'crystal',name:'Crystal'}];
  return modes.map(m=>{const p=m.key===(s.defaultModeId??'crystal')?s.players[id]:s.modes?.[m.key]?.players[id],until=p?.cooldownUntil??0;return `**${m.name}:** ${until>now?`Available <t:${Math.floor(until/1000)}:R> (<t:${Math.floor(until/1000)}:f>)`:'No active cooldown'}`;}).join('\n');
}

export function dashboardEmbed(s:State,c:Config):EmbedBuilder{
  const active=Object.values(s.tickets).filter(t=>t.status!=='closed'),testing=active.filter(t=>t.type==='test').length;
  const modes=c.gameModes.length?c.gameModes.map(m=>({key:m.key,name:m.name})):[{key:s.defaultModeId??'crystal',name:'Crystal'}];
  const queues=modes.map(m=>{const q=(m.key===(s.defaultModeId??'crystal')?s.queues:s.modes?.[m.key]?.queues)??{NA:[],EU:[],AS:[]},t=Object.keys(s.testers).filter(id=>(s.testerModes?.[id]??s.defaultModeId??'crystal')===m.key);return `**${m.name}** · NA ${q.NA.length} · EU ${q.EU.length} · AS/AU ${q.AS.length} · Testers ${t.length}`;});
  const pending=Object.values(s.leaves??{}).filter(l=>l.status==='pending').length,jobs=Object.values(s.jobs),retry=jobs.filter(j=>j.status==='pending'&&j.attempts>0).length;
  return new EmbedBuilder().setTitle('Staff Dashboard').setColor(c.branding.colors.panel as `#${string}`).setDescription(`**Open tickets**\nTesting: ${testing} · Support: ${active.length-testing}\n\n**Queues and active testers**\n${queues.join('\n')}\n\n**Needs attention**\nPending LOA requests: ${pending}\nRetrying bot operations: ${retry}${s.maintenance?'\nMaintenance is enabled.':''}`).setFooter({text:'Updates about once a minute • Counts only'});
}

export function dashboardChannelSafe(channel:TextChannel,c:Config,botId:string):boolean{
  const allowed=new Set([...c.permissionGroups.staff,...c.permissionGroups.highStaff]);
  if(channel.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))return false;
  for(const entry of channel.permissionOverwrites.cache.values())if(entry.allow.has(PermissionFlagsBits.ViewChannel)&&entry.id!==botId&&!allowed.has(entry.id))return false;
  return true;
}
