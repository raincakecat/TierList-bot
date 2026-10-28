import { SlashCommandBuilder, type SlashCommandStringOption } from 'discord.js';
import { REGIONS, TIERS } from '../domain/types.js';
const regions=(o:SlashCommandStringOption)=>o.setName('region').setDescription('Region').setRequired(true).addChoices(...REGIONS.map(value=>({name:value,value})));
const rank=(o:SlashCommandStringOption)=>o.setName('tier').setDescription('Tier').setRequired(true).addChoices(...TIERS.filter(t=>t!=='Unranked').map(value=>({name:value,value})));
const cmd=(name:string,description:string)=>new SlashCommandBuilder().setName(name).setDescription(description).setContexts(0);
export function commandDefinitions(){
  const commands=[
    cmd('loa','Leave of absence status and administration').addSubcommand(s=>s.setName('status').setDescription('View a saved LOA').addUserOption(o=>o.setName('member').setDescription('Staff member'))).addSubcommand(s=>s.setName('end').setDescription('End an active LOA as an LOA Admin').addUserOption(o=>o.setName('member').setDescription('Staff member').setRequired(true)).addStringOption(o=>o.setName('reason').setDescription('Required reason').setRequired(true).setMaxLength(1000))),
    cmd('health','View private database, job and backup health'),
    cmd('profile','View a player profile').addUserOption(o=>o.setName('member').setDescription('Player')),
    cmd('leave','Leave your active queue'),
    cmd('start','Start a testing session').addStringOption(regions),cmd('stop','End your testing session'),cmd('next','Open the next queued test'),
    cmd('passeval','Pass this ticket’s evaluation'),cmd('skip','Skip this test before evaluation'),
    cmd('close','Complete this testing ticket').addStringOption(o=>rank(o).addChoices({name:'Test Discontinued',value:'discontinued'})),
    cmd('forceclose','Close this support ticket without opener approval').addStringOption(o=>o.setName('reason').setDescription('Reason for closing').setRequired(true).setMaxLength(1000)),
    cmd('requestclose','Ask the ticket opener to approve closure').addStringOption(o=>o.setName('reason').setDescription('Reason for closing').setRequired(true).setMaxLength(1000)).addStringOption(o=>o.setName('timeout').setDescription('1h to 7d, for example 3h or 2d').setRequired(true)),
    cmd('format','Post a fight result template').addStringOption(rank),
    cmd('add','Add a member to this ticket').addUserOption(o=>o.setName('member').setDescription('Member').setRequired(true)),
    cmd('remove','Remove an added participant').addUserOption(o=>o.setName('member').setDescription('Member').setRequired(true)),
    cmd('rename','Rename this ticket').addStringOption(o=>o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(90)),
    cmd('addht3','Add an eligible regional HT3 opponent'),cmd('addlt2','Add an eligible regional LT2 opponent'),
    cmd('unverify','Unlink an account without removing rank').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)),
    cmd('uuid','Look up a Minecraft UUID').addStringOption(o=>o.setName('ign').setDescription('Minecraft username').setRequired(true).setMaxLength(16)),
    cmd('restrict','Restrict a Discord and Minecraft account pair').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)).addStringOption(o=>o.setName('ign').setDescription('Minecraft username').setRequired(true).setMaxLength(16)).addStringOption(o=>o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)).addStringOption(o=>o.setName('duration').setDescription('Optional duration, for example 7d')),
    cmd('unrestrict','Remove an account pair restriction').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)),
    cmd('forcestopqueue','Stop testers and clear a regional queue').addStringOption(regions),
    cmd('forcetest','Open a test bypassing queue and cooldown').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)).addStringOption(regions),
    cmd('deadline','Set or clear a ticket deadline').addSubcommand(s=>s.setName('set').setDescription('Set or replace the deadline').addStringOption(o=>o.setName('duration').setDescription('1m to 14d, for example 3h').setRequired(true))).addSubcommand(s=>s.setName('clear').setDescription('Clear the deadline')),
    cmd('resetcooldown','Clear one player cooldown').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)),
    cmd('setcooldown','Set a cooldown in days').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)).addNumberOption(o=>o.setName('days').setDescription('Days').setRequired(true).setMinValue(0).setMaxValue(3650)),
    cmd('reset','Reset one player, preserving restrictions and archives').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)),
    cmd('forceresetcooldowns','Clear every player cooldown'),cmd('forceclosetickets','Discontinue and archive all active tickets'),
    cmd('maintenance','Enable or disable maintenance').addBooleanOption(o=>o.setName('enabled').setDescription('Enable maintenance').setRequired(true)),
    cmd('addtester','Assign tester and staff roles').addUserOption(o=>o.setName('member').setDescription('Member').setRequired(true)),
    cmd('stoptester','Remove tester role and active session').addUserOption(o=>o.setName('member').setDescription('Member').setRequired(true)),
    cmd('configquota','Set monthly tester quota or disable it').addIntegerOption(o=>o.setName('count').setDescription('0 disables quotas').setRequired(true).setMinValue(0)),
    cmd('configcooldown','Set cooldowns for future completed tests').addStringOption(o=>o.setName('kind').setDescription('Test class').setRequired(true).addChoices({name:'Normal',value:'normal'},{name:'High',value:'high'})).addStringOption(o=>o.setName('duration').setDescription('0 for none, or a duration such as 7d').setRequired(true)),
    cmd('stats','View completed tests for a tester').addUserOption(o=>o.setName('member').setDescription('Tester')),
    cmd('testerstats','View tester quota statistics'),cmd('testerlb','View the testing leaderboard').addStringOption(o=>o.setName('period').setDescription('Period').addChoices({name:'Monthly',value:'monthly'},{name:'Weekly',value:'weekly'},{name:'All time',value:'all'})),
    cmd('setup','Preview or apply initial resource setup').addSubcommand(s=>s.setName('wizard').setDescription('Open the private guided setup wizard')).addSubcommand(s=>s.setName('preview').setDescription('Preview setup changes')).addSubcommand(s=>s.setName('apply').setDescription('Review and confirm setup')),
    cmd('config','Validate or reload configuration').addSubcommand(s=>s.setName('validate').setDescription('Validate configuration and Discord resources')).addSubcommand(s=>s.setName('reload').setDescription('Validate and reload the local file')),
    cmd('panels','Manage request panels').addSubcommand(s=>s.setName('refresh').setDescription('Publish or refresh configured panels')),
    cmd('backup','Export, restore, or transfer portable data').addSubcommand(s=>s.setName('export').setDescription('Create an export on the bot host')).addSubcommand(s=>s.setName('restore').setDescription('Preview a local backup restore').addStringOption(o=>o.setName('filename').setDescription('File in the backup directory').setRequired(true))).addSubcommand(s=>s.setName('transfer').setDescription('Transfer to an empty configured destination').addStringOption(o=>o.setName('config').setDescription('Destination config filename on the host').setRequired(true))),
    cmd('migration','Preview, apply, or retry a legacy import').addSubcommand(s=>s.setName('preview').setDescription('Preview a local import').addStringOption(o=>o.setName('filename').setDescription('File in the imports directory').setRequired(true))).addSubcommand(s=>s.setName('apply').setDescription('Review and confirm an import').addStringOption(o=>o.setName('filename').setDescription('File in the imports directory').setRequired(true))).addSubcommand(s=>s.setName('retry').setDescription('Retry failed saved import operations')),
    cmd('set-ticket','Register this existing channel as a ticket').addStringOption(o=>o.setName('type').setDescription('test or a configured support type key').setRequired(true)).addUserOption(o=>o.setName('member').setDescription('Opener').setRequired(true)).addUserOption(o=>o.setName('tester').setDescription('Original tester for a testing ticket')),
    cmd('maketestticket','Register this channel as a testing ticket').addUserOption(o=>o.setName('member').setDescription('Player being tested').setRequired(true)).addUserOption(o=>o.setName('tester').setDescription('Verified Tester assigned to the test').setRequired(true)),
    cmd('changeticket','Change this ticket’s support type or testing route').addStringOption(o=>o.setName('type').setDescription('Support type key, test, or high').setRequired(true)).addUserOption(o=>o.setName('tester').setDescription('Original tester when converting to testing'))
  ];
  for(const name of ['forceresult','migrate']){const c=cmd(name,name==='migrate'?'Assign a migrated rank':'Force a rank assignment').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)).addStringOption(rank).addStringOption(regions);if(name==='migrate')c.addStringOption(o=>o.setName('source').setDescription('Source community').setRequired(true));c.addStringOption(o=>o.setName('ign').setDescription('Required for an unverified player').setMaxLength(16));commands.push(c);}
  for(const tier of ['ht3','lt2','ht2','lt1'])commands.push(cmd(`${tier}list`,`${tier.toUpperCase()} list management`).addSubcommand(s=>s.setName('list').setDescription('View current members')).addSubcommand(s=>s.setName('add').setDescription('Add a member').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)).addStringOption(regions)).addSubcommand(s=>s.setName('remove').setDescription('Remove a member').addUserOption(o=>o.setName('member').setDescription('Player').setRequired(true)).addStringOption(regions)));
  return commands.map(c=>c.toJSON());
}
