import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configSchema} from '../src/config.js';
import {supportGuideEmbed,supportPanelEmbed} from '../src/discord/support-surfaces.js';

test('support cards keep five routes readable with the Lunar logo',async()=>{
  const config=configSchema.parse(JSON.parse(await readFile('config.support.example.json','utf8')));
  const logo='https://cdn.discordapp.com/attachments/123/456/logo.webp';
  const panel=supportPanelEmbed(config,logo).toJSON();
  const guide=supportGuideEmbed(config,'123456789012345678',logo).toJSON();
  assert.equal(panel.thumbnail?.url,logo);
  assert.equal(guide.thumbnail?.url,logo);
  assert.equal(panel.fields?.length,3);
  assert.equal(guide.fields?.length,5);
  assert.match(guide.description??'',/<#123456789012345678>/);
  for(const label of ['General Support','Player Report','Staff Report','Restriction Appeal','Partnership Request']){
    assert(JSON.stringify(panel).includes(label));
    assert(JSON.stringify(guide).includes(label));
  }
  assert(JSON.stringify(guide).length<6000);
});
