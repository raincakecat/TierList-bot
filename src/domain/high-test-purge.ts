import {randomUUID} from 'node:crypto';
import type {Config} from '../config.js';
import type {Store} from '../storage/store.js';
import {requireGroup} from './permissions.js';
import {enqueue} from './service.js';
import {UserError, type Actor, type State, type Ticket, type Tier} from './types.js';

export interface PurgeChannel {id:string;name:string;parentId:string|null;type:number}
export interface PurgeTarget extends PurgeChannel {ticketId?:string}
const highName= /-(ht3|lt2|ht2|lt1|ht1)(?:-(na|eu|as|au))?$/i;
const high=(t:Ticket)=>t.type==='test'&&(!!t.target||t.passed);

export function highTestPurgePlan(c:Config,s:State,channels:PurgeChannel[]):PurgeTarget[]{
  const scope=new Set([c.categories.highTests,...c.categories.overflow,...channels.filter(ch=>ch.type===4&&/^overflow\d+$/i.test(ch.name)).map(ch=>ch.id)].filter((id):id is string=>!!id));
  const protectedIds=new Set([...Object.values(c.channels),...Object.values(c.tierLists.channelIds),...c.supportTicketTypes.map(t=>t.archiveChannelId),...Object.values(c.regions).map(r=>r.queueChannelId)]);
  return channels.filter(ch=>ch.type===0&&!protectedIds.has(ch.id)).flatMap(ch=>{
    const known=Object.values(s.tickets).find(t=>t.channelId===ch.id&&t.status!=='closed');
    if(known)return high(known)?[{...ch,ticketId:known.id}]:[];
    return ch.parentId&&scope.has(ch.parentId)&&highName.test(ch.name)?[{...ch}]:[];
  });
}

export function purgeProgress(s:State,id?:string){
  const batch=id?s.jobs[id]:Object.values(s.jobs).filter(j=>j.data.event==='high-test-purge').sort((a,b)=>(b.createdAt??0)-(a.createdAt??0))[0];
  if(!batch||batch.data.event!=='high-test-purge')throw new UserError('No high-test purge has been started.');
  const ids=batch.data.archiveJobs as string[],jobs=ids.map(id=>s.jobs[id]),done=jobs.filter(j=>j?.status==='done'&&j.checkpoints.closed===true).length;
  const retrying=jobs.filter(j=>j&&j.status!=='done'&&j.attempts>0).length;
  return {id:batch.id,total:ids.length,done,pending:ids.length-done,retrying};
}

export async function queueHighTestPurge(store:Store,c:Config,a:Actor,plan:PurgeTarget[],reason:string){
  requireGroup(c,a,'owner');reason=reason.trim();if(!reason||reason.length>1000)throw new UserError('Provide a purge reason up to 1000 characters.');
  if(!c.channels.testingArchives||!c.channels.operationalLog)throw new UserError('Configure testing archives and operational log first.');
  return store.change(s=>{
    if(s.maintenance)throw new UserError('Disable maintenance before starting the purge.');
    if(Object.values(s.jobs).some(j=>j.data.event==='high-test-purge'&&purgeProgress(s,j.id).pending>0))throw new UserError('A high-test purge is already in progress. Use /purgehightests status.');
    const now=Date.now(),batchId=randomUUID(),archiveJobs:string[]=[],seen=new Set<string>();
    for(const item of plan){
      if(seen.has(item.id))continue;seen.add(item.id);
      const existing=Object.values(s.tickets).find(t=>t.channelId===item.id&&t.status!=='closed');
      if(item.ticketId&&(!existing||existing.id!==item.ticketId||!high(existing)))continue;
      if(!item.ticketId&&(existing||!highName.test(item.name)))continue;
      let t:Ticket;
      if(existing){
        t=existing;
        const prior=Object.values(s.jobs).find(j=>j.kind==='archive'&&j.data.ticketId===t.id&&j.status!=='done');
        if(prior){prior.data.purgeBatchId=batchId;archiveJobs.push(prior.id);continue;}
        t.status='closing';t.closedAt=now;t.outcome='discontinued';delete t.deadline;
        for(const r of t.closeRequests??[])if(r.status==='pending'){r.status='cancelled';r.resolvedAt=now;}
      }else{
        const match=item.name.match(highName)!;
        t={id:randomUUID(),channelId:item.id,type:'legacy-high-test',opener:a.id,region:null,openingTier:'Unranked',openingIgn:null,tester:null,target:match[1]!.toUpperCase() as Tier,passed:false,status:'closing',participants:[],openedAt:now,closedAt:now,outcome:'discontinued',accessRoles:[],closingRoles:[],archiveChannelId:c.channels.testingArchives!,copyImages:false,imageRetentionDays:c.archival.imageRetentionDays,archiveDirectory:c.archival.directory,minimumDeletionDelaySeconds:c.archival.minimumDeletionDelaySeconds,categoryId:item.parentId!,name:item.name};
      }
      const id=enqueue(s,'archive',{...(existing?{ticketId:t.id}:{channelId:item.id,archiveOnlyTicket:t}),actor:a.id,reason,purgeBatchId:batchId,bulk:true},now);archiveJobs.push(id);
    }
    if(!archiveJobs.length)throw new UserError('No matching high-test tickets remain. Nothing was queued.');
    enqueue(s,'notice',{event:'high-test-purge',actor:a.id,reason,archiveJobs,reportChannelId:c.channels.operationalLog,bulk:true},now,batchId);
    s.audit.push({id:randomUUID(),at:now,actor:a.id,action:'purge-high-tests',target:batchId});
    return {id:batchId,total:archiveJobs.length};
  });
}
