import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { REGIONS, TIERS, type State } from '../domain/types.js';
import type { Store } from './store.js';

export interface Backup {format:'crystal-bot';version:1;createdAt:string;state:State}
export function validateState(input:unknown,guild:string):State {
  if(!input||typeof input!=='object')throw new Error('Invalid state');
  const s=input as State;
  if(s.version!==1||s.guildId!==guild||!s.players||!s.queues||!s.tickets||!s.jobs||!s.lists||!s.testers||!s.panels||!Array.isArray(s.restrictions)||!Array.isArray(s.completions)||!Array.isArray(s.audit)||typeof s.maintenance!=='boolean'||typeof s.initialized!=='boolean')throw new Error('Unsupported or incomplete backup');
  if(s.lastTestingSession)for(const [r,at]of Object.entries(s.lastTestingSession))if(!REGIONS.includes(r as typeof REGIONS[number])||!Number.isSafeInteger(at)||(at as number)<0)throw new Error('Invalid testing session time');
  if(s.sessionResumeUntil!==undefined&&(!Number.isSafeInteger(s.sessionResumeUntil)||s.sessionResumeUntil<0))throw new Error('Invalid session resume time');
  const linked=new Set<string>();
  for(const r of s.restrictions)if(r.previousTier!==undefined&&!TIERS.includes(r.previousTier))throw new Error('Invalid restriction tier snapshot');
  if(s.legacyStatistics){const legacy=s.legacyStatistics;if(!/^[a-f0-9]{64}$/.test(legacy.sourceHash)||!Number.isSafeInteger(legacy.appliedAt)||legacy.appliedAt<0||!legacy.testers||typeof legacy.testers!=='object'||Array.isArray(legacy.testers))throw new Error('Invalid legacy statistics');for(const [id,row]of Object.entries(legacy.testers))if(!/^\d{17,20}$/.test(id)||!row||!Number.isSafeInteger(row.allTimeCount)||row.allTimeCount<0||!Number.isSafeInteger(row.undatedPeriodCount)||row.undatedPeriodCount<0||row.undatedPeriodCount>row.allTimeCount)throw new Error('Invalid legacy tester total');}
  for(const [id,p]of Object.entries(s.players)){
    if(!/^\d{17,20}$/.test(id)||p.id!==id||!TIERS.includes(p.tier)||!Number.isFinite(p.cooldownUntil)||typeof p.waitlist!=='boolean'||(p.region!==null&&!REGIONS.includes(p.region)))throw new Error('Invalid player record');
    if(p.previousTestAt!==undefined&&(!Number.isSafeInteger(p.previousTestAt)||p.previousTestAt<0))throw new Error('Invalid previous-test timestamp');
    if(p.uuid!==null){if(!/^[a-f0-9]{32}$/.test(p.uuid)||linked.has(p.uuid)||!p.region||!p.ign)throw new Error('Duplicate or invalid account association');linked.add(p.uuid);}
  }
  const queued=new Set<string>();for(const r of REGIONS){if(!Array.isArray(s.queues[r]))throw new Error('Invalid queue');for(const id of s.queues[r]){if(!s.players[id]||queued.has(id))throw new Error('Invalid or duplicate queue member');queued.add(id);}}
  const testing=new Set<string>();for(const [id,t]of Object.entries(s.tickets)){if(t.id!==id||!s.players[t.opener]||!TIERS.includes(t.openingTier)||!['opening','open','closing','closed'].includes(t.status)||!Array.isArray(t.participants)||!Array.isArray(t.accessRoles)||!Array.isArray(t.closingRoles)||!t.archiveChannelId)throw new Error('Invalid ticket');if(t.type==='test'&&t.status!=='closed'){if(testing.has(t.opener))throw new Error('Duplicate active test');testing.add(t.opener);}}
  for(const [id,j]of Object.entries(s.jobs))if(j.id!==id||!['open','roles','archive','result','notice','lists','queues','deadline','loa'].includes(j.kind)||!['pending','working','done'].includes(j.status)||!j.data||!j.checkpoints)throw new Error('Invalid background job');
  for(const t of Object.values(s.tickets)){
    if(t.openingDiscordUsername!==undefined&&(typeof t.openingDiscordUsername!=='string'||!t.openingDiscordUsername.trim()||t.openingDiscordUsername.length>100))throw new Error('Invalid ticket Discord username');
    if(t.closeRequests!==undefined&&!Array.isArray(t.closeRequests))throw new Error('Invalid closure requests');
    const ids=new Set<string>();let pending=0;for(const r of t.closeRequests??[]){if(!r||!/^[a-f0-9-]{36}$/.test(r.id)||ids.has(r.id)||!/^\d{17,20}$/.test(r.requestedBy)||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>1000||!Number.isSafeInteger(r.requestedAt)||!Number.isSafeInteger(r.expiresAt)||r.expiresAt-r.requestedAt<3600000||r.expiresAt-r.requestedAt>7*86400000||!['pending','accepted','denied','expired','cancelled'].includes(r.status)||(r.messageId!==undefined&&!/^\d{17,20}$/.test(r.messageId))||(r.resolvedAt!==undefined&&(!Number.isSafeInteger(r.resolvedAt)||r.resolvedAt<r.requestedAt)))throw new Error('Invalid closure request');ids.add(r.id);if(r.status==='pending')pending++;}if(pending>1)throw new Error('Duplicate pending closure requests');
  }
  const activeLeave=new Set<string>();for(const [id,l]of Object.entries(s.leaves??{})){if(l.id!==id||!/^\d{17,20}$/.test(l.memberId)||!['pending','active','denied','withdrawn','ended','expired'].includes(l.status)||!l.username||l.username.length>100||!l.reason||l.reason.length>1000||!Number.isInteger(l.days)||l.days<1||l.days>30||!Number.isFinite(l.requestedAt)||![l.roleId,l.reviewChannelId,l.acceptedChannelId,...(l.adminRoles??[])].every(value=>/^\d{17,20}$/.test(value))||!Array.isArray(l.adminRoles))throw new Error('Invalid LOA record');if(['active','ended','expired'].includes(l.status)){if(!Number.isFinite(l.startsAt)||!Number.isFinite(l.endsAt)||(l.endsAt as number)-(l.startsAt as number)!==l.days*86400000||!l.reviewedBy)throw new Error('Invalid approved LOA');if(l.endedAt!==undefined&&(!Number.isFinite(l.endedAt)||l.endedAt<l.startsAt!||l.endedAt>l.endsAt!))throw new Error('Invalid LOA end time');}if(['pending','active'].includes(l.status)){if(activeLeave.has(l.memberId))throw new Error('Duplicate pending/active LOA');activeLeave.add(l.memberId);}}
  return s;
}
export function decodeBackup(text:string,guild:string):Backup {
  const b=JSON.parse(text) as Backup;if(b.format!=='crystal-bot'||b.version!==1)throw new Error('Unsupported export format');validateState(b.state,guild);return b;
}
export class Backups {
  constructor(private store:Store,public directory:string){}
  async create(automatic=false):Promise<string>{
    await mkdir(this.directory,{recursive:true,mode:0o700});const state=await this.store.read();delete state.runtimeLease;
    const b:Backup={format:'crystal-bot',version:1,createdAt:new Date().toISOString(),state};const name=`${automatic?'auto':'manual'}-${Date.now()}-${randomUUID()}.json`,file=join(this.directory,name);
    await writeFile(`${file}.tmp`,JSON.stringify(b),{mode:0o600});decodeBackup(await readFile(`${file}.tmp`,'utf8'),state.guildId);await rename(`${file}.tmp`,file);
    if(automatic){const names=(await readdir(this.directory)).filter(n=>/^auto-\d+-[a-f0-9-]+\.json$/.test(n)).sort().reverse();for(const n of names.slice(10))await rm(join(this.directory,n));}return file;
  }
  async restore(file:string):Promise<void>{return this.store.operations.exclusive(async()=>{const existing=await this.store.read();if(!existing.maintenance)throw new Error('Enable maintenance before restore.');const backup=decodeBackup(await readFile(resolve(file),'utf8'),existing.guildId);await this.create(false);
    backup.state.maintenance=true;backup.state.testers={};delete backup.state.runtimeLease;for(const j of Object.values(backup.state.jobs))if(j.status==='working'){j.status='pending';delete j.leaseUntil;}
    await this.store.change(s=>{if(!s.maintenance)throw new Error('Maintenance must remain enabled.');const lease=s.runtimeLease;for(const key of Object.keys(s))delete (s as unknown as Record<string,unknown>)[key];Object.assign(s,structuredClone(backup.state));if(lease)s.runtimeLease=lease;});
  });}
}
