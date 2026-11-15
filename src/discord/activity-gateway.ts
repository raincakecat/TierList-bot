import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,PermissionFlagsBits,type Client,type Guild,type GuildMember,type TextChannel} from 'discord.js';
import type {Config} from '../config.js';
import {allowed} from '../domain/permissions.js';
import {ActivityService} from '../domain/activity.js';
import {JobDeferred,UserError,type Actor,type ActivityNotice,type Job} from '../domain/types.js';
import type {Store} from '../storage/store.js';
import {paginateLines} from './pages.js';
import type {Gateway} from './gateway.js';

export class ActivityGateway {
  private service:ActivityService;
  constructor(private client:Client,private store:Store,private config:()=>Config,private gateway:Gateway){this.service=new ActivityService(store,config);}
  private async members(guild:Guild){
    const fresh=await guild.fetch();const members=await guild.members.fetch({time:30_000});
    if(members.size<fresh.memberCount)throw new Error('Staff roster could not be fetched completely');
    return members;
  }
  private async channels(guild:Guild,noticeId:string,reportId:string,staffRoles:string[],members:Map<string,GuildMember>){
    const [notice,report,me,roles]=await Promise.all([this.gateway.text(noticeId),this.gateway.text(reportId),guild.members.fetchMe(),guild.roles.fetch()]);
    if(notice.id===report.id)throw new UserError('Notice and private report must use separate channels.');
    const needed=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.EmbedLinks];
    if(!notice.permissionsFor(me)?.has(needed)||!report.permissionsFor(me)?.has(needed))throw new UserError('The bot needs view, send, history and embed permissions in both activity channels.');
    for(const id of staffRoles){const role=roles.get(id);if(!role||!notice.permissionsFor(role)?.has(PermissionFlagsBits.ViewChannel))throw new UserError('Staff must be able to view the notice channel.');if(!role.mentionable&&!notice.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone))throw new UserError('The bot cannot mention the configured Staff role.');}
    if(report.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))throw new UserError('The activity report channel must be private.');
    const c=this.config();
    for(const m of members.values()){
      if(m.user.bot||m.permissions.has(PermissionFlagsBits.Administrator))continue;
      const actor:Actor={id:m.id,roles:[...m.roles.cache.keys()],administrator:false};
      if(!allowed(c,actor,'highStaff')&&!allowed(c,actor,'botAdmin')&&!allowed(c,actor,'owner')&&report.permissionsFor(m)?.has(PermissionFlagsBits.ViewChannel))throw new UserError('The activity report channel is visible to someone outside High Staff, Bot Admins and Owners.');
    }
    return {notice,report};
  }
  async start(a:Actor){
    const c=this.config(),options=c.activity;
    if(!options.enabled||!options.noticeChannelId||!options.reportChannelId||!c.loa.roleId||!c.permissionGroups.staff.length)throw new UserError('Activity notice channels, Staff and LOA roles must be configured first.');
    if(!allowed(c,a,'highStaff')&&!allowed(c,a,'botAdmin')&&!allowed(c,a,'owner'))throw new UserError('You do not have permission to start an activity notice.');
    const guild=await this.gateway.guild(),members=await this.members(guild);await this.channels(guild,options.noticeChannelId,options.reportChannelId,c.permissionGroups.staff,members);
    const roster=[...members.values()].filter(m=>!m.user.bot&&c.permissionGroups.staff.some(id=>m.roles.cache.has(id))).map(m=>m.id);
    return this.service.start(a,roster,options.noticeChannelId,options.reportChannelId,c.permissionGroups.staff,c.loa.roleId);
  }
  private panel(n:ActivityNotice,closed:boolean){
    const description=closed?'This activity notice has closed.':`Staff: click the button below to confirm you are active.\n${n.closesAt?`Closes <t:${Math.floor(n.closesAt/1000)}:R>.`:'This notice lasts 24 hours after posting.'}`;
    const embed=new EmbedBuilder().setTitle('Staff Activity Notice').setDescription(description).setColor(this.config().branding.colors.panel as `#${string}`);
    const button=new ButtonBuilder().setCustomId(`activity:${n.id}`).setLabel("I'm Active").setStyle(ButtonStyle.Primary).setDisabled(closed);
    return {embeds:[embed],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(button)]};
  }
  async job(j:Job,save:(key:string,value:unknown)=>Promise<void>){
    let n=(await this.store.read(false)).activityNotices?.[String(j.data.activityId)];if(!n)throw new Error('Activity notice missing');
    if(j.data.event==='open'){
      const guild=await this.gateway.guild(),members=await this.members(guild),{notice}=await this.channels(guild,n.noticeChannelId,n.reportChannelId,n.staffRoleIds,members);
      const message=await this.gateway.sendOnce(notice,j,{content:n.staffRoleIds.map(id=>`<@&${id}>`).join(' '),...this.panel(n,false),allowedMentions:{parse:[],roles:n.staffRoleIds}},save);
      await this.service.posted(n.id,message.id,message.createdTimestamp);
      n=(await this.store.read(false)).activityNotices![n.id]!;
      await message.edit({...this.panel(n,false),allowedMentions:{parse:[]}});return;
    }
    if(j.data.event!=='close')throw new Error('Invalid activity job');
    if(n.status==='closed')return;
    if(n.status==='open'&&n.closesAt!>Date.now())throw new JobDeferred(n.closesAt!,'Waiting for activity deadline');
    const notice=await this.gateway.text(n.noticeChannelId);
    if(n.messageId){const message=await notice.messages.fetch(n.messageId).catch(e=>{if((e as {code?:number}).code===10008)return null;throw e;});if(message)await message.edit({...this.panel(n,true),allowedMentions:{parse:[]}});}
    const guild=await this.gateway.guild(),members=await this.members(guild),{report}=await this.channels(guild,n.noticeChannelId,n.reportChannelId,n.staffRoleIds,members);
    if(n.status==='open'){
      const exemptionRoles=this.config().activity.exemptRoleIds,roles=await guild.roles.fetch();
      if(exemptionRoles.some(id=>!roles.has(id)))throw new Error('Activity exemption role is missing');
      const staff=[...members.values()].filter(m=>!m.user.bot&&n!.staffRoleIds.some(id=>m.roles.cache.has(id)));
      await this.service.finish(n.id,staff.map(m=>m.id),staff.filter(m=>m.roles.cache.has(n!.loaRoleId)).map(m=>m.id),staff.filter(m=>exemptionRoles.some(id=>m.roles.cache.has(id))).map(m=>m.id));
      n=(await this.store.read(false)).activityNotices![n.id]!;
    }
    const rows=[`**Did not respond (${n.missing?.length??0})**`,...(n.missing?.length?n.missing.map(id=>`<@${id}>`):['None.']), '',`**LOA exempt (${n.exempt?.length??0})**`,...(n.exempt?.length?n.exempt.map(id=>`<@${id}>`):['None.']), ...(n.roleExempt?.length?['',`**Role exempt (${n.roleExempt.length})**`,...n.roleExempt.map(id=>`<@${id}>`)]:[])];
    const pages=paginateLines(rows,1700);
    for(let index=0;index<pages.length;index++){
      const key=`activityPage:${index}`,sub:Job={...j,id:`${j.id}-page-${index}`,checkpoints:{...j.checkpoints,messageId:j.checkpoints[key]}};
      await this.gateway.sendOnce(report,sub,{content:`**Staff activity results${pages.length>1?` (${index+1}/${pages.length})`:''}**\n${pages[index]}`,allowedMentions:{parse:[]}},async(k,v)=>{if(k==='messageId')await save(key,v);});
    }
    await this.store.change(s=>{const saved=s.activityNotices?.[n!.id];if(saved?.status==='closing')saved.status='closed';});
  }
}
