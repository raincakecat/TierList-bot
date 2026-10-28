import type { Config } from '../config.js';
import { readiness } from '../config.js';
import type { Store } from '../storage/store.js';

export async function healthSummary(store:Store,c:Config,startedAt:number,discordProblems:number,now=Date.now()):Promise<string>{
  const header=`Bot health\nDatabase backend: ${c.database.backend}\nUptime: ${Math.floor((now-startedAt)/1000)} seconds\nRecovery fence: ${store.operations.recovering?'active':'idle'}`;
  try{const state=await store.read(false),jobs=Object.values(state.jobs),pending=jobs.filter(j=>j.status==='pending'),working=jobs.filter(j=>j.status==='working'),retrying=pending.filter(j=>j.attempts>0),oldest=pending.length?Math.min(...pending.map(j=>j.createdAt??j.nextAt)):null;
    const failures=retrying.filter(j=>j.lastFailureCode).slice(0,3).map(j=>`${j.kind}: ${j.lastFailureCode}`).join('; ');
    return `${header}\nDatabase: available\nMaintenance: ${state.maintenance?'enabled':'disabled'}\nSaved state: ${Math.ceil(Buffer.byteLength(JSON.stringify(state))/1024)} KiB\nPending: ${pending.length}; running: ${working.length}; retrying: ${retrying.length}\n${failures?`Recent retry causes: ${failures}\n`:''}Oldest pending work: ${oldest===null?'none':new Date(oldest).toISOString()} (legacy jobs use scheduled time)\nLast successful automatic backup: ${state.lastAutomaticBackupAt?new Date(state.lastAutomaticBackupAt).toISOString():'none recorded'}\nConfiguration problems: ${readiness(c).length}; last Discord validation problems: ${discordProblems}`;
  }catch{return `${header}\nDatabase: unavailable\nState, job and backup information could not be read. Check the private operational logs.\nConfiguration problems: ${readiness(c).length}; last Discord validation problems: ${discordProblems}`;}
}
