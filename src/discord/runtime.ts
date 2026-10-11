import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, REST, Routes, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type Client, type GuildMember, type Interaction } from 'discord.js';
import { ConfigFile, milliseconds, readiness } from '../config.js';
import { Service, currentTicket, enqueue, player, removeQueue, restricted, syncLists, tierName } from '../domain/service.js';
import { dateKey, periodStart, previousMonth } from '../domain/calendar.js';
import { allowed, requireGroup } from '../domain/permissions.js';
import { TIERS, UserError, type Actor, type Tier } from '../domain/types.js';
import { Store, openStore } from '../storage/store.js';
import { Backups, decodeBackup } from '../storage/backups.js';
import { Worker } from '../storage/jobs.js';
import { applyMigration, migrationSchema, previewMigration, type Preview } from '../storage/migration.js';
import { lookupMinecraft } from '../minecraft.js';
import { commandDefinitions } from './commands.js';
import { Gateway } from './gateway.js';
import { provision, setupPreview, validateDiscord } from './setup.js';

type Pending={actor:string;expires:number;fingerprint:string;action:()=>Promise<string>;group:'owner'|'setup'};
export class Runtime {
  private service:Service;
  private gateway:Gateway;
  private worker:Worker;
  private pending=new Map<string,Pending>();
  private timers:NodeJS.Timeout[]=[];
  private running=false;
  private lease=randomUUID();
  private busy=false;
  private lastRefresh=0;
  private setupErrors:string[]=[];
  private editingImports=new Set<string>();
  constructor(private client:Client,private file:ConfigFile,private store:Store){
    this.service=new Service(store,()=>file.value);this.gateway=new Gateway(client,store,()=>file.value);
    this.worker=new Worker(store,(job,save)=>this.gateway.job(job,save),j=>this.gateway.failure(j));
  }
  async ready(){
    const now=Date.now();await this.store.change(s=>{if(s.runtimeLease&&s.runtimeLease.until>now)throw new Error('Another bot instance is already using this database.');s.runtimeLease={owner:this.lease,until:now+60_000};s.testers={};});
    const guild=await this.gateway.guild();await guild.members.fetchMe();
    await new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN!).put(Routes.applicationGuildCommands(this.client.user!.id,guild.id),{body:commandDefinitions()});
    const errors=await validateDiscord(this.file.value,guild);
    this.setupErrors=errors;
    if(errors.length)console.log(`Setup needs ${errors.length} settings or permission corrections. Use /setup preview or /config validate.`);
    this.running=true;this.timers.push(setInterval(()=>void this.loop().catch(()=>console.error('Background cycle failed; saved work will retry.')),2000));
    this.timers.push(setInterval(()=>void this.renew().catch(()=>{this.running=false;console.error('Database lease unavailable; stopping Discord connection.');this.client.destroy();}),15_000));
    this.client.on('interactionCreate',i=>void this.interact(i));
    this.client.on('guildMemberRemove',m=>{if(m.guild.id!==this.file.value.community.guildId)return;void this.store.change(s=>{s.departures??=[];if(!s.departures.includes(m.id))s.departures.push(m.id);removeQueue(s,m.id);enqueue(s,'queues',{},Date.now());}).catch(()=>console.error('Member departure could not be recorded.'));});
    this.client.on('guildMemberAdd',m=>{if(m.guild.id!==this.file.value.community.guildId)return;void this.store.read().then(async s=>{if(s.players[m.id])await this.gateway.playerRoles(s.players[m.id]!);}).catch(()=>console.error('Member role restoration needs review.'));});
    this.client.on('guildMemberUpdate',(old,m)=>{if(m.guild.id!==this.file.value.community.guildId||this.gateway.synchronizingRoles.has(m.id))return;const configured=Object.values(this.file.value.tierRoleIds).filter(Boolean);if(configured.some(id=>old.roles.cache.has(id!)!==m.roles.cache.has(id!))||this.file.value.permissionGroups.verifiedTester.some(id=>old.roles.cache.has(id)!==m.roles.cache.has(id))||this.file.value.permissionGroups.staff.some(id=>old.roles.cache.has(id)!==m.roles.cache.has(id)))void this.reconcileMember(m.id).catch(()=>console.error('Member role reconciliation needs review.'));});
    console.log('Crystal bot connected.');
  }
  private async renew(){await this.store.change(s=>{if(s.runtimeLease?.owner!==this.lease)throw new Error('Instance lease lost');s.runtimeLease.until=Date.now()+60_000;});}
  private async loop(){if(!this.running||this.busy)return;this.busy=true;try{
    await this.service.tick();await this.worker.runOnce();const now=Date.now(),s=await this.store.read();
    if(s.initialized&&!readiness(this.file.value).length&&now-this.lastRefresh>60_000){await this.gateway.queues();this.lastRefresh=now;}
    if(now-(s.lastAutomaticBackupAt??0)>86_400_000){await new Backups(this.store,this.file.value.backups.directory).create(true);await this.gateway.cleanupImages();await this.store.change(s=>s.lastAutomaticBackupAt=now);}
    const channelId=this.file.value.channels.staffActionLog;if(channelId)await this.store.change(state=>{for(const e of state.audit)if(!state.jobs[`audit-${e.id}`])enqueue(state,'notice',{channelId,content:`${new Date(e.at).toISOString()} | ${e.actor} | ${e.action} | ${e.target}`},now,`audit-${e.id}`);});
    if(this.file.value.modules.testerQuotas&&s.initialized){const month=previousMonth(now,this.file.value.community.timezone),jobId=`quota-${month}`;if(!s.jobs[jobId])await this.store.change(state=>{const rows=Object.values(state.players).filter(p=>p.testerSince&&dateKey(p.testerSince,this.file.value.community.timezone).slice(0,7)<month).map(p=>{const count=state.completions.filter(e=>e.tester===p.id&&dateKey(e.at,this.file.value.community.timezone).slice(0,7)===month).length;return `<@${p.id}>: ${count} / ${this.file.value.testing.monthlyTesterQuota}`;});enqueue(state,'notice',{channelId:this.file.value.channels.quotaReports,content:`Monthly tester quota report: ${month}\n${rows.join('\n')||'No eligible testers this period.'}`},now,jobId);});}
    if(!s.maintenance)for(const id of s.departures??[]){const tickets=Object.values(s.tickets).filter(t=>t.opener===id&&t.status==='open');const internal:Actor={id:'system',roles:this.file.value.permissionGroups.owner,administrator:false,channelAccess:true};for(const t of tickets)await this.service.close(internal,t.id,'discontinued','Member left the server');await this.store.change(state=>{if(!Object.values(state.tickets).some(t=>t.opener===id&&t.status==='opening'))state.departures=(state.departures??[]).filter(x=>x!==id);});}
    for(const [id,p]of this.pending)if(p.expires<now)this.pending.delete(id);
  }finally{this.busy=false;}}
  async stop(){this.running=false;for(const t of this.timers)clearInterval(t);while(this.busy)await new Promise(resolve=>setTimeout(resolve,50));await this.store.change(s=>{if(s.runtimeLease?.owner===this.lease)delete s.runtimeLease;});this.client.destroy();await this.store.close();}
  private async reconcileMember(id:string){if(this.gateway.synchronizingRoles.has(id))return;const c=this.file.value,guild=await this.gateway.guild(),m=await guild.members.fetch({user:id,force:true});if(this.gateway.synchronizingRoles.has(id))return;
    await this.store.change(s=>{if(!s.initialized||s.maintenance)return;const p=player(s,id),highest=[...TIERS].reverse().find(t=>t!=='Unranked'&&c.tierRoleIds[t]&&m.roles.cache.has(c.tierRoleIds[t]!))??'Unranked';if(highest!==p.tier){p.tier=highest;syncLists(s,p,Date.now());s.audit.push({id:randomUUID(),at:Date.now(),actor:'system',action:'tier-role-reconciled',target:id});enqueue(s,'roles',{playerId:id},Date.now());enqueue(s,'lists',{},Date.now());}
      const tester=allowed(c,{id,roles:[...m.roles.cache.keys()],administrator:false},'verifiedTester')&&allowed(c,{id,roles:[...m.roles.cache.keys()],administrator:false},'staff');if(!tester&&s.testers[id]){const r=s.testers[id]!;delete s.testers[id];if(!Object.values(s.testers).includes(r))s.queues[r]=[];enqueue(s,'queues',{},Date.now());}});
  }
  private async actor(i:Interaction):Promise<Actor>{
    if(i.guildId!==this.file.value.community.guildId||!i.guild)throw new UserError('This action is only available in the configured server.');
    const member=await i.guild.members.fetch({user:i.user.id,force:true});const channel=i.channelId?await i.guild.channels.fetch(i.channelId):null;
    return {id:i.user.id,roles:[...member.roles.cache.keys()],administrator:member.permissions.has(PermissionFlagsBits.Administrator),channelAccess:!!channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)};
  }
  private async ticketId(i:Interaction){const t=Object.values((await this.store.read()).tickets).find(t=>t.channelId===i.channelId&&t.status!=='closed');if(!t)throw new UserError('This channel is not a registered ticket.');return t.id;}
  private async confirm(i:Interaction,a:Actor,description:string,action:()=>Promise<string>,group:Pending['group']='owner'){
    if(!i.isRepliable())return;const id=randomUUID();this.pending.set(id,{actor:a.id,expires:Date.now()+300_000,fingerprint:JSON.stringify(this.file.value),action,group});
    await i.editReply({content:description.slice(0,1800),components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`confirm:${id}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`cancel:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary))]});
  }
  private backups(){return new Backups(this.store,this.file.value.backups.directory);}
  async interact(i:Interaction){
    if(!i.isRepliable())return;
    try{
      const a=await this.actor(i);
      if(i.isButton()&&i.customId.startsWith('review:')){requireGroup(this.file.value,a,'botAdmin');const id=i.customId.split(':')[1]!,review=(await this.store.read()).reviews?.[id];if(!review||review.resolved)throw new UserError('This review has already been resolved.');
        if(['region','openingTier'].includes(review.field)){const options=review.field==='region'?['NA','EU','AS'].filter(r=>this.file.value.regions[r as 'NA'].enabled):[...TIERS];await i.reply({content:review.message,flags:MessageFlags.Ephemeral,components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`reviewvalue:${id}`).setPlaceholder('Choose the corrected value').addOptions(options.map(value=>({label:value,value}))))]});}
        else if(['tester','ign','openingIgn','type','opener'].includes(review.field))await i.showModal(new ModalBuilder().setCustomId(`reviewedit:${id}`).setTitle('Correct Import Record').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('value').setLabel(`Correct ${review.field}`).setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true))));
        else await i.reply({content:'Correct this conflict in the import file on the host, then run /migration preview and /migration apply to resume the same import.',flags:MessageFlags.Ephemeral});return;
      }
      if(i.isButton()&&i.customId==='verify'){
        if(this.setupErrors.length)throw new UserError('An administrator must finish configuration before new requests are accepted.');
        if(!this.file.value.modules.testing)throw new UserError('Testing is disabled.');
        const modal=new ModalBuilder().setCustomId('verification').setTitle('Verify Minecraft Account');
        for(const [id,label,max]of [['ign','Minecraft username',16],['region','Region: NA, EU, or AS',2],['server','Preferred Minecraft server',100]] as const)modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(true)));
        await i.showModal(modal);return;
      }
      if(i.isButton()&&i.customId.startsWith('supportclose:')){
        const id=i.customId.split(':')[1]!,s=await this.store.read(),t=s.tickets[id];if(!t||t.channelId!==i.channelId||!a.channelAccess||(!allowed(this.file.value,a,'owner')&&!t.closingRoles.some(id=>a.roles.includes(id))))throw new UserError('Only responsible staff can close this ticket.');
        await i.showModal(new ModalBuilder().setCustomId(`closereason:${id}`).setTitle('Close Ticket').addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Closure reason (optional)').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false))));return;
      }
      const publicStats=i.isChatInputCommand()&&['stats','testerstats','testerlb'].includes(i.commandName);if(publicStats)requireGroup(this.file.value,a,'staff');
      await i.deferReply(publicStats?{}:{flags:MessageFlags.Ephemeral});let reply='Done.';
      const createsRequest=(i.isButton()&&['waitlist','join'].includes(i.customId.split(':')[0]!))||(i.isStringSelectMenu()&&i.customId==='support')||(i.isModalSubmit()&&i.customId==='verification')||(i.isChatInputCommand()&&['start','next','forcetest','set-ticket'].includes(i.commandName));
      if(createsRequest&&this.setupErrors.length)throw new UserError('An administrator must finish configuration before new requests are accepted.');
      if(i.isButton()){
        const [name,value]=i.customId.split(':');
        if(name==='confirm'||name==='cancel'){const pending=this.pending.get(value!);if(!pending||pending.actor!==a.id||pending.expires<Date.now())throw new UserError('This confirmation has expired.');if(name==='cancel'){this.pending.delete(value!);reply='Cancelled.';}else{
          if(pending.group==='setup'){const s=await this.store.read();if(s.initialized)requireGroup(this.file.value,a,'owner');else if(!a.administrator)throw new UserError('Discord Administrator permission is required.');}else requireGroup(this.file.value,a,'owner');
          if(pending.fingerprint!==JSON.stringify(this.file.value))throw new UserError('Configuration changed. Review a new preview.');this.pending.delete(value!);reply=await pending.action();}}
        else if(name==='waitlist'){if(i.channelId!==this.file.value.channels.verificationPanel)throw new UserError('Use the current request-test panel.');reply=await this.service.waitlist(a);}
        else if(name==='join'){if(i.channelId!==this.file.value.regions[value as 'NA']?.queueChannelId)throw new UserError('Use your current regional queue panel.');reply=`You joined at position ${await this.service.join(a,value!)}.`;}
        else if(name==='leave'){await this.service.leave(a);reply='You left the queue.';}
        else throw new UserError('This control is no longer available.');
      }else if(i.isStringSelectMenu()&&i.customId==='support'){const t=await this.service.support(a,i.values[0]!);reply=`Your ${t.type} ticket is being opened.`;}
      else if(i.isStringSelectMenu()&&i.customId.startsWith('reviewvalue:')){await this.correctReview(a,i.customId.split(':')[1]!,i.values[0]!);reply='Correction saved. An Owner can preview and resume this import.';}
      else if(i.isModalSubmit()){
        if(i.customId==='verification'){const account=await lookupMinecraft(i.fields.getTextInputValue('ign'));await this.service.verify(a,account,i.fields.getTextInputValue('region').trim().toUpperCase(),i.fields.getTextInputValue('server'));reply=`Your account has been verified: ${account.ign}.`;}
        else if(i.customId.startsWith('closereason:')){const id=i.customId.split(':')[1]!;if((await this.ticketId(i))!==id)throw new UserError('Ticket mismatch.');await this.service.close(a,id,'discontinued',i.fields.getTextInputValue('reason'));reply='The ticket is locked while its archive is saved.';}
        else if(i.customId.startsWith('reviewedit:')){await this.correctReview(a,i.customId.split(':')[1]!,i.fields.getTextInputValue('value').trim());reply='Correction saved. An Owner can preview and resume this import.';}
      }else if(i.isChatInputCommand()){
        const o=i.options,c=this.file.value,name=i.commandName,member=()=>o.getUser('member',true).id,str=(key:string)=>o.getString(key,true),ticket=()=>this.ticketId(i);
        switch(name){
          case 'profile':{const id=o.getUser('member')?.id??a.id,p=(await this.store.read()).players[id];if(p){const embed=new EmbedBuilder().setTitle('Player Profile').setColor(c.branding.colors.panel as `#${string}`).addFields({name:'Discord',value:`<@${id}>`},{name:'Minecraft',value:p.ign??'Not linked'},{name:'Rank',value:tierName(p.tier)},{name:'Region',value:p.region??'Not selected'});if(p.uuid)embed.setThumbnail(`https://visage.surgeplay.com/bust/128/${p.uuid}`);await i.editReply({embeds:[embed],allowedMentions:{parse:[]}});return;}reply='This player has no saved profile.';break;}
          case 'leave':await this.service.leave(a);break;
          case 'start':await this.service.start(a,str('region'));reply='Your testing session is active.';break;
          case 'stop':await this.service.stop(a);reply='Your testing session ended.';break;
          case 'next':await this.service.next(a);reply='The next ticket is being opened.';break;
          case 'passeval':await this.service.pass(a,await ticket());reply='Evaluation passed. The ticket is moving to HT3 testing.';break;
          case 'skip':await this.service.close(a,await ticket(),'skipped');reply='This test will be archived and skipped.';break;
          case 'close':await this.service.close(a,await ticket(),str('tier') as Tier|'discontinued');reply='The ticket is closing. Archival must succeed before deletion.';break;
          case 'deadline':await this.service.deadline(a,await ticket(),o.getSubcommand()==='clear'?null:str('duration'));break;
          case 'add':{const guild=await this.gateway.guild(),m=await guild.members.fetch(member());await this.service.add(a,await ticket(),m.id,allowed(c,{...a,id:m.id,roles:[...m.roles.cache.keys()]},'verifiedTester'));break;}
          case 'remove':{const guild=await this.gateway.guild(),m=await guild.members.fetch(member()),t=(await this.store.read()).tickets[await ticket()]!;if(t.accessRoles.some(id=>m.roles.cache.has(id)))throw new UserError('This member has required role-based access and cannot be removed.');await this.service.remove(a,t.id,m.id);break;}
          case 'rename':await this.service.rename(a,await ticket(),str('name'));break;
          case 'set-ticket':{requireGroup(c,a,'staff',true);const ch=await this.gateway.text(i.channelId!);const participants=[...ch.permissionOverwrites.cache.values()].filter(x=>x.type===1&&x.allow.has(PermissionFlagsBits.ViewChannel)&&x.id!==this.client.user!.id).map(x=>x.id);const tester=o.getUser('tester')?.id??null;if(tester){const m=await(await this.gateway.guild()).members.fetch(tester);if(!allowed(c,{...a,id:m.id,roles:[...m.roles.cache.keys()]},'verifiedTester'))throw new UserError('Original tester must be a Verified Tester.');}await this.service.adopt(a,ch.id,str('type'),member(),tester,ch.name,participants);break;}
          case 'changeticket':await this.service.changeType(a,await ticket(),str('type'),o.getUser('tester')?.id??null);break;
          case 'format':{requireGroup(c,a,'staff',true);const t=(await this.store.read()).tickets[await ticket()]!;if(t.type!=='test')throw new UserError('Use this in a test ticket.');await(await this.gateway.text(t.channelId!)).send({content:this.gateway.fightTemplate(t,str('tier') as Tier),allowedMentions:{parse:[]}});reply='Formatted message sent.';break;}
          case 'addht3':case 'addlt2':{requireGroup(c,a,'staff',true);const s=await this.store.read(),t=s.tickets[await ticket()]!,tier=name==='addht3'?'HT3':'LT2';if(!t.region||!c.modules.tierLists)throw new UserError('No regional list is available.');const guild=await this.gateway.guild(),candidates=[];for(const id of s.lists[tier]?.[t.region]??[]){const p=s.players[id];if(!p||restricted(s,p,Date.now())||[t.opener,t.tester,...t.participants].includes(id))continue;const m=await guild.members.fetch(id).catch(()=>null);const channel=await this.gateway.text(t.channelId!);if(m&&!channel.permissionsFor(m).has(PermissionFlagsBits.ViewChannel))candidates.push(m);}const online=candidates.filter(m=>['online','idle','dnd'].includes(m.presence?.status??'')),pool=online.length?online:candidates;if(!pool.length)throw new UserError('No eligible opponent is available in this regional list.');const chosen=pool[Math.floor(Math.random()*pool.length)]!;await this.service.add(a,t.id,chosen.id,allowed(c,{...a,roles:[...chosen.roles.cache.keys()]},'verifiedTester'));break;}
          case 'uuid':requireGroup(c,a,'staff');{const result=await lookupMinecraft(str('ign'));reply=`${result.ign}: ${result.uuid}`;}break;
          case 'unverify':await this.service.unverify(a,member());break;
          case 'restrict':requireGroup(c,a,'restrictionKey');{const account=await lookupMinecraft(str('ign'));await this.service.restriction(a,member(),account.uuid,str('reason'),o.getString('duration'));}break;
          case 'unrestrict':await this.service.unrestrict(a,member());break;
          case 'forcetest':await this.service.forceTest(a,member(),str('region'));break;
          case 'forcestopqueue':await this.service.stopQueue(a,str('region'));break;
          case 'forceresult':case 'migrate':{requireGroup(c,a,'regulator');const p=(await this.store.read()).players[member()];let ign=o.getString('ign')??undefined;if(!p?.uuid){if(!ign)throw new UserError('Provide an IGN for this unverified player.');ign=(await lookupMinecraft(ign)).ign;}await this.service.forceResult(a,member(),str('tier') as Tier,str('region'),ign,name==='migrate'?str('source'):undefined);break;}
          case 'resetcooldown':await this.service.cooldown(a,member(),0);break;
          case 'setcooldown':await this.service.cooldown(a,member(),o.getNumber('days',true));break;
          case 'reset':requireGroup(c,a,'owner');await this.confirm(i,a,`Reset <@${member()}>? Tier, account association, region, cooldown, queue, and lists will be cleared. Restrictions and archives remain.`,async()=>{await this.service.reset(a,member());return 'Player reset.';});return;
          case 'maintenance':await this.service.maintenance(a,o.getBoolean('enabled',true));break;
          case 'forceresetcooldowns':requireGroup(c,a,'owner');await this.confirm(i,a,'Clear every player cooldown?',async()=>{await this.service.resetAllCooldowns(a);return 'All cooldowns cleared.';});return;
          case 'forceclosetickets':{requireGroup(c,a,'owner');const tickets=Object.values((await this.store.read()).tickets).filter(t=>t.status==='open');await this.confirm(i,a,`Discontinue and archive ${tickets.length} active tickets?`,async()=>{for(const t of tickets)await this.service.close({...a,channelAccess:true},t.id,'discontinued','Owner bulk closure');return 'Ticket closures queued.';});return;}
          case 'addtester':case 'stoptester':{requireGroup(c,a,'botAdmin');const guild=await this.gateway.guild(),m=await guild.members.fetch(member());if(name==='addtester'){await m.roles.add([...c.permissionGroups.verifiedTester,...c.permissionGroups.staff]);await this.store.change(s=>{player(s,m.id).testerSince??=Date.now();});}else{await m.roles.remove(c.permissionGroups.verifiedTester);await this.store.change(s=>{const r=s.testers[m.id];delete s.testers[m.id];if(r&&!Object.values(s.testers).includes(r))s.queues[r]=[];enqueue(s,'queues',{},Date.now());});}break;}
          case 'configquota':requireGroup(c,a,'botAdmin');{const next=structuredClone(c),n=o.getInteger('count',true);next.modules.testerQuotas=n>0;next.testing.monthlyTesterQuota=n||null;const errors=readiness(next);if(errors.length)throw new UserError(errors.join('\n'));await this.file.save(next);}break;
          case 'configcooldown':requireGroup(c,a,'botAdmin');{milliseconds(str('duration'));const next=structuredClone(c);next.testing[o.getString('kind')==='high'?'highCooldown':'normalCooldown']=str('duration');await this.file.save(next);}break;
          case 'stats':case 'testerstats':case 'testerlb':requireGroup(c,a,'staff');reply=await this.statistics(name,o.getUser('member')?.id??a.id,o.getString('period')??'monthly');break;
          case 'setup':{const s=await this.store.read();if(s.initialized)requireGroup(c,a,'owner');else if(!a.administrator)throw new UserError('Discord Administrator permission is required.');if(o.getSubcommand()==='preview')reply=setupPreview(c);else{await this.confirm(i,a,setupPreview(c),async()=>{const guild=await this.gateway.guild();await provision(this.file,guild,a.id,!s.initialized);const errors=await validateDiscord(this.file.value,guild);this.setupErrors=errors;if(errors.length)return `Resources recorded. Finish configuration before enabling requests:\n${errors.join('\n')}`;await this.store.change(s=>s.initialized=true);await this.gateway.panels();return 'Setup completed and panels published.';},'setup');return;}break;}
          case 'config':{const s=await this.store.read();if(s.initialized)requireGroup(c,a,'owner');else if(!a.administrator)throw new UserError('Discord Administrator permission is required.');const loaded=await ConfigFile.load(this.file.path);const errors=await validateDiscord(loaded.value,await this.gateway.guild());if(errors.length){reply=errors.join('\n');break;}if(o.getSubcommand()==='reload'){
            if(JSON.stringify(c.database)!==JSON.stringify(loaded.value.database)||c.community.guildId!==loaded.value.community.guildId)throw new UserError('Database and server changes require a stopped bot and a reviewed transfer.');
            const old={...c,templates:null,branding:null,testing:null},next={...loaded.value,templates:null,branding:null,testing:null};if(JSON.stringify(old)!==JSON.stringify(next)&&!s.maintenance)throw new UserError('Enable maintenance before changing resource mappings or features.');
            this.file.value=loaded.value;this.setupErrors=[];await this.store.change(s=>s.initialized=true);reply='Configuration validated and reloaded.';
          }else reply='Configuration and Discord permissions are valid.';break;}
          case 'panels':requireGroup(c,a,'botAdmin');{const errors=await validateDiscord(c,await this.gateway.guild());if(errors.length)throw new UserError(errors.join('\n'));await this.gateway.panels();}break;
          case 'backup':requireGroup(c,a,'owner');if(o.getSubcommand()==='export'){const path=await this.backups().create();reply=`Backup saved on the host: ${basename(path)}.`;}else if(o.getSubcommand()==='transfer'){
            const name=str('config');if(basename(name)!==name||!name.endsWith('.json'))throw new UserError('Use a destination configuration filename in the installation directory.');const dest=await ConfigFile.load(name),snapshot=await this.store.read();if(!snapshot.maintenance)throw new UserError('Enable maintenance first.');if(dest.value.community.guildId!==c.community.guildId)throw new UserError('Destination server must match this installation.');
            await this.confirm(i,a,`Copy ${Object.keys(snapshot.players).length} players and ${Object.keys(snapshot.tickets).length} tickets to ${dest.value.database.backend}? Destination must be empty. The current database will be backed up and remain in maintenance. Stop the bot before switching configuration.`,async()=>{if(!(await this.store.read()).maintenance)throw new UserError('Maintenance must remain enabled.');const target=await openStore(dest.value);try{const empty=await target.read();if(empty.initialized||empty.runtimeLease||Object.keys(empty.players).length||Object.keys(empty.tickets).length||Object.keys(empty.jobs).length)throw new UserError('Destination is not empty.');const backup=await this.backups().create(),state=decodeBackup(await readFile(backup,'utf8'),snapshot.guildId).state;state.testers={};state.maintenance=true;delete state.runtimeLease;for(const j of Object.values(state.jobs))if(j.status==='working'){j.status='pending';delete j.leaseUntil;}await target.change(s=>Object.assign(s,state));const check=await target.read();if(JSON.stringify(check)!==JSON.stringify(state))throw new Error('Destination verification failed');return 'Transfer verified. Stop this bot, select the destination configuration, restart, then leave maintenance.';}finally{await target.close();}});return;
          }else{
            const name=str('filename');if(basename(name)!==name||!name.endsWith('.json'))throw new UserError('Use a JSON filename from the backup directory.');const path=join(c.backups.directory,name),before=await this.store.read();if(!before.maintenance)throw new UserError('Enable maintenance first.');const raw=await readFile(path,'utf8'),backup=decodeBackup(raw,before.guildId),hash=createHash('sha256').update(raw).digest('hex');
            await this.confirm(i,a,`Restore ${Object.keys(backup.state.players).length} players and ${Object.keys(backup.state.tickets).length} ticket records? The current database will be backed up first.`,async()=>{if(createHash('sha256').update(await readFile(path,'utf8')).digest('hex')!==hash)throw new UserError('Backup changed; preview it again.');await this.backups().restore(path);return 'Backup restored. Maintenance remains enabled.';});return;}break;
          case 'migration':{if(!c.modules.migration)throw new UserError('Migration is disabled.');const sub=o.getSubcommand();requireGroup(c,a,sub==='preview'?'botAdmin':'owner');if(sub==='retry'){await this.store.change(s=>{if(!s.maintenance)throw new UserError('Enable maintenance first.');for(const j of Object.values(s.jobs))if(j.status==='pending'&&j.attempts>0)j.nextAt=0;});reply='Saved failed operations are queued for retry.';break;}
            const filename=str('filename');if(basename(filename)!==filename||!filename.endsWith('.json'))throw new UserError('Use a JSON filename in data/imports.');const path=join('data','imports',filename),raw=await readFile(path,'utf8'),s=await this.store.read(),preview=previewMigration(raw,c,s);reply=`${preview.summary}\n${[...preview.errors,...preview.issues.map(x=>x.message)].join('\n')}`;if(sub==='apply'){if(!s.maintenance)throw new UserError('Enable maintenance first.');if(preview.errors.length)throw new UserError(reply);const guild=await this.gateway.guild();for(const t of preview.data.tickets.filter(t=>preview.readyKeys.includes(`ticket:${t.channelId}`))){const ch=await guild.channels.fetch(t.channelId);if(!ch||ch.type!==ChannelType.GuildText)throw new UserError(`Missing adopted channel ${t.channelId}`);}await this.confirm(i,a,preview.summary+'\nReady records will be imported; unresolved records go to Bot Review. Roles and controls will be updated. A backup will be saved first.',async()=>{if(createHash('sha256').update(await readFile(path,'utf8')).digest('hex')!==preview.hash)throw new UserError('Import changed. Preview it again.');await this.backups().create();await applyMigration(this.store,c,preview,a.id,filename);await this.postReviews(filename,preview);return 'Ready records imported. Unresolved records await Bot Review. Saved Discord operations can retry. Maintenance remains enabled.';});return;}break;}
          default:if(name.endsWith('list')){const tier=name.replace('list','').toUpperCase() as Tier,action=o.getSubcommand();if(action==='list'){requireGroup(c,a,'staff');const s=await this.store.read();reply=['NA','EU','AS'].map(r=>`${r}: ${(s.lists[tier]?.[r as 'NA']??[]).map(id=>`<@${id}>`).join(', ')||'No members listed'}`).join('\n');}else await this.service.list(a,tier,action as 'add'|'remove',member(),str('region'));}else throw new UserError('This command is unavailable.');
        }
      }
      await i.editReply({content:reply.slice(0,1950),allowedMentions:{parse:[]}});
    }catch(error){
      const message=error instanceof UserError?error.message:'The action could not complete. Check the configuration or ask an administrator to review it.';
      if(error instanceof Error&&!(error instanceof UserError))console.error(`Action failed: ${error.name}`);
      try{if(i.deferred||i.replied)await i.editReply({content:message.slice(0,1950),components:[],allowedMentions:{parse:[]}});else await i.reply({content:message.slice(0,1950),flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});}catch{}
    }
  }
  private async postReviews(filename:string,preview:Preview){const channel=await this.gateway.text(this.file.value.channels.botReview!);for(const issue of preview.issues){const id=createHash('sha256').update(`${filename}:${issue.key}:${issue.field}`).digest('hex').slice(0,24);const existing=(await this.store.read()).reviews?.[id];if(existing?.messageId&&!existing.resolved)continue;
    const message=await channel.send({embeds:[new EmbedBuilder().setTitle('Import record needs review').setDescription(`${issue.message}\nRecord: ${issue.key}\nFile: ${filename}`).setColor(this.file.value.branding.colors.error as `#${string}`)],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`review:${id}`).setLabel('Review / correct').setStyle(ButtonStyle.Primary))],allowedMentions:{parse:[]}});
    await this.store.change(s=>{s.reviews??={};s.reviews[id]={filename,key:issue.key,field:issue.field,message:issue.message,resolved:false,messageId:message.id};});
  }}
  private async correctReview(a:Actor,id:string,value:string){requireGroup(this.file.value,a,'botAdmin');const state=await this.store.read(),review=state.reviews?.[id];if(!review||review.resolved)throw new UserError('This review is already resolved.');if(state.migrationSession?.done.includes(review.key))throw new UserError('This record was already imported.');if(basename(review.filename)!==review.filename)throw new UserError('Invalid review filename.');
    if(this.editingImports.has(review.filename))throw new UserError('Another correction is being saved. Try again.');this.editingImports.add(review.filename);try{
    const path=join('data','imports',review.filename),raw=await readFile(path,'utf8'),data=migrationSchema.parse(JSON.parse(raw)),[kind,recordId]=review.key.split(':');const records:Record<string,unknown>[]=(kind==='player'?data.players:kind==='ticket'?data.tickets:[]) as unknown as Record<string,unknown>[];const record=records.find(r=>String(r[kind==='player'?'id':'channelId'])===recordId);if(!record)throw new UserError('Record no longer exists.');if(!['region','openingTier','tester','ign','openingIgn','type','opener'].includes(review.field))throw new UserError('Correct this conflict in the import file, then resume.');
    if(review.field==='region'&&(!['NA','EU','AS'].includes(value)||!this.file.value.regions[value as 'NA'].enabled))throw new UserError('Choose an enabled region.');if(review.field==='openingTier'&&!TIERS.includes(value as Tier))throw new UserError('Choose a valid tier.');if(['tester','opener'].includes(review.field)){const member=await(await this.gateway.guild()).members.fetch(value).catch(()=>null);if(!member)throw new UserError('Choose a current Discord member.');if(review.field==='tester'&&!allowed(this.file.value,{id:value,roles:[...member.roles.cache.keys()],administrator:false},'verifiedTester'))throw new UserError('Choose a Verified Tester.');}
    if(['ign','openingIgn'].includes(review.field))value=(await lookupMinecraft(value)).ign;const previous=record[review.field];record[review.field]=value;migrationSchema.parse(data);await writeFile(path+'.tmp',JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(path+'.tmp',path);await this.store.change(s=>{s.reviews![id]!.resolved=true;s.audit.push({id:randomUUID(),at:Date.now(),actor:a.id,action:`import-correction ${review.field}: ${String(previous)} -> ${value}`,target:review.key});});
    if(review.messageId)await(await this.gateway.text(this.file.value.channels.botReview!)).messages.edit(review.messageId,{content:`Resolved by <@${a.id}> at <t:${Math.floor(Date.now()/1000)}:F>.`,components:[],allowedMentions:{parse:[]}});
    }finally{this.editingImports.delete(review.filename);}
  }
  private async statistics(command:string,id:string,period:string){const s=await this.store.read(),timezone=this.file.value.community.timezone,now=Date.now(),today=dateKey(now,timezone),start=periodStart(now,timezone,period==='weekly'?'weekly':'monthly');
    const filtered=s.completions.filter(e=>{const d=dateKey(e.at,timezone);return e.at<=now&&(period==='all'||(d>=start&&d<=today));}),counts:Record<string,number>={};for(const e of filtered)counts[e.tester]=(counts[e.tester]??0)+1;
    if(command==='stats')return `<@${id}>: ${counts[id]??0} completed tests this month; ${s.completions.filter(e=>e.tester===id).length} all time.`;
    return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([id,n],i)=>`${i+1}. <@${id}> — ${n}${command==='testerstats'&&this.file.value.modules.testerQuotas?` / ${this.file.value.testing.monthlyTesterQuota}`:''}`).join('\n')||'No completed tests in this period.';
  }
}
