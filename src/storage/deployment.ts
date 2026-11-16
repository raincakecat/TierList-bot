import {Service,clearLists,syncLists} from '../domain/service.js';
import {requireGroup} from '../domain/permissions.js';
import {modeConfig} from '../modes.js';
import type {ConfigFile} from '../config.js';
import {randomUUID} from 'node:crypto';
import {emptyState,UserError,type Actor,type Tier,type State,type Player,type ModeState} from '../domain/types.js';
import {Store,type Adapter,type Snapshot} from './store.js';
import type {ModeScope} from '../modes.js';

const copy=<T>(v:T):T=>structuredClone(v);
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const core=['uuid','ign','region','preferredServer'] as const;
function blank(id:string):Player{return {id,tier:'Unranked',uuid:null,ign:null,region:null,preferredServer:null,waitlist:false,cooldownUntil:0};}
function partition(s:State,key:string):ModeState{
  if(key===(s.defaultModeId??'crystal'))return s;
  return (s.modes??={})[key]??=((()=>{const e=emptyState(s.guildId);return {players:{},queues:e.queues,lists:{}};})());
}
function rawGuild(root:State,id:string):State{return id===root.guildId?root:root.servers?.[id]??emptyState(id);}
function putGuild(root:State,guild:State){if(root.guildId===guild.guildId){const servers=root.servers;for(const key of Object.keys(root))if(key!=='servers')delete (root as unknown as Record<string,unknown>)[key];Object.assign(root,guild);if(servers)root.servers=servers;}else(root.servers??={})[guild.guildId]=guild;}
export function guildSnapshot(root:State,id:string):State{const s=copy(rawGuild(root,id));delete s.servers;return s;}
export function modeSnapshot(s:State,key:string):State{
  const view=copy(s),part=partition(view,key),players:Record<string,Player>={};
  for(const id of new Set([...Object.keys(view.players),...Object.keys(part.players)])){
    const p=copy(part.players[id]??blank(id)),profile=view.players[id];if(profile)for(const field of core)Object.assign(p,{[field]:profile[field]});players[id]=p;
  }
  view.players=players;view.queues=copy(part.queues);view.lists=copy(part.lists);view.lastTestingSession=copy(part.lastTestingSession);
  view.testers=Object.fromEntries(Object.entries(s.testers).filter(([id])=>(s.testerModes?.[id]??s.defaultModeId??'crystal')===key));
  view.tickets=Object.fromEntries(Object.entries(s.tickets).filter(([,t])=>t.type!=='test'||(t.modeId??s.defaultModeId??'crystal')===key));
  view.jobs=Object.fromEntries(Object.entries(s.jobs).filter(([,j])=>(j.data.modeId??s.defaultModeId??'crystal')===key));
  view.panels=Object.fromEntries(Object.entries(s.panels).flatMap(([name,id])=>{if(sharedPanel(name))return [[name,id]];const prefix=`mode:${key}:`;if(name.startsWith(prefix))return [[name.slice(prefix.length),id]];if(key===(s.defaultModeId??'crystal')&&!name.startsWith('mode:'))return [[name,id]];return [];}));
  view.completions=s.completions.filter(e=>(e.modeId??s.tickets[e.ticketId]?.modeId??s.defaultModeId??'crystal')===key);
  delete view.modes;delete view.servers;delete view.testerModes;return view;
}
const sharedPanel=(key:string)=>/^(verification|support(?::.*)?|loa|loa-active(?::.*)?)$/.test(key);
function panelKey(s:State,mode:string,key:string){return sharedPanel(key)||mode===(s.defaultModeId??'crystal')?key:`mode:${mode}:${key}`;}
function mergeRecords<T>(target:Record<string,T>,before:Record<string,T>,after:Record<string,T>,prepare:(value:T)=>T=v=>v){
  for(const id of Object.keys(before))if(!(id in after))delete target[id];
  for(const [id,value]of Object.entries(after))if(!equal(before[id],value))target[id]=prepare(copy(value));
}
function addJob(s:State,key:string,kind:'roles'|'lists'|'queues',playerId?:string){const id=randomUUID();s.jobs[id]={id,kind,status:'pending',attempts:0,nextAt:Date.now(),createdAt:Date.now(),checkpoints:{},data:{modeId:key,...(playerId?{playerId}:{})}};}
export function mergeMode(s:State,key:string,after:State,name?:string):State{
  const before=modeSnapshot(s,key),result=copy(s),part=partition(result,key);
  const specific=new Set(['players','queues','lists','testers','tickets','jobs','lastTestingSession','modes','servers','testerModes','completions','defaultModeId','panels']);
  for(const field of Object.keys(after) as (keyof State)[])if(!specific.has(field)&&!equal(before[field],after[field]))(result as unknown as Record<string,unknown>)[field]=copy(after[field]);
  for(const [id,p]of Object.entries(after.players))if(!equal(before.players[id],p)){
    const profile=result.players[id]??=blank(id);
    for(const field of core)if(!equal(before.players[id]?.[field],p[field]))Object.assign(profile,{[field]:p[field]});
    part.players[id]=copy(p);
    if(before.players[id]?.uuid&&!p.uuid){
      if(Object.values(s.tickets).some(t=>t.opener===id&&t.type==='test'&&t.status!=='closed'))throw new UserError('Finish all open tests in this server before unlinking the account.');
      for(const mode of [result.defaultModeId??'crystal',...Object.keys(result.modes??{})]){const p=partition(result,mode);if(p.players[id])p.players[id]!.waitlist=false;for(const r of ['NA','EU','AS'] as const)p.queues[r]=p.queues[r].filter(x=>x!==id);clearLists(p,id);addJob(result,mode,'roles',id);addJob(result,mode,'lists');}
    }
  }
  for(const [id,p]of Object.entries(after.players))if(p.uuid&&(before.players[id]?.uuid!==p.uuid||before.players[id]?.region!==p.region)){
    for(const mode of [result.defaultModeId??'crystal',...Object.keys(result.modes??{})]){if(mode===key)continue;const target=partition(result,mode),rank=target.players[id];if(rank)syncLists({...result,lists:target.lists},{...rank,...Object.fromEntries(core.map(field=>[field,p[field]]))},Date.now());addJob(result,mode,'roles',id);addJob(result,mode,'lists');}
  }
  for(const id of Object.keys(before.players))if(!after.players[id])delete part.players[id];
  part.queues=copy(after.queues);part.lists=copy(after.lists);part.lastTestingSession=copy(after.lastTestingSession);
  for(const [id,region]of Object.entries(after.testers))if(before.testers[id]!==region){
    const active=result.testerModes?.[id]??result.defaultModeId??'crystal';
    if(result.testers[id]&&active!==key)throw new UserError('Use /stop before starting another mode in this server.');
    result.testers[id]=region;(result.testerModes??={})[id]=key;
  }
  for(const id of Object.keys(before.testers))if(!after.testers[id]){delete result.testers[id];if(result.testerModes)delete result.testerModes[id];}
  if(!s.maintenance&&result.maintenance){result.testers={};result.testerModes={};for(const mode of [result.defaultModeId??'crystal',...Object.keys(result.modes??{})]){partition(result,mode).queues={NA:[],EU:[],AS:[]};addJob(result,mode,'queues');}}
  mergeRecords(result.tickets,before.tickets,after.tickets,t=>({...t,...(t.type==='test'?{modeId:key,modeName:name??key}:{})}));
  mergeRecords(result.jobs,before.jobs,after.jobs,j=>({...j,data:{...j.data,modeId:j.data.modeId??key}}));
  for(const name of Object.keys(before.panels))if(!(name in after.panels))delete result.panels[panelKey(result,key,name)];
  for(const [name,id]of Object.entries(after.panels))if(before.panels[name]!==id)result.panels[panelKey(result,key,name)]=id;
  const other=result.completions.filter(e=>!before.completions.some(b=>b.ticketId===e.ticketId));result.completions=[...other,...after.completions.map(e=>({...e,modeId:key}))];
  for(const restriction of result.restrictions)if(!s.restrictions.some(r=>r.id===restriction.id)){
    restriction.previousTiers=Object.fromEntries([s.defaultModeId??'crystal',...Object.keys(s.modes??{})].map(mode=>[mode,partition(copy(s),mode).players[restriction.playerId]?.tier??'Unranked']));
    for(const mode of [result.defaultModeId??'crystal',...Object.keys(result.modes??{})]){const p=partition(result,mode);for(const r of ['NA','EU','AS'] as const)p.queues[r]=p.queues[r].filter(id=>id!==restriction.playerId);for(const regions of Object.values(p.lists))for(const ids of Object.values(regions??{}))if(ids){const n=ids.indexOf(restriction.playerId);if(n>=0)ids.splice(n,1);}addJob(result,mode,'roles',restriction.playerId);addJob(result,mode,'lists');}
  }
  for(const old of s.restrictions)if(!result.restrictions.some(r=>r.id===old.id))for(const [mode,tier]of Object.entries(old.previousTiers??{[s.defaultModeId??'crystal']:old.previousTier??'Unranked'})){const p=partition(result,mode);if(p.players[old.playerId])p.players[old.playerId]!.tier=tier;addJob(result,mode,'roles',old.playerId);}
  return result;
}
export function validateIdentities(root:State){
  const byUser=new Map<string,string>(),byUuid=new Map<string,string>();
  for(const guild of [root,...Object.values(root.servers??{})])for(const p of Object.values(guild.players))if(p.uuid){
    if(byUser.has(p.id)&&byUser.get(p.id)!==p.uuid)throw new UserError('Use the same Minecraft account linked in the other server. Ask an Owner for a global unlink to change it.');
    if(byUuid.has(p.uuid)&&byUuid.get(p.uuid)!==p.id)throw new UserError('This Minecraft account is already linked to another Discord account.');
    byUser.set(p.id,p.uuid);byUuid.set(p.uuid,p.id);
  }
}
class ScopedAdapter implements Adapter {
  constructor(private parent:Store,private guild:string,private key?:string,private name?:string){}
  async read():Promise<Snapshot>{const {revision,state}=await this.parent.adapter.read(),guild=guildSnapshot(state,this.guild);return {revision,state:this.key?modeSnapshot(guild,this.key):guild};}
  async compareAndSwap(revision:number,state:State){
    const latest=await this.parent.adapter.read();if(latest.revision!==revision)return false;
    const before=guildSnapshot(latest.state,this.guild),next=this.key?mergeMode(before,this.key,state,this.name):copy(state);delete next.servers;
    const root=copy(latest.state);putGuild(root,next);
    if(!equal(Object.values(before.players).map(p=>[p.id,p.uuid]),Object.values(next.players).map(p=>[p.id,p.uuid])))validateIdentities(root);
    return this.parent.adapter.compareAndSwap(revision,root);
  }
  async close(){}
}
export class SharedDeployment {
  constructor(readonly parent:Store,readonly configs:ConfigFile[]=[] ){}
  async attach(guild:string,mode:string){await this.parent.change(root=>{if(guild!==root.guildId&&!root.servers?.[guild])(root.servers??={})[guild]={...emptyState(guild),maintenance:true};const s=rawGuild(root,guild);s.defaultModeId??=mode;validateIdentities(root);});}
  guildStore(guild:string){return new Store(new ScopedAdapter(this.parent,guild),this.parent.operations);}
  async supportProfile(guild:string,id:string){const root=await this.parent.read(false),source=guildSnapshot(root,guild);return source.players[id]??null;}
  async profileRanks(guild:string,id:string){const root=await this.parent.read(false),source=guildSnapshot(root,guild),config=this.configs.find(file=>file.value.community.guildId===guild)?.value;
    const keys=config?.gameModes.length?config.gameModes.map(mode=>({key:mode.key,name:mode.name})):[{key:source.defaultModeId??'crystal',name:'Crystal'}];
    return {player:source.players[id]??null,ranks:keys.map(mode=>({name:mode.name,tier:(mode.key===(source.defaultModeId??'crystal')?source.players[id]:source.modes?.[mode.key]?.players[id])?.tier??'Unranked'}))};
  }
  async migrateFromSupport(targetGuild:string,supportGuild:string,actor:Actor,id:string,mode:string,tier:Tier,region:string,ign:string|undefined,source:string){
    const target=this.configs.find(f=>f.value.community.guildId===targetGuild)?.value;
    const support=this.configs.find(f=>f.value.community.guildId===supportGuild)?.value;
    if(!target||!support||support.supportTargetGuildId!==targetGuild||targetGuild===supportGuild)throw new UserError('The testing server is not configured for support migrations.');
    requireGroup(support,actor,'regulator');
    if(!target.gameModes.some(m=>m.key===mode))throw new UserError('Choose a game mode in the testing server.');
    if(!source.trim()||source.length>100)throw new UserError('Provide a source up to 100 characters.');
    const config=modeConfig(target,mode),grant=config.permissionGroups.regulator[0]??config.permissionGroups.owner[0];
    if(!grant)throw new UserError('The testing server needs a Regulator role mapping.');
    const profile=await this.supportProfile(targetGuild,id);
    if(!profile?.uuid&&!ign)throw new UserError('Provide an IGN for this unverified player.');
    await new Service(this.modeStore(targetGuild,mode,config.activeMode?.name),()=>config).forceResult({id:actor.id,roles:[grant],administrator:false},id,tier,region,ign,source);
  }
  async resetCooldownFromSupport(targetGuild:string,supportGuild:string,actor:Actor,id:string,mode:string){
    const target=this.configs.find(f=>f.value.community.guildId===targetGuild)?.value;
    const support=this.configs.find(f=>f.value.community.guildId===supportGuild)?.value;
    if(!target||!support||support.supportTargetGuildId!==targetGuild||targetGuild===supportGuild)throw new UserError('The testing server is not configured for support cooldown resets.');
    requireGroup(support,actor,'regulator');
    if(!target.gameModes.some(m=>m.key===mode))throw new UserError('Choose a game mode in the testing server.');
    const config=modeConfig(target,mode),grant=config.permissionGroups.owner[0];
    if(!grant)throw new UserError('The testing server needs an Owner role mapping.');
    await new Service(this.modeStore(targetGuild,mode,config.activeMode?.name),()=>config).resetCooldown({id:actor.id,roles:[grant],administrator:false},id);
  }
  async unrestrictFromSupport(sourceGuild:string,supportGuild:string,actor:string,id:string){
    if(sourceGuild===supportGuild)throw new UserError('Support and testing servers must be separate.');
    return this.parent.change(root=>{
      const source=rawGuild(root,sourceGuild),support=rawGuild(root,supportGuild);
      if((sourceGuild!==root.guildId&&!root.servers?.[sourceGuild])||!source.initialized||!support.initialized)throw new UserError('Support or testing server is unavailable.');
      const removed=source.restrictions.filter(r=>r.playerId===id);
      if(!removed.length)throw new UserError('No restriction was found for this player.');
      source.restrictions=source.restrictions.filter(r=>r.playerId!==id);
      for(const mode of [source.defaultModeId??'crystal',...Object.keys(source.modes??{})]){
        const ranks=partition(source,mode),previous=[...removed].reverse().map(r=>r.previousTiers?.[mode]??(mode===(source.defaultModeId??'crystal')?r.previousTier:undefined)).find(Boolean);
        if(previous&&ranks.players[id])ranks.players[id]!.tier=previous;
        addJob(source,mode,'roles',id);addJob(source,mode,'lists');
      }
      const at=Date.now(),event={id:randomUUID(),at,actor,action:'support-unrestrict',target:id};
      source.audit.push(event);support.audit.push({...event,id:randomUUID(),action:'crystal-unrestrict'});
    });
  }
  modeStore(guild:string,key:string,name?:string){return new Store(new ScopedAdapter(this.parent,guild,key,name),this.parent.operations);}
  async unlinkAll(id:string){await this.parent.change(root=>{
    const guilds=[root,...Object.values(root.servers??{})];if(guilds.some(s=>Object.values(s.tickets).some(t=>t.opener===id&&t.type==='test'&&t.status!=='closed')))throw new UserError('Finish open tests in both servers before globally unlinking.');
    for(const s of guilds){if(!s.players[id])continue;Object.assign(s.players[id]!,{uuid:null,ign:null,region:null,preferredServer:null,waitlist:false});for(const mode of [s.defaultModeId??'crystal',...Object.keys(s.modes??{})]){const p=partition(s,mode);if(p.players[id])Object.assign(p.players[id]!,{uuid:null,ign:null,region:null,preferredServer:null,waitlist:false});for(const r of ['NA','EU','AS'] as const)p.queues[r]=p.queues[r].filter(x=>x!==id);clearLists(p,id);addJob(s,mode,'roles',id);addJob(s,mode,'lists');}}
  });}
}
export class ContextStore extends Store {
  private stores=new Map<string,Store>();
  constructor(readonly deployment:SharedDeployment,readonly guild:string,readonly scope:ModeScope){super(deployment.guildStore(guild).adapter,deployment.parent.operations);}
  private current(){const key=this.scope.key;let store=this.stores.get(key);if(!store){store=this.deployment.modeStore(this.guild,key,this.scope.file.value.activeMode?.name);this.stores.set(key,store);}return store;}
  override read(includeLease=true){return this.current().read(includeLease);}
  override change<T>(fn:(state:State)=>T){return this.current().change(fn);}
  override async close(){}
}
