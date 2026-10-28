import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { configSchema, type Config } from '../config.js';
import { clearLists, enqueue, restricted, syncLists } from '../domain/service.js';
import { rolesFor } from '../domain/permissions.js';
import { REGIONS, TIERS, type Player, type State, type Ticket } from '../domain/types.js';
import type { Store } from './store.js';

const id=z.string().regex(/^\d{17,20}$/),region=z.enum(REGIONS),tier=z.enum(TIERS);
export const migrationSchema=z.object({
  format:z.literal('crystal-legacy'),version:z.literal(1),guildId:id,
  players:z.array(z.object({id,tier,uuid:z.string().regex(/^[a-f0-9]{32}$/).nullable(),ign:z.string().regex(/^[A-Za-z0-9_]{1,16}$/).nullable(),region:region.nullable(),preferredServer:z.string().max(100).nullable(),waitlist:z.boolean(),cooldownUntil:z.number().nonnegative(),testerSince:z.number().nonnegative().optional(),previousTestAt:z.number().int().nonnegative().optional()}).strict()),
  restrictions:z.array(z.object({id:z.string(),playerId:id,uuid:z.string().regex(/^[a-f0-9]{32}$/),reason:z.string().min(1),until:z.number().nullable(),actor:id,previousTier:tier.optional()}).strict()).default([]),
  tickets:z.array(z.object({channelId:id,type:z.string(),opener:id,region:region.nullable(),openingTier:tier.nullable(),openingIgn:z.string().nullable(),openingUuid:z.string().regex(/^[a-f0-9]{32}$/).nullable().optional(),preferredServer:z.string().max(100).nullable().optional(),previousTestAt:z.number().int().nonnegative().nullable().optional(),tester:id.nullable(),target:tier.nullable(),passed:z.boolean(),participants:z.array(id),openedAt:z.number().nonnegative(),name:z.string().min(1).max(100),deadline:z.object({at:z.number(),setter:id,notified:z.boolean()}).optional()}).strict()).default([]),
  lists:z.array(z.object({tier,region,members:z.array(id)})).default([]),
  completions:z.array(z.object({ticketId:z.string(),tester:id,at:z.number().nonnegative()})).default([])
}).strict();
export type LegacyImport=z.infer<typeof migrationSchema>;
export interface Issue {key:string;field:string;message:string}
export interface Preview {hash:string;data:LegacyImport;errors:string[];issues:Issue[];summary:string;readyKeys:string[]}
export function recordKeys(data:LegacyImport):string[]{return [...data.players.map(p=>`player:${p.id}`),...data.tickets.map(t=>`ticket:${t.channelId}`),...data.restrictions.map(r=>`restriction:${r.id}`),...data.lists.map(l=>`list:${l.tier}:${l.region}`),...data.completions.map(c=>`completion:${c.ticketId}`)];}
export function previewMigration(text:string,c:Config,s:State):Preview {
  const data=migrationSchema.parse(JSON.parse(text)),errors:string[]=[],issues:Issue[]=[];
  const block=(key:string,field:string,message:string)=>issues.push({key,field,message});
  if(data.guildId!==s.guildId)errors.push('Import server does not match this installation.');
  if(s.migrationId)errors.push('An import has already been applied. Use saved operation retries instead.');
  const ids=new Set<string>(),uuids=new Set<string>();
  const done=new Set(s.migrationSession?.done??[]);
  for(const p of data.players){const key=`player:${p.id}`;if(done.has(key))continue;if(ids.has(p.id))block(key,'conflict',`Duplicate Discord player ${p.id}`);ids.add(p.id);if(p.uuid){if(uuids.has(p.uuid)){block(key,'conflict',`Duplicate Minecraft UUID for ${p.id}`);for(const other of data.players.filter(x=>x.uuid===p.uuid&&x.id!==p.id))block(`player:${other.id}`,'conflict','Minecraft UUID occurs more than once');}uuids.add(p.uuid);if(!p.region)block(key,'region',`Missing region for ${p.id}`);if(!p.ign)block(key,'ign',`Missing IGN for ${p.id}`);}if(p.region&&!c.regions[p.region].enabled)block(key,'region',`Disabled region for ${p.id}`);const existing=s.players[p.id];if(existing&&JSON.stringify(existing)!==JSON.stringify(p))block(key,'conflict',`Existing player conflict ${p.id}`);if(Object.values(s.players).some(x=>x.uuid&&x.uuid===p.uuid&&x.id!==p.id))block(key,'conflict',`Minecraft link conflict ${p.id}`);}
  const channels=new Set<string>(),tests=new Set<string>();for(const t of data.tickets){const key=`ticket:${t.channelId}`;if(done.has(key))continue;if(channels.has(t.channelId)||Object.values(s.tickets).some(x=>x.channelId===t.channelId))block(key,'conflict',`Duplicate adopted channel ${t.channelId}`);channels.add(t.channelId);if(!ids.has(t.opener)&&!s.players[t.opener])block(key,'opener',`Missing opener ${t.opener}`);if(issues.some(x=>x.key===`player:${t.opener}`))block(key,'dependency',`Opener ${t.opener} needs review`);if(t.type==='test'){if(!t.region||!c.regions[t.region].enabled)block(key,'region',`Missing or disabled test region ${t.channelId}`);if(!t.openingIgn)block(key,'openingIgn',`Missing opening IGN ${t.channelId}`);if(t.openingTier===null)block(key,'openingTier',`Missing rank before ticket opened ${t.channelId}`);if((!t.target||t.passed)&&!t.tester)block(key,'tester',`Missing original tester ${t.channelId}`);if(tests.has(t.opener)||Object.values(s.tickets).some(x=>x.opener===t.opener&&x.type==='test'&&x.status!=='closed'))block(key,'conflict',`Duplicate active test ${t.opener}`);tests.add(t.opener);}else if(!c.supportTicketTypes.some(x=>x.key===t.type&&x.enabled))block(key,'type',`Unknown ticket type ${t.type}`);}
  for(const list of data.lists){const key=`list:${list.tier}:${list.region}`;if(done.has(key))continue;for(const id of list.members){const p=data.players.find(p=>p.id===id)??s.players[id];if(!p||p.tier!==list.tier||!c.regions[list.region].enabled||issues.some(x=>x.key===`player:${id}`))block(key,'dependency',`Invalid or unresolved ${list.tier} list member ${id}`);}}
  const keys=recordKeys(data),blocked=new Set(issues.map(x=>x.key)),readyKeys=keys.filter(key=>!done.has(key)&&!blocked.has(key));
  if(s.migrationSession&&JSON.stringify([...new Set(keys)].sort())!==JSON.stringify([...new Set(s.migrationSession.keys)].sort()))errors.push('Import record IDs changed after application began. Correct existing records without adding or removing IDs.');
  const summary=`${readyKeys.length} records ready; ${new Set(issues.map(x=>x.key)).size} records need review; ${done.size} already imported. Existing ticket names will be retained.`;
  return {hash:createHash('sha256').update(text).digest('hex'),data,errors:[...new Set(errors)],issues,readyKeys,summary};
}
export async function applyMigration(store:Store,c:Config,preview:Preview,actor:string,filename='import.json'){
  const now=Date.now();await store.change(s=>{
    if(!s.maintenance)throw new Error('Migration requires maintenance.');if(s.migrationId)throw new Error('Import already applied.');if(s.migrationSession&&s.migrationSession.filename!==filename)throw new Error('Another import is already in progress.');const fresh=previewMigration(JSON.stringify(preview.data),c,s);if(fresh.errors.length)throw new Error('Import no longer matches preview.');
    const ready=new Set(fresh.readyKeys);s.migrationSession??={filename,id:preview.hash,keys:recordKeys(preview.data),done:[]};
    for(const p of preview.data.players)if(ready.has(`player:${p.id}`)){s.players[p.id]=structuredClone(p);syncLists(s,p,now);enqueue(s,'roles',{playerId:p.id,bulk:true},now);}
    for(const r of preview.data.restrictions)if(ready.has(`restriction:${r.id}`)&&!s.restrictions.some(x=>x.id===r.id))s.restrictions.push(structuredClone(r));
    for(const p of Object.values(s.players))if(restricted(s,p,now))clearLists(s,p.id);
    for(const list of preview.data.lists)if(ready.has(`list:${list.tier}:${list.region}`)){s.lists[list.tier]??={};const members=s.lists[list.tier]![list.region]??=[];for(const id of list.members){const p=s.players[id]!;if(!s.restrictions.some(r=>(r.playerId===id||r.uuid===p.uuid)&&(r.until===null||r.until>now))&&!members.includes(id))members.push(id);}}
    for(const legacy of preview.data.tickets)if(ready.has(`ticket:${legacy.channelId}`)){const p=s.players[legacy.opener]!,support=c.supportTicketTypes.find(x=>x.key===legacy.type);const t:Ticket={...structuredClone(legacy),openingTier:legacy.openingTier??p.tier,id:randomUUID(),status:'opening',accessRoles:rolesFor(c,legacy.type==='test'?['staff','owner']:[...support!.accessGroups,'owner']),closingRoles:rolesFor(c,legacy.type==='test'?['staff','owner']:[...support!.closingGroups,'owner']),archiveChannelId:legacy.type==='test'?c.channels.testingArchives!:support!.archiveChannelId!,copyImages:support?.copyImages??false,imageRetentionDays:c.archival.imageRetentionDays,categoryId:legacy.type==='test'?(legacy.target?c.categories.highTests!:c.regions[legacy.region!].testCategoryId!):support!.categoryId!,openingLists:[]};s.tickets[t.id]=t;enqueue(s,'open',{ticketId:t.id,adopt:true,preserveAccess:true,silentAdoption:true},now);if(!p.uuid&&legacy.type==='test')s.audit.push({id:randomUUID(),at:now,actor,action:'import-unverified-open-test',target:t.id});}
    for(const completion of preview.data.completions)if(ready.has(`completion:${completion.ticketId}`)&&!s.completions.some(x=>x.ticketId===completion.ticketId))s.completions.push(structuredClone(completion));
    for(const key of ready)if(!s.migrationSession.done.includes(key))s.migrationSession.done.push(key);
    if(s.migrationSession.keys.every(key=>s.migrationSession!.done.includes(key)))s.migrationId=s.migrationSession.id;
    s.audit.push({id:randomUUID(),at:now,actor,action:'migration-apply',target:s.migrationSession.id});enqueue(s,'lists',{},now);enqueue(s,'queues',{},now);
  });
}
