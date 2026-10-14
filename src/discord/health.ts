import type { Config } from '../config.js';
import { readiness } from '../config.js';
import type { Store } from '../storage/store.js';

export async function healthSummary(store:Store,c:Config,startedAt:number,discordProblems:number,now=Date.now()):Promise<string>{
  const header=`Bot health\nDatabase backend: ${c.database.backend}\nUptime: ${Math.floor((now-startedAt)/1000)} seconds\nRecovery fence: ${store.operations.recovering?'active':'idle'}`;
  try{const state=await store.read(),jobs=Object.values(state.jobs),pending=jobs.filter(j=>j.status==='pending'),working=jobs.filter(j=>j.status==='working'),retrying=pending.filter(j=>j.attempts>0),oldest=pending.length?Math.min(...pending.map(j=>j.createdAt??j.nextAt)):null;
    return `${header}\nDatabase: available\nMaintenance: ${state.maintenance?'enabled':'disabled'}\nPending: ${pending.length}; running: ${working.length}; retrying: ${retrying.length}\nOldest pending work: ${oldest===null?'none':new Date(oldest).toISOString()} (legacy jobs use scheduled time)\nLast successful automatic backup: ${state.lastAutomaticBackupAt?new Date(state.lastAutomaticBackupAt).toISOString():'none recorded'}\nConfiguration problems: ${readiness(c).length}; last Discord validation problems: ${discordProblems}`;
  }catch{return `${header}\nDatabase: unavailable\nState, job and backup information could not be read. Check the private operational logs.\nConfiguration problems: ${readiness(c).length}; last Discord validation problems: ${discordProblems}`;}
}
