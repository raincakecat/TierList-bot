import type {Client,GuildMember} from 'discord.js';
import type {Config} from '../config.js';
import type {Store} from '../storage/store.js';

/** Mirrors configured title roles, preserving support roles added by hand. */
export class CrossGuildRoleSync {
  private active=new Map<string,Promise<void>>();
  constructor(private client:Client,private store:Store,private config:()=>Config,private afterSync?:(member:GuildMember)=>Promise<void>){}
  sync(id:string):Promise<void>{const running=this.active.get(id);if(running)return running;const task=this.apply(id).finally(()=>this.active.delete(id));this.active.set(id,task);return task;}
  async reconcile(){const c=this.config();if(!c.roleSync)return;const target=await this.client.guilds.fetch(c.community.guildId!);const members=await target.members.fetch();let index=0;const ids=[...members.keys()];await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{while(index<ids.length)await this.sync(ids[index++]!);}));}
  private async apply(id:string){const c=this.config(),rules=c.roleSync;if(!rules)return;
    const source=await this.client.guilds.fetch(rules.sourceGuildId),target=await this.client.guilds.fetch(c.community.guildId!);
    const member=await target.members.fetch({user:id,force:true}).catch(error=>{if((error as {code?:number}).code===10007)return null;throw error;});if(!member)return;
    const original=await source.members.fetch({user:id,force:true}).catch(error=>{if((error as {code?:number}).code===10007)return null;throw error;});
    const grants=new Set((await this.store.read(false)).roleSyncGrants?.[id]??[]);
    const add=[...new Set(rules.mappings.filter(rule=>original?.roles.cache.has(rule.sourceRoleId)&&!member.roles.cache.has(rule.targetRoleId)).map(rule=>rule.targetRoleId))];
    const remove=[...grants].filter(role=>rules.mappings.some(rule=>rule.targetRoleId===role)&&!rules.mappings.some(rule=>rule.targetRoleId===role&&original?.roles.cache.has(rule.sourceRoleId)));
    if(add.length){for(const role of add)grants.add(role);await this.store.change(s=>{(s.roleSyncGrants??={})[id]=[...grants];});await member.roles.add(add,'Synced from TierList Bot');}
    if(remove.length){const held=remove.filter(role=>member.roles.cache.has(role));if(held.length)await member.roles.remove(held,'No longer held in TierList Bot');for(const role of remove)grants.delete(role);await this.store.change(s=>{(s.roleSyncGrants??={})[id]=[...grants];});}
    await this.afterSync?.(member);
  }
}
