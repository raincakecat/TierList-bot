import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../src/domain/types.js';
import {MemoryAdapter,Store} from '../src/storage/store.js';
import {Worker} from '../src/storage/jobs.js';
test('foreground role restoration runs before bulk migration work without dropping the bulk job',async()=>{
  const state=emptyState('100000000000000001');for(const [id,bulk]of [['migration',true],['unrestrict',false]] as const)state.jobs[id]={id,kind:'roles',data:{playerId:'100000000000000002',bulk},status:'pending',attempts:0,nextAt:0,checkpoints:{}};
  const store=new Store(new MemoryAdapter(state)),seen:string[]=[],worker=new Worker(store,async job=>{seen.push(job.id);},async()=>{});await worker.runOnce();assert.deepEqual(seen,['unrestrict']);assert.equal((await store.read()).jobs.migration!.status,'pending');await worker.runOnce();assert.deepEqual(seen,['unrestrict','migration']);
});
