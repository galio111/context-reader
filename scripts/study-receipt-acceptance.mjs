// Run inside the application container. Creates and removes only its own QA user.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base='https://context-reader.com',internal=process.env.SUPABASE_URL;
assert.equal(internal,'http://supabase-api:8000');
const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
async function db(path,method='GET',body){const r=await fetch(internal+path,{method,headers,body:body?JSON.stringify(body):undefined});assert.ok(r.ok,path.split('?')[0]+' '+r.status);const text=await r.text();return text?JSON.parse(text):null;}
const identity=await(await fetch(base+'/api/connectivity')).json();
assert.equal(identity.releaseId,process.env.EXPECT_RELEASE);
const email='study-receipt-qa-'+randomUUID()+'@phone.context-reader.invalid',password='QA-'+randomUUID()+'-a1';
let user;
const evidence={release:identity,receipts:[],checks:[]};
try{
 user=await db('/auth/v1/admin/users','POST',{email,password,email_confirm:true,user_metadata:{nickname:'作答回执专项验收'}});
 const token=await db('/auth/v1/token?grant_type=password','POST',{email,password});
 const cookie='context_reader_access='+token.access_token+'; context_reader_refresh='+token.refresh_token;
 async function api(path,body){const at=performance.now();const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-Context-Account':user.id},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});const text=await r.text();assert.equal(r.status,200,path+' '+text.slice(0,150));return {data:JSON.parse(text),ms:Math.round(performance.now()-at),bytes:Buffer.byteLength(text)};}
 const session=await api('/api/auth/session');assert.equal(session.data.account.profile.userId,user.id);
 const at=new Date().toISOString();
 const entries=['alpha','beta','gamma'].map((word,i)=>({id:'receipt-qa-'+i,word,lemma:word,phonetic:'',partOfSpeech:'noun',basicMeaning:'测试词',contextMeaning:'测试词',sourceSentence:'',sentenceTranslation:'',usageNote:'',collocation:'',exampleEnglish:'',exampleChinese:'',previousSentence:'',nextSentence:'',difficulty:'medium',shouldAddToVocabulary:true,createdAt:at,updatedAt:at,anki:{cardMode:'basic_en_to_cn',basicCue:'测试词',canMakeCloze:false}}));
 const synced=await api('/api/account/sync',{objects:entries.map(e=>({kind:'vocabulary',objectKey:e.id,payload:e,serverVersion:0,clientUpdatedAt:at,deletedAt:null}))});assert.equal(synced.data.objects.length,3);assert.ok(synced.data.objects.every(o=>o.accepted));evidence.checks.push('authenticated account and vocabulary sync');
 const prepared=(await api('/api/study',{op:'prepare'})).data;assert.equal(prepared.cards.length,3);
 for(const c of prepared.cards){const i=Number(c.entry_id.slice(-1)),state=[1,2,0][i];await db('/rest/v1/study_cards?user_id=eq.'+user.id+'&id=eq.'+c.id,'PATCH',{memory:{...c.memory,state,due:new Date(Date.now()-60000).toISOString(),...(state?{last_review:new Date(Date.now()-86400000).toISOString(),reps:2,stability:1,difficulty:5}:{})}});}
 await api('/api/study',{op:'start'});
 for(let i=0;i<3;i++){
  const c=(await db('/rest/v1/study_cards?user_id=eq.'+user.id+'&entry_id=eq.receipt-qa-'+i))[0];
  const shown=(await api('/api/study',{op:'present',cardId:c.id,version:c.version})).data;
  await new Promise(resolve=>setTimeout(resolve,900));
  const body={op:'review',response:'receipt',id:randomUUID(),cardId:c.id,version:c.version,token:shown.token,answer:i===1?'forgot':'remembered',activeMs:1000};
  const response=await api('/api/study',body),d=response.data;
  assert.equal(d.saved,true);assert.equal(d.id,body.id);assert.equal(d.snapshot,undefined);assert.equal(d.receipt.card.version,c.version+1);assert.equal(d.receipt.todayStats.new_cards,i===2?1:0);assert.ok(response.bytes<10000);assert.ok(response.ms<10000);
  const duplicate=await api('/api/study',body);assert.equal(duplicate.data.receipt.card.version,c.version+1);
  const ledger=await db('/rest/v1/study_reviews?user_id=eq.'+user.id+'&id=eq.'+body.id);assert.equal(ledger.length,1);
  evidence.receipts.push({category:['learning','review','new'][i],ms:response.ms,bytes:response.bytes,duplicateMs:duplicate.ms,newWords:d.receipt.todayStats.new_cards,savedOnce:true});
 }
 const refreshed=(await api('/api/study')).data;assert.equal(refreshed.daily.at(-1).new_cards,1);assert.equal(refreshed.reviews.length,3);evidence.checks.push('refresh preserves all three reviews and exact new-word count');
 const ordinary=await fetch(base+'/api/admin/accounts',{headers:{Cookie:cookie}});assert.ok([401,403].includes(ordinary.status));evidence.checks.push('ordinary account cannot access Admin');
 const anonymous=await fetch(base+'/api/study');assert.equal(anonymous.status,401);evidence.checks.push('anonymous study rejected');
}finally{
 if(user){const own=await db('/auth/v1/admin/users/'+user.id);assert.equal(own.email,email);await db('/auth/v1/admin/users/'+user.id,'DELETE');const left=await db('/rest/v1/study_reviews?user_id=eq.'+user.id+'&select=id');assert.equal(left.length,0);evidence.qaRemoved=true;}
}
console.log(JSON.stringify(evidence,null,2));
