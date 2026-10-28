/** Stops work if renewal fails or hangs past the last confirmed lease. */
export class LeaseWatch {
  private pending?:Promise<void>;
  private stopped=false;
  constructor(private until:number,private renew:(until:number)=>Promise<void>,private fail:()=>void,private clock:()=>number=Date.now){}
  check(){if(!this.stopped&&this.clock()>=this.until)this.failed();}
  private failed(){if(this.stopped)return;this.stopped=true;this.fail();}
  pulse():Promise<void>{
    this.check();if(this.stopped)return Promise.resolve();if(this.pending)return this.pending;
    const until=this.clock()+60_000;
    const task=this.renew(until).then(()=>{this.check();if(!this.stopped)this.until=until;},()=>this.failed());
    this.pending=task;void task.finally(()=>{if(this.pending===task)this.pending=undefined;});return task;
  }
  async stop(){this.stopped=true;await this.pending;}
}
