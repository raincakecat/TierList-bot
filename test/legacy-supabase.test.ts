import test from 'node:test';
import assert from 'node:assert/strict';
import { convertLegacySupabase } from '../src/storage/legacy-supabase.js';
const guild='100000000000000099',member='100000000000000001';
function fixture(){return {players:[{discord_id:member,username:'PlayerOne',uuid:'a'.repeat(32),rank:'High Tier 3',region:'AU',preferred_server:'Example',last_tested:1700000000}],
  cooldown_entries:[{user_id:member,start_time:1700000000000,duration:345600000}],tickets:[{channel_id:'100000000000000002',testee_id:member,type:'high'}],
  tester_quotas:[{tester_id:member,count:3,all_time_count:50}],quota_settings:[]};}
test('legacy conversion preserves ranks and cooldown units, maps AU and retains unresolved history',()=>{
  const source=fixture(),before=JSON.stringify(source),r=convertLegacySupabase(source,guild);
  assert.equal(JSON.stringify(source),before);assert.equal(r.data.players[0]!.tier,'HT3');assert.equal(r.data.players[0]!.region,'AS');
  assert.equal(r.data.players[0]!.cooldownUntil,1700345600000);assert.equal(r.data.players[0]!.waitlist,false);
  assert.deepEqual(r.data.tickets,[]);assert.deepEqual(r.data.completions,[]);assert.equal(r.review.unresolvedTickets.length,1);
  assert.equal(r.review.legacyQuotas.testers[0]!.all_time_count,50);assert.equal(r.review.previousTests[0]!.legacyUnixSeconds,1700000000);
});
test('legacy conversion retains missing links/regions and flags every conflicting UUID without choosing an owner',()=>{
  const source=fixture();source.players.push({...source.players[0]!,discord_id:'100000000000000003',region:'NA'});
  const r=convertLegacySupabase(source,guild);assert.equal(r.review.duplicateLinks[0]!.members.length,2);assert.equal(r.data.players.length,2);
  const missing=fixture() as any;missing.players[0].uuid=null;missing.players[0].region=null;
  const m=convertLegacySupabase(missing,guild);assert.equal(m.data.players[0]!.tier,'HT3');assert.equal(m.review.missingUuid.length,1);assert.equal(m.review.missingRegion.length,1);
});
test('legacy conversion rejects ambiguous raw copies, foreign guilds, unknown ranks and orphan cooldowns',()=>{
  const source=fixture();assert.throws(()=>convertLegacySupabase({...source,ticketdata:[{id:'global',data:{a:1}},{id:`guild_${guild}`,data:{a:2}}]},guild),/disagree/);
  assert.throws(()=>convertLegacySupabase({...source,ticketdata:[{id:'guild_100000000000000004',data:{}}]},guild),/another server/);
  source.players[0]!.rank='Unknown';assert.throws(()=>convertLegacySupabase(source,guild),/Unknown legacy rank/);
  source.players[0]!.rank='HT3';source.cooldown_entries[0]!.user_id='100000000000000005';assert.throws(()=>convertLegacySupabase(source,guild),/Cooldown without player/);
});
