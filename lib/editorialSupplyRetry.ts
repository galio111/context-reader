export const EDITORIAL_PROCESSING_LIMIT_MS=120*60_000;
export interface SupplyRetryLedger {finished?:boolean;suspended?:boolean;nextSupplyRetryAt?:string;supplyRetryCount?:number;processingMs?:number;processingStartedAt?:string;startedAt?:string}
export function supplyRetryDue(ledger:SupplyRetryLedger,now=Date.now()):boolean {
  const at=Date.parse(ledger.nextSupplyRetryAt||'');
  return !!ledger.finished && !ledger.suspended && (ledger.supplyRetryCount||0)<1 && Number.isFinite(at) && now>=at;
}
export function supplyRetryTime(day:string,now:number,processingMs:number):string|undefined {
  if(processingMs>=EDITORIAL_PROCESSING_LIMIT_MS)return;
  const at=Math.max(now+60*60_000,Date.parse(`${day}T10:00:00+08:00`));
  return at<Date.parse(`${day}T18:00:00+08:00`)?new Date(at).toISOString():undefined;
}
