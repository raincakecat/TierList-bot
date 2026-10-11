export function dateKey(timestamp:number,timezone:string):string {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(timestamp);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function periodStart(timestamp:number,timezone:string,period:'monthly'|'weekly'):string {
  const day=dateKey(timestamp,timezone);if(period==='monthly')return day.slice(0,7)+'-01';
  const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-date.getUTCDay());return date.toISOString().slice(0,10);
}
export function previousMonth(timestamp:number,timezone:string):string {
  const day=dateKey(timestamp,timezone);const date=new Date(day.slice(0,7)+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7);
}
