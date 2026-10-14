import { AsyncLocalStorage } from 'node:async_hooks';

/** Shared operations may overlap; recovery waits for all of them and fences new work. */
export class Operations {
  private context=new AsyncLocalStorage<'shared'|'exclusive'>();
  private readers=0;
  private writer=false;
  private queue:{exclusive:boolean;start:()=>void;reject:(error:Error)=>void;timer?:NodeJS.Timeout}[]=[];
  get recovering(){return this.writer||this.queue.some(x=>x.exclusive);}
  shared<T>(action:()=>Promise<T>):Promise<T>{
    if(this.context.getStore())return action();
    return this.acquire(false,action);
  }
  exclusive<T>(action:()=>Promise<T>,timeoutMs=30_000):Promise<T>{
    if(this.context.getStore()==='exclusive')return action();
    if(this.context.getStore()==='shared')return Promise.reject(new Error('Recovery must begin outside an active operation.'));
    return this.acquire(true,action,timeoutMs);
  }
  private acquire<T>(exclusive:boolean,action:()=>Promise<T>,timeoutMs?:number):Promise<T>{
    return new Promise<T>((resolve,reject)=>{
      const entry={exclusive,reject,start:()=>{
        if(entry.timer)clearTimeout(entry.timer);
        if(exclusive)this.writer=true;else this.readers++;
        void this.context.run(exclusive?'exclusive':'shared',async()=>{
          try{resolve(await action());}catch(error){reject(error);}finally{if(exclusive)this.writer=false;else this.readers--;this.pump();}
        });
      },timer:undefined as NodeJS.Timeout|undefined};
      if(timeoutMs!==undefined)entry.timer=setTimeout(()=>{const index=this.queue.indexOf(entry);if(index<0)return;this.queue.splice(index,1);reject(new Error('Recovery timed out waiting for active work. No restore or transfer was started.'));this.pump();},timeoutMs);
      this.queue.push(entry);this.pump();
    });
  }
  private pump(){
    if(this.writer)return;
    while(this.queue.length){const next=this.queue[0]!;if(next.exclusive&&this.readers)return;this.queue.shift();next.start();if(next.exclusive)return;}
  }
}
