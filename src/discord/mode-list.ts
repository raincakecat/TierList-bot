import {EmbedBuilder} from 'discord.js';
import type {Config} from '../config.js';
import type {State} from '../domain/types.js';
import {paginateLines} from './pages.js';

export function modeListPanels(c:Config,s:State,names:Map<string,string>){
  const lines:string[]=[];
  for(const [region,label]of [['NA','North America · NA'],['EU','Europe · EU'],['AS','Asia / Australia · AS/AU']] as const){
    if(!c.regions[region].enabled)continue;lines.push(`**${label}**`);let count=0;
    for(const tier of ['HT3','LT2','HT2','LT1'] as const){const ids=[...new Set(s.lists[tier]?.[region]??[])];ids.sort((a,b)=>(names.get(a)??a).localeCompare(names.get(b)??b)||a.localeCompare(b));for(const id of ids){lines.push(`<@${id}> · \`${tier}\``);count++;}}
    if(!count)lines.push('No players listed.');lines.push('');
  }
  const pages=paginateLines(lines,3600);
  return pages.map((description,page)=>({embeds:[new EmbedBuilder().setTitle(`${c.activeMode?.name??'Crystal'} High List${pages.length>1?` · ${page+1}/${pages.length}`:''}`).setDescription(description).setColor(c.branding.colors.panel as `#${string}`).setFooter({text:'HT3 → LT2 → HT2 → LT1 · Updated automatically'})],allowedMentions:{parse:[] as []}}));
}
