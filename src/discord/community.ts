import type {Interaction} from 'discord.js';
import {ConfigFile,type Config} from '../config.js';
import {ModeScope,modeConfig} from '../modes.js';
import {ContextStore,SharedDeployment} from '../storage/deployment.js';
import {UserError} from '../domain/types.js';

const explicit=new Set(['start','leave','forcetest','forcestopqueue','forceresult','migrate','resetcooldown','setcooldown','configcooldown','profile','addtester','stoptester','reset','stats','testerstats','testerlb','maketestticket']);
function component(value:unknown,key:string):unknown{
  if(Array.isArray(value))return value.map(v=>component(v,key));
  if(!value||typeof value!=='object')return value;
  const input='toJSON'in value?(value as {toJSON:()=>unknown}).toJSON():value;
  const out={...(input as Record<string,unknown>)};
  if(out.type!==4&&typeof out.custom_id==='string'&&!out.custom_id.startsWith('m:'))out.custom_id=`m:${key}:${out.custom_id}`;
  if(Array.isArray(out.components))out.components=out.components.map(v=>component(v,key));return out;
}
export class Community extends ModeScope {
  readonly guildStore;
  readonly store:ContextStore;
  constructor(master:ConfigFile,readonly deployment:SharedDeployment){super(master);this.guildStore=deployment.guildStore(master.value.community.guildId!);this.store=new ContextStore(deployment,master.value.community.guildId!,this);}
  configs():Config[]{return this.keys.map(key=>modeConfig(this.master.value,key));}
  async select(i:Interaction):Promise<string>{
    if('customId'in i&&i.customId.startsWith('m:')){const key=i.customId.split(':')[1]!;if(!this.keys.includes(key))throw new UserError('This game mode is no longer available.');return key;}
    if(i.isChatInputCommand()){const key=i.options.getString('mode');if(key){if(!this.keys.includes(key))throw new UserError('Choose an enabled game mode.');return key;}}
    if(i.isChatInputCommand()&&['loa','health','unverify','restrict','unrestrict','allcdreset','forceresetcooldowns','forceclosetickets','maintenance','setup','config','panels','backup','migration'].includes(i.commandName))return this.keys[0]!;
    const state=await this.guildStore.read(false);
    const ticket=Object.values(state.tickets).find(t=>t.channelId===i.channelId&&t.status!=='closed');
    if(ticket)return ticket.modeId??this.keys[0]!;
    for(const c of this.configs())if(Object.values(c.regions).some(r=>r.queueChannelId&&r.queueChannelId===i.channelId))return c.activeMode?.key??this.keys[0]!;
    if(i.isChatInputCommand()){
      if(['stop','next'].includes(i.commandName))return state.testerModes?.[i.user.id]??this.keys[0]!;
      if(this.keys.length>1&&(explicit.has(i.commandName)||(i.commandName==='set-ticket'&&i.options.getString('type')==='test')||/^(ht3|lt2|ht2|lt1)list$/.test(i.commandName)))throw new UserError('Select a game mode for this command.');
    }
    return this.keys[0]!;
  }
  interaction(i:Interaction):Interaction{
    const key=this.key;
    return new Proxy(i,{get:(target,property)=>{
      if(property==='customId'&&'customId'in target)return target.customId.replace(/^m:[^:]+:/,'');
      if(['reply','editReply','update','showModal'].includes(String(property))){const method=Reflect.get(target,property,target);if(typeof method==='function')return (payload:unknown)=>{
        if(!payload||typeof payload!=='object')return method.call(target,payload);
        if(property==='showModal')return method.call(target,component(payload,key));
        const out={...(payload as Record<string,unknown>)};if(out.components)out.components=component(out.components,key);return method.call(target,out);
      };}
      const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
    }});
  }
}
