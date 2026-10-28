import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { Config } from '../config.js';
import type { Region, State } from '../domain/types.js';
import { paginateLines } from './pages.js';

export function queuePanels(c:Config,s:State,r:Region){
  const testers=Object.keys(s.testers).filter(id=>s.testers[id]===r),queue=s.queues[r];
  const open=testers.length>0&&!s.maintenance,last=s.lastTestingSession?.[r];
  const lines=open?['Use `/leave` if you wish to be removed from the waitlist or queue.','**Queue**',
    ...(queue.length?queue.map((id,i)=>`${i+1}. <@${id}>`):['Empty']),'','**Testers**',...testers.map((id,i)=>`${i+1}. <@${id}>`) ]
    :s.maintenance?['Testing is temporarily paused.','Please check back later.']
    :['No testers for your region are available at this time.','You will be pinged when a tester is available.','Check back later!'];
  const pages=paginateLines(lines);
  return pages.map((description,page)=>{
    const embed=new EmbedBuilder().setAuthor({name:c.community.name,...(c.branding.iconUrl?{iconURL:c.branding.iconUrl}:{})})
      .setTitle((open?'Tester(s) Available!':s.maintenance?'Testing Paused':'No Testers Online')+(pages.length>1?` (${page+1}/${pages.length})`:''))
      .setDescription(description).setColor(c.branding.colors.panel as `#${string}`);
    if(!open)embed.addFields({name:'Last testing session',value:last?`<t:${Math.floor(last/1000)}:f>`:'Not recorded yet.'});
    return {embeds:[embed],components:open&&!page?[new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`join:${r}`).setLabel('Join Queue').setStyle(ButtonStyle.Primary))]:[]};
  });
}
