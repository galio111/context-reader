import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
const dir=process.argv[2]||'artifacts/capacity-20260922';
const rows=[];
for(const f of readdirSync(dir).filter(f=>/^(ai|article|cold|inventory)-.*\.json$/.test(f))){
 const d=JSON.parse(readFileSync(`${dir}/${f}`));
 const ai=d.results.filter(r=>r.response!==undefined).map(r=>{let events=[];try{events=r.response.trim().split('\n').map(s=>JSON.parse(s))}catch{};return{status:r.status,firstMs:r.firstMs,totalMs:r.totalMs,guestId:r.guestId,done:events.some(e=>e.type==='done'),error:events.some(e=>e.type==='error'),code:events[0]?.code}});
 rows.push({...d.summary,file:f,slow:d.results.filter(r=>d.summary.mode==='ai'?r.status===200&&r.firstMs>5000:r.totalMs>(d.summary.mode==='cold'?5000:3000)).length,ai,home:d.inventory?.home});
}
rows.sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
writeFileSync(`${dir}/summary.json`,JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows.map(r=>({mode:r.mode,n:r.n,transport:r.transport||'http1',p95Ms:r.p95Ms,maxMs:r.maxMs,failed:r.failed,slow:r.slow,ai:r.ai,home:r.home})),null,2));
