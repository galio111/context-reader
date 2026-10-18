// Run inside the application container. Creates and removes only its own QA user.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base='https://context-reader.com',internal=process.env.SUPABASE_URL;
assert.equal(internal,'http://supabase-api:8000');
const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'};
async function db(path,method='GET',body){const r=await fetch(internal+path,{method,headers,body:body?JSON.stringify(body):undefined});assert.ok(r.ok,path.split('?')[0]+' '+r.status);const text=await r.text();return text?JSON.parse(text):null;}
const identity=await(await fetch(base+'/api/connectivity')).json();
assert.equal(identity.releaseId,process.env.EXPECT_RELEASE);
const email='study-offline-qa-'+randomUUID()+'@phone.context-reader.invalid',password='QA-'+randomUUID()+'-a1';
let user;
const evidence={release:identity,receipts:[],checks:[]};
try{
 user=await db('/auth/v1/admin/users','POST',{email,password,email_confirm:true,user_metadata:{nickname:'离线学习专项验收'}});
 const token=await db('/auth/v1/token?grant_type=password','POST',{email,password});
 const cookie='context_reader_access='+token.access_token+'; context_reader_refresh='+token.refresh_token;
 async function api(path,body){const at=performance.now();const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json','X-Context-Account':user.id},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});const text=await r.text();assert.equal(r.status,200,path+' '+text.slice(0,150));return {data:JSON.parse(text),ms:Math.round(performance.now()-at),bytes:Buffer.byteLength(text)};}
 const session=await api('/api/auth/session');assert.equal(session.data.account.profile.userId,user.id);
 const at=new Date().toISOString();
 const entries=['alpha','beta','gamma'].map((word,i)=>({id:'receipt-qa-'+i,word,lemma:word,phonetic:'',partOfSpeech:'noun',basicMeaning:'测试词',contextMeaning:'测试词',sourceSentence:'',sentenceTranslation:'',usageNote:'',collocation:'',exampleEnglish:'',exampleChinese:'',previousSentence:'',nextSentence:'',difficulty:'medium',shouldAddToVocabulary:true,createdAt:at,updatedAt:at,anki:{cardMode:'basic_en_to_cn',basicCue:'测试词',canMakeCloze:false}}));
 const synced=await api('/api/account/sync',{objects:entries.map(e=>({kind:'vocabulary',objectKey:e.id,payload:e,serverVersion:0,clientUpdatedAt:at,deletedAt:null}))});assert.equal(synced.data.objects.length,3);assert.ok(synced.data.objects.every(o=>o.accepted));evidence.checks.push('authenticated account and vocabulary sync');
 const prepared=(await api('/api/study',{op:'start'})).data;
 const secondToken=await db('/auth/v1/token?grant_type=password','POST',{email,password});
 const secondCookie='context_reader_access='+secondToken.access_token+'; context_reader_refresh='+secondToken.refresh_token;
 async function desktop(op){const at=performance.now();const r=await fetch(base+'/api/study',{method:'POST',headers:{Cookie:secondCookie,Origin:base,'Content-Type':'application/json','X-Context-Account':user.id},body:JSON.stringify({op}),signal:AbortSignal.timeout(45000)});assert.equal(r.status,200);const text=await r.text();return {data:JSON.parse(text),ms:Math.round(performance.now()-at),bytes:Buffer.byteLength(text)};}
 const before=await desktop('local_revision');
 assert.equal((await desktop('local_revision')).data.revision,before.data.revision);
 assert.ok(before.bytes<100);

 assert.ok(prepared.offlinePermit);assert.equal(prepared.settings.learningOrder,'review_first');assert.equal(prepared.settings.reviewsPerNew,5);
 const permit=prepared.offlinePermit,c=prepared.cards[0],id=randomUUID();
 const event={kind:'review',id,cardId:c.id,answer:'forgot',activeMs:1500,at:new Date().toISOString(),permit};
 const first=await api('/api/study',{op:'local_event',event});assert.equal(first.data.ack.id,id);assert.equal(first.data.ack.card.version,c.version+1);assert.ok(first.bytes<15000);
 const changed=await desktop('local_revision');assert.notEqual(changed.data.revision,before.data.revision);
 const otherSnapshot=await desktop('local_refresh');assert.ok(otherSnapshot.data.reviews.some(r=>r.id===id));assert.equal(otherSnapshot.data.cards.find(row=>row.id===c.id).version,c.version+1);
 evidence.crossDevice={probeBytes:changed.bytes,probeMs:changed.ms,refreshMs:otherSnapshot.ms,uploadMs:first.ms};
 evidence.checks.push('separate authenticated session sees committed answer via small revision probe and refresh');
 const duplicate=await api('/api/study',{op:'local_event',event});assert.equal(duplicate.data.ack.outcome.duplicate,true);assert.equal(duplicate.data.ack.card.version,c.version+1);
 assert.equal((await db('/rest/v1/study_reviews?user_id=eq.'+user.id+'&id=eq.'+id)).length,1);
 evidence.checks.push('small offline acknowledgement and lost-response idempotence');
 const undo={kind:'undo',id:randomUUID(),reviewId:id,at:new Date().toISOString(),permit};
 const restored=(await api('/api/study',{op:'local_event',event:undo})).data.ack;assert.equal(restored.review.undone,true);assert.equal(restored.card.memory.state,0);
 const settingsEvent={kind:'settings',id:randomUUID(),at:new Date().toISOString(),permit,settings:{...prepared.settings,learningOrder:'mixed',reviewsPerNew:7}};
 await api('/api/study',{op:'local_event',event:settingsEvent});
 const refreshed=(await api('/api/study',{op:'local_refresh'})).data;assert.equal(refreshed.settings.learningOrder,'mixed');assert.equal(refreshed.settings.reviewsPerNew,7);
 const exported=(await api('/api/account/export')).data;assert.equal(exported.study.localEvents.length,3);assert.equal(exported.study.reviews.length,1);
 evidence.checks.push('offline undo, settings roundtrip, export includes original events');
 evidence.receipts.push({ms:first.ms,bytes:first.bytes,duplicateMs:duplicate.ms});
 const ordinary=await fetch(base+'/api/admin/accounts',{headers:{Cookie:cookie}});assert.ok([401,403].includes(ordinary.status));evidence.checks.push('ordinary account cannot access Admin');
 const anonymous=await fetch(base+'/api/study');assert.equal(anonymous.status,401);evidence.checks.push('anonymous study rejected');
}finally{
 if(user){const own=await db('/auth/v1/admin/users/'+user.id);assert.equal(own.email,email);assert.equal((await db('/rest/v1/billing_orders?user_id=eq.'+user.id)).length,0);for(const table of ['billing_grants','billing_memberships'])await db('/rest/v1/'+table+'?user_id=eq.'+user.id,'DELETE');await db('/auth/v1/admin/users/'+user.id,'DELETE');const left=await db('/rest/v1/study_reviews?user_id=eq.'+user.id+'&select=id');assert.equal(left.length,0);evidence.qaRemoved=true;}
}
console.log(JSON.stringify(evidence,null,2));
