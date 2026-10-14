import { EmbedBuilder } from 'discord.js';
import type { Config } from '../config.js';
import type { Player } from '../domain/types.js';

export function alreadyVerified(c:Config,p:Player):EmbedBuilder|null{
  if(!p.uuid)return null;
  return new EmbedBuilder().setTitle('Already Verified').setDescription('Your Minecraft account is already linked. Ask staff to unlink it if you need to change the account. Your Discord rank and cooldown are preserved.').setColor(c.branding.colors.success as `#${string}`).addFields({name:'Linked Username',value:p.ign??'Unknown'},{name:'UUID',value:p.uuid}).setThumbnail(`https://visage.surgeplay.com/bust/128/${p.uuid}`);
}
