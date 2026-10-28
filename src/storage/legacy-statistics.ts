import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {State} from '../domain/types.js';
import type {Store} from './store.js';

const id=z.string().regex(/^\d{17,20}$/),count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const schema=z.object({tester_quotas:z.array(z.object({tester_id:id,count,all_time_count:count}).passthrough()),players:z.array(z.object({discord_id:id,last_tested:z.number().int().nonnegative().nullable()}).passthrough())}).passthrough();
export function prepareLegacyStatistics(input:unknown){
  const source=schema.parse(input),testers:NonNullable<State['legacyStatistics']>['testers']={},previousTests:Record<string,number>={};
  for(const row of source.tester_quotas){if(testers[row.tester_id]||row.count>row.all_time_count)throw new Error('Duplicate or inconsistent legacy tester total');testers[row.tester_id]={allTimeCount:row.all_time_count,undatedPeriodCount:row.count};}
  for(const row of source.players)if(row.last_tested){const at=row.last_tested*1000;if(!Number.isSafeInteger(at))throw new Error('Invalid legacy test time');if(previousTests[row.discord_id]!==undefined)throw new Error('Duplicate legacy player');previousTests[row.discord_id]=at;}
  return {testers,previousTests};
}
export async function importLegacyStatistics(store:Store,raw:string,now=Date.now()){
  const sourceHash=createHash('sha256').update(raw).digest('hex'),data=prepareLegacyStatistics(JSON.parse(raw));
  return store.change(s=>{
    if(!s.maintenance)throw new Error('Legacy statistics require maintenance');
    if(s.legacyStatistics){if(s.legacyStatistics.sourceHash===sourceHash)return false;throw new Error('Legacy statistics already imported from another snapshot');}
    if(s.completions.length)throw new Error('Import legacy statistics before recording new completed tests');
    s.legacyStatistics={sourceHash,appliedAt:now,testers:data.testers};
    for(const [id,at]of Object.entries(data.previousTests))if(s.players[id])s.players[id]!.previousTestAt=at;
    return true;
  });
}
export function allTimeTests(s:State,id:string){return (s.legacyStatistics?.testers[id]?.allTimeCount??0)+s.completions.filter(e=>e.tester===id).length;}
