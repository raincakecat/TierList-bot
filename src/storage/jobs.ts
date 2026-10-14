import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { Job } from '../domain/types.js';

export class Worker {
  private active=false;
  private token=randomUUID();
  constructor(private store:Store,private execute:(job:Job,checkpoint:(key:string,value:unknown)=>Promise<void>)=>Promise<void>,private report:(job:Job)=>Promise<void>){}
  async runOnce():Promise<boolean>{
    return this.store.operations.shared(()=>this.executeOnce());
  }
  private async executeOnce():Promise<boolean>{
    if(this.active)return false;this.active=true;
    try{
      const job=await this.store.change(s=>{const now=Date.now();const j=Object.values(s.jobs).find(j=>j.status!=='done'&&j.nextAt<=now&&(j.status!=='working'||(j.leaseUntil??0)<now));if(!j)return null;j.status='working';j.leaseUntil=now+300_000;j.checkpoints.worker=this.token;return structuredClone(j);});
      if(!job)return false;
      const checkpoint=async(key:string,value:unknown)=>{await this.store.change(s=>{const j=s.jobs[job.id];if(!j||j.checkpoints.worker!==this.token)throw new Error('Job lease lost');j.checkpoints[key]=value;j.leaseUntil=Date.now()+300_000;});job.checkpoints[key]=value;};
      try{await this.execute(job,checkpoint);await this.store.change(s=>{const j=s.jobs[job.id];if(j?.checkpoints.worker===this.token){j.status='done';delete j.leaseUntil;}});}catch{
        await this.store.change(s=>{const j=s.jobs[job.id];if(j?.checkpoints.worker===this.token){j.status='pending';j.attempts++;j.nextAt=Date.now()+Math.min(300_000,5000*2**Math.min(j.attempts,6));delete j.leaseUntil;}});
        if(job.attempts===0)await this.report(job).catch(()=>{});
      }return true;
    }finally{this.active=false;}
  }
}
