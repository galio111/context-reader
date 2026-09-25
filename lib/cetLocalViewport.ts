// Device-local reading positions must never move another device's cursor.
const KEY = "context-reader:cet-viewports:v1";
export function readCetViewport(key:string):number {
  try { const value=JSON.parse(sessionStorage.getItem(KEY)||"{}")[key];return Number.isFinite(value)&&value>=0?value:0; } catch {return 0;}
}
export function saveCetViewport(key:string,value:number):void {
  try {
    if(!Number.isFinite(value)||value<0)return;
    const entries=Object.entries(JSON.parse(sessionStorage.getItem(KEY)||"{}")).filter(([id])=>id!==key).slice(-199);
    sessionStorage.setItem(KEY,JSON.stringify(Object.fromEntries([...entries,[key,value]])));
  } catch { /* A viewport preference must not block saving the answer. */ }
}
