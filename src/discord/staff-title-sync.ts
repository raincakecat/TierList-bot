import {Routes,type Guild,type GuildMember} from 'discord.js';
import type {Config} from '../config.js';
import type {Store} from '../storage/store.js';

export class StaffTitleSync {
  private active=new Map<string,Promise<void>>();
  constructor(private store:Store,private config:()=>Config){}
  sync(member:GuildMember):Promise<void>{
    const running=this.active.get(member.id);if(running)return running;
    const task=this.apply(member).finally(()=>this.active.delete(member.id));this.active.set(member.id,task);return task;
  }
  async reconcile(guild:Guild):Promise<void>{
    const c=this.config(),staffId=c.permissionGroups.staff[0],highId=c.permissionGroups.highStaff[0],ticketSupportId=c.staffTitles.ticketSupportRoleId,cdId=c.permissionGroups.cdResetter[0];
    const seniorIds=this.cooldownSourceRoleIds(guild);
    const grants=new Set(Object.keys((await this.store.read(false)).staffTitleGrants??{}));
    const candidateIds:string[]=[];
    let after='0';
    while(true){
      const batch=await guild.client.rest.get(Routes.guildMembers(guild.id),{query:new URLSearchParams({limit:'1000',after})}) as {user?:{id:string;bot?:boolean};roles:string[]}[];
      for(const member of batch){
        if(!member.user||member.user.bot)continue;
        const staffTitle=c.staffTitles.staffRoleIds.some(id=>member.roles.includes(id));
        const highTitle=c.staffTitles.highStaffRoleIds.some(id=>member.roles.includes(id));
        if(grants.has(member.user.id)||(highTitle&&highId&&!member.roles.includes(highId))||((staffTitle||highTitle)&&staffId&&!member.roles.includes(staffId))||(staffTitle&&ticketSupportId&&!member.roles.includes(ticketSupportId))||(cdId&&seniorIds.some(id=>member.roles.includes(id))&&!member.roles.includes(cdId)))candidateIds.push(member.user.id);
      }
      if(batch.length<1000)break;
      after=batch.at(-1)?.user?.id??'';if(!after)throw Error('Discord returned a member page without a cursor.');
    }
    let index=0;
    const failures:string[]=[];
    await Promise.all(Array.from({length:Math.min(4,candidateIds.length)},async()=>{while(index<candidateIds.length){const id=candidateIds[index++]!;try{await this.sync(await guild.members.fetch({user:id,force:true}));}catch(error){failures.push(id);console.error(`Staff title sync failed for ${id}:`,error);}}}));
    if(failures.length)throw Error(`Staff title reconciliation failed for ${failures.length} member(s).`);
  }
  private async apply(member:GuildMember){
    const c=this.config(),staffId=c.permissionGroups.staff[0],highId=c.permissionGroups.highStaff[0],ticketSupportId=c.staffTitles.ticketSupportRoleId,cdId=c.permissionGroups.cdResetter[0];
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
    if(cdId){
      const senior=this.cooldownSourceRoleIds(member.guild).some(id=>member.roles.cache.has(id));
      if(senior&&!member.roles.cache.has(cdId)){await member.roles.add(cdId,'Regulator or higher cooldown access');grants.cdResetter=true;await save();}
      if(!senior&&grants.cdResetter&&member.roles.cache.has(cdId)){await member.roles.remove(cdId,'Regulator or higher role removed');grants.cdResetter=false;await save();}
    }
  }
  cooldownSourceRoleIds(guild:Guild):string[]{
    const c=this.config(),regulator=c.permissionGroups.regulator[0],cdId=c.permissionGroups.cdResetter[0];
    if(!regulator||!cdId)return [];
    const threshold=guild.roles.cache.get(regulator)?.position;
    if(threshold===undefined)return [];
    return guild.roles.cache.filter(role=>role.position>=threshold&&!role.managed&&role.id!==guild.id).map(role=>role.id);
  }
}
