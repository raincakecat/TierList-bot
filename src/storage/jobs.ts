import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import { JobDeferred, type Job } from '../domain/types.js';

export class Worker {
  private active=0;
  private runningKeys=new Set<string>();
  constructor(private store:Store,private execute:(job:Job,checkpoint:(key:string,value:unknown)=>Promise<void>)=>Promise<void>,private report:(job:Job)=>Promise<void>,private concurrency=1){}
  async runOnce():Promise<boolean>{
    return this.store.operations.shared(()=>this.executeOnce());
  }
  private async executeOnce():Promise<boolean>{
    if(this.active>=this.concurrency)return false;this.active++;
    let runningKey:string|undefined;
    try{
      const job=await this.store.change(s=>{const now=Date.now(),jobs=Object.values(s.jobs).sort((a,b)=>(a.createdAt??0)-(b.createdAt??0)),working=new Set(jobs.filter(j=>j.status==='working'&&(j.leaseUntil??0)>=now).map(jobKey));
        const ordered=jobs.filter(j=>j.status!=='done');
        const backgroundRunning=jobs.filter(j=>j.status==='working'&&(j.leaseUntil??0)>=now&&(j.kind==='archive'||priority(j)>=4)).length;
        const candidates=ordered.filter((j,index)=>(this.concurrency===1||(j.kind!=='archive'&&priority(j)<4)||backgroundRunning<this.concurrency-1)&&!this.runningKeys.has(jobKey(j))&&j.nextAt<=now&&(j.status!=='working'||(j.leaseUntil??0)<now)&&!working.has(jobKey(j))&&(!['ticket:','channel:'].some(prefix=>jobKey(j).startsWith(prefix))||!ordered.slice(0,index).some(previous=>jobKey(previous)===jobKey(j))));
        const j=candidates.sort((a,b)=>priority(a)-priority(b))[0];if(!j)return null;
        if(j.checkpoints.deliveryStartedAt)j.checkpoints.recovery=true;else j.checkpoints.deliveryStartedAt=now;
        j.status='working';j.leaseUntil=now+300_000;j.checkpoints.worker=randomUUID();return structuredClone(j);});
      if(!job)return false;runningKey=jobKey(job);this.runningKeys.add(runningKey);const owner=String(job.checkpoints.worker);
      const checkpoint=async(key:string,value:unknown)=>{await this.store.change(s=>{const j=s.jobs[job.id];if(!j||j.checkpoints.worker!==owner)throw new Error('Job lease lost');j.checkpoints[key]=value;j.leaseUntil=Date.now()+300_000;});job.checkpoints[key]=value;};
      try{await this.execute(job,checkpoint);await this.store.change(s=>{const j=s.jobs[job.id];if(j?.checkpoints.worker===owner){j.status='done';delete j.leaseUntil;}});}catch(error){
        if(error instanceof JobDeferred){await this.store.change(s=>{const j=s.jobs[job.id];if(j?.checkpoints.worker===owner){j.status='pending';j.nextAt=Math.max(Date.now()+100,error.retryAt);delete j.leaseUntil;}});return true;}
        const code=failureCode(error);job.lastFailureCode=code;
        await this.store.change(s=>{const j=s.jobs[job.id];if(j?.checkpoints.worker===owner){j.status='pending';j.attempts++;j.lastFailureCode=code;j.lastFailureAt=Date.now();j.nextAt=Date.now()+Math.min(300_000,5000*2**Math.min(j.attempts,6));delete j.leaseUntil;}});
        if(job.attempts===0)await this.report(job).catch(()=>{});
      }return true;
    }finally{if(runningKey)this.runningKeys.delete(runningKey);this.active--;}
  }
}

function failureCode(error:unknown):string {
  const e=error as {code?:unknown;name?:unknown}|null,code=e?.code;
  if(typeof code==='number'&&Number.isSafeInteger(code))return `Discord_${code}`;
  if(['InvalidType','ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(String(code)))return String(code);
  if(e?.name==='TimeoutError'||e?.name==='AbortError')return e.name;
  return 'OperationError';
}

function jobKey(j:Job):string {
  if(j.kind==='result')return `result:${String(j.data.ticketId??j.id)}`;
  if(j.kind==='queues'||j.kind==='lists'||j.kind==='loa')return `panel:${j.kind}`;
  if(j.data.ticketId)return `ticket:${String(j.data.ticketId)}`;
  if(j.kind==='roles')return `member:${String(j.data.playerId)}`;
  if(j.data.channelId)return `channel:${String(j.data.channelId)}`;
  return `job:${j.id}`;
}
function priority(j:Job):number {
  if(j.data.bulk===true)return 6;
  if(j.kind==='open'||j.kind==='archive')return 0;
  if(j.kind==='queues'||j.data.here||j.data.event==='delete-transient')return 1;
  if(j.kind==='lists')return 4;
  return 2;
}
