export const REGIONS = ['NA', 'EU', 'AS'] as const;
export type Region = typeof REGIONS[number];
export const TIERS = ['Unranked','LT5','HT5','LT4','HT4','LT3','HT3','LT2','HT2','LT1','HT1'] as const;
export type Tier = typeof TIERS[number];
export const GROUPS = ['owner','botAdmin','staff','verifiedTester','regulator','listAdmin','restrictionKey','highStaff','trainee','partnershipManager','loaAdmin','cdResetter'] as const;
export type Group = typeof GROUPS[number];
export type Actor = { id: string; roles: string[]; administrator: boolean; channelAccess?: boolean };
export interface Player {
  id: string; tier: Tier; uuid: string | null; ign: string | null;
  region: Region | null; preferredServer: string | null; waitlist: boolean;
  cooldownUntil: number; testerSince?: number; previousTestAt?:number;
}
export interface CloseRequest {
  id:string; requestedBy:string; reason:string; requestedAt:number; expiresAt:number;
  status:'pending'|'accepted'|'denied'|'expired'|'cancelled'; resolvedAt?:number; messageId?:string;
}
export interface Ticket {
  id: string; channelId: string | null; type: string; opener: string;
  region: Region | null; openingTier: Tier; openingIgn: string | null;
  tester: string | null; target: Tier | null; passed: boolean;
  status: 'opening'|'open'|'closing'|'closed'; participants: string[];
  openedAt: number; closedAt?: number; outcome?: Tier|'discontinued'|'skipped';
  accessRoles: string[]; closingRoles: string[]; archiveChannelId: string;
  copyImages: boolean; imageRetentionDays: number; categoryId: string;
  name: string; creditApplied?: boolean; closeRequests?:CloseRequest[];
  openingNickname?:string;
  openingDiscordUsername?:string;
  openingUuid?: string|null; preferredServer?: string|null; previousTestAt?: number|null;
  archiveDirectory?: string; minimumDeletionDelaySeconds?: number;
  openingLists?: {tier:Tier;region:Region}[];
  deadline?: { at: number; setter: string; notified: boolean };
}
export interface Restriction { id: string; playerId: string; uuid: string; reason: string; until: number | null; actor: string; previousTier?:Tier }
export interface Job {
  id: string; kind: 'open'|'roles'|'archive'|'result'|'notice'|'lists'|'queues'|'deadline'|'loa';
  data: Record<string, unknown>; status: 'pending'|'working'|'done'; attempts: number;
  nextAt: number; createdAt?:number; leaseUntil?: number; checkpoints: Record<string, unknown>;
  lastFailureCode?:string; lastFailureAt?:number;
}
export interface Leave {
  id:string; memberId:string; username:string; days:number; reason:string;
  status:'pending'|'active'|'denied'|'withdrawn'|'ended'|'expired'; requestedAt:number;
  reviewedBy?:string; reviewedAt?:number; denialReason?:string;
  startsAt?:number; endsAt?:number; endedAt?:number; endedBy?:string; endReason?:string;
  roleId:string; reviewChannelId:string; acceptedChannelId:string; adminRoles:string[];
  reviewMessageId?:string; acceptedMessageId?:string;
  notifications?:Record<string,'sent'|'blocked'>;
}
export interface State {
  version: 1; guildId: string; initialized: boolean; maintenance: boolean;
  players: Record<string, Player>; queues: Record<Region,string[]>;
  testers: Record<string,Region>; tickets: Record<string,Ticket>;
  restrictions: Restriction[]; lists: Partial<Record<Tier,Partial<Record<Region,string[]>>>>;
  completions: {ticketId:string; tester:string; at:number}[];
  jobs: Record<string,Job>; panels: Record<string,string>;
  audit: {id:string; at:number; actor:string; action:string; target:string}[];
  lastTestingSession?:Partial<Record<Region,number>>;
  sessionResumeUntil?:number;
  migrationId?: string;
  runtimeLease?: {owner:string;until:number};
  departures?: string[];
  migrationSession?: {filename:string;id:string;done:string[];keys:string[]};
  reviews?: Record<string,{filename:string;key:string;field:string;message:string;resolved:boolean;messageId?:string}>;
  lastAutomaticBackupAt?: number;
  leaves?:Record<string,Leave>;
  legacyStatistics?:{sourceHash:string;appliedAt:number;testers:Record<string,{allTimeCount:number;undatedPeriodCount:number}>};
}
export function emptyState(guildId:string): State {
  return {version:1,guildId,initialized:false,maintenance:false,players:{},queues:{NA:[],EU:[],AS:[]},testers:{},tickets:{},restrictions:[],lists:{},completions:[],jobs:{},panels:{},audit:[]};
}
export class UserError extends Error {}
export class JobDeferred extends Error {
  constructor(public readonly retryAt:number,message:string){super(message);}
}
