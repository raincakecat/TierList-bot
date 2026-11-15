import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,type Player} from '../src/domain/types.js';
import {MemoryAdapter,Store} from '../src/storage/store.js';
import {SharedDeployment} from '../src/storage/deployment.js';

const MAIN='100000000000000001',SUPPORT='100000000000000002',USER='100000000000000003';
const player=(tier:Player['tier']):Player=>({id:USER,tier,uuid:'a'.repeat(32),ign:'Player',region:'NA',preferredServer:'server',waitlist:false,cooldownUntil:44});
test('support unrestriction updates only Crystal ranks and records both audit trails',async()=>{
  const root=emptyState(MAIN),support=emptyState(SUPPORT);root.initialized=support.initialized=true;root.players[USER]=player('HT3');root.modes={sword:{players:{[USER]:player('LT2')},queues:{NA:[],EU:[],AS:[]},lists:{}}};root.restrictions=[{id:'restriction',playerId:USER,uuid:'a'.repeat(32),reason:'reason',until:null,actor:'moderator',previousTier:'LT3',previousTiers:{crystal:'LT3',sword:'HT2'}}];root.servers={[SUPPORT]:support};
  const store=new Store(new MemoryAdapter(root)),deployment=new SharedDeployment(store);await deployment.unrestrictFromSupport(MAIN,SUPPORT,'reviewer',USER);const result=await store.read(false);
  assert.deepEqual(result.restrictions,[]);assert.equal(result.players[USER]!.tier,'LT3');assert.equal(result.modes!.sword!.players[USER]!.tier,'HT2');assert.equal(result.players[USER]!.cooldownUntil,44);
  assert.equal(result.audit.at(-1)!.actor,'reviewer');assert.equal(result.servers![SUPPORT]!.audit.at(-1)!.actor,'reviewer');assert(Object.values(result.jobs).some(j=>j.data.modeId==='sword'));
  await assert.rejects(deployment.unrestrictFromSupport(MAIN,SUPPORT,'reviewer',USER),/No restriction/);
});
