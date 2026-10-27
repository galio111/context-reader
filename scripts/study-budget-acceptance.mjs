// Run in the application container. Real gggg reads; all answers belong to a disposable QA account.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const base=process.env.TEST_BASE||'https://context-reader.com';
const internal=process.env.SUPABASE_URL;
const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
async function db(path,method='GET',body){const r=await fetch(internal+path,{method,headers,body:body?JSON.stringify(body):undefined});assert.ok(r.ok,path.split('?')[0]+' '+r.status);const text=await r.text();return text?JSON.parse(text):null;}
function apiFor(user,token){return async function(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:'context_reader_access='+token.access_token+'; context_reader_refresh='+token.refresh_token,Origin:base,'Content-Type':'application/json','X-Context-Account':user.id},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});const text=await r.text();assert.equal(r.status,200,path+' '+text.slice(0,180));return JSON.parse(text);};}
const evidence={identity:await(await fetch(base+'/api/connectivity')).json(),checks:[]};
if(process.env.EXPECT_RELEASE)assert.equal(evidence.identity.releaseId,process.env.EXPECT_RELEASE);
const email='budget-qa-'+randomUUID()+'@phone.context-reader.invalid',password='QA-'+randomUUID()+'-a1';let user;
try{
 user=await db('/auth/v1/admin/users','POST',{email,password,email_confirm:true,user_metadata:{nickname:'复习预算验收'}});
 const token=await db('/auth/v1/token?grant_type=password','POST',{email,password}),api=apiFor(user,token);
 assert.equal((await api('/api/auth/session')).account.profile.userId,user.id);
 const at=new Date().toISOString();
 const entries=Array.from({length:47},(_,i)=>({id:'budget-qa-'+i,word:'budgetword'+i,lemma:'budgetword'+i,basicMeaning:'验收词',contextMeaning:'验收词',sourceSentence:'',createdAt:at,updatedAt:at,anki:{cardMode:'basic_en_to_cn',basicCue:'验收词',canMakeCloze:false}}));
 const sync=await api('/api/account/sync',{objects:entries.map(e=>({kind:'vocabulary',objectKey:e.id,payload:e,serverVersion:0,clientUpdatedAt:at,deletedAt:null}))});assert.equal(sync.objects.filter(x=>x.accepted).length,47);
 let seed=await api('/api/study',{op:'prepare'});
 for(const c of seed.cards){if(Number(c.entry_id.split('-').at(-1))<45)await db('/rest/v1/study_cards?user_id=eq.'+user.id+'&id=eq.'+c.id,'PATCH',{memory:{...c.memory,state:2,due:new Date(Date.now()-86400000).toISOString(),last_review:new Date(Date.now()-7*86400000).toISOString(),stability:5,difficulty:5,reps:3}});}
 seed=await api('/api/study',{op:'start'});
 const old=s=>s.today.card_ids.filter(id=>s.cards.find(c=>c.id===id)?.memory.state!==0);
 assert.equal(seed.settings.reviewsPerDay,40);assert.equal(old(seed).length,40);evidence.checks.push('45 due reviews select 40, two new words remain available');
 for(const id of old(seed)){
  const event={id:randomUUID(),at:new Date().toISOString(),permit:seed.offlinePermit,kind:'review',cardId:id,answer:'remembered',activeMs:1000};
  const saved=await api('/api/study',{op:'local_event',event});assert.ok(saved.ack.review);assert.equal(saved.ack.review.card_id,id);
  const duplicate=await api('/api/study',{op:'local_event',event});assert.ok(duplicate.ack.outcome.duplicate);
 }
 const reload=await api('/api/study',{op:'local_refresh'}),second=await api('/api/study',{op:'start'});
 assert.equal(old(reload).length,40);assert.deepEqual(second.today.card_ids,reload.today.card_ids);assert.equal(reload.reviews.filter(r=>!r.undone).length,40);
 evidence.checks.push('40 answers, duplicate receipts, reload and second-client start retain exactly 40 old words');
 const extra={...reload.settings,reviewExtraDay:reload.today.day,reviewExtraCount:10};
 const added=await api('/api/study',{op:'settings',settings:extra});assert.equal(old(added).length,45);
 const reset=await api('/api/study',{op:'settings',settings:{...extra,reviewExtraCount:0}});assert.equal(old(reset).length,40);
 evidence.checks.push('explicit extra admits remaining five; reducing budget preserves forty answers');
 const anon=await fetch(base+'/api/study');assert.equal(anon.status,401);
 const admin=await fetch(base+'/api/admin/accounts',{headers:{Cookie:'context_reader_access='+token.access_token}});assert.ok([401,403].includes(admin.status));
 evidence.checks.push('anonymous study and ordinary-account Admin access denied');
 const profiles=await db('/rest/v1/account_profiles?nickname=eq.gggg&select=user_id');assert.equal(profiles.length,1);
 const guser=await db('/auth/v1/admin/users/'+profiles[0].user_id);
 const link=await db('/auth/v1/admin/generate_link','POST',{type:'magiclink',email:guser.email});
 const gtoken=await db('/auth/v1/verify','POST',{type:'magiclink',token_hash:(link.properties?.hashed_token??link.hashed_token)});
 const gapi=apiFor(guser,gtoken);
 async function ledgerHash(){const results=[];for(const table of ['study_cards','study_reviews']){let all=[];for(let offset=0;;offset+=500){const rows=await db('/rest/v1/'+table+'?user_id=eq.'+guser.id+'&select=*&order=id.asc&limit=500&offset='+offset);all.push(...rows);if(rows.length<500)break;}results.push(createHash('sha256').update(JSON.stringify(all)).digest('hex'));}return results;}
 const before=await ledgerHash(),g=await gapi('/api/study',{op:'start'}),g2=await gapi('/api/study',{op:'local_refresh'});
 const after=await ledgerHash();assert.deepEqual(after,before);assert.equal(g.settings.reviewsPerDay,40);assert.deepEqual(g2.today.card_ids,g.today.card_ids);
 const oldIds=g.today.card_ids.filter(id=>g.cards.find(c=>c.id===id)?.memory.state!==0);
 assert.equal(oldIds.length,40);
 evidence.gggg={cards:g.cards.length,oldPlan:oldIds.length,untouchedNew:g.cards.filter(c=>c.memory.state===0).length,ledgerHashesUnchanged:true};
 if(process.env.KEEP_QA==='1'){writeFileSync('/tmp/study-budget-qa-session.json',JSON.stringify({id:user.id,email,cookie:'context_reader_access='+token.access_token+'; context_reader_refresh='+token.refresh_token}),{mode:0o600});evidence.qaRetainedForBrowser=true;}
}finally{
 if(user&&process.env.KEEP_QA!=='1'){assert.equal((await db('/auth/v1/admin/users/'+user.id)).email,email);await db('/auth/v1/admin/users/'+user.id,'DELETE');evidence.qaRemoved=true;}
}
console.log(JSON.stringify(evidence,null,2));
