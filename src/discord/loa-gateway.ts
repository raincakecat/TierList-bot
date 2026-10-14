import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type TextChannel } from 'discord.js';
import type { Config } from '../config.js';
import type { Job, Leave } from '../domain/types.js';
import { enqueue } from '../domain/service.js';
import type { Store } from '../storage/store.js';
import type { Gateway } from './gateway.js';

export function leaveControls(l:Leave,review:boolean){
  if(review&&l.status==='pending')return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`loa:accept:${l.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`loa:deny:${l.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`loa:withdraw:${l.id}`).setLabel('Withdraw Request').setStyle(ButtonStyle.Secondary))];
  if(!review&&l.status==='active')return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`loa:end:${l.id}`).setLabel('End My LOA').setStyle(ButtonStyle.Secondary))];return [];
}
export function leaveEmbed(l:Leave,c:Config){const e=new EmbedBuilder().setTitle(`Leave of Absence - ${l.status}`).setColor(c.branding.colors.panel as `#${string}`).addFields({name:'Member',value:`<@${l.memberId}>`},{name:'Username',value:l.username},{name:'Duration',value:`${l.days} day(s)`},{name:'Reason',value:l.reason},{name:'Requested',value:`<t:${Math.floor(l.requestedAt/1000)}:F>`});if(l.reviewedBy)e.addFields({name:'Reviewed by',value:`<@${l.reviewedBy}>`});if(l.startsAt!==undefined)e.addFields({name:'Starts',value:`<t:${Math.floor(l.startsAt/1000)}:F>`},{name:'Scheduled end',value:`<t:${Math.floor(l.endsAt!/1000)}:F>`});if(l.endedAt!==undefined)e.addFields({name:'Ended',value:`<t:${Math.floor(l.endedAt/1000)}:F>`});if(l.denialReason)e.addFields({name:'Denial reason',value:l.denialReason});if(l.endReason)e.addFields({name:'End reason',value:l.endReason});return e;}
export class LeaveGateway {
  constructor(private client:Client,private store:Store,private config:()=>Config,private gateway:Gateway){}
  async syncRole(memberId:string){const guild=await this.gateway.guild();let member;try{member=await guild.members.fetch({user:memberId,force:true});}catch(error){if((error as {code?:number}).code===10007)return;throw error;}
    const leaves=Object.values((await this.store.read()).leaves??{}).filter(l=>l.memberId===memberId),roles=new Set(leaves.map(l=>l.roleId));if(this.config().loa.roleId)roles.add(this.config().loa.roleId!);const active=new Set(leaves.filter(l=>l.status==='active'&&l.endsAt!>Date.now()).map(l=>l.roleId));
    for(const role of roles){if(active.has(role)){if(!member.roles.cache.has(role))await member.roles.add(role,'Approved LOA');}else if(member.roles.cache.has(role)){try{await member.roles.remove(role,'LOA ended');}catch(error){if((error as {code?:number}).code!==10011)throw error;}}}
  }
  async job(j:Job,save:(key:string,value:unknown)=>Promise<void>){const l=(await this.store.read()).leaves?.[String(j.data.leaveId)];if(!l)return;const event=String(j.data.event);
    // Reconcile current state, rather than replaying obsolete grants after early return.
    if(event!=='request'&&event!=='withdraw')await this.syncRole(l.memberId);
    await this.post(l.id,true,event==='request',j,save);
    if(l.startsAt!==undefined)await this.post(l.id,false,false,j,save);
    if(['accept','deny','expired','ended'].includes(event))await this.dm(l,event,j,save);
  }
  private async post(id:string,review:boolean,ping:boolean,j:Job,save:(key:string,value:unknown)=>Promise<void>){const l=(await this.store.read()).leaves![id]!,field=review?'reviewMessageId':'acceptedMessageId',ch=await this.gateway.text(review?l.reviewChannelId:l.acceptedChannelId);
    const sub:Job={...j,id:`loa-${review?'review':'accepted'}-${id}`,checkpoints:{messageId:l[field]}};
    const options={content:review&&ping&&l.status==='pending'?l.adminRoles.map(role=>`<@&${role}>`).join(' '):undefined,embeds:[leaveEmbed(l,this.config())],components:leaveControls(l,review),allowedMentions:{parse:[] as never[],roles:review&&ping&&l.status==='pending'?l.adminRoles:[]}};
    const message=await this.gateway.sendOnce(ch,sub,options,async(key,value)=>{if(key==='messageId')await this.store.change(s=>s.leaves![id]![field]=String(value));await save(field,value);});
    const current=(await this.store.read()).leaves![id]!;await message.edit({embeds:[leaveEmbed(current,this.config()).setFooter({text:`Reference ${sub.id}`})],components:leaveControls(current,review),allowedMentions:{parse:[]}});
  }
  private async dm(l:Leave,event:string,j:Job,save:(key:string,value:unknown)=>Promise<void>){if((await this.store.read()).leaves![l.id]!.notifications?.[event])return;
    const descriptions:Record<string,string>={accept:`Your LOA was approved for ${l.days} day(s). It ends <t:${Math.floor(l.endsAt!/1000)}:F>.`,deny:`Your LOA request was denied.\nReason: ${l.denialReason}`,expired:'Your leave of absence has expired.',ended:`Your leave of absence ended early.\nReason: ${l.endReason}`};
    try{const user=await this.client.users.fetch(l.memberId),channel=await user.createDM();const sub:Job={...j,id:`loa-dm-${l.id}-${event}`,checkpoints:{messageId:j.checkpoints.dmMessageId}};await this.gateway.sendOnce(channel as unknown as TextChannel,sub,{embeds:[new EmbedBuilder().setTitle('Leave of Absence Update').setDescription(descriptions[event]!).setColor(this.config().branding.colors.panel as `#${string}`)],allowedMentions:{parse:[]}},async(key,value)=>{if(key==='messageId')await save('dmMessageId',value);});await this.store.change(s=>{s.leaves![l.id]!.notifications??={};s.leaves![l.id]!.notifications![event]='sent';});
    }catch(error){if(![50007,10013].includes((error as {code:number}).code))throw error;await this.store.change(s=>{const leave=s.leaves![l.id]!;leave.notifications??={};if(leave.notifications[event])return;leave.notifications[event]='blocked';s.audit.push({id:randomUUID(),at:Date.now(),actor:'system',action:'loa-dm-blocked',target:l.id});if(this.config().channels.operationalLog)enqueue(s,'notice',{channelId:this.config().channels.operationalLog,content:`An LOA notification could not be delivered to <@${l.memberId}>. Decision: ${event}.`},Date.now(),`loa-dm-blocked-${l.id}-${event}`);});}
  }
}
