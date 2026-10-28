import {TIERS,type Tier} from '../domain/types.js';
export interface TierHistory {
  capturedAt:number;earliest:number;exhausted:boolean;
  members:Record<string,{joinedAt:number;capturedAt:number;roles:string[]}>;
  events:{id:string;memberId:string;at:number;added:string[];removed:string[]}[];
}
export function recoverOpeningTier(memberId:string,at:number,roles:Partial<Record<Tier,string|null>>,history:TierHistory,integrity:{complete:boolean;changes:{at:number}[]}):{tier:Tier;auditIds:string[]}|{reason:string}{
  const member=history.members[memberId];if(!member)return {reason:'Member unavailable'};
  if(!Number.isFinite(member.joinedAt)||member.joinedAt>at)return {reason:'Member rejoined after ticket creation'};
  if(at>member.capturedAt||at<history.capturedAt-45*86400000)return {reason:'Reference outside retained snapshot window'};
  if(history.earliest>at&&!history.exhausted)return {reason:'Audit coverage incomplete'};
  if(!integrity.complete||integrity.changes.some(e=>e.at>=at&&e.at<=member.capturedAt))return {reason:'Tier role identity history needs review'};
  for(const id of Object.values(roles))if(id&&Number((BigInt(id)>>22n)+1420070400000n)>at)return {reason:'Tier role mapping is newer than ticket'};
  const current=new Set(member.roles),used:string[]=[];
  const events=history.events.filter(e=>e.memberId===memberId&&e.at>=at&&e.at<=member.capturedAt).sort((a,b)=>a.at===b.at?(BigInt(a.id)>BigInt(b.id)?-1:1):b.at-a.at);
  for(const e of events){
    if(e.at===at)return {reason:'Ambiguous same-millisecond tier update'};
    if(e.added.some(id=>!current.has(id))||e.removed.some(id=>current.has(id)))return {reason:'Role history does not match current snapshot'};
    for(const id of e.added)current.delete(id);for(const id of e.removed)current.add(id);used.push(e.id);
  }
  return {tier:[...TIERS].reverse().find(t=>roles[t]&&current.has(roles[t]!))??'Unranked',auditIds:used};
}
