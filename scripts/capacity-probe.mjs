import https from 'node:https';
import {gunzipSync, brotliDecompressSync, inflateSync} from 'node:zlib';
import {writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import http2 from 'node:http2';
const base='https://context-reader.com';
const mode=process.argv[2]||'inventory';
const n=Number(process.argv[3]||1);
if(!Number.isInteger(n)||n<1||n>64) throw Error('Concurrency must be 1..64');
if(mode==='ai'&&n>12) throw Error('AI batch cap 12');
const out=process.env.CAPACITY_OUTPUT||'artifacts/capacity-20260922';
mkdirSync(out,{recursive:true});
const agent=new https.Agent({keepAlive:true,maxSockets:256});
const start=Date.now();
const h2=process.env.CAPACITY_HTTP2==='1';
const sessions=new Map();
async function request(path,body,user='control'){
 if(h2){
  const t=performance.now();
  let session=sessions.get(user);
  if(!session){session=http2.connect(base);session.on('error',()=>{});sessions.set(user,session)}
  return new Promise(resolve=>{
   let headers={},first=null,head=null,bytes=0;const chunks=[];
   const stream=session.request({':path':path,':method':body?'POST':'GET','accept-encoding':body?'identity':'gzip, br','user-agent':'ContextReader-AuthorizedCapacityProbe/20260922',...(body?{'content-type':'application/json','x-context-action-id':randomUUID()}:{} )});
   const timer=setTimeout(()=>stream.destroy(Error('45s deadline')),45000);
   stream.on('response',h=>{headers=h;head=performance.now()-t});
   stream.on('data',c=>{if(first===null)first=performance.now()-t;bytes+=c.length;chunks.push(c)});
   stream.on('end',()=>{clearTimeout(timer);let b=Buffer.concat(chunks);try{if(headers['content-encoding']==='gzip')b=gunzipSync(b);if(headers['content-encoding']==='br')b=brotliDecompressSync(b)}catch{};resolve({path,status:headers[':status'],headersMs:head,firstMs:first,totalMs:performance.now()-t,wireBytes:bytes,text:b.toString(),encoding:headers['content-encoding']||'identity'})});
   stream.on('error',e=>{clearTimeout(timer);resolve({path,status:0,error:e.message,totalMs:performance.now()-t,wireBytes:bytes})});
   stream.end(body?JSON.stringify(body):undefined);
  });
 }
 const t=performance.now();
 return new Promise(resolve=>{
  let first=null,head=null,bytes=0;const chunks=[];
  const req=https.request(new URL(path,base),{agent,method:body?'POST':'GET',headers:{'accept-encoding':body?'identity':'gzip, br','user-agent':'ContextReader-AuthorizedCapacityProbe/20260922',...(body?{'content-type':'application/json','x-context-action-id':randomUUID()}:{} )}},res=>{
   head=performance.now()-t;
   res.on('data',c=>{if(first===null)first=performance.now()-t;bytes+=c.length;chunks.push(c)});
   res.on('end',()=>{clearTimeout(timer);let b=Buffer.concat(chunks);try{const enc=res.headers['content-encoding'];if(enc==='gzip')b=gunzipSync(b);if(enc==='br')b=brotliDecompressSync(b);if(enc==='deflate')b=inflateSync(b)}catch{};
    resolve({path,status:res.statusCode,headersMs:head,firstMs:first,totalMs:performance.now()-t,wireBytes:bytes,text:b.toString(),encoding:res.headers['content-encoding']||'identity',guestId:(res.headers['set-cookie']||[]).join(';').match(/context_reader_guest=([a-f0-9-]+)/)?.[1]});
   });
   res.on('error',e=>{clearTimeout(timer);resolve({path,status:0,error:e.message,totalMs:performance.now()-t,wireBytes:bytes})});
  });
  const timer=setTimeout(()=>req.destroy(Error('45s deadline')),45000);
  req.on('error',e=>{clearTimeout(timer);resolve({path,status:0,error:e.message,totalMs:performance.now()-t,wireBytes:bytes})});
  if(body)req.write(JSON.stringify(body));req.end();
 });
}
function compact(r){const{text,...rest}=r;return rest}
function percentile(a,p){return [...a].sort((a,b)=>a-b)[Math.max(0,Math.ceil(a.length*p)-1)]}
const health=await request('/api/connectivity');
const release=JSON.parse(health.text||'{}');
if(release.backendMode!=='mainland_internal')throw Error('Wrong backend');
let results=[],inventory;
if(mode==='inventory'||mode==='cold'){
 const home=await request('/');
 const paths=[...new Set([...home.text.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).filter(p=>p.startsWith('/_next/static/')&&/\.(js|css)(\?|$)/.test(p)))];
 inventory={home:compact(home),assets:paths};
 if(mode==='inventory'){
  for(const p of paths)results.push(compact(await request(p)));
 }else{
  results=await Promise.all(Array.from({length:n},async(_,user)=>{const t=performance.now();const root=await request('/',undefined,user);const rs=[compact(root)];let i=0;await Promise.all(Array.from({length:h2?paths.length:6},async()=>{while(i<paths.length){const p=paths[i++];rs.push(compact(await request(p,undefined,user)))}}));return{user,totalMs:performance.now()-t,wireBytes:rs.reduce((s,r)=>s+r.wireBytes,0),errors:rs.filter(r=>r.status!==200),requests:rs}}));
 }
}else if(mode==='article'){
 const list=await request('/api/public-articles');
 const articles=JSON.parse(list.text||'{}').articles;
 if(!articles?.length)throw Error('No public article');
 results=await Promise.all(Array.from({length:n},async(_,i)=>{const r=await request('/api/public-articles/'+articles[i%articles.length].id,undefined,i);let valid=false;try{valid=!!JSON.parse(r.text).article}catch{};return{...compact(r),valid}}));
}else if(mode==='ai'){
 const words=['resilience','curiosity','reflect','patient','observe','deliberate','wonder','persist','adapt','explore','notice','balance'];
 results=await Promise.all(Array.from({length:n},async(_,i)=>{const r=await request('/api/dictionary-stream',{query:words[i]});return{...compact(r),response:r.text}}));
}else throw Error('Unknown mode');
const summary={mode,n,transport:h2?'h2':'http1',release,startedAt:new Date(start).toISOString(),elapsedMs:Date.now()-start,p50Ms:percentile(results.map(r=>r.totalMs),.5),p95Ms:percentile(results.map(r=>r.totalMs),.95),maxMs:Math.max(...results.map(r=>r.totalMs)),wireBytes:results.reduce((s,r)=>s+r.wireBytes,0),failed:results.filter(r=>r.errors?.length||r.status!==undefined&&r.status!==200||r.valid===false).length};
const path=`${out}/${mode}-${n}-${start}.json`;
writeFileSync(path,JSON.stringify({summary,inventory,results},null,2));
console.log(JSON.stringify({...summary,file:path,detail:results.map(r=>({status:r.status,firstMs:r.firstMs,totalMs:r.totalMs,wireBytes:r.wireBytes,valid:r.valid,error:r.error,response:r.response?.slice(-350)}))},null,2));
agent.destroy();
for(const s of sessions.values())s.destroy();
