import { Client, GatewayIntentBits } from 'discord.js';
import { ConfigFile, readiness } from './config.js';
import { openStore } from './storage/store.js';
import { Runtime } from './discord/runtime.js';
import { readFile } from 'node:fs/promises';
import { loadLocalPolicy } from './domain/permissions.js';

async function main(){
  const path=process.env.BOT_CONFIG??'config.json';let file:ConfigFile;
  try{file=await ConfigFile.load(path);}catch{throw new Error('Create config.json from config.example.json and check its JSON format and settings.');}
  if(process.argv[2]==='validate'){const errors=readiness(file.value);console.log(errors.length?errors.join('\n'):'Configuration structure and required settings are valid. Discord resource checks run through /config validate.');process.exitCode=errors.length?1:0;return;}
  const policy=await readFile('local-policy.json','utf8').catch(()=>null);if(policy){const parsed=JSON.parse(policy.replace(/^\uFEFF/,'')) as {actors?:string[]};if(Array.isArray(parsed.actors))loadLocalPolicy(parsed.actors);}
  if(!process.env.DISCORD_TOKEN)throw new Error('Set DISCORD_TOKEN in the local environment before starting.');
  const store=await openStore(file.value),client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildPresences],allowedMentions:{parse:[]}}),runtime=new Runtime(client,file,store);
  client.once('clientReady',()=>void runtime.ready().catch(async(e:Error)=>{console.error(e.message);client.destroy();await store.close();process.exitCode=1;}));
  client.on('error',()=>console.error('Discord connection error.'));
  let stopping=false;for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{if(stopping)return;stopping=true;void runtime.stop().then(()=>process.exit(0),()=>process.exit(1));});
  try{await client.login(process.env.DISCORD_TOKEN);}catch{await store.close();client.destroy();throw new Error('Discord login failed. Verify token and required gateway intents.');}
}
main().catch((e:Error)=>{console.error(e.message);process.exitCode=1;});
