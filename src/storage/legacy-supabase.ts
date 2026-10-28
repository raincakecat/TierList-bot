import { z } from 'zod';
import { TIERS, type Tier } from '../domain/types.js';
import { migrationSchema, type LegacyImport } from './migration.js';

const id = z.string().regex(/^\d{17,20}$/);
const sourceSchema = z.object({
  players: z.array(z.object({discord_id:id, username:z.string(), uuid:z.string().nullable(),
    rank:z.string().nullable(), region:z.string().nullable(), preferred_server:z.string().nullable(),
    last_tested:z.number().nullable()}).passthrough()),
  cooldown_entries:z.array(z.object({user_id:id,start_time:z.number().nonnegative(),duration:z.number().nonnegative()}).passthrough()),
  tickets:z.array(z.object({channel_id:id,testee_id:id,tester_id:id.nullable().optional(),type:z.string()}).passthrough()),
  tester_quotas:z.array(z.record(z.string(),z.unknown())),
  quota_settings:z.array(z.record(z.string(),z.unknown())),
  ticketdata:z.array(z.object({id:z.string(),data:z.record(z.string(),z.unknown())}).passthrough()).default([]),
  cooldowns:z.array(z.object({id:z.string(),data:z.record(z.string(),z.unknown())}).passthrough()).default([]),
  quotadata:z.array(z.object({id:z.string(),data:z.record(z.string(),z.unknown())}).passthrough()).default([])
}).passthrough();

function tier(value:string|null):Tier {
  if(value===null||value==='Unranked')return 'Unranked';
  if(TIERS.includes(value as Tier))return value as Tier;
  const m=/^(Low|High) Tier ([1-5])$/.exec(value);
  if(!m)throw new Error('Unknown legacy rank; correct its mapping before conversion.');
  return `${m[1]==='Low'?'L':'H'}T${m[2]}` as Tier;
}

/** Offline only: never connects to Supabase or modifies the source snapshot. */
export function convertLegacySupabase(input:unknown,guildId:string) {
  id.parse(guildId);
  const source=sourceSchema.parse(input);
  for(const name of ['ticketdata','cooldowns','quotadata'] as const){
    const rows=source[name],global=rows.find(r=>r.id==='global'),guild=rows.find(r=>r.id===`guild_${guildId}`);
    // Object property order is irrelevant; compare normalized trees.
    const stable=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
      ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
    if(global&&guild&&stable(global.data)!==stable(guild.data))throw new Error(`${name}: global and guild snapshots disagree; choose the authoritative source first.`);
    if(rows.some(r=>r.id.startsWith('guild_')&&r.id!==`guild_${guildId}`))throw new Error(`${name}: contains another server's data.`);
  }
  const cooldowns=new Map<string,number>();
  for(const row of source.cooldown_entries){
    if(cooldowns.has(row.user_id))throw new Error('Duplicate cooldown entry.');
    const end=row.start_time+row.duration;
    if(!Number.isSafeInteger(end))throw new Error('Invalid cooldown timestamp.');
    cooldowns.set(row.user_id,end);
  }
  const seen=new Set<string>();
  let mappedAU=0;
  const players=source.players.map(row=>{
    if(seen.has(row.discord_id))throw new Error('Duplicate Discord player.');
    seen.add(row.discord_id);
    let region=row.region?.trim().toUpperCase()||null;
    if(region==='AU'){region='AS';mappedAU++;}
    if(region&&!['NA','EU','AS'].includes(region))throw new Error('Unknown legacy region.');
    return {id:row.discord_id,tier:tier(row.rank),uuid:row.uuid?row.uuid.replaceAll('-','').toLowerCase():null,
      ign:row.username||null,region,preferredServer:row.preferred_server,waitlist:false,
      cooldownUntil:cooldowns.get(row.discord_id)??0,...(row.last_tested?{previousTestAt:row.last_tested*1000}:{})};
  });
  for(const playerId of cooldowns.keys())if(!seen.has(playerId))throw new Error('Cooldown without player; preserve and resolve it before conversion.');
  const data:LegacyImport=migrationSchema.parse({format:'crystal-legacy',version:1,guildId,players,
    restrictions:[],tickets:[],lists:[],completions:[]});
  const uuidOwners=new Map<string,string[]>();
  for(const p of data.players)if(p.uuid)uuidOwners.set(p.uuid,[...(uuidOwners.get(p.uuid)??[]),p.id]);
  const duplicateLinks=[...uuidOwners].filter(([,owners])=>owners.length>1).map(([uuid,members])=>({uuid,members}));
  return {data,review:{
    mappedAU,playerCount:players.length,cooldownCount:cooldowns.size,
    missingUuid:players.filter(p=>!p.uuid).map(p=>p.id),
    missingRegion:players.filter(p=>!p.region).map(p=>p.id),duplicateLinks,
    // No invented opening rank, creation time, channel name, target, or completion dates.
    unresolvedTickets:source.tickets,
    legacyQuotas:{settings:source.quota_settings,testers:source.tester_quotas,raw:source.quotadata},
    previousTests:source.players.filter(p=>p.last_tested!==null).map(p=>({id:p.discord_id,legacyUnixSeconds:p.last_tested})),
    notes:[
      'AU maps to AS. No waitlist membership was inferred from verification or region.',
      'Duplicate UUIDs and linked players without a region must be resolved in migration preview.',
      'Tickets need Discord channel names, actual opening time/rank, target, participants and evaluation state before adoption.',
      'Aggregate quota counts are preserved here; they are not fabricated as dated completed tests.',
      'Restrictions and manual HT3 membership are absent from this source; reconcile Discord before cutover.'
    ]
  }};
}
