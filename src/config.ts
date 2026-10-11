import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { GROUPS, REGIONS, type Group } from './domain/types.js';

const id = z.string().regex(/^\d{17,20}$/, 'Use a quoted Discord ID').nullable();
const ids = z.array(id.unwrap());
const group = z.enum(GROUPS);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const duration = z.string().regex(/^(0|[1-9]\d*[mhd])$/).nullable();
const regionSchema = z.object({enabled:z.boolean(),regionRoleId:id,waitlistRoleId:id,queueChannelId:id,testCategoryId:id}).strict();
export const configSchema = z.object({
  schemaVersion:z.literal(1),
  community:z.object({guildId:id,name:z.string().min(1).max(100),timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Invalid timezone')}).strict(),
  database:z.object({backend:z.enum(['supabase','postgresql','sqlite']),supabase:z.object({urlEnv:z.string().min(1),serviceKeyEnv:z.string().min(1)}),postgresql:z.object({connectionStringEnv:z.string().min(1)}),sqlite:z.object({file:z.string().min(1)})}).strict(),
  modules:z.object({testing:z.boolean(),supportTickets:z.boolean(),tierLists:z.boolean(),testerQuotas:z.boolean(),migration:z.boolean()}).strict(),
  permissionGroups:z.object(Object.fromEntries(GROUPS.map(k=>[k,ids])) as Record<Group,typeof ids>).strict(),
  regions:z.object({NA:regionSchema,EU:regionSchema,AS:regionSchema}).strict(),
  tierRoleIds:z.object({LT5:id,HT5:id,LT4:id,HT4:id,LT3:id,HT3:id,LT2:id,HT2:id,LT1:id,HT1:id}).strict(),
  channels:z.object({verificationPanel:id,supportPanel:id,results:id,testerAlerts:id,testingArchives:id,quotaReports:id,staffActionLog:id,operationalLog:id,botReview:id}).strict(),
  categories:z.object({highTests:id,overflow:ids}).strict(),
  testing:z.object({queueCapacityPerRegion:z.number().int().positive().max(1000),normalCooldown:duration,highCooldown:duration,monthlyTesterQuota:z.number().int().positive().nullable(),defaultLeaderboardPeriod:z.literal('monthly'),weeklyStartDay:z.literal('Sunday')}).strict(),
  tierLists:z.object({channelIds:z.object({HT3:id,LT2:id,HT2:id,LT1:id,HT1:id}).strict()}).strict(),
  supportTicketTypes:z.array(z.object({key:z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),enabled:z.boolean(),name:z.string().min(1).max(80),categoryId:id,archiveChannelId:id,accessGroups:z.array(group).min(1),openingPingGroups:z.array(group),closingGroups:z.array(group).min(1),copyImages:z.boolean(),openingMessage:z.string().min(1).max(3500)}).strict()),
  branding:z.object({iconUrl:z.url().nullable(),colors:z.object({panel:color,ticket:color,result:color,success:color,error:color}).strict()}).strict(),
  templates:z.object({verificationPanel:z.string().min(1).max(3500),supportPanel:z.string().min(1).max(3500),testOpeningTitle:z.string().min(1).max(200),resultTitle:z.string().min(1).max(200),resultAboveEmbed:z.string().max(1500)}).strict(),
  archival:z.object({directory:z.string().min(1),imageRetentionDays:z.number().int().positive().max(3650),transcriptRetentionDays:z.null(),minimumDeletionDelaySeconds:z.number().int().min(10)}).strict(),
  backups:z.object({directory:z.string().min(1),schedule:z.literal('daily'),retainSuccessfulAutomaticBackups:z.literal(10)}).strict(),
  setup:z.object({mode:z.literal('existing-or-create'),requirePreviewConfirmation:z.literal(true)}).strict()
}).strict();
export type Config = z.infer<typeof configSchema>;
export function milliseconds(value:string):number {
  if(value==='0')return 0;
  const match=/^([1-9]\d*)([mhd])$/.exec(value);
  if(!match)throw new Error('Use a duration such as 3h, 2d, or 0');
  const result=Number(match[1])*({m:60_000,h:3_600_000,d:86_400_000}[match[2]!]!);
  if(!Number.isSafeInteger(result))throw new Error('Duration is too large');
  return result;
}
export function readiness(c:Config):string[] {
  const errors:string[]=[];
  const need=(v:unknown,name:string)=>{if(v===null || (Array.isArray(v)&&!v.length))errors.push(`${name} is not configured`);};
  need(c.community.guildId,'community.guildId');need(c.permissionGroups.owner,'permissionGroups.owner');need(c.permissionGroups.botAdmin,'permissionGroups.botAdmin');
  for(const key of ['staffActionLog','operationalLog','botReview'] as const)need(c.channels[key],`channels.${key}`);
  if((c.modules.tierLists||c.modules.testerQuotas)&&!c.modules.testing)errors.push('Lists and quotas require testing');
  if(c.modules.testing){
    for(const g of ['staff','verifiedTester','regulator','listAdmin','restrictionKey'] as const)need(c.permissionGroups[g],`permissionGroups.${g}`);
    for(const key of ['verificationPanel','results','testerAlerts','testingArchives'] as const)need(c.channels[key],`channels.${key}`);
    need(c.categories.highTests,'categories.highTests');
    for(const [t,v]of Object.entries(c.tierRoleIds))need(v,`tierRoleIds.${t}`);
    if(!REGIONS.some(r=>c.regions[r].enabled))errors.push('Enable at least one region');
    for(const r of REGIONS)if(c.regions[r].enabled)for(const [key,v]of Object.entries(c.regions[r]))if(key!=='enabled')need(v,`regions.${r}.${key}`);
    for(const key of ['normalCooldown','highCooldown'] as const){need(c.testing[key],`testing.${key}`);if(c.testing[key]!==null)try{milliseconds(c.testing[key]);}catch(e){errors.push(`${key}: ${(e as Error).message}`);}}
  }
  if(c.modules.tierLists)for(const [key,v]of Object.entries(c.tierLists.channelIds))need(v,`tierLists.channelIds.${key}`);
  if(c.modules.testerQuotas){need(c.testing.monthlyTesterQuota,'testing.monthlyTesterQuota');need(c.channels.quotaReports,'channels.quotaReports');}
  if(c.modules.supportTickets){need(c.channels.supportPanel,'channels.supportPanel');for(const t of c.supportTicketTypes.filter(t=>t.enabled)){need(t.categoryId,`${t.key}.categoryId`);need(t.archiveChannelId,`${t.key}.archiveChannelId`);for(const g of [...t.accessGroups,...t.closingGroups,...t.openingPingGroups])need(c.permissionGroups[g],`permissionGroups.${g}`);}}
  const seen=new Set<string>();for(const t of c.supportTicketTypes){if(seen.has(t.key))errors.push(`Duplicate ticket type ${t.key}`);seen.add(t.key);}
  const valid=new Set(['communityName','userMention','testerMention','minecraftIgn','discordUsername','region','previousRank','earnedRank','previousTest','preferredServer','deadline']);
  for(const text of [...Object.values(c.templates),...c.supportTicketTypes.map(t=>t.openingMessage)])for(const m of text.matchAll(/\{([^{}]+)\}/g))if(!valid.has(m[1]!))errors.push(`Unknown template placeholder ${m[1]}`);
  return [...new Set(errors)];
}
export function render(template:string,values:Record<string,string>):string {
  return template.replace(/@(everyone|here)/g,'@\u200b$1').replace(/\{([^{}]+)\}/g,(_,key:string)=>values[key]??'N/A');
}
export class ConfigFile {
  constructor(public path:string, public value:Config){}
  static async load(path:string):Promise<ConfigFile>{return new ConfigFile(resolve(path),configSchema.parse(JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''))));}
  async save(value:Config){configSchema.parse(value);const temp=`${this.path}.tmp`;await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,this.path);this.value=value;}
}
