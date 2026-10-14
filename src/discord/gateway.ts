import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { paginateLines } from './pages.js';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder, type Client, type Guild, type TextChannel, type MessageCreateOptions } from 'discord.js';
import { render, type Config } from '../config.js';
import { enqueue, listTiers, removeQueue, tierName } from '../domain/service.js';
import { REGIONS, type Job, type Player, type State, type Ticket, type Tier } from '../domain/types.js';
import { rolesFor } from '../domain/permissions.js';
import type { Store } from '../storage/store.js';
import { LeaveGateway } from './loa-gateway.js';

export class Gateway {
  public synchronizingRoles=new Set<string>();
  constructor(private client:Client,private store:Store,private getConfig:()=>Config){}
  get config(){return this.getConfig();}
  async guild():Promise<Guild>{return this.client.guilds.fetch(this.config.community.guildId!);}
  async text(id:string):Promise<TextChannel>{const guild=await this.guild(),ch=await guild.channels.fetch(id);if(!ch||ch.type!==ChannelType.GuildText)throw new Error('Configured text channel unavailable');return ch;}
  async job(job:Job,checkpoint:(key:string,value:unknown)=>Promise<void>):Promise<void>{
    const state=await this.store.read(),ticket=job.data.ticketId?state.tickets[String(job.data.ticketId)]:undefined;
    switch(job.kind){
      case 'open':if(ticket)await this.open(ticket,job,checkpoint);break;
      case 'roles':{const p=state.players[String(job.data.playerId)];if(p)await this.playerRoles(p);break;}
      case 'queues':await this.queues();break;
      case 'lists':await this.lists();break;
      case 'result':await this.result(job,ticket,state,checkpoint);break;
      case 'notice':await this.notice(job,ticket,checkpoint);break;
      case 'deadline':{const d=ticket?.deadline;if(ticket?.status==='open'&&d&&d.at===job.data.at&&d.setter===job.data.setter&&ticket.channelId)await this.sendOnce(await this.text(ticket.channelId),job,{content:`<@${d.setter}> ⏳ This ticket has reached its deadline. Please review it.`,allowedMentions:{users:[d.setter],parse:[]}},checkpoint);break;}
      case 'archive':if(ticket)await this.archive(ticket,job,checkpoint);break;
      case 'loa':await new LeaveGateway(this.client,this.store,()=>this.config,this).job(job,checkpoint);await this.leavePanels();break;
    }
  }
  async failure(job:Job){const id=this.config.channels.operationalLog;if(!id)return;await(await this.text(id)).send({content:`An operation needs attention: ${job.kind}${job.data.ticketId?` for ticket ${String(job.data.ticketId)}`:''}. It is saved and will retry. No unsaved ticket will be deleted.`,allowedMentions:{parse:[]}});}
  private async destination(categoryId:string):Promise<string>{
    const guild=await this.guild(),channels=await guild.channels.fetch();
    const available=(id:string)=>channels.get(id)?.type===ChannelType.GuildCategory&&channels.filter(c=>c?.parentId===id).size<50;
    if(available(categoryId))return categoryId;
    for(const id of this.config.categories.overflow)if(available(id))return id;
    const existing=channels.filter(c=>c?.type===ChannelType.GuildCategory&&/^overflow\d+$/.test(c.name));
    for(const c of existing.values())if(c&&available(c.id))return c.id;
    const numbers=[...existing.values()].map(c=>Number(c!.name.replace('overflow','')));
    const category=await guild.channels.create({name:`overflow${Math.max(1,...numbers)+1}`,type:ChannelType.GuildCategory,permissionOverwrites:[{id:guild.id,deny:[PermissionFlagsBits.ViewChannel]},{id:this.client.user!.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels]}]});return category.id;
  }
  private async open(t:Ticket,j:Job,save:(k:string,v:unknown)=>Promise<void>){
    if(t.status==='closed')return;const guild=await this.guild();let ch:TextChannel;
    if(t.channelId){ch=await this.text(t.channelId);await ch.permissionOverwrites.set([{id:guild.id,deny:[PermissionFlagsBits.ViewChannel]},{id:this.client.user!.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]},...t.accessRoles.map(id=>({id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]})),...[...new Set([t.opener,...t.participants,...(t.tester?[t.tester]:[])])].map(id=>({id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}))]);}else{
      const found=(await guild.channels.fetch()).find(c=>c?.type===ChannelType.GuildText&&c.topic===`crystal-ticket:${t.id}`);
      ch=found?.type===ChannelType.GuildText?found:await guild.channels.create({name:t.name,type:ChannelType.GuildText,parent:await this.destination(t.categoryId),topic:`crystal-ticket:${t.id}`,permissionOverwrites:[{id:guild.id,deny:[PermissionFlagsBits.ViewChannel]},{id:this.client.user!.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels]},...t.accessRoles.map(id=>({id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]})),...[t.opener,...t.participants].map(id=>({id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]}))]});
      await this.store.change(s=>{s.tickets[t.id]!.channelId=ch.id;});
    }
    const s=await this.store.read(),p=s.players[t.opener]!;const mentions=[t.opener,...(t.tester?[t.tester]:[])];
    const embed=new EmbedBuilder().setColor(this.config.branding.colors.ticket as `#${string}`);
    const values=this.values(p,t);
    const components:ActionRowBuilder<ButtonBuilder>[]=[];
    if(t.type==='test'){
      embed.setTitle(render(this.config.templates.testOpeningTitle,values)).addFields({name:'User',value:`<@${t.opener}>`},...(t.tester?[{name:'Tester',value:`<@${t.tester}>`}]:[]),{name:'Region',value:t.region??'N/A'},{name:'Minecraft Username',value:t.openingIgn??'N/A'},{name:'Preferred Server',value:t.preferredServer??p.preferredServer??'N/A'},{name:'Previous Test',value:t.previousTestAt?`<t:${Math.floor(t.previousTestAt/1000)}:F>`:'N/A'});
      if(t.openingUuid??p.uuid)embed.setThumbnail(`https://visage.surgeplay.com/bust/128/${t.openingUuid??p.uuid}`);
    }else{
      const kind=this.config.supportTicketTypes.find(x=>x.key===t.type);embed.setTitle('Ticket Created').setDescription(render(kind?.openingMessage??'Welcome {userMention}! Please describe your request.',values));
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`supportclose:${t.id}`).setLabel('Close').setStyle(ButtonStyle.Secondary).setEmoji('🔒')));
      for(const r of rolesFor(this.config,kind?.openingPingGroups??[]))mentions.push(r);
    }
    const content=[`<@${t.opener}>`,...(t.tester?[`<@${t.tester}>`]:[]),...mentions.filter(x=>!([t.opener,t.tester].includes(x))).map(id=>`<@&${id}>`)].join(' ');
    const message=await this.sendOnce(ch,j,{content,embeds:[embed],components,allowedMentions:{parse:[],users:[t.opener,...(t.tester?[t.tester]:[])],roles:mentions.filter(x=>x!==t.opener&&x!==t.tester)}},save);
    if(t.type!=='test')await message.pin('Ticket opening information');
    await this.store.change(s=>{const saved=s.tickets[t.id]!;saved.status='open';removeQueue(s,t.opener);enqueue(s,'queues',{},Date.now());});
  }
  private values(p:Player,t?:Ticket):Record<string,string>{return {communityName:this.config.community.name,userMention:`<@${p.id}>`,testerMention:t?.tester?`<@${t.tester}>`:'Unassigned',minecraftIgn:p.ign??'N/A',discordUsername:p.ign??p.id,region:p.region??'N/A',preferredServer:p.preferredServer??'N/A',previousRank:t?tierName(t.openingTier):tierName(p.tier),earnedRank:t?.outcome?tierName(t.outcome as Tier):tierName(p.tier),previousTest:t?tierName(t.openingTier):'N/A',deadline:'N/A'};}
  async playerRoles(p:Player){
    const guild=await this.guild(),member=await guild.members.fetch(p.id).catch(()=>null);if(!member)return;
    const c=this.config,managed=[...Object.values(c.tierRoleIds),...REGIONS.flatMap(r=>[c.regions[r].regionRoleId,c.regions[r].waitlistRoleId])].filter((x):x is string=>!!x);
    const desired:string[]=[];if(p.tier!=='Unranked'&&c.tierRoleIds[p.tier])desired.push(c.tierRoleIds[p.tier]!);
    if(p.region&&c.regions[p.region].enabled){const r=c.regions[p.region];if(r.regionRoleId)desired.push(r.regionRoleId);if(p.uuid&&p.waitlist&&r.waitlistRoleId)desired.push(r.waitlistRoleId);}
    // Add/remove only managed roles; preserve unrelated roles added by other systems.
    const remove=managed.filter(id=>member.roles.cache.has(id)&&!desired.includes(id)),add=desired.filter(id=>!member.roles.cache.has(id));
    this.synchronizingRoles.add(p.id);try{if(remove.length)await member.roles.remove(remove,'Player state synchronization');if(add.length)await member.roles.add(add,'Player state synchronization');}finally{this.synchronizingRoles.delete(p.id);}
  }
  private async result(j:Job,t:Ticket|undefined,s:State,save:(k:string,v:unknown)=>Promise<void>){
    const id=t?.opener??String(j.data.playerId),p=s.players[id]!;const guild=await this.guild(),member=await guild.members.fetch(id).catch(()=>null);
    const previous=t?.openingTier??j.data.previousTier as Tier,earned=t?.outcome??j.data.earnedTier??p.tier;
    const values=this.values(p,t);values.discordUsername=member?.user.username??p.ign??id;values.earnedRank=tierName(earned as Tier);values.previousRank=tierName(previous??'Unranked');
    const embed=new EmbedBuilder().setTitle(render(this.config.templates.resultTitle,values)).setColor(this.config.branding.colors.result as `#${string}`).addFields({name:'Tester',value:t?.tester?`<@${t.tester}>`:`<@${String(j.data.actor)}>`},{name:'Region',value:String(t?.region??j.data.region??p.region??'N/A')},{name:'Username',value:t?.openingIgn??String(j.data.ign??p.ign??'N/A')},{name:'Previous Rank',value:values.previousRank!},{name:'Rank Earned',value:values.earnedRank!});
    if(t?.openingUuid??p.uuid)embed.setThumbnail(`https://visage.surgeplay.com/bust/128/${t?.openingUuid??p.uuid}`);
    const message=await this.sendOnce(await this.text(this.config.channels.results!),j,{content:render(this.config.templates.resultAboveEmbed,values),embeds:[embed],allowedMentions:{users:[id],parse:[]}},save);
    for(const emoji of ['👑','🥳','😱','😭','😂','💀'])await message.react(emoji);
  }
  private async notice(j:Job,t:Ticket|undefined,save:(k:string,v:unknown)=>Promise<void>){
    if(t?.status==='closed')return;const ch=await this.text(t?.channelId??String(j.data.channelId));
    if(t&&['access','rename','passeval','type'].includes(String(j.data.event))){
      if(j.data.event==='access'){for(const id of [t.opener,...t.participants])await ch.permissionOverwrites.edit(id,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});if(j.data.remove)await ch.permissionOverwrites.delete(String(j.data.remove));}
      if(j.data.event==='rename')await ch.setName(t.name);
      if(j.data.event==='passeval'){await ch.setParent(await this.destination(t.categoryId),{lockPermissions:false});await ch.setName(t.name);}
      if(j.data.event==='type'){for(const role of (j.data.previousRoles as string[]))if(!t.accessRoles.includes(role))await ch.permissionOverwrites.delete(role);for(const role of t.accessRoles)await ch.permissionOverwrites.edit(role,{ViewChannel:true,SendMessages:true,ReadMessageHistory:true});await ch.setParent(await this.destination(t.categoryId),{lockPermissions:false});const kind=this.config.supportTicketTypes.find(k=>k.key===t.type);const roles=rolesFor(this.config,kind?.openingPingGroups??[]);if(roles.length)await ch.send({content:roles.map(id=>`<@&${id}>`).join(' '),allowedMentions:{parse:[],roles}});}
    }
    await this.sendOnce(ch,j,{content:String(j.data.content),allowedMentions:j.data.here?{parse:['everyone']}:{parse:[],users:(j.data.mentions as string[]|undefined)??[]}},save);
    if(j.data.event==='passeval'&&!j.checkpoints.template){const sub:Job={...j,id:j.id+'-template',checkpoints:{messageId:j.checkpoints.templateMessageId}};await this.sendOnce(ch,sub,{content:this.fightTemplate(t!,'HT3'),allowedMentions:{parse:[]}},async(k,v)=>{if(k==='messageId')await save('templateMessageId',v);});await save('template',true);}
  }
  fightTemplate(t:Ticket,tier:Tier):string {
    const stages:Partial<Record<Tier,Tier[]>>={HT3:['HT3'],LT2:['HT3','LT2'],HT2:['LT2','HT2'],LT1:['LT2','HT2','LT1'],HT1:['LT2','HT2','LT1','HT1']};
    return `<@${t.opener}> - ${t.openingIgn??'Player'} - **Promoted to/Failed ${tierName(tier)}**\n\n${tier==='HT3'?'*Passed Evaluation*\n':''}${(stages[tier]??[tier]).map(stage=>`__**${stage} Fights:**__\n> Won/Lost 0-0 vs. (IGN)${tier==='HT3'?'':'\n> Won/Lost 0-0 vs. (IGN)'}`).join('\n\n')}`;
  }
  async sendOnce(ch:TextChannel,j:Job,options:MessageCreateOptions,save:(k:string,v:unknown)=>Promise<void>){
    if(j.checkpoints.messageId){const found=await ch.messages.fetch(String(j.checkpoints.messageId)).catch(()=>null);if(found)return found;}
    const reference=`Reference ${j.id}`;
    // Persisted reference permits recovery even after Discord's nonce window expires.
    let before:string|undefined;for(;;){const batch=await ch.messages.fetch({limit:100,before});const found=batch.find(m=>m.author.id===this.client.user!.id&&m.embeds.some(e=>e.footer?.text===reference));if(found){await save('messageId',found.id);return found;}if(batch.size<100)break;before=batch.last()!.id;}
    const embed=(options.embeds?.[0]?EmbedBuilder.from(options.embeds[0] as EmbedBuilder):new EmbedBuilder()).setFooter({text:reference});
    const nonce=createHash('sha256').update(j.id).digest('hex').slice(0,24);
    const message=await ch.send({...options,embeds:[embed,...(options.embeds?.slice(1)??[])],nonce,enforceNonce:true});await save('messageId',message.id);return message;
  }
  private async upsertPanel(key:string,ch:TextChannel,options:MessageCreateOptions){
    const s=await this.store.read(),old=s.panels[key];const found=old?await ch.messages.fetch(old).catch(()=>null):null;
    if(found){await found.edit({content:options.content,embeds:options.embeds,components:options.components,allowedMentions:{parse:[]}});return;}
    const message=await ch.send({...options,allowedMentions:{parse:[]}});await this.store.change(s=>{s.panels[key]=message.id;});
  }
  async panels(){const c=this.config;
    await this.leavePanels();
    if(c.modules.testing)await this.upsertPanel('verification',await this.text(c.channels.verificationPanel!),{embeds:[new EmbedBuilder().setTitle(`${c.community.name} | Testing`).setDescription(render(c.templates.verificationPanel,{communityName:c.community.name})).setColor(c.branding.colors.panel as `#${string}`)],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('verify').setLabel('Verify Account').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('waitlist').setLabel('Enter Waitlist').setStyle(ButtonStyle.Primary))]});
    if(c.modules.supportTickets){const kinds=c.supportTicketTypes.filter(t=>t.enabled);for(let page=0;page<Math.ceil(kinds.length/25);page++)await this.upsertPanel(`support:${page}`,await this.text(c.channels.supportPanel!),{embeds:[new EmbedBuilder().setTitle('Contact Support').setDescription(render(c.templates.supportPanel,{communityName:c.community.name})).setColor(c.branding.colors.panel as `#${string}`)],components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('support').setPlaceholder('Choose a ticket type').addOptions(kinds.slice(page*25,page*25+25).map(t=>({label:t.name,value:t.key}))))]});}
    await this.queues();await this.lists();
  }
  async leavePanels(){const c=this.config,s=await this.store.read();if(!c.channels.requestLoa||(!c.modules.loa&&!s.panels.loa))return;const channel=await this.text(c.channels.requestLoa);
    const embed=new EmbedBuilder().setTitle('🗓️ Staff Leave Portal').setAuthor({name:c.community.name,...(c.branding.iconUrl?{iconURL:c.branding.iconUrl}:{})}).setDescription(render(c.templates.loaPanel,{communityName:c.community.name})).setColor(c.branding.colors.panel as `#${string}`).setFooter({text:'Leave requests • Reviewed by the LOA team'});
    await this.upsertPanel('loa',channel,{embeds:[embed],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('loa:request').setLabel('Request Leave of Absence').setStyle(ButtonStyle.Primary).setDisabled(!c.modules.loa||s.maintenance))]});
    const active=Object.values(s.leaves??{}).filter(l=>l.status==='active'&&l.endsAt!>Date.now()).sort((a,b)=>a.endsAt!-b.endsAt!||a.memberId.localeCompare(b.memberId));
    const lines=['Staff members currently on approved leave.','',`**On LOA (${active.length})**`,...active.map(l=>`<@${l.memberId}> — returns <t:${Math.floor(l.endsAt!/1000)}:D> (<t:${Math.floor(l.endsAt!/1000)}:R>)` )];if(!active.length)lines.push('No staff members are currently on LOA.');const pages=paginateLines(lines),keep=new Set<string>();
    for(let page=0;page<pages.length;page++){const key=`loa-active:${page}`;keep.add(key);await this.upsertPanel(key,channel,{embeds:[new EmbedBuilder().setTitle('🌙 Members on LOA'+(pages.length>1?` (${page+1}/${pages.length})`:'' )).setDescription(pages[page]!).setColor(c.branding.colors.panel as `#${string}`).setFooter({text:'Updates automatically when approved leave changes'}).setTimestamp()],components:[]});}await this.removePanelPages('loa-active',keep,channel.id);
  }
  private async removePanelPages(prefix:string,keep:Set<string>,channelId:string){
    const state=await this.store.read();for(const [key,id]of Object.entries(state.panels)){if(!(key===prefix||key.startsWith(prefix+':'))||keep.has(key))continue;
      const channel=await this.text(channelId);let message;try{message=await channel.messages.fetch(id);}catch(error){if((error as {code?:number}).code!==10008)throw error;}
      if(message?.author.id===this.client.user!.id)await message.delete();
      await this.store.change(s=>{if(s.panels[key]===id)delete s.panels[key];});
    }
  }
  async queues(){const c=this.config;if(!c.modules.testing)return;const s=await this.store.read();for(const r of REGIONS)if(c.regions[r].enabled){const testers=Object.keys(s.testers).filter(id=>s.testers[id]===r),queue=s.queues[r];
    const lines=testers.length?['The queue updates every minute. Use /leave to leave.','','**Queue:**',...(queue.length?queue.map((id,i)=>`${i+1}. <@${id}>`):['Empty']),'','**Active Testers:**',...testers.map(id=>`<@${id}>`)]:['No testers for your region are available at this time. Check back later!'];
    const pages=paginateLines(lines),keep=new Set<string>();for(let page=0;page<pages.length;page++){const key=page?`queue:${r}:${page}`:`queue:${r}`;keep.add(key);
      const components=page?[]:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`join:${r}`).setLabel('Join Queue').setStyle(ButtonStyle.Primary).setDisabled(!testers.length||s.maintenance),new ButtonBuilder().setCustomId('leave').setLabel('Leave Queue').setStyle(ButtonStyle.Secondary))];
      await this.upsertPanel(key,await this.text(c.regions[r].queueChannelId!),{embeds:[new EmbedBuilder().setTitle((testers.length?'Tester(s) Available!':'No Testers Online')+(pages.length>1?` (${page+1}/${pages.length})`:'' )).setDescription(pages[page]!).setColor(c.branding.colors.panel as `#${string}`)],components});
    }await this.removePanelPages(`queue:${r}`,keep,c.regions[r].queueChannelId!);
  }}
  async lists(){const c=this.config;if(!c.modules.tierLists)return;const s=await this.store.read(),guild=await this.guild();for(const tier of listTiers){const channelId=c.tierLists.channelIds[tier as keyof Config['tierLists']['channelIds']];if(!channelId)continue;const lines:string[]=[];for(const r of REGIONS)if(c.regions[r].enabled){const ids=s.lists[tier]?.[r]??[],names=await Promise.all(ids.map(async id=>({id,name:(await guild.members.fetch(id).catch(()=>null))?.displayName??id})));names.sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));lines.push(`**${r}**`,...(names.length?names.map(x=>`<@${x.id}>`):['No members listed']),'');}
    const chunks=paginateLines(lines),keep=new Set<string>();for(let page=0;page<chunks.length;page++){const key=`list:${tier}:${page}`;keep.add(key);await this.upsertPanel(key,await this.text(channelId),{embeds:[new EmbedBuilder().setTitle(`${tierName(tier)} List${page?` (${page+1})`:''}`).setDescription(chunks[page]!).setColor(c.branding.colors.panel as `#${string}`).setTimestamp()]});}await this.removePanelPages(`list:${tier}`,keep,channelId);
  }}
  private async archive(t:Ticket,j:Job,save:(k:string,v:unknown)=>Promise<void>){
    if(t.status==='closed')return;if(!t.channelId)throw new Error('Ticket has no channel');const guild=await this.guild();
    const channel=await guild.channels.fetch(t.channelId).catch(()=>null);
    if(!channel){if(j.checkpoints.archived){await this.store.change(s=>s.tickets[t.id]!.status='closed');return;}throw new Error('Ticket channel missing before archival');}
    if(channel.type!==ChannelType.GuildText)throw new Error('Invalid ticket channel');
    if(!j.checkpoints.locked){for(const id of [t.opener,...t.participants,...t.accessRoles])await channel.permissionOverwrites.edit(id,{SendMessages:false});await save('locked',true);}
    const dir=join(t.archiveDirectory??this.config.archival.directory,t.id);await mkdir(dir,{recursive:true,mode:0o700});
    if(!j.checkpoints.transcript){
      const messages=[];let before:string|undefined;for(;;){const batch=await channel.messages.fetch({limit:100,before});messages.push(...batch.values());if(batch.size<100)break;before=batch.last()!.id;await save('lastPage',before);}
      messages.sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
      const s=await this.store.read();let text=`# Ticket ${t.name}\n\n${JSON.stringify({...t,closedBy:j.data.actor,reason:j.data.reason},null,2)}\n\n`;
      text+='## Management history\n'+s.audit.filter(e=>e.target===t.id||e.target.startsWith(`${t.id}:`)).map(e=>`${new Date(e.at).toISOString()} | ${e.actor} | ${e.action} | ${e.target}`).join('\n')+'\n\n## Messages\n';
      for(const m of messages){text+=`\n### ${new Date(m.createdTimestamp).toISOString()} — ${m.author.username} (${m.author.id})\n${m.content}\n`;for(const e of m.embeds)text+=`\n${e.title??''}\n${e.description??''}\n${e.fields.map(f=>`${f.name}: ${f.value}`).join('\n')}\n`;
        for(const a of m.attachments.values()){text+=`\nAttachment: ${a.name} ${a.url}\n`;if(t.copyImages&&a.contentType?.startsWith('image/')&&!a.contentType.includes('svg')){const u=new URL(a.url);if(u.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(u.hostname))throw new Error('Unrecognized attachment host');const filename=`image-${a.id}.bin`,file=join(dir,filename);try{await stat(file);}catch{if(a.size>25*1024*1024)throw new Error('Image is larger than supported evidence limit');const response=await fetch(u,{signal:AbortSignal.timeout(60_000),redirect:'error'});if(!response.ok||!response.body)throw new Error('Evidence image download failed');let length=0;const chunks:Uint8Array[]=[];for await(const chunk of response.body){length+=chunk.byteLength;if(length>25*1024*1024)throw new Error('Evidence image exceeds limit');chunks.push(chunk);}await writeFile(file+'.tmp',Buffer.concat(chunks),{mode:0o600});await rename(file+'.tmp',file);}text+=`Copied evidence: ${filename}\n`;}
      }}
      await writeFile(join(dir,'transcript.md.tmp'),text,{mode:0o600});await rename(join(dir,'transcript.md.tmp'),join(dir,'transcript.md'));await save('transcript',true);
    }
    const transcript=join(dir,'transcript.md');const size=(await stat(transcript)).size;if(size>8*1024*1024)throw new Error('Transcript exceeds the supported single-file archive limit; channel retained');
    if(!j.checkpoints.archived){await this.sendOnce(await this.text(t.archiveChannelId),j,{content:`Archived ${t.name}. Closed by <@${String(j.data.actor)}> — ${String(j.data.reason??'')}`,files:[new AttachmentBuilder(transcript,{name:`${t.id}.md`})],allowedMentions:{parse:[]}},save);const at=Date.now();await writeFile(join(dir,'retention.json'),JSON.stringify({archivedAt:at,imageRetentionDays:t.imageRetentionDays}),{mode:0o600});await save('archived',at);}
    const archivedAt=Number(j.checkpoints.archived);if(Date.now()-archivedAt<(t.minimumDeletionDelaySeconds??this.config.archival.minimumDeletionDelaySeconds)*1000)throw new Error('Waiting for safe deletion delay');
    if((await this.store.read()).maintenance)throw new Error('Deletion paused during maintenance');
    await channel.delete('Archived ticket');await this.store.change(s=>s.tickets[t.id]!.status='closed');
  }
  async cleanupImages(){const state=await this.store.read(),roots=new Set([this.config.archival.directory,...Object.values(state.tickets).map(t=>t.archiveDirectory).filter((x):x is string=>!!x)].map(p=>resolve(p)));for(const root of roots){
    await mkdir(root,{recursive:true,mode:0o700});for(const entry of await readdir(root,{withFileTypes:true})){if(!entry.isDirectory()||!/^[a-f0-9-]{36}$/.test(entry.name))continue;const dir=join(root,entry.name);const marker=await readFile(join(dir,'retention.json'),'utf8').catch(()=>null);if(!marker)continue;
      let retention:{archivedAt:number;imageRetentionDays:number};try{retention=JSON.parse(marker);}catch{continue;}if(!Number.isFinite(retention.archivedAt)||!Number.isFinite(retention.imageRetentionDays)||retention.imageRetentionDays<=0||Date.now()-retention.archivedAt<retention.imageRetentionDays*86400000)continue;
      for(const file of await readdir(dir))if(/^image-\d+\.bin$/.test(file))await rm(join(dir,file));
    }
  }}
}
