import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,escapeMarkdown} from 'discord.js';
import type {Config} from '../config.js';
import type {CloseRequest,Ticket} from '../domain/types.js';

export function closeRequestPanel(c:Config,t:Ticket,r:CloseRequest){
  const pending=r.status==='pending'&&t.status==='open';
  const status={pending:'Waiting for your decision',accepted:'Closure approved',denied:'Closure denied — ticket stays open',expired:'No response — closing ticket',cancelled:'Request cancelled'}[r.status];
  const embed=new EmbedBuilder().setTitle('Ticket Closure Request').setColor(c.branding.colors.panel as `#${string}`)
    .setDescription(`${escapeMarkdown(r.reason)}\n\n**${status}**`)
    .addFields({name:'Requested by',value:`<@${r.requestedBy}>`},{name:'Respond before',value:`<t:${Math.floor(r.expiresAt/1000)}:F> (<t:${Math.floor(r.expiresAt/1000)}:R>)`})
    .setFooter({text:'Only the ticket opener can respond. Unanswered requests close automatically.'});
  return {embeds:[embed],components:[new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`requestclose:${t.id}:${r.id}:accept`).setLabel('Approve Close').setStyle(ButtonStyle.Danger).setDisabled(!pending),
    new ButtonBuilder().setCustomId(`requestclose:${t.id}:${r.id}:deny`).setLabel('Deny Close').setStyle(ButtonStyle.Secondary).setDisabled(!pending))]};
}
