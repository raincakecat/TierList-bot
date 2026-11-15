import {randomUUID} from 'node:crypto';
import {emptyState,UserError,type ModeState,type Player,type State,type Tier} from '../domain/types.js';

const modes=['sword','axe','smp','pot','mace','uhc','nethpot','spear-mace'] as const;
const ranks=['HT3','LT2','HT2','LT1'] as const;
const regions=['NA','EU','AS'] as const;
const copy=<T>(value:T):T=>structuredClone(value);

export function consolidationPreview(root:State,sourceId:string){
  const source=root.servers?.[sourceId];
  if(!source||sourceId===root.guildId)throw new UserError('The source testing server is unavailable.');
  const openTests=Object.values(source.tickets).filter(t=>t.type==='test'&&t.status!=='closed');
  const existing=modes.filter(key=>root.modes?.[key]);
  const sourceModes=modes.filter(key=>key!==(source.defaultModeId??'crystal')&&!source.modes?.[key]);
  const conflicts=Object.values(source.players).filter(p=>p.uuid&&root.players[p.id]?.uuid&&root.players[p.id]!.uuid!==p.uuid).map(p=>p.id);
  return {sourceId,targetId:root.guildId,openTests:openTests.length,existingModes:existing,missingModes:sourceModes,identityConflicts:conflicts,
    playerCount:Object.keys(source.players).length,closedTests:Object.values(source.tickets).filter(t=>t.type==='test'&&t.status==='closed').length};
}

export function consolidateTestingModes(root:State,sourceId:string){
  const preview=consolidationPreview(root,sourceId);
  if(!root.maintenance||!root.servers![sourceId]!.maintenance)throw new UserError('Enable maintenance in both testing servers first.');
  if(preview.openTests||preview.existingModes.length||preview.missingModes.length||preview.identityConflicts.length)throw new UserError('Resolve open tests, existing/missing modes, and identity conflicts before transfer.');
  const source=root.servers![sourceId]!,now=Date.now();root.modes??={};
  for(const [id,p] of Object.entries(source.players)){
    const current=root.players[id];
    if(!current){root.players[id]={...copy(p),tier:'Unranked',waitlist:false,cooldownUntil:0};continue;}
    if(!current.uuid&&p.uuid){current.uuid=p.uuid;current.ign=p.ign;}
    current.region??=p.region;current.preferredServer??=p.preferredServer;
  }
  for(const key of modes){
    const from:ModeState=key===(source.defaultModeId??'crystal')?{players:source.players,queues:source.queues,lists:source.lists,lastTestingSession:source.lastTestingSession}:source.modes![key]!;
    const part=copy(from);part.queues={NA:[],EU:[],AS:[]};part.lastTestingSession={};part.lists={};
    for(const [id,p] of Object.entries(part.players)){
      const profile=root.players[id];if(!profile)throw new UserError(`Missing shared player ${id}`);
      Object.assign(p,{uuid:profile.uuid,ign:profile.ign,region:profile.region,preferredServer:profile.preferredServer,waitlist:false});
      if(!profile.uuid||!profile.region||p.tier==='Unranked')continue;
      if((ranks as readonly string[]).includes(p.tier)&&p.tier!=='HT3')((part.lists[p.tier]??={})[profile.region]??=[]).push(id);
    }
    for(const region of regions)for(const id of from.lists.HT3?.[region]??[]){
      const p=part.players[id],r=root.players[id]?.region;
      if(p?.tier==='HT3'&&r&&p.uuid)((part.lists.HT3??={})[r]??=[]).push(id);
    }
    for(const tier of ranks)for(const region of regions)if(part.lists[tier]?.[region])part.lists[tier]![region]=[...new Set(part.lists[tier]![region])];
    root.modes[key]=part;
    for(const id of Object.keys(part.players)){const jobId=randomUUID();root.jobs[jobId]={id:jobId,kind:'roles',status:'pending',attempts:0,nextAt:now,createdAt:now,checkpoints:{},data:{modeId:key,playerId:id}};}
    const listJobId=randomUUID();root.jobs[listJobId]={id:listJobId,kind:'lists',status:'pending',attempts:0,nextAt:now,createdAt:now,checkpoints:{},data:{modeId:key}};
  }
  const migratedTickets=Object.values(source.tickets).filter(t=>t.type==='test'&&t.status==='closed');
  for(const t of migratedTickets){if(root.tickets[t.id])throw new UserError('Testing ticket ID collision.');root.tickets[t.id]=copy({...t,modeId:t.modeId??source.defaultModeId??'sword'});}
  const ticketIds=new Set(migratedTickets.map(t=>t.id));
  for(const event of source.completions.filter(e=>ticketIds.has(e.ticketId)))if(!root.completions.some(x=>x.ticketId===event.ticketId))root.completions.push(copy({...event,modeId:event.modeId??source.tickets[event.ticketId]?.modeId??source.defaultModeId??'sword'}));
  for(const event of source.audit.filter(e=>e.action==='passeval'&&ticketIds.has(e.target)))if(!root.audit.some(x=>x.id===event.id))root.audit.push(copy(event));
  for(const old of source.restrictions.filter(r=>r.until===null||r.until>now)){
    const current=root.restrictions.filter(r=>r.playerId===old.playerId&&(!r.until||r.until>now)).sort((a,b)=>(b.until??Infinity)-(a.until??Infinity))[0];
    if(current&&(current.until??Infinity)>=(old.until??Infinity))continue;
    root.restrictions=root.restrictions.filter(r=>r.playerId!==old.playerId||!!r.until&&r.until<=now);
    const previousTiers:Record<string,Tier>={crystal:root.players[old.playerId]?.tier??'Unranked'};
    for(const key of modes)previousTiers[key]=root.modes[key]?.players[old.playerId]?.tier??'Unranked';
    root.restrictions.push({...copy(old),previousTier:previousTiers.crystal,previousTiers});
  }
  root.audit.push({id:randomUUID(),at:now,actor:'system',action:'consolidate-testing-modes',target:sourceId});
  return preview;
}
