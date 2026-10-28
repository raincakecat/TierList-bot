import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { convertLegacySupabase } from '../dist/src/storage/legacy-supabase.js';

const [input,guildId,output='data/imports/final-refresh']=process.argv.slice(2);
if(!input||!guildId)throw new Error('Usage: node scripts/convert-legacy-supabase.mjs SOURCE.json GUILD_ID [OUTPUT_DIRECTORY]');
const result=convertLegacySupabase(JSON.parse(await readFile(input,'utf8')),guildId);
const directory=resolve(output);
// Refuse to overwrite an earlier conversion or its review decisions.
await mkdir(directory,{recursive:false,mode:0o700});
await writeFile(resolve(directory,'players-import.json'),JSON.stringify(result.data,null,2),{flag:'wx',mode:0o600});
await writeFile(resolve(directory,'migration-review.json'),JSON.stringify(result.review,null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({players:result.review.playerCount,cooldowns:result.review.cooldownCount,
  mappedAU:result.review.mappedAU,duplicateUuidGroups:result.review.duplicateLinks.length,
  missingUuid:result.review.missingUuid.length,missingRegion:result.review.missingRegion.length,
  unresolvedTickets:result.review.unresolvedTickets.length}));
