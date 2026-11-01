import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configSchema} from '../src/config.js';
import {requestSetupErrors} from '../src/discord/request-readiness.js';
const ACTIVE='100000000000000001',DELETED='100000000000000002';
async function config(){const c=configSchema.parse(JSON.parse(await readFile('config.example.json','utf8')));c.permissionGroups.owner=[ACTIVE];c.permissionGroups.staff=[ACTIVE];c.permissionGroups.verifiedTester=[ACTIVE];c.permissionGroups.restrictionKey=[DELETED];c.permissionGroups.partnershipManager=[DELETED];return c;}
test('missing restriction and partnership permission roles do not disable testing or LOA',async()=>{const c=await config();const errors=[`Missing role ${DELETED}`];assert.deepEqual(requestSetupErrors(c,errors,'testing'),[]);assert.deepEqual(requestSetupErrors(c,errors,'loa'),[]);assert.deepEqual(errors,[`Missing role ${DELETED}`]);});
test('missing roles remain blocking for support types that use them, without affecting general support',async()=>{const c=await config(),partner=c.supportTicketTypes.find(t=>t.accessGroups.includes('partnershipManager'))!;assert(partner);partner.enabled=true;const errors=[`Missing role ${DELETED}`];assert.deepEqual(requestSetupErrors(c,errors,'support',partner.key),errors);assert.deepEqual(requestSetupErrors(c,errors,'support','general-support'),[]);});
test('shared testing roles and non-role validation failures still block requests',async()=>{const c=await config();c.permissionGroups.staff.push(DELETED);const errors=[`Missing role ${DELETED}`,'Bot needs Manage Channels and Manage Roles','Missing text channel 100000000000000099'];assert.deepEqual(requestSetupErrors(c,errors,'testing'),errors);});
