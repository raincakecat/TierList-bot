import test from 'node:test';
import assert from 'node:assert/strict';
import {LeaseWatch} from '../src/storage/lease-watch.js';
import {boundedFetch} from '../src/storage/store.js';

test('a stalled renewal expires the lease even while its request is pending',async()=>{
 let now=0,failures=0,release!:()=>void,calls=0;const held=new Promise<void>(r=>release=r);
 const watch=new LeaseWatch(60000,async()=>{calls++;await held;},()=>failures++,()=>now);
 const pending=watch.pulse();void watch.pulse();assert.equal(calls,1);now=60001;watch.check();watch.check();assert.equal(failures,1);release();await pending;await watch.pulse();assert.equal(calls,1);assert.equal(failures,1);
});
test('successful renewals extend the confirmed deadline and shutdown stops monitoring',async()=>{
 let now=15000,failures=0;const watch=new LeaseWatch(60000,async()=>{},()=>failures++,()=>now);await watch.pulse();now=65000;watch.check();assert.equal(failures,0);await watch.stop();now=100000;watch.check();assert.equal(failures,0);
});
test('renewal failures fail once and cannot be hidden by a later successful response',async()=>{
 let failures=0;const watch=new LeaseWatch(Date.now()+60000,async()=>{throw Error('offline');},()=>failures++);await watch.pulse();await watch.pulse();assert.equal(failures,1);
});
test('database fetches have a deadline and retain caller cancellation',async()=>{
 const fetcher:typeof fetch=async(_input,init)=>new Promise((_resolve,reject)=>{const signal=init!.signal!;if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 const keepAlive=setInterval(()=>{},1000);try{await assert.rejects(boundedFetch(fetcher,20)('https://example.invalid'),e=>(e as Error).name==='TimeoutError');const abort=new AbortController();abort.abort();await assert.rejects(boundedFetch(fetcher)('https://example.invalid',{signal:abort.signal}),e=>(e as Error).name==='AbortError');}finally{clearInterval(keepAlive);}
});
