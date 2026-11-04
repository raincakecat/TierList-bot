import {randomUUID} from 'node:crypto';
import {SharedDeployment} from './storage/deployment.js';
import {Community} from './discord/community.js';
import {modeKeys,modeConfig} from './modes.js';
import { Client, GatewayIntentBits } from 'discord.js';
import { ConfigFile, readiness } from './config.js';
import { openStore } from './storage/store.js';
import { Runtime } from './discord/runtime.js';
import { readFile } from 'node:fs/promises';
import { loadLocalPolicy } from './domain/permissions.js';

async function main(){
  const paths=process.env.BOT_CONFIGS?JSON.parse(process.env.BOT_CONFIGS) as string[]:[process.env.BOT_CONFIG??'config.json'];
  if(!Array.isArray(paths)||!paths.length||paths.some(p=>typeof p!=='string'))throw Error('BOT_CONFIGS must be a JSON array of configuration filenames.');
  const files:ConfigFile[]=[];for(const path of paths)files.push(await ConfigFile.load(path));
  if(new Set(files.map(f=>f.value.community.guildId)).size!==files.length)throw Error('Configure each Discord server once.');
  if(files.some(f=>JSON.stringify(f.value.database)!==JSON.stringify(files[0]!.value.database)))throw Error('All servers must use the same database settings.');
  if(process.argv[2]==='validate'){const errors=files.flatMap(file=>(file.value.gameModes.length?file.value.gameModes.map(m=>modeConfig(file.value,m.key)):[file.value]).flatMap(c=>readiness(c).map(e=>`${c.community.name}${c.activeMode?' / '+c.activeMode.name:''}: ${e}`)));console.log(errors.length?errors.join('\n'):'Configuration structure and required settings are valid. Discord resource checks run through /config validate.');process.exitCode=errors.length?1:0;return;}
  const policy=await readFile('local-policy.json','utf8').catch(()=>null);if(policy){const parsed=JSON.parse(policy.replace(/^\uFEFF/,'')) as {actors?:string[]};if(Array.isArray(parsed.actors))loadLocalPolicy(parsed.actors);}
  if(!process.env.DISCORD_TOKEN)throw new Error('Set DISCORD_TOKEN in the local environment before starting.');
  const store=await openStore(files[0]!.value),client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildPresences],allowedMentions:{parse:[]}});
  const runtimes:Runtime[]=[];
  if(files.length>1||files[0]!.value.gameModes.length){const guard=randomUUID();await store.acquireLease(guard,Date.now()+60_000);try{const deployment=new SharedDeployment(store);for(const file of files){await deployment.attach(file.value.community.guildId!,modeKeys(file.value)[0]!);const community=new Community(file,deployment);runtimes.push(new Runtime(client,community.file,community.store,code=>process.exit(code),community));}}finally{await store.releaseLease(guard);}}
  else runtimes.push(new Runtime(client,files[0]!,store));
  client.once('clientReady',()=>void(async()=>{let started=0;for(const runtime of runtimes)try{await runtime.ready();started++;}catch{console.error('A configured server could not start; its saved state is retained.');await runtime.stop().catch(()=>{});}if(!started){client.destroy();await store.close().catch(()=>{});process.exit(1);} })());
  client.on('error',()=>console.error('Discord connection error.'));
  let stopping=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(stopping)return;stopping=true;void Promise.all(runtimes.map(r=>r.stop())).then(async()=>{client.destroy();await store.close().catch(()=>{});process.exit(0);},()=>process.exit(1));});
  try{await client.login(process.env.DISCORD_TOKEN);}catch{await store.close();client.destroy();throw new Error('Discord login failed. Verify token and required gateway intents.');}
}
main().catch((e:Error)=>{console.error(e.message);process.exitCode=1;});
