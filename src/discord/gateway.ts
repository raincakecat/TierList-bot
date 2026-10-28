import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { paginateLines } from './pages.js';
import { closeRequestPanel } from './close-request-panel.js';
import { queuePanels } from './queue-panel.js';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits, type Client, type Guild, type TextChannel, type MessageCreateOptions } from 'discord.js';
import { render, type Config } from '../config.js';
import { channelName, clearLists, enqueue, listTiers, removeQueue, restricted, tierName } from '../domain/service.js';
import { JobDeferred, REGIONS, type Job, type Player, type State, type Ticket, type Tier } from '../domain/types.js';
import { rolesFor } from '../domain/permissions.js';
import type { Store } from '../storage/store.js';
import { LeaveGateway } from './loa-gateway.js';

export class Gateway {
  public synchronizingRoles=new Set<string>();
  private panelCache=new Map<string,{payload:string;at:number}>();
  private panelTasks=new Map<string,Promise<void>>();
  constructor(private client:Client,private store:Store,private getConfig:()=>Config,private onTicketChannel?:(ticketId:string,channelId:string)=>void){}
  get config(){return this.getConfig();}
  async guild():Promise<Guild>{return this.client.guilds.fetch(this.config.community.guildId!);}
  private async member(guild:Guild,id:string){return guild.members.fetch({user:id,force:true}).catch(error=>{if([10007,10013].includes((error as {code:number}).code))return null;throw error;});}
  async text(id:string):Promise<TextChannel>{const guild=await this.guild(),ch=await guild.channels.fetch(id);if(!ch||ch.type!==ChannelType.GuildText)throw new Error('Configured text channel unavailable');return ch;}
  async job(job:Job,checkpoint:(key:string,value:unknown)=>Promise<void>):Promise<void>{
    const state=await this.store.read(false),ticket=job.data.ticketId?state.tickets[String(job.data.ticketId)]:undefined;
    switch(job.kind){
      case 'open':if(ticket)await this.open(ticket,job,checkpoint);break;
      case 'roles':{const p=state.players[String(job.data.playerId)];if(p)await this.playerRoles(p,state);break;}
      case 'queues':await this.queues();break;
      case 'lists':await this.lists();break;
      case 'result':await this.result(job,ticket,state,checkpoint);break;
      case 'notice':await this.notice(job,ticket,checkpoint);break;
      case 'deadline':{const d=ticket?.deadline;if(ticket?.status==='open'&&d&&d.at===job.data.at&&d.setter===job.data.setter&&ticket.channelId)await this.sendOnce(await this.text(ticket.channelId),job,{content:`<@${d.setter}> ⏳ This ticket has reached its deadline. Please review it.`,allowedMentions:{users:[d.setter],parse:[]}},checkpoint);break;}
      case 'archive':if(ticket)await this.archive(ticket,job,checkpoint);break;
      case 'loa':await new LeaveGateway(this.client,this.store,()=>this.config,this).job(job,checkpoint);await this.leavePanels();break;
    }
  }
  async failure(job:Job){const id=this.config.channels.operationalLog;if(!id)return;await(await this.text(id)).send({content:`An operation needs attention: ${job.kind}${job.data.ticketId?` for ticket ${String(job.data.ticketId)}`:''}${job.lastFailureCode?` (${job.lastFailureCode})`:''}. It is saved and will retry. No unsaved ticket will be deleted.`,allowedMentions:{parse:[]}});}
  private async destination(categoryId:string):Promise<string>{
    const guild=await this.guild(),channels=await guild.channels.fetch();
    const available=(id:string)=>channels.get(id)?.type===ChannelType.GuildCategory&&channels.filter(c=>c?.parentId===id).size<50;
    if(available(categoryId))return categoryId;
    for(const id of this.config.categories.overflow)if(available(id))return id;
    const existing=channels.filter(c=>c?.type===ChannelType.GuildCategory&&/^overflow\d+$/.test(c.name));
    for(const c of existing.values())if(c&&available(c.id))return c.id;
    const numbers=[...existing.values()].map(c=>Number(c!.name.replace('overflow','')));
    const category=await guild.channels.create({name:`overflow${Math.max(1,...numbers)+1}`,type:ChannelType.GuildCategory,permissionOverwrites:[{id:guild.id,type:0 as const,deny:[PermissionFlagsBits.ViewChannel]},{id:this.client.user!.id,type:1 as const,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels]}]});return category.id;
  }
  private async open(t:Ticket,j:Job,save:(k:string,v:unknown)=>Promise<void>){
    if(t.status==='closed')return;const guild=await this.guild();let ch:TextChannel;
    if(t.channelId){ch=await this.text(t.channelId);if(j.data.adopt&&j.data.preserveAccess){
      if(!ch.permissionOverwrites.cache.get(guild.id)?.deny.has(PermissionFlagsBits.ViewChannel))throw new Error('Legacy adoption requires a private channel.');
      const accessRoles=[...ch.permissionOverwrites.cache.values()].filter(o=>o.type===0&&o.id!==guild.id&&o.allow.has(PermissionFlagsBits.ViewChannel)).map(o=>o.id);
      await ch.permissionOverwrites.edit(this.client.user!.id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true,ManageChannels:true},{type:1});
      await this.store.change(s=>{s.tickets[t.id]!.accessRoles=accessRoles;});
    }else await ch.permissionOverwrites.set([{id:guild.id,type:0 as const,deny:[PermissionFlagsBits.ViewChannel]},{id:this.client.user!.id,type:1 as const,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]},...t.accessRoles.map(id=>({id,type:0 as const,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]})),...[...new Set([t.opener,...t.participants,...(t.tester?[t.tester]:[])])].map(id=>({id,type:1 as const,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}))]);}else{
      const found=(await guild.channels.fetch()).find(c=>c?.type===ChannelType.GuildText&&c.topic===`crystal-ticket:${t.id}`);
      if(!found){const member=await guild.members.fetch(t.opener);t.openingDiscordUsername=member.user.username;t.name=t.type==='test'?testingTicketName(t,member.user.username):supportTicketName(t.type,member.user.username,t.opener);await this.store.change(s=>{s.tickets[t.id]!.name=t.name;s.tickets[t.id]!.openingDiscordUsername=t.openingDiscordUsername;});}
      ch=found?.type===ChannelType.GuildText?found:await guild.channels.create({name:t.name,type:ChannelType.GuildText,parent:await this.destination(t.categoryId),topic:`crystal-ticket:${t.id}`,permissionOverwrites:[{id:guild.id,type:0 as const,deny:[PermissionFlagsBits.ViewChannel]},{id:this.client.user!.id,type:1 as const,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]},...t.accessRoles.map(id=>({id,type:0 as const,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]})),...[t.opener,...t.participants].map(id=>({id,type:1 as const,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}))]});
      await this.store.change(s=>{s.tickets[t.id]!.channelId=ch.id;});
    }
    this.onTicketChannel?.(t.id,ch.id);
    const s=await this.store.read(false),p=s.players[t.opener]!;const mentions=[t.opener,...(t.tester?[t.tester]:[])];
    const embed=new EmbedBuilder().setColor(this.config.branding.colors.ticket as `#${string}`);
    const values=this.values(p,t);
    const components:ActionRowBuilder<ButtonBuilder>[]=[];
    if(t.type==='test'){
      if(t.target)mentions.push(...(this.config.ticketNotifications.highTestingRoleIds??rolesFor(this.config,['staff'])));
      embed.setTitle(render(this.config.templates.testOpeningTitle,values)).addFields({name:'User',value:`<@${t.opener}>`},...(t.tester?[{name:'Tester',value:`<@${t.tester}>`}]:[]),{name:'Region',value:t.region??'N/A'},{name:'Minecraft Username',value:t.openingIgn??'N/A'},{name:'Preferred Server',value:t.preferredServer??p.preferredServer??'N/A'},{name:'Previous Test',value:t.previousTestAt?`<t:${Math.floor(t.previousTestAt/1000)}:F>`:'N/A'});
      if(t.openingUuid??p.uuid)embed.setThumbnail(`https://visage.surgeplay.com/bust/128/${t.openingUuid??p.uuid}`);
    }else{
      const kind=this.config.supportTicketTypes.find(x=>x.key===t.type);embed.setTitle('Ticket Created').setDescription(render(kind?.openingMessage??'Welcome {userMention}! Please describe your request.',values));
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`supportclose:${t.id}`).setLabel('Close').setStyle(ButtonStyle.Secondary).setEmoji('🔒')));
      for(const r of (this.config.ticketNotifications.supportRoleIds??rolesFor(this.config,kind?.openingPingGroups??[])))mentions.push(r);
    }
    const content=[`<@${t.opener}>`,...(t.tester?[`<@${t.tester}>`]:[]),...mentions.filter(x=>!([t.opener,t.tester].includes(x))).map(id=>`<@&${id}>`)].join(' ');
    const silent=j.data.adopt&&j.data.silentAdoption;
    const message=await this.sendOnce(ch,j,{content,embeds:[embed],components,allowedMentions:{parse:[],users:silent?[]:[t.opener,...(t.tester?[t.tester]:[])],roles:silent?[]:mentions.filter(x=>x!==t.opener&&x!==t.tester)}},save);
    if(t.type!=='test')await message.pin('Ticket opening information');
    await this.store.change(s=>{const saved=s.tickets[t.id]!;saved.status='open';removeQueue(s,t.opener);enqueue(s,'queues',{},Date.now());});
  }
  private values(p:Player,t?:Ticket):Record<string,string>{return {communityName:this.config.community.name,userMention:`<@${p.id}>`,testerMention:t?.tester?`<@${t.tester}>`:'Unassigned',minecraftIgn:p.ign??'N/A',discordUsername:p.ign??p.id,region:p.region??'N/A',preferredServer:p.preferredServer??'N/A',previousRank:t?tierName(t.openingTier):tierName(p.tier),earnedRank:t?.outcome?tierName(t.outcome as Tier):tierName(p.tier),previousTest:t?tierName(t.openingTier):'N/A',deadline:'N/A'};}
  async playerRoles(p:Player,state?:State){
    const guild=await this.guild(),member=await this.member(guild,p.id);if(!member)return;
    const c=this.config,managed=[c.restriction.roleId,...Object.values(c.tierRoleIds),...REGIONS.flatMap(r=>[c.regions[r].regionRoleId,c.regions[r].waitlistRoleId])].filter((x):x is string=>!!x);
    const desired:string[]=[];if(p.tier!=='Unranked'&&c.tierRoleIds[p.tier])desired.push(c.tierRoleIds[p.tier]!);
    if(p.region&&c.regions[p.region].enabled){const r=c.regions[p.region];if(r.regionRoleId)desired.push(r.regionRoleId);if(p.uuid&&p.waitlist&&r.waitlistRoleId)desired.push(r.waitlistRoleId);}
    if(c.restriction.roleId&&restricted(state??await this.store.read(false),p,Date.now()))desired.push(c.restriction.roleId);
    // Add/remove only managed roles; preserve unrelated roles added by other systems.
    const remove=managed.filter(id=>member.roles.cache.has(id)&&!desired.includes(id)),add=desired.filter(id=>!member.roles.cache.has(id));
    this.synchronizingRoles.add(p.id);try{if(remove.length)await member.roles.remove(remove,'Player state synchronization');if(add.length)await member.roles.add(add,'Player state synchronization');}finally{this.synchronizingRoles.delete(p.id);}
  }
  private async result(j:Job,t:Ticket|undefined,s:State,save:(k:string,v:unknown)=>Promise<void>){
    const id=t?.opener??String(j.data.playerId),p=s.players[id]!;const guild=await this.guild(),member=await this.member(guild,id);
    const previous=t?.openingTier??j.data.previousTier as Tier,earned=t?.outcome??j.data.earnedTier??p.tier;
    const values=this.values(p,t);values.discordUsername=member?.user.username??p.ign??id;values.earnedRank=tierName(earned as Tier);values.previousRank=tierName(previous??'Unranked');
    const embed=new EmbedBuilder().setTitle(render(this.config.templates.resultTitle,values)).setColor(this.config.branding.colors.result as `#${string}`).addFields({name:'Tester',value:t?.tester?`<@${t.tester}>`:`<@${String(j.data.actor)}>`},{name:'Region',value:String(t?.region??j.data.region??p.region??'N/A')},{name:'Username',value:t?.openingIgn??String(j.data.ign??p.ign??'N/A')},{name:'Previous Rank',value:values.previousRank!},{name:'Rank Earned',value:values.earnedRank!});
    if(t?.openingUuid??p.uuid)embed.setThumbnail(`https://visage.surgeplay.com/bust/128/${t?.openingUuid??p.uuid}`);
    const message=await this.sendOnce(await this.text(this.config.channels.results!),j,{content:render(this.config.templates.resultAboveEmbed,values),embeds:[embed],allowedMentions:{users:[id],parse:[]}},save);
    for(const emoji of ['👑','🥳','😱','😭','😂','💀'])await message.react(emoji);
  }
  private async notice(j:Job,t:Ticket|undefined,save:(k:string,v:unknown)=>Promise<void>){
    if(t?.status==='closed'||(t?.status==='closing'&&['access','rename','passeval','type','close-request'].includes(String(j.data.event))))return;const ch=await this.text(t?.channelId??String(j.data.channelId));
    if(j.data.event==='delete-transient'){try{await ch.messages.delete(String(j.data.messageId));}catch(error){if((error as {code?:number}).code!==10008)throw error;}return;}
    if(j.data.queueOpening||j.data.here){
      const s=await this.store.read(false),region=j.data.region as typeof REGIONS[number];
      if(j.checkpoints.pingRegistered||s.jobs[`delete-${j.id}`])return;
      const sessionAt=Number(j.data.sessionAt??s.lastTestingSession?.[region]??0);
      if(!REGIONS.includes(region)||!this.config.modules.testing||!this.config.regions[region].enabled||s.maintenance||!Object.values(s.testers).includes(region)||(s.lastTestingSession?.[region]??0)!==sessionAt)return;
      const role=this.config.regions[region].waitlistRoleId;if(!role)throw new Error('Regional waitlist role is not configured');
      const message=await this.sendOnce(ch,j,{content:`<@&${role}>`,allowedMentions:{parse:[],roles:[role]}},save);
      await this.store.change(s=>{s.panels[`queue-ping:${region}:${sessionAt}:${ch.id}:${j.id}`]=message.id;});
      await save('pingRegistered',true);
      await this.store.change(s=>{enqueue(s,'queues',{},Date.now());});return;
    }
    if(t&&['close-request','close-request-update'].includes(String(j.data.event))){
      const r=t.closeRequests?.find(r=>r.id===j.data.requestId);if(!r)return;
      const payload=closeRequestPanel(this.config,t,r);
      if(j.data.event==='close-request'){
        const message=await this.sendOnce(ch,j,{...payload,content:`<@${t.opener}>`,allowedMentions:{parse:[],users:r.status==='pending'?[t.opener]:[]}},save);
        await this.store.change(s=>{const current=s.tickets[t.id]?.closeRequests?.find(x=>x.id===r.id);if(current){current.messageId=message.id;if(current.status!==r.status)enqueue(s,'notice',{ticketId:t.id,event:'close-request-update',requestId:r.id},Date.now());}});
      }else{if(!r.messageId)throw new Error('Closure request message is not published yet.');const message=await ch.messages.fetch(r.messageId).catch((e:unknown)=>{if((e as {code?:number}).code===10008)return null;throw e;});if(message)await message.edit({...payload,allowedMentions:{parse:[]}});}
      return;
    }
    if(t&&['access','rename','passeval','type'].includes(String(j.data.event))){
      if(j.data.event==='access'){const guild=await this.guild();for(const id of new Set([t.opener,...t.participants]))if(await this.member(guild,id))await ch.permissionOverwrites.edit(id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},{type:1});if(j.data.remove)await ch.permissionOverwrites.delete(String(j.data.remove)).catch(error=>{if((error as {code:number}).code!==10009)throw error;});}
      if(j.data.event==='rename')await ch.setName(t.name);
      if(j.data.event==='passeval'){await ch.setParent(await this.destination(t.categoryId),{lockPermissions:false});await ch.setName(t.name);}
      if(j.data.event==='type'){for(const role of (j.data.previousRoles as string[]))if(!t.accessRoles.includes(role))await ch.permissionOverwrites.delete(role).catch(error=>{if((error as {code:number}).code!==10009)throw error;});for(const role of t.accessRoles)await ch.permissionOverwrites.edit(role,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true},{type:0});await ch.setParent(await this.destination(t.categoryId),{lockPermissions:false});const kind=this.config.supportTicketTypes.find(k=>k.key===t.type);const roles=(this.config.ticketNotifications.supportRoleIds??rolesFor(this.config,kind?.openingPingGroups??[]));if(roles.length){const sub:Job={...j,id:`${j.id}-type-ping`,checkpoints:{...j.checkpoints,messageId:j.checkpoints.typePingMessageId}};await this.sendOnce(ch,sub,{content:roles.map(id=>`<@&${id}>`).join(' '),allowedMentions:{parse:[],roles}},async(k,v)=>{if(k==='messageId')await save('typePingMessageId',v);});}}
    }
    await this.sendOnce(ch,j,{content:String(j.data.content),allowedMentions:{parse:[],users:(j.data.mentions as string[]|undefined)??[]}},save);
    if(j.data.event==='passeval'&&!j.checkpoints.template){const sub:Job={...j,id:j.id+'-template',checkpoints:{messageId:j.checkpoints.templateMessageId}};await this.sendOnce(ch,sub,{content:this.fightTemplate(t!,'HT3'),allowedMentions:{parse:[]}},async(k,v)=>{if(k==='messageId')await save('templateMessageId',v);});await save('template',true);}
  }
  fightTemplate(t:Ticket,tier:Tier):string {
    const stages:Partial<Record<Tier,Tier[]>>={HT3:['HT3'],LT2:['HT3','LT2'],HT2:['LT2','HT2'],LT1:['LT2','HT2','LT1'],HT1:['LT2','HT2','LT1','HT1']};
    return `<@${t.opener}> - ${t.openingIgn??'Player'} - **Promoted to/Failed ${tierName(tier)}**\n\n${tier==='HT3'?'*Passed Evaluation*\n':''}${(stages[tier]??[tier]).map(stage=>`__**${stage} Fights:**__\n> Won/Lost 0-0 vs. (IGN)${tier==='HT3'?'':'\n> Won/Lost 0-0 vs. (IGN)'}`).join('\n\n')}`;
  }
  async sendOnce(ch:TextChannel,j:Job,options:MessageCreateOptions,save:(k:string,v:unknown)=>Promise<void>){
    if(j.checkpoints.messageId){const found=await ch.messages.fetch(String(j.checkpoints.messageId)).catch((error:unknown)=>{if((error as {code?:number}).code===10008)return null;throw error;});if(found)return found;}
    const nonce=createHash('sha256').update(j.id).digest('hex').slice(0,24),reference=`Reference ${j.id}`;
    const fileNames=(options.files??[]).map(f=>typeof f==='string'?f.split(/[\\/]/).pop():(f as {name?:string}).name);
    // Fresh jobs send immediately. Only interrupted deliveries need a bounded history lookup.
    if(j.attempts>0||j.checkpoints.recovery){
      const since=Number(j.checkpoints.deliveryStartedAt??j.createdAt??0)-5000;let before:string|undefined;
      for(;;){const batch=await ch.messages.fetch({limit:100,before});const found=batch.find(m=>m.author.id===this.client.user!.id&&(String(m.nonce??'')===nonce||m.embeds.some(e=>e.footer?.text===reference)||(m.createdTimestamp>=since&&deliverySignature(m.content,m.embeds)===deliverySignature(options.content??'',options.embeds??[])&&(!fileNames.length||(fileNames.every(Boolean)&&JSON.stringify([...m.attachments.values()].map(a=>a.name).sort())===JSON.stringify([...fileNames].sort()))))));
        if(found){await save('messageId',found.id);return found;}
        if(batch.size<100||(batch.last()?.createdTimestamp??0)<since)break;before=batch.last()!.id;
      }
    }
    const message=await ch.send({...options,nonce,enforceNonce:true});await save('messageId',message.id);return message;
  }
  private async upsertPanel(key:string,ch:TextChannel,options:MessageCreateOptions){
    const task=(this.panelTasks.get(key)??Promise.resolve()).catch(()=>{}).then(()=>this.upsertPanelNow(key,ch,options));this.panelTasks.set(key,task);
    try{await task;}finally{if(this.panelTasks.get(key)===task)this.panelTasks.delete(key);}
  }
  private async upsertPanelNow(key:string,ch:TextChannel,options:MessageCreateOptions){
    const payload=JSON.stringify(options),cached=this.panelCache.get(key);if(cached?.payload===payload&&Date.now()-cached.at<60_000)return;
    const s=await this.store.read(false),old=s.panels[key];const found=old?await ch.messages.fetch(old).catch(error=>{if((error as {code:number}).code===10008)return null;throw error;}):null;
    if(found){await found.edit({content:options.content,embeds:options.embeds,components:options.components,allowedMentions:{parse:[]}});this.panelCache.set(key,{payload,at:Date.now()});return;}
    const message=await ch.send({...options,allowedMentions:{parse:[]}});await this.store.change(s=>{s.panels[key]=message.id;});this.panelCache.set(key,{payload,at:Date.now()});
  }
  async panels(){const c=this.config;
    await this.leavePanels();
    if(c.modules.testing)await this.upsertPanel('verification',await this.text(c.channels.verificationPanel!),{embeds:[new EmbedBuilder().setTitle("📝 Evaluation Testing Waitlist").setDescription(render(c.templates.verificationPanel,{communityName:c.community.name})).setColor(c.branding.colors.panel as `#${string}`)],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('verify').setLabel('Verify Account').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('waitlist').setLabel('Enter Waitlist').setStyle(ButtonStyle.Primary))]});
    await this.supportPanels();
    await this.queues();await this.lists();
  }
  async supportPanels(){const c=this.config;if(!c.modules.supportTickets)return;
    const kinds=c.supportTicketTypes.filter(t=>t.enabled),keep=new Set<string>(),channel=await this.text(c.channels.supportPanel!);
    for(let page=0;page<Math.ceil(kinds.length/15);page++){
      const key=`support:${page}`,slice=kinds.slice(page*15,page*15+15),components:ActionRowBuilder<ButtonBuilder>[]=[];keep.add(key);
      for(let offset=0;offset<slice.length;offset+=3)components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(slice.slice(offset,offset+3).map(t=>new ButtonBuilder().setCustomId(`support:${t.key}`).setLabel(t.name).setStyle(t.key==='general-support'?ButtonStyle.Primary:ButtonStyle.Secondary))));
      await this.upsertPanel(key,channel,{embeds:[new EmbedBuilder().setTitle('Contact Support').setDescription(render(c.templates.supportPanel,{communityName:c.community.name})).setColor(c.branding.colors.panel as `#${string}`)],components});
    }await this.removePanelPages('support',keep,channel.id);
  }
  async leavePanels(){const c=this.config,s=await this.store.read(false);if(!c.channels.requestLoa||(!c.modules.loa&&!s.panels.loa))return;const channel=await this.text(c.channels.requestLoa);
    const embed=new EmbedBuilder().setTitle('🗓️ Staff Leave Portal').setAuthor({name:c.community.name,...(c.branding.iconUrl?{iconURL:c.branding.iconUrl}:{})}).setDescription(render(c.templates.loaPanel,{communityName:c.community.name})).setColor(c.branding.colors.panel as `#${string}`).setFooter({text:'Leave requests • Reviewed by the LOA team'});
    await this.upsertPanel('loa',channel,{embeds:[embed],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('loa:request').setLabel('Request Leave of Absence').setStyle(ButtonStyle.Primary).setDisabled(!c.modules.loa||s.maintenance))]});
    const active=Object.values(s.leaves??{}).filter(l=>l.status==='active'&&l.endsAt!>Date.now()).sort((a,b)=>a.endsAt!-b.endsAt!||a.memberId.localeCompare(b.memberId));
    const lines=['Staff members currently on approved leave.','',`**On LOA (${active.length})**`,...active.map(l=>`<@${l.memberId}> — returns <t:${Math.floor(l.endsAt!/1000)}:D> (<t:${Math.floor(l.endsAt!/1000)}:R>)` )];if(!active.length)lines.push('No staff members are currently on LOA.');const pages=paginateLines(lines),keep=new Set<string>();
    for(let page=0;page<pages.length;page++){const key=`loa-active:${page}`;keep.add(key);await this.upsertPanel(key,channel,{embeds:[new EmbedBuilder().setTitle('🌙 Members on LOA'+(pages.length>1?` (${page+1}/${pages.length})`:'' )).setDescription(pages[page]!).setColor(c.branding.colors.panel as `#${string}`).setFooter({text:'Updates automatically when approved leave changes'}).setTimestamp()],components:[]});}await this.removePanelPages('loa-active',keep,channel.id);
  }
  private async removePanelPages(prefix:string,keep:Set<string>,channelId:string){
    const state=await this.store.read(false);for(const [key,id]of Object.entries(state.panels)){if(!(key===prefix||key.startsWith(prefix+':'))||keep.has(key))continue;
      const channel=await this.text(channelId);let message;try{message=await channel.messages.fetch(id);}catch(error){if((error as {code?:number}).code!==10008)throw error;}
      if(message?.author.id===this.client.user!.id)await message.delete();
      await this.store.change(s=>{if(s.panels[key]===id)delete s.panels[key];});
    }
  }
  async queues(){const c=this.config;
    // Keep each opening's ping until its regional session closes, across restarts.
    const snapshot=await this.store.read(false);
    for(const key of Object.keys(snapshot.panels).filter(key=>key.startsWith('queue-ping:'))){
      const [,region,sessionAt,channelId]=key.split(':');const r=region as typeof REGIONS[number],current=await this.store.read(false);
      if(!REGIONS.includes(r)||!c.modules.testing||!c.regions[r].enabled||current.maintenance||!Object.values(current.testers).includes(r)||(current.lastTestingSession?.[r]??0)!==Number(sessionAt))await this.removePanelPages(key,new Set(),channelId!);
    }
    if(!c.modules.testing)return;const s=await this.store.read(false);for(const r of REGIONS)if(c.regions[r].enabled){
    const pages=queuePanels(c,s,r),keep=new Set<string>();for(let page=0;page<pages.length;page++){const key=page?`queue:${r}:${page}`:`queue:${r}`;keep.add(key);
      await this.upsertPanel(key,await this.text(c.regions[r].queueChannelId!),pages[page]!);
    }await this.removePanelPages(`queue:${r}`,keep,c.regions[r].queueChannelId!);
  }}
  async lists(){const c=this.config;if(!c.modules.tierLists)return;const snapshot=await this.store.read(false),guild=await this.guild();
    const ids=[...new Set(listTiers.flatMap(tier=>REGIONS.flatMap(r=>snapshot.lists[tier]?.[r]??[])))],names=new Map<string,string>(),missing=new Set<string>(),errors:unknown[]=[];let cursor=0;
    await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{while(cursor<ids.length){const id=ids[cursor++]!;try{const member=await guild.members.fetch({user:id,force:true});names.set(id,member.displayName??member.user.username??id);}catch(error){if((error as {code?:number}).code===10007)missing.add(id);else errors.push(error);}}}));
    if(errors.length)throw errors[0];
    if(missing.size)await this.store.change(s=>{for(const id of missing)clearLists(s,id);});
    const state=await this.store.read(false);for(const tier of listTiers){const channelId=c.tierLists.channelIds[tier as keyof Config['tierLists']['channelIds']];if(!channelId)continue;
      const lines:string[]=[];for(const r of REGIONS)if(c.regions[r].enabled){const members=(state.lists[tier]?.[r]??[]).filter(id=>!missing.has(id)).map(id=>({id,name:names.get(id)??id}));members.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));lines.push(`**${r}**`,...(members.length?members.map(x=>`<@${x.id}>`):['No members listed']),'');}
      const chunks=paginateLines(lines),keep=new Set<string>();for(let page=0;page<chunks.length;page++){const key=`list:${tier}:${page}`;keep.add(key);await this.upsertPanel(key,await this.text(channelId),{embeds:[new EmbedBuilder().setTitle(`${tierName(tier)} List${page?` (${page+1})`:''}`).setDescription(chunks[page]!).setColor(c.branding.colors.panel as `#${string}`).setTimestamp()]});}await this.removePanelPages(`list:${tier}`,keep,channelId);
    }
  }
  private async archive(t:Ticket,j:Job,save:(k:string,v:unknown)=>Promise<void>){
    if(t.status==='closed')return;if(!t.channelId)throw new Error('Ticket has no channel');const guild=await this.guild();
    const channel=await guild.channels.fetch(t.channelId).catch(error=>{if((error as {code?:number}).code===10003)return null;throw error;});
    if(!channel){if(j.checkpoints.archived){await this.store.change(s=>s.tickets[t.id]!.status='closed');return;}throw new Error('Ticket channel missing before archival');}
    if(channel.type!==ChannelType.GuildText)throw new Error('Invalid ticket channel');
    if(!j.checkpoints.locked){
      let bulkLocked=false;
      if(channel.permissionOverwrites.cache?.size){
        const overwrites=[...channel.permissionOverwrites.cache.values()].map(o=>({id:o.id,type:o.type,allow:o.id===this.client.user!.id?o.allow.bitfield:o.allow.bitfield&~PermissionFlagsBits.SendMessages,deny:o.id===this.client.user!.id?o.deny.bitfield:o.deny.bitfield|PermissionFlagsBits.SendMessages}));
        try{await channel.permissionOverwrites.set(overwrites,'Lock ticket for archival');bulkLocked=true;}catch(error){if(![10007,10009,10011,10013].includes((error as {code:number}).code))throw error;}
      }
      if(!bulkLocked)for(const id of new Set([t.opener,...t.participants,...t.accessRoles])){
        const role=t.accessRoles.includes(id);
        try{await channel.permissionOverwrites.edit(id,{SendMessages:false},{type:role?0:1});}
        catch(error){
          const code=(error as {code:number}).code;
          if([10007,10013,10011].includes(code))continue;
          // Discord can report Unknown Overwrite for a member who has left.
          // Only skip it after confirming the target no longer exists.
          if(code===10009){
            if(role){if(!await guild.roles.fetch(id))continue;}
            else{const member=await guild.members.fetch({user:id,force:true}).catch(failure=>{if([10007,10013].includes((failure as {code:number}).code))return null;throw failure;});if(!member)continue;}
          }
          throw error;
        }
      }
      await save('locked',true);
    }
    const dir=join(t.archiveDirectory??this.config.archival.directory,t.id);await mkdir(dir,{recursive:true,mode:0o700});
    const transcript=join(dir,'transcript.md');
    const localTranscript=j.checkpoints.transcript?await stat(transcript).then(()=>true).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}):false;
    if(!j.checkpoints.archived&&!localTranscript){
      const messages=[];let before:string|undefined;for(;;){const batch=await channel.messages.fetch({limit:100,before});messages.push(...batch.values());if(batch.size<100)break;before=batch.last()!.id;await save('lastPage',before);}
      messages.sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
      const s=await this.store.read(false);let text=`# Ticket ${t.name}\n\n${JSON.stringify({...t,closedBy:j.data.actor,reason:j.data.reason},null,2)}\n\n`;
      text+='## Management history\n'+s.audit.filter(e=>e.target===t.id||e.target.startsWith(`${t.id}:`)).map(e=>`${new Date(e.at).toISOString()} | ${e.actor} | ${e.action} | ${e.target}`).join('\n')+'\n\n## Messages\n';
      for(const m of messages){text+=`\n### ${new Date(m.createdTimestamp).toISOString()} — ${m.author.username} (${m.author.id})\n${m.content}\n`;for(const e of m.embeds)text+=`\n${e.title??''}\n${e.description??''}\n${e.fields.map(f=>`${f.name}: ${f.value}`).join('\n')}\n`;
        for(const a of m.attachments.values()){text+=`\nAttachment: ${a.name} ${a.url}\n`;if(t.copyImages&&a.contentType?.startsWith('image/')&&!a.contentType.includes('svg')){const u=new URL(a.url);if(u.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname))throw new Error('Unrecognized attachment host');const filename=`image-${a.id}.bin`,file=join(dir,filename);try{await stat(file);}catch{if(a.size>25*1024*1024)throw new Error('Image is larger than supported evidence limit');const response=await fetch(u,{signal:AbortSignal.timeout(60_000),redirect:'error'});if(!response.ok||!response.body)throw new Error('Evidence image download failed');let length=0;const chunks:Uint8Array[]=[];for await(const chunk of response.body){length+=chunk.byteLength;if(length>25*1024*1024)throw new Error('Evidence image exceeds limit');chunks.push(chunk);}await writeFile(file+'.tmp',Buffer.concat(chunks),{mode:0o600});await rename(file+'.tmp',file);}text+=`Copied evidence: ${filename}\n`;}
      }}
      await writeFile(join(dir,'transcript.md.tmp'),text,{mode:0o600});await rename(join(dir,'transcript.md.tmp'),join(dir,'transcript.md'));await save('transcript',true);
    }
    if(!j.checkpoints.archived){
      const archive=await this.text(t.archiveChannelId),content=`Archived ${t.name}. Closed by <@${String(j.data.actor)}> — ${String(j.data.reason??'')}`;
      if((await stat(transcript)).size<=8*1024*1024)await this.sendOnce(archive,j,{content,files:[new AttachmentBuilder(transcript,{name:`${t.id}.md`})],allowedMentions:{parse:[]}},save);
      else{
        const parts=transcriptParts(await readFile(transcript));
        for(let part=0;part<parts.length;part++){
          const key=`archivePartMessageId:${part}`,sub:Job={...j,id:`${j.id}-part-${part}`,checkpoints:{...j.checkpoints,messageId:j.checkpoints[key]}};
          await this.sendOnce(archive,sub,{content:`${content}\nTranscript part ${part+1}/${parts.length}`,files:[new AttachmentBuilder(parts[part]!,{name:`${t.id}-part-${part+1}.md`})],allowedMentions:{parse:[]}},async(k,v)=>{if(k==='messageId')await save(key,v);});
        }
      }
      const at=Date.now();await writeFile(join(dir,'retention.json'),JSON.stringify({archivedAt:at,imageRetentionDays:t.imageRetentionDays}),{mode:0o600});await save('archived',at);
    }
    const archivedAt=Number(j.checkpoints.archived),deleteAt=archivedAt+(t.minimumDeletionDelaySeconds??this.config.archival.minimumDeletionDelaySeconds)*1000;if(Date.now()<deleteAt)throw new JobDeferred(deleteAt,'Waiting for safe deletion delay');
    if((await this.store.read(false)).maintenance)throw new Error('Deletion paused during maintenance');
    await channel.delete('Archived ticket');await this.store.change(s=>s.tickets[t.id]!.status='closed');
  }
  async cleanupImages(){const state=await this.store.read(false),roots=new Set([this.config.archival.directory,...Object.values(state.tickets).map(t=>t.archiveDirectory).filter((x):x is string=>!!x)].map(p=>resolve(p)));for(const root of roots){
    await mkdir(root,{recursive:true,mode:0o700});for(const entry of await readdir(root,{withFileTypes:true})){if(!entry.isDirectory()||!/^[a-f0-9-]{36}$/.test(entry.name))continue;const dir=join(root,entry.name);const marker=await readFile(join(dir,'retention.json'),'utf8').catch(()=>null);if(!marker)continue;
      let retention:{archivedAt:number;imageRetentionDays:number};try{retention=JSON.parse(marker);}catch{continue;}if(!Number.isFinite(retention.archivedAt)||!Number.isFinite(retention.imageRetentionDays)||retention.imageRetentionDays<=0||Date.now()-retention.archivedAt<retention.imageRetentionDays*86400000)continue;
      for(const file of await readdir(dir))if(/^image-\d+\.bin$/.test(file))await rm(join(dir,file));
    }
  }}
}

