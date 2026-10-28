import test from 'node:test';
import assert from 'node:assert/strict';
import {TicketLinks} from '../src/discord/ticket-links.js';

test('ticket links return an already-created channel',async()=>{const links=new TicketLinks();assert.equal(await links.wait('t',async()=>({channelId:'channel',status:'opening'}),100),'channel');});
test('ticket links resolve when the channel is committed after the initial read',async()=>{const links=new TicketLinks();const pending=links.wait('t',async()=>({channelId:null,status:'opening'}),100);links.ready('t','channel');assert.equal(await pending,'channel');});
test('ticket links cannot miss an event during the initial state read',async()=>{const links=new TicketLinks();const pending=links.wait('t',async()=>{links.ready('t','channel');return {channelId:null,status:'opening'};},100);assert.equal(await pending,'channel');});
test('uncreated ticket links time out without inventing a URL and tolerate later events',async()=>{const links=new TicketLinks();assert.equal(await links.wait('t',async()=>undefined,2),null);links.ready('t','late-channel');assert.equal(await links.wait('other',async()=>({channelId:'closed',status:'closed'}),2),null);});
