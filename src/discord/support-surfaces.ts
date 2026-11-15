import {EmbedBuilder} from 'discord.js';
import type {Config} from '../config.js';

export function supportPanelEmbed(config:Config,logoUrl?:string){
  const embed=new EmbedBuilder()
    .setColor(config.branding.colors.panel as `#${string}`)
    .setTitle('Open a support ticket')
    .setDescription('Choose the button that best fits your issue. Your ticket opens privately with the team that handles it.')
    .addFields(
      {name:'Help & reports',value:'**General Support** · Account or server help\n**Player Report** · Report a player',inline:false},
      {name:'Private reviews',value:'**Staff Report** · Report staff conduct\n**Restriction Appeal** · Ask for a restriction review',inline:false},
      {name:'Partnerships',value:'**Partnership Request** · Discuss working with Lunar Tiers',inline:false},
    )
    .setFooter({text:'One ticket per issue  •  Include relevant screenshots or links'});
  if(logoUrl)embed.setThumbnail(logoUrl);
  return embed;
}

export function supportGuideEmbed(config:Config,panelChannelId:string,logoUrl?:string){
  const embed=new EmbedBuilder()
    .setColor(config.branding.colors.panel as `#${string}`)
    .setTitle('Your guide to Lunar Support')
    .setDescription(`Start in <#${panelChannelId}>. Pick one ticket type and tell us what happened. Your conversation stays in a private ticket with the appropriate team.`)
    .addFields(
      {name:'01  ·  General Support',value:'Questions about your account or the server. A Staff member will help.',inline:false},
      {name:'02  ·  Player Report',value:'Report a player. Include names, what happened, and any evidence. Regulator and above handle these reports.',inline:false},
      {name:'03  ·  Staff Report',value:'Report staff conduct. High Staff review these tickets privately.',inline:false},
      {name:'04  ·  Restriction Appeal',value:'Ask High Staff to review a testing restriction. Explain the decision you are appealing and why.',inline:false},
      {name:'05  ·  Partnership Request',value:'Propose a partnership. Share your community, what you have in mind, and a contact. The Partnership Manager handles these.',inline:false},
    )
    .setFooter({text:'Open one ticket per issue  •  Add screenshots or links when useful'});
  if(logoUrl)embed.setThumbnail(logoUrl);
  return embed;
}
