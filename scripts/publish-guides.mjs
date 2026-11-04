// Publish role-restricted, read-only guides. Message IDs are kept outside Git.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {Client,GatewayIntentBits,ChannelType,PermissionFlagsBits,EmbedBuilder} from 'discord.js';
import {ConfigFile} from '../dist/src/config.js';
import {paginateLines} from '../dist/src/discord/pages.js';

const args=process.argv.slice(2),path=args.find(a=>!a.startsWith('--'))??process.env.BOT_CONFIG??'config.json';
const c=(await ConfigFile.load(path)).value;
if(!c.community.guildId||c.gameModes.length<2)throw Error('Select a configured multi-mode community.');
const specs=[
  {key:'tester',name:'tester-guide',title:'Tester guide',source:'TESTER-GUIDE.md',aliases:['testerguide']},
  {key:'staff',name:'staff-guide',title:'Staff guide',source:'STAFF-GUIDE.md',aliases:['staffguide']},
  {key:'highStaff',name:'high-staff-guide',title:'High Staff guide',source:'HIGH-STAFF-GUIDE.md',aliases:['highstaffguide','managementguide']}
];
const sources=new Map();
for(const spec of specs)sources.set(spec.key,await readFile(new URL('../docs/'+spec.source,import.meta.url),'utf8'));
if(!args.includes('--apply')){console.log('Preview: create or reuse three read-only guide channels; publish Tester, Staff and High Staff references. Pass --apply to publish.');process.exit(0);}
if(!process.env.DISCORD_TOKEN)throw Error('Set DISCORD_TOKEN on the host.');
const directory=join('data','guides'),manifestPath=join(directory,c.community.guildId+'.json');
await mkdir(directory,{recursive:true,mode:0o700});
let saved;
try{saved=JSON.parse(await readFile(manifestPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;saved={version:1,guildId:c.community.guildId,guides:{}};}
if(saved.guildId!==c.community.guildId)throw Error('Guide manifest belongs to another server.');
const persist=async()=>{await writeFile(manifestPath+'.tmp',JSON.stringify(saved,null,2)+'\n',{mode:0o600});await rename(manifestPath+'.tmp',manifestPath);};
const client=new Client({intents:[GatewayIntentBits.Guilds],allowedMentions:{parse:[]}});
const norm=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
function pages(source,title){
  const sections=[];let heading=title,lines=[];
  const flush=()=>{const text=lines.join('\n').trim();if(text)for(const description of paginateLines(text.split('\n'),3500))sections.push({heading,description});lines=[];};
  for(const line of source.split(/\r?\n/)){if(line.startsWith('# '))continue;if(line.startsWith('## ')){flush();heading=line.slice(3);}else lines.push(line);}flush();return sections;
}
client.once('clientReady',()=>void(async()=>{try{
  const guild=await client.guilds.fetch(c.community.guildId);assert.equal(guild.id,c.community.guildId);await guild.members.fetchMe();
  const [roles,channels]=await Promise.all([guild.roles.fetch(),guild.channels.fetch()]);
  const groups=(...names)=>names.flatMap(name=>c.permissionGroups[name]??[]);
  const legacy=(...names)=>[...roles.values()].filter(r=>!r.managed&&names.includes(r.name)).map(r=>r.id);
  const senior=legacy('Co Owner','Staff Management','Executive','General Management','Manager','Administrator','Overseer');
  const advanced=[...new Set([...groups('owner','highStaff','botAdmin','regulator'),...senior])];
  const staff=[...new Set([...groups('staff','trainee','loaAdmin','listAdmin','restrictionKey','cdResetter','partnershipManager'),...advanced,...legacy('Moderator','Senior Mod','Trial Moderation','Helper')])];
  const testers=[...new Set([...staff,...c.gameModes.flatMap(m=>m.testerRoleIds),...legacy('Verified Tester','Senior Tester')])];
  const readers={tester:testers,staff,highStaff:advanced};
  const parentOf=id=>channels.get(id)?.parentId;
  const parents={tester:parentOf(c.channels.staffActionLog),staff:parentOf(c.channels.staffActionLog),highStaff:parentOf(c.channels.operationalLog)};
  for(const spec of specs){
    const entry=saved.guides[spec.key]??={messageIds:[]};
    let channel=entry.channelId?await guild.channels.fetch(entry.channelId).catch(e=>{if(e.code===10003)return null;throw e;}):null;
    channel??=channels.find(ch=>ch?.type===ChannelType.GuildText&&spec.aliases.includes(norm(ch.name)));
    if(channel&&channel.type!==ChannelType.GuildText)throw Error('Guide destination must be a text channel.');
    for(const id of readers[spec.key])if(!roles.has(id))throw Error('Guide audience contains a missing role.');
    const overwrites=[
      {id:guild.id,deny:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]},
      {id:client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.ManageMessages]},
      ...readers[spec.key].map(id=>({id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory],deny:[PermissionFlagsBits.SendMessages]}))
    ];
    if(!channel)channel=await guild.channels.create({name:spec.name,type:ChannelType.GuildText,parent:parents[spec.key]??undefined,permissionOverwrites:overwrites,topic:`Lunar Tiers ${spec.title.toLowerCase()} — commands, permissions and when to use them.`});
    else{await channel.permissionOverwrites.set(overwrites,'Requested role-specific guide visibility');if(channel.name!==spec.name)await channel.setName(spec.name);}
    entry.channelId=channel.id;entry.source=spec.source;entry.readerRoleIds=readers[spec.key];await persist();
    const sections=pages(sources.get(spec.key),spec.title),history=await channel.messages.fetch({limit:100}),ids=[];
    for(let n=0;n<sections.length;n++){
      const section=sections[n],title=n===0?spec.title:`${spec.title} · ${section.heading}`;
      const embed=new EmbedBuilder().setAuthor({name:c.community.name,...(c.branding.iconUrl?{iconURL:c.branding.iconUrl}:{})}).setTitle(title).setDescription(section.description).setColor(c.branding.colors.panel).setFooter({text:`Lunar Tiers · ${spec.title} · ${n+1}/${sections.length}`});
      let message=entry.messageIds[n]?await channel.messages.fetch(entry.messageIds[n]).catch(e=>{if(e.code===10008)return null;throw e;}):null;
      message??=history.find(m=>m.author.id===client.user.id&&m.embeds[0]?.title===title);
      if(message&&message.author.id!==client.user.id)throw Error('Refusing to overwrite a guide message from another author.');
      const payload={embeds:[embed],allowedMentions:{parse:[]}};
      if(message)await message.edit(payload);else message=await channel.send({...payload,nonce:createHash('sha256').update(guild.id+spec.key+n+section.description).digest('hex').slice(0,24),enforceNonce:true});
      ids.push(message.id);entry.messageIds[n]=message.id;await persist();
    }
    for(const id of entry.messageIds.slice(sections.length)){const message=await channel.messages.fetch(id).catch(e=>{if(e.code===10008)return null;throw e;});if(message?.author.id===client.user.id)await message.delete();}
    entry.messageIds=ids;entry.updatedAt=new Date().toISOString();entry.sourceHash=createHash('sha256').update(sources.get(spec.key)).digest('hex');await persist();
    const first=await channel.messages.fetch(ids[0]),links=sections.slice(1).map((s,n)=>`[${s.heading}](https://discord.com/channels/${guild.id}/${channel.id}/${ids[n+1]})`).join('\n');
    const intro=new EmbedBuilder(first.embeds[0].toJSON()).setDescription(sections[0].description+(links?'\n\n**In this guide**\n'+links:''));
    if(intro.data.description.length>4096)throw Error('Guide index is too long.');
    await first.edit({embeds:[intro],allowedMentions:{parse:[]}});if(!first.pinned)await first.pin('Requested staff command reference');
    assert(!channel.permissionsFor(guild.roles.everyone).has(PermissionFlagsBits.ViewChannel));
    if(spec.key==='highStaff')for(const id of c.permissionGroups.staff){const role=roles.get(id);if(!advanced.includes(id)&&!role.permissions.has(PermissionFlagsBits.Administrator))assert(!channel.permissionsFor(role).has(PermissionFlagsBits.ViewChannel));}
    for(const id of readers[spec.key])assert(channel.permissionsFor(roles.get(id)).has(PermissionFlagsBits.ViewChannel));
    console.log(`${spec.name}: ${sections.length} guide messages; visibility checked.`);
  }
}catch(error){console.error(error.message);process.exitCode=1;}finally{client.destroy();}})());
await client.login(process.env.DISCORD_TOKEN);