/** Support names use the Discord username; testing and adopted names remain separate. */
export function supportTicketName(type:string,username:string,fallback:string):string {
  const clean=channelName(username).replace(/-+/g,'-').replace(/^-|-$/g,'');
  const prefix=type==='general-support'?'support':type;
  return channelName(`${prefix}-${clean||fallback}`);
}

function deliverySignature(content:string,embeds:readonly unknown[]):string {
  return JSON.stringify([content,embeds.map(e=>{
    const value=(typeof (e as {toJSON?:unknown}).toJSON==='function'?(e as {toJSON:()=>unknown}).toJSON():e) as {title?:string;description?:string;color?:number;fields?:{name:string;value:string;inline?:boolean}[];footer?:{text?:string}};
    return {title:value.title??null,description:value.description??null,color:value.color??null,fields:(value.fields??[]).map(f=>[f.name,f.value,!!f.inline]),footer:value.footer?.text?.startsWith('Reference ')?null:value.footer?.text??null};
  })]);
}

export function testingTicketName(t:Pick<Ticket,'target'|'region'|'opener'>,username:string):string {
  const clean=channelName(username).replace(/-+/g,'-').replace(/^-|-$/g,'')||t.opener;
  return channelName(t.target?`${clean}-${t.target}-${t.region}`:`test-${clean}-${t.region}`);
}

/** Keep every UTF-8 code point intact and remain below Discord's upload cap. */
export function transcriptParts(data:Buffer,limit=7*1024*1024):Buffer[]{
  if(!Number.isSafeInteger(limit)||limit<4)throw new Error('Invalid transcript part size');
  const parts:Buffer[]=[];for(let start=0;start<data.length;){let end=Math.min(start+limit,data.length);while(end<data.length&&(data[end]!&0xc0)===0x80)end--;parts.push(data.subarray(start,end));start=end;}return parts;
}
