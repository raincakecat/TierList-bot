/** Subscribe before reading to avoid missing a channel created between the two. */
export class TicketLinks {
  private listeners=new Map<string,Set<(channelId:string)=>void>>();
  ready(ticketId:string,channelId:string){for(const listener of this.listeners.get(ticketId)??[])listener(channelId);}
  async wait(ticketId:string,read:()=>Promise<{channelId:string|null;status:string}|undefined>,timeoutMs=25_000):Promise<string|null>{
    let notify!:(channelId:string)=>void;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const pending=new Promise<string|null>(resolve=>{notify=resolve;timer=setTimeout(()=>resolve(null),timeoutMs);});
    const listeners=this.listeners.get(ticketId)??new Set();listeners.add(notify);this.listeners.set(ticketId,listeners);
    try{const ticket=await read();if(ticket?.channelId&&ticket.status!=='closed')return ticket.channelId;return await pending;}
    finally{if(timer)clearTimeout(timer);listeners.delete(notify);if(!listeners.size)this.listeners.delete(ticketId);}
  }
}
