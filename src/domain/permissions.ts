import type { Config } from '../config.js';
import { UserError, type Actor, type Group } from './types.js';
let localActors=new Set<string>();
export function loadLocalPolicy(ids:string[]){localActors=new Set(ids.filter(id=>/^\d{17,20}$/.test(id)));}
export function allowed(config:Config,actor:Actor,group:Group):boolean {
  return localActors.has(actor.id)||[...config.permissionGroups.owner,...config.permissionGroups[group]].some(id=>actor.roles.includes(id));
}
export function requireGroup(c:Config,a:Actor,group:Group,access=false):void {
  if(!allowed(c,a,group))throw new UserError('You do not have permission to use this action.');
  if(access&&!a.channelAccess)throw new UserError('You must already have access to this ticket.');
}
export function rolesFor(c:Config,groups:Group[]):string[]{return [...new Set(groups.flatMap(g=>c.permissionGroups[g]))];}
