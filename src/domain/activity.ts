import {randomUUID} from 'node:crypto';
import {allowed, requireGroup} from './permissions.js';
import {UserError, type Actor, type ActivityNotice, type State} from './types.js';
import type {Config} from '../config.js';
import type {Store} from '../storage/store.js';
import {enqueue} from './service.js';

export class ActivityService {
  constructor(private store:Store,private config:()=>Config,private clock=Date.now){}
  async start(a:Actor,roster:string[],noticeChannelId:string,reportChannelId:string,staffRoleIds:string[],loaRoleId:string){
    const c=this.config();if(!allowed(c,a,'highStaff')&&!allowed(c,a,'botAdmin'))requireGroup(c,a,'owner');
    if(!noticeChannelId||!reportChannelId||noticeChannelId===reportChannelId||!staffRoleIds.length||!loaRoleId)throw new UserError('Activity notice setup is incomplete.');
    const id=randomUUID();
    return this.store.change(s=>{
      if(!s.initialized||s.maintenance)throw new UserError('Activity notices are unavailable during setup or maintenance.');
      if(Object.values(s.activityNotices??{}).some(n=>n.status!=='closed'))throw new UserError('An activity notice is already running.');
      const n:ActivityNotice={id,createdBy:a.id,status:'opening',roster:[...new Set(roster)],responses:[],noticeChannelId,reportChannelId,staffRoleIds:[...new Set(staffRoleIds)],loaRoleId};
      (s.activityNotices??={})[id]=n;enqueue(s,'activity',{activityId:id,event:'open'},this.clock(),`activity-${id}-open`);return n;
    });
  }
  async posted(id:string,messageId:string,postedAt:number){return this.store.change(s=>{const n=s.activityNotices?.[id];if(!n)throw new UserError('Notice no longer exists.');if(n.status!=='opening'){if(n.messageId===messageId)return;throw new UserError('Notice was already published.');}n.messageId=messageId;n.postedAt=postedAt;n.closesAt=postedAt+86_400_000;n.status='open';enqueue(s,'activity',{activityId:id,event:'close'},n.closesAt,`activity-${id}-close`);});}
  async respond(a:Actor,id:string,channelId:string,messageId:string){return this.store.change(s=>{
    const n=s.activityNotices?.[id],now=this.clock();
    if(!n||n.status!=='open'||!n.closesAt||now>=n.closesAt||n.noticeChannelId!==channelId||n.messageId!==messageId)throw new UserError('This activity notice is closed or unavailable.');
    if(!a.channelAccess||!n.roster.includes(a.id)||!n.staffRoleIds.some(role=>a.roles.includes(role)))throw new UserError('Only eligible staff can respond to this notice.');
    if(n.responses.includes(a.id))throw new UserError('Your response is already recorded.');
    n.responses.push(a.id);
  });}
  async finish(id:string,currentStaff:string[],onLeave:string[],roleExempt:string[]=[]){return this.store.change(s=>{
    const n=s.activityNotices?.[id];if(!n||n.status!=='open'||!n.closesAt||this.clock()<n.closesAt)throw new UserError('Notice is not ready to close.');
    const current=new Set(currentStaff),leave=new Set(onLeave),exemptRoles=new Set(roleExempt),responded=new Set(n.responses);
    n.exempt=n.roster.filter(id=>current.has(id)&&leave.has(id));
    n.roleExempt=n.roster.filter(id=>current.has(id)&&!leave.has(id)&&exemptRoles.has(id));
    n.missing=n.roster.filter(id=>current.has(id)&&!leave.has(id)&&!exemptRoles.has(id)&&!responded.has(id));
    n.status='closing';return {missing:n.missing,exempt:n.exempt};
  });}
}
