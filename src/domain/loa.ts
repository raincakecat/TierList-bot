import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import { requireGroup } from './permissions.js';
import { enqueue } from './service.js';
import { dateKey } from './calendar.js';
import { UserError, type Actor, type Leave, type State } from './types.js';
import type { Store } from '../storage/store.js';

export function currentLeave(s:State,member:string){return Object.values(s.leaves??{}).find(l=>l.memberId===member&&['pending','active'].includes(l.status));}
export function quotaExempt(s:State,member:string,month:string,timezone:string,now=Date.now()):boolean{
  return Object.values(s.leaves??{}).some(l=>{
    if(l.memberId!==member||!['active','ended','expired'].includes(l.status)||l.startsAt===undefined||l.endsAt===undefined||l.startsAt>now)return false;
    const end=Math.min(l.endsAt,l.endedAt??l.endsAt,now+1);if(end<=l.startsAt)return false;
    return dateKey(l.startsAt,timezone).slice(0,7)<=month&&dateKey(end-1,timezone).slice(0,7)>=month;
  });
}
function queue(s:State,l:Leave,event:string,now:number){enqueue(s,'loa',{leaveId:l.id,event},now,`loa-${l.id}-${event}`);}
export class LeaveService {
  constructor(private store:Store,private config:()=>Config,private clock=Date.now){}
  private ensure(s:State){if(!s.initialized)throw new UserError('Finish setup first.');if(s.maintenance)throw new UserError('The bot is in maintenance.');}
  private audit(s:State,a:Actor,action:string,id:string,now:number){s.audit.push({id:randomUUID(),actor:a.id,action,target:id,at:now});}
  async request(a:Actor,username:string,duration:string,reason:string){const c=this.config();requireGroup(c,a,'staff');const match=/^([1-9]|[12]\d|30)d$/.exec(duration.trim());if(!match)throw new UserError('Choose 1-30 whole days, such as 7d.');username=username.trim();reason=reason.trim();if(!username||username.length>100||!reason||reason.length>1000)throw new UserError('Provide a username (up to 100 characters) and reason (up to 1000).');
    return this.store.change(s=>{this.ensure(s);if(!c.modules.loa||!c.loa.roleId||!c.channels.loaInProgress||!c.channels.acceptedLoa||!c.permissionGroups.loaAdmin.length)throw new UserError('LOA requests are unavailable.');if(currentLeave(s,a.id))throw new UserError('You already have a pending or active LOA.');const now=this.clock(),l:Leave={id:randomUUID(),memberId:a.id,username,days:Number(match[1]),reason,status:'pending',requestedAt:now,roleId:c.loa.roleId,reviewChannelId:c.channels.loaInProgress,acceptedChannelId:c.channels.acceptedLoa,adminRoles:[...c.permissionGroups.loaAdmin]};s.leaves??={};s.leaves[l.id]=l;queue(s,l,'request',now);this.audit(s,a,'loa-request',l.id,now);return l;});
  }
  async decide(a:Actor,id:string,decision:'accept'|'deny',reason='',present=true){requireGroup(this.config(),a,'loaAdmin');if(decision==='deny'&&(!reason.trim()||reason.length>1000))throw new UserError('Provide a denial reason up to 1000 characters.');return this.store.change(s=>{this.ensure(s);const l=s.leaves?.[id];if(!l||l.status!=='pending')throw new UserError('This request was already decided or withdrawn.');if(decision==='accept'&&!present)throw new UserError('The requester is no longer in this server.');const now=this.clock();l.reviewedBy=a.id;l.reviewedAt=now;
    if(decision==='accept'){l.status='active';l.startsAt=now;l.endsAt=now+l.days*86400000;}else{l.status='denied';l.denialReason=reason.trim();}queue(s,l,decision,now);this.audit(s,a,`loa-${decision}`,id,now);return l;});}
  async withdraw(a:Actor,id:string){return this.store.change(s=>{this.ensure(s);const l=s.leaves?.[id];if(!l||l.memberId!==a.id||l.status!=='pending')throw new UserError('Only the requester can withdraw a pending request.');const now=this.clock();l.status='withdrawn';queue(s,l,'withdraw',now);this.audit(s,a,'loa-withdraw',id,now);});}
  async end(a:Actor,id:string,reason='',admin=false){if(admin){requireGroup(this.config(),a,'loaAdmin');if(!reason.trim()||reason.length>1000)throw new UserError('Provide an early-end reason up to 1000 characters.');}return this.store.change(s=>{this.ensure(s);const l=s.leaves?.[id];if(!l||l.status!=='active')throw new UserError('No active LOA was found.');if(!admin&&l.memberId!==a.id)throw new UserError('Only the requester can use End My LOA.');const now=this.clock();l.status=now>=l.endsAt!?'expired':'ended';l.endedAt=Math.min(now,l.endsAt!);l.endedBy=a.id;l.endReason=admin?reason.trim():'Returned early';queue(s,l,l.status,now);this.audit(s,a,'loa-end',id,now);});}
  async tick(){return this.store.change(s=>{const now=this.clock();for(const l of Object.values(s.leaves??{}))if(l.status==='active'&&l.endsAt!<=now){l.status='expired';l.endedAt=l.endsAt;queue(s,l,'expired',now);this.audit(s,{id:'system',roles:[],administrator:false},'loa-expired',l.id,now);}});}
}
