import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,type Player,type Ticket} from '../src/domain/types.js';
import {consolidationPreview,consolidateTestingModes} from '../src/storage/consolidation.js';

const MAIN='100000000000000001',OLD='100000000000000002',USER='100000000000000003';
const keys=['sword','axe','smp','pot','mace','uhc','nethpot','spear-mace'];
const person=(tier:Player['tier'],region:Player['region'],cooldownUntil=0):Player=>({id:USER,tier,uuid:'a'.repeat(32),ign:'Example',region,preferredServer:'practice',waitlist:true,cooldownUntil});
function fixture(){
  const main=emptyState(MAIN),old=emptyState(OLD);main.initialized=old.initialized=true;main.maintenance=old.maintenance=true;old.defaultModeId='sword';
  main.players[USER]=person('LT3','EU',31);old.players[USER]=person('HT3','NA',91);old.lists.HT3={NA:[USER]};
  for(const key of keys.slice(1))old.modes??={},old.modes[key]={players:{[USER]:person(key==='axe'?'LT2':'Unranked','NA',77)},queues:{NA:[USER],EU:[],AS:[]},lists:{}};
  const ticket:Ticket={id:'ticket',channelId:'100000000000000004',type:'test',opener:USER,region:'NA',openingTier:'LT3',openingIgn:'Example',tester:USER,target:null,passed:true,status:'closed',participants:[],openedAt:1,closedAt:2,outcome:'HT3',accessRoles:[],closingRoles:[],archiveChannelId:'100000000000000005',copyImages:false,imageRetentionDays:1,categoryId:'100000000000000006',name:'old'};
  old.tickets[ticket.id]=ticket;old.completions.push({ticketId:ticket.id,tester:USER,at:2});old.audit.push({id:'pass',at:1,actor:USER,action:'passeval',target:ticket.id});main.servers={[OLD]:old};return main;
}
test('consolidation preserves mode ranks and history while choosing Crystal region and clearing queues',()=>{
  const main=fixture();assert.equal(consolidationPreview(main,OLD).openTests,0);consolidateTestingModes(main,OLD);
  assert.equal(main.players[USER]!.tier,'LT3');assert.equal(main.players[USER]!.region,'EU');assert.equal(main.modes!.sword!.players[USER]!.tier,'HT3');assert.equal(main.modes!.sword!.players[USER]!.cooldownUntil,91);
  assert.deepEqual(main.modes!.sword!.lists.HT3?.EU,[USER]);assert.deepEqual(main.modes!.axe!.lists.LT2?.EU,[USER]);assert.deepEqual(main.modes!.axe!.queues.NA,[]);
  assert.equal(main.modes!.axe!.players[USER]!.waitlist,false);assert.equal(main.tickets.ticket!.modeId,'sword');assert.equal(main.completions[0]!.modeId,'sword');assert(main.audit.some(x=>x.id==='pass'));
  assert.equal(main.servers![OLD]!.players[USER]!.region,'NA');assert.throws(()=>consolidateTestingModes(main,OLD),/existing\/missing modes/);
});
test('consolidation refuses open tests, identity conflicts, and missing maintenance without changing the snapshot',()=>{
  const main=fixture(),before=structuredClone(main);main.servers![OLD]!.tickets.ticket!.status='open';assert.throws(()=>consolidateTestingModes(main,OLD),/open tests/);assert.deepEqual(main.modes,before.modes);
  main.servers![OLD]!.tickets.ticket!.status='closed';main.players[USER]!.uuid='b'.repeat(32);assert.throws(()=>consolidateTestingModes(main,OLD),/identity conflicts/);
  main.players[USER]!.uuid='a'.repeat(32);main.maintenance=false;assert.throws(()=>consolidateTestingModes(main,OLD),/maintenance/);
});
