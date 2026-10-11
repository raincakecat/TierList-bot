import { UserError } from './domain/types.js';
export async function lookupMinecraft(ign:string):Promise<{uuid:string;ign:string}>{
  if(!/^[A-Za-z0-9_]{1,16}$/.test(ign))throw new UserError('Enter a valid Minecraft username.');
  const response=await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(ign)}`,{signal:AbortSignal.timeout(10_000)});
  if(response.status===204||response.status===404)throw new UserError('No Minecraft account was found for that username.');
  if(!response.ok)throw new UserError('Minecraft lookup is unavailable. Try again shortly.');
  const account=await response.json() as {id?:string;name?:string};
  if(!account.id||!/^[a-f0-9]{32}$/i.test(account.id)||!account.name)throw new UserError('Minecraft returned an invalid account.');
  return {uuid:account.id.toLowerCase(),ign:account.name};
}
