import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,type Job} from '../src/domain/types.js';
import {compactCompletedJobs} from '../src/domain/service.js';

test('job compaction removes old completed refresh work and retains archive and audit evidence',()=>{
  const s=emptyState('100000000000000001'),now=120_000;
  const job=(id:string,kind:Job['kind'],status:Job['status'],createdAt:number):Job=>({id,kind,status,attempts:0,nextAt:createdAt,createdAt,checkpoints:{},data:{}});
  s.jobs={oldRole:job('oldRole','roles','done',0),oldQueue:job('oldQueue','queues','done',0),oldList:job('oldList','lists','done',0),recentRole:job('recentRole','roles','done',90_000),pending:job('pending','lists','pending',0),archive:job('archive','archive','done',0),'audit-event':job('audit-event','notice','done',0)};
  assert.equal(compactCompletedJobs(s,now),3);
  assert.deepEqual(Object.keys(s.jobs),['recentRole','pending','archive','audit-event']);
  assert.equal(s.lastJobCompactionAt,now);
});
