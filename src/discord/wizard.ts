import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { configSchema, milliseconds, readiness, type Config } from '../config.js';
import { allowed } from '../domain/permissions.js';
import { GROUPS, REGIONS, UserError, type Actor, type State } from '../domain/types.js';

export interface Resource {path:string;label:string;array:boolean}
export function wizardResources(c:Config):Resource[]{
  const out:Resource[]=[];const add=(path:string,label:string,array=false)=>out.push({path,label,array});
  for(const group of GROUPS)add(`permissionGroups.${group}`,`Role group: ${group}`,true);
  for(const tier of Object.keys(c.tierRoleIds))add(`tierRoleIds.${tier}`,`Tier role: ${tier}`);
  for(const region of REGIONS)for(const field of ['regionRoleId','waitlistRoleId','queueChannelId','testCategoryId'])add(`regions.${region}.${field}`,`${region}: ${field}`);
  for(const channel of Object.keys(c.channels))add(`channels.${channel}`,`Channel: ${channel}`);
  add('loa.roleId','Role: LOA');
  add('categories.highTests','Category: High Tests');add('categories.overflow','Categories: Overflow',true);
  for(const tier of Object.keys(c.tierLists.channelIds))add(`tierLists.channelIds.${tier}`,`List channel: ${tier}`);
  c.supportTicketTypes.forEach((t,index)=>{add(`supportTicketTypes.${index}.categoryId`,`${t.name}: category`);add(`supportTicketTypes.${index}.archiveChannelId`,`${t.name}: archive`);});
  return out;
}
function get(c:Config,path:string):unknown{return path.split('.').reduce<unknown>((object,key)=>(object as Record<string,unknown>)[key],c);}
function set(c:Config,path:string,value:unknown){const parts=path.split('.'),key=parts.pop()!;const object=parts.reduce<unknown>((object,key)=>(object as Record<string,unknown>)[key],c) as Record<string,unknown>;object[key]=value;}
export function requireWizard(c:Config,a:Actor,state:Pick<State,'initialized'>){if(state.initialized){if(!allowed(c,a,'owner'))throw new UserError('Owner permission is required.');}else if(!a.administrator)throw new UserError('Discord Administrator permission is required.');}
export function wizardPolicy(c:Config):string[]{return readiness(c).filter(e=>!e.endsWith('is not configured')||e.includes('Cooldown')||e.includes('monthlyTesterQuota')||e==='community.guildId is not configured');}
export interface Session {id:string;actor:string;expires:number;fingerprint:string;draft:Config;resourcePage:number;view:'home'|'features'|'resources';revision:number}
export class WizardSessions {
  private sessions=new Map<string,Session>();
  constructor(private clock=Date.now){}
  create(c:Config,a:Actor,s:Pick<State,'initialized'>){requireWizard(c,a,s);this.prune();const session:Session={id:randomUUID(),actor:a.id,expires:this.clock()+900_000,fingerprint:JSON.stringify(c),draft:structuredClone(c),resourcePage:0,view:'home',revision:0};this.sessions.set(session.id,session);return session;}
  find(id:string,a:Actor,c:Config,s:Pick<State,'initialized'>){requireWizard(c,a,s);const session=this.sessions.get(id);if(!session||session.actor!==a.id||session.expires<this.clock())throw new UserError('This setup wizard has expired or belongs to another operator.');if(session.fingerprint!==JSON.stringify(c))throw new UserError('Configuration changed. Start a new /setup wizard.');return session;}
  remove(id:string){this.sessions.delete(id);}
  prune(){for(const [id,s]of this.sessions)if(s.expires<this.clock())this.sessions.delete(id);}
  edit(session:Session,action:string,fields:Record<string,string>){const c=structuredClone(session.draft);
    if(action==='community'){c.community.name=fields.name!.trim();c.community.timezone=fields.timezone!.trim();}
    else if(action==='policy'){milliseconds(fields.normal!);milliseconds(fields.high!);const quota=fields.quota!.trim(),capacity=Number(fields.capacity);if(!/^(0|[1-9]\d*)$/.test(quota))throw new UserError('Quota must be a whole number; 0 disables quotas.');c.testing.normalCooldown=fields.normal!;c.testing.highCooldown=fields.high!;c.testing.queueCapacityPerRegion=capacity;c.testing.monthlyTesterQuota=Number(quota)||null;c.modules.testerQuotas=Number(quota)>0;}
    else if(action.startsWith('map-')){const index=Number(action.slice(4)),resource=wizardResources(c)[index];if(!resource)throw new UserError('Invalid resource mapping.');const input=fields.ids!.trim(),ids=input?input.split(',').map(x=>x.trim()):[];if(ids.some(id=>!/^\d{17,20}$/.test(id)))throw new UserError('Use Discord IDs separated by commas, or leave blank to create missing resources.');if(!resource.array&&ids.length>1)throw new UserError('Choose one ID for this resource.');set(c,resource.path,resource.array?[...new Set(ids)]:ids[0]??null);}
    else throw new UserError('Unknown wizard form.');
    const parsed=configSchema.safeParse(c);if(!parsed.success)throw new UserError('Check the form values: use a valid timezone, name, numeric capacity (1-1000), and IDs.');session.draft=parsed.data;session.revision++;
  }
  select(session:Session,action:string,values:string[]){const c=structuredClone(session.draft);
    if(action==='regions'){if(values.some(x=>!REGIONS.includes(x as 'NA')))throw new UserError('Unknown region.');for(const r of REGIONS)c.regions[r].enabled=values.includes(r);}
    else if(action==='modules'){if(values.some(x=>!Object.hasOwn(c.modules,x)))throw new UserError('Unknown feature.');for(const key of Object.keys(c.modules) as (keyof Config['modules'])[])c.modules[key]=values.includes(key);}
    else throw new UserError('Unknown wizard selection.');session.draft=configSchema.parse(c);session.revision++;
  }
}
const button=(s:Session,action:string,label:string,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(`wizard:${s.id}:${action}`).setLabel(label).setStyle(style);
export function wizardView(s:Session){const c=s.draft,embed=new EmbedBuilder().setTitle('Discord Setup Wizard').setColor(c.branding.colors.panel as `#${string}`).setDescription(`Draft only - nothing is saved until you review and confirm.\nCommunity: ${c.community.name}\nTimezone: ${c.community.timezone}\nRegions: ${REGIONS.filter(r=>c.regions[r].enabled).join(', ')||'none'}\nFeatures: ${Object.entries(c.modules).filter(([,on])=>on).map(([key])=>key).join(', ')||'none'}\nNormal/high cooldown: ${c.testing.normalCooldown??'choose'} / ${c.testing.highCooldown??'choose'}\nMonthly quota: ${c.testing.monthlyTesterQuota??'disabled'}\nQueue capacity: ${c.testing.queueCapacityPerRegion}\n\nBlank resource mappings mean create missing resources. Database credentials and the initial server ID stay on the host. Session expires 15 minutes after opening.`);
  const rows:(ActionRowBuilder<ButtonBuilder>|ActionRowBuilder<StringSelectMenuBuilder>)[]=[new ActionRowBuilder<ButtonBuilder>().addComponents(button(s,'community','Community'),button(s,'features','Features / Regions'),button(s,'policy','Cooldowns / Quota'),button(s,'resources','Resources'),button(s,'review','Review',ButtonStyle.Primary))];
  if(s.view==='features'){
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`wizard:${s.id}:regions`).setPlaceholder('Enabled regions').setMinValues(0).setMaxValues(3).addOptions(REGIONS.map(r=>({label:r,value:r,default:c.regions[r].enabled})))));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`wizard:${s.id}:modules`).setPlaceholder('Enabled features').setMinValues(0).setMaxValues(Object.keys(c.modules).length).addOptions(Object.entries(c.modules).map(([key,on])=>({label:key,value:key,default:on})))));
  }
  if(s.view==='resources'){const resources=wizardResources(c),pages=Math.ceil(resources.length/25);s.resourcePage=Math.max(0,Math.min(pages-1,s.resourcePage));const slice=resources.slice(s.resourcePage*25,s.resourcePage*25+25);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`wizard:${s.id}:mapping`).setPlaceholder(`Resource mappings (${s.resourcePage+1}/${pages})`).addOptions(slice.map((r,index)=>({label:r.label.slice(0,100),value:String(s.resourcePage*25+index),description:String(get(c,r.path)??'Create missing').slice(0,100)||'Create missing'})))));
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button(s,'prev','Previous').setDisabled(s.resourcePage===0),button(s,'next','Next').setDisabled(s.resourcePage===pages-1)));
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(button(s,'cancel','Cancel')));return {embeds:[embed],components:rows,allowedMentions:{parse:[] as never[]}};
}
export function wizardModal(s:Session,action:string){const modal=new ModalBuilder().setCustomId(`wizard:${s.id}:${action}`).setTitle(action.startsWith('map-')?'Resource Mapping':'Setup Settings');const field=(id:string,label:string,value:string,max=100,required=true)=>{const input=new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);if(value)input.setValue(value);return modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));};
  if(action==='community'){field('name','Community name',s.draft.community.name);field('timezone','Timezone (example: America/New_York)',s.draft.community.timezone);}
  else if(action==='policy'){field('normal','Normal cooldown: 0, 30m, 3h, or 7d',s.draft.testing.normalCooldown??'');field('high','High cooldown: 0, 30m, 3h, or 7d',s.draft.testing.highCooldown??'');field('quota','Monthly quota: 0 disables it',String(s.draft.testing.monthlyTesterQuota??0));field('capacity','Queue capacity per region (1-1000)',String(s.draft.testing.queueCapacityPerRegion));}
  else{const r=wizardResources(s.draft)[Number(action.slice(4))];if(!r)throw new UserError('Invalid resource.');const value=get(s.draft,r.path);field('ids',r.array?'Role/category IDs, comma separated':'Existing resource ID; blank creates one',Array.isArray(value)?value.join(','):String(value??''),1000,false);}
  return modal;
}
