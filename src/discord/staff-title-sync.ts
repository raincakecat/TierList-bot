import type {GuildMember} from 'discord.js';
import type {Config} from '../config.js';
import type {Store} from '../storage/store.js';

export class StaffTitleSync {
  private active=new Map<string,Promise<void>>();
  constructor(private store:Store,private config:()=>Config){}
  sync(member:GuildMember):Promise<void>{
    const running=this.active.get(member.id);if(running)return running;
    const task=this.apply(member).finally(()=>this.active.delete(member.id));this.active.set(member.id,task);return task;
  }
  private async apply(member:GuildMember){
    const c=this.config(),staffId=c.permissionGroups.staff[0],highId=c.permissionGroups.highStaff[0],ticketSupportId=c.staffTitles.ticketSupportRoleId;
    if(!staffId||!highId||(!c.staffTitles.staffRoleIds.length&&!c.staffTitles.highStaffRoleIds.length))return;
    const high=c.staffTitles.highStaffRoleIds.some(id=>member.roles.cache.has(id));
    const staffByTitle=c.staffTitles.staffRoleIds.some(id=>member.roles.cache.has(id));
    const grants=(await this.store.read(false)).staffTitleGrants?.[member.id]??{};
    const save=async()=>this.store.change(s=>{(s.staffTitleGrants??={})[member.id]={...grants};});
    if(high&&!member.roles.cache.has(highId)){await member.roles.add(highId,'High Staff title access');grants.highStaff=true;await save();}
    if(!high&&grants.highStaff&&member.roles.cache.has(highId)){await member.roles.remove(highId,'High Staff title removed');grants.highStaff=false;await save();}
    const staff=high||staffByTitle||(member.roles.cache.has(highId)&&!grants.highStaff);
    if(staff&&!member.roles.cache.has(staffId)){await member.roles.add(staffId,'Staff title access');grants.staff=true;await save();}
    if(!staff&&grants.staff&&member.roles.cache.has(staffId)){await member.roles.remove(staffId,'Staff title removed');grants.staff=false;await save();}
    if(ticketSupportId){
      if(staffByTitle&&!member.roles.cache.has(ticketSupportId)){await member.roles.add(ticketSupportId,'Ticket Support title access');grants.ticketSupport=true;await save();}
      if(!staffByTitle&&grants.ticketSupport&&member.roles.cache.has(ticketSupportId)){await member.roles.remove(ticketSupportId,'Ticket Support title removed');grants.ticketSupport=false;await save();}
    }
  }
}
