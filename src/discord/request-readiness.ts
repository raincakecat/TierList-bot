import type {Config} from '../config.js';
import type {Group} from '../domain/types.js';

/** Missing permission roles must not disable unrelated request flows.
 * All other validation failures remain blocking; authorization is unchanged.
 */
export function requestSetupErrors(c:Config,errors:string[],feature:'testing'|'support'|'loa',supportKey?:string):string[]{
  const groups:Group[]=['owner'];
  const roles:(string|null)[]=[];
  if(feature==='testing'){
    groups.push('staff','verifiedTester');roles.push(c.restriction.roleId,...Object.values(c.tierRoleIds),...(c.ticketNotifications.highTestingRoleIds??[]));
    for(const r of Object.values(c.regions))if(r.enabled)roles.push(r.regionRoleId,r.waitlistRoleId);
  }else if(feature==='loa'){
    groups.push('staff','loaAdmin');roles.push(c.loa.roleId);
  }else{
    for(const t of c.supportTicketTypes.filter(t=>t.enabled&&(!supportKey||t.key===supportKey)))groups.push(...t.accessGroups,...t.closingGroups,...(t.openingPingGroups??[]));
    roles.push(...(c.ticketNotifications.supportRoleIds??[]));
  }
  const needed=new Set([...roles,...groups.flatMap(g=>c.permissionGroups[g])].filter(Boolean));
  return errors.filter(error=>{const missing=error.match(/^Missing role (\d+)$/);return !missing||needed.has(missing[1]!);});
}
