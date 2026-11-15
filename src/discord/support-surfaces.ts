import {EmbedBuilder} from 'discord.js';
import type {Config} from '../config.js';

export function supportPanelEmbed(config:Config,logoUrl?:string){
  const embed=new EmbedBuilder()
    .setColor(config.branding.colors.panel as `#${string}`)
    .setTitle('Open a support ticket')
    .setDescription('Choose what you need help with below.')
    .addFields(
      {name:'Help & reports',value:'**General Support** · Questions or issues\n**Player Report** · Report a player',inline:false},
      {name:'Appeals & partnerships',value:'**Staff Report** · Report a staff member\n**Restriction Appeal** · Appeal a restriction\n**Partnership Request** · Ask about a partnership',inline:false},
    )
    .setFooter({text:'One ticket per issue  •  Add screenshots if you have them'});
  if(logoUrl)embed.setThumbnail(logoUrl);
  return embed;
}

export function supportGuideEmbed(config:Config,panelChannelId:string,logoUrl?:string){
  const embed=new EmbedBuilder()
    .setColor(config.branding.colors.panel as `#${string}`)
    .setTitle('Lunar Support')
    .setDescription(`Need help? Open a ticket in <#${panelChannelId}>.`)
    .addFields(
      {name:'01  ·  General Support',value:'Questions or issues with the server.',inline:false},
      {name:'02  ·  Player Report',value:'Report a player. Include their name and any proof you have.',inline:false},
      {name:'03  ·  Staff Report',value:'Report a staff member.',inline:false},
      {name:'04  ·  Restriction Appeal',value:'Appeal a restriction. Tell us why it should be reviewed.',inline:false},
      {name:'05  ·  Partnership Request',value:'Ask about a partnership with Lunar Tiers.',inline:false},
    )
    .setFooter({text:'Open one ticket per issue  •  Add screenshots if you have them'});
  if(logoUrl)embed.setThumbnail(logoUrl);
  return embed;
}
