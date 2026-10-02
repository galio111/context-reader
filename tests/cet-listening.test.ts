import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createCetActivity,cetAnswer,cetFinalize,cetEligibility,cetPause,mergeCetActivity} from '../lib/cetActivity';
import {cetViewModel} from '../lib/cetViewModel';
import {normalizeCetActivity} from '../lib/cetActivityStorage';
import {listeningVisibleText,recordListeningPlayback,listeningDefaultMinutes,validListeningSnapshots} from '../lib/cetListening';
import type {CetPaper,CetSection} from '../types/cet';
import {auditListeningAnswers, explicitAnswerReferences} from '../scripts/audit-cet-listening-answers.mjs';
import {auditListeningContent, listeningContentFlags} from '../scripts/audit-cet-listening-content.mjs';
const original=JSON.parse(readFileSync(new URL('../data/cet/cet4-2025-06-1.json',import.meta.url),'utf8')) as CetPaper;
const listening=JSON.parse(readFileSync(new URL('../data/cet/listening/cet4-2025-06-1.json',import.meta.url),'utf8')) as CetSection;
const paper={...original,sections:[listening,...original.sections]};
const now='2026-10-02T00:00:00.000Z';
const supplement=JSON.parse(readFileSync(new URL('../docs/evidence/cet-listening-supplement/source-manifest.json',import.meta.url),'utf8'));
const cleanup=JSON.parse(readFileSync(new URL('../docs/evidence/cet-listening-watermark/cleanup-proof.json',import.meta.url),'utf8'));
const sha256=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');

test('all listening English surfaces are free of source marks and Chinese explanations remain valid',()=>{
 assert.deepEqual(auditListeningContent(new URL('../data/cet/listening',import.meta.url)),{papers:62,questions:1550,options:6200,groups:465,flags:[]});
 const fixture={questions:[{number:1,stem:'',options:[{key:'C',text:"Call the man's company. 公众号【语听颖想说】"}],explanation:'选项C正确。这是对话中的细节信息。'}],listeningGroups:[]};
 assert.equal(listeningContentFlags(fixture).length,1);
 fixture.questions[0].options[0].text='Call the man\'s company.';
 assert.deepEqual(listeningContentFlags(fixture),[]);
 fixture.questions[0].options[0].text='Cultivate better citizens. 第1页/共8页';
 assert.equal(listeningContentFlags(fixture).length,1);
 fixture.questions[0].options[0].text='Cultivate better citizens.';
 fixture.questions[0].explanation='选项C正确。公众亏【语听颖想说】';
 assert.equal(listeningContentFlags(fixture).length,1);
 for(const text of ['C)费用高昂。相说 B)其他选项。','C)超过智商。听领相说 B)其他选项。','C)被社会所采纳所颖想说 B)其他选项。']){
  fixture.questions[0].explanation=text;assert.equal(listeningContentFlags(fixture).length,1);
 }
 fixture.questions[0].explanation='讲话者想说的是新颖的方案，能够让人脱颖而出。';
 assert.deepEqual(listeningContentFlags(fixture),[]);
});

test('reviewed watermark cleanup changes only exact source-backed fields and preserves answer/audio/snapshots',()=>{
 assert.equal(cleanup.files.length,8);
 assert.equal(cleanup.files.reduce((n:number,f:{changes:unknown[]})=>n+f.changes.length,0),18);
 for(const entry of cleanup.files){
  const bytes=readFileSync(new URL(`../${entry.path}`,import.meta.url));
  assert.equal(sha256(bytes),entry.afterSha256);
  let reversed=bytes.toString('utf8');
  for(const edit of entry.changes){
   assert.equal(edit.source.visualVerification,true);assert.match(edit.source.sha256,/^[a-f0-9]{64}$/);
   assert.match(edit.source.url,/^https:\/\/github.com\/0609x\/CET46-Resources\/blob\/[a-f0-9]{40}\//);
   const token=JSON.stringify(edit.after);assert.equal(reversed.split(token).length,2);
   reversed=reversed.replace(token,JSON.stringify(edit.before));
  }
  assert.equal(sha256(reversed),entry.beforeSha256);
  const before=JSON.parse(reversed),after=JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(before.audio,after.audio);assert.deepEqual(before.listeningGroups,after.listeningGroups);
  assert.deepEqual(before.questions.map((q:{number:number;answer:string})=>[q.number,q.answer]),after.questions.map((q:{number:number;answer:string})=>[q.number,q.answer]));
  const oldPaper={...original,id:entry.paperId,sections:[before]};
  const submitted=cetFinalize(createCetActivity({paper:oldPaper,purpose:'practice',sectionId:before.id,owner:'guest',now}),oldPaper,'passage_submit',before.id,now,'before-cleanup');
  assert.deepEqual(submitted.finalizations['before-cleanup'].questions.map(q=>q.options),before.questions.map((q:{options:unknown[]})=>q.options));
 }
 const load=(id:string)=>JSON.parse(readFileSync(new URL(`../data/cet/listening/${id}.json`,import.meta.url),'utf8')) as CetSection;
 const q=load('cet6-2025-06-1').questions[0];assert.equal(q.options[2].text,"Call the man's company.");assert.equal(q.answer,'C');
 assert.equal(load('cet4-2021-12-1').questions[18].options[1].text,'Workers who can lose 30 pounds in a year.');
});

test('source attribution is immutable in submitted listening and unsafe snapshot links are rejected',()=>{
 const changed=structuredClone(paper);
 changed.sections[0].audio!.attribution=[{title:'Source',url:'https://github.com/example/source',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'}];
 const a=cetFinalize(createCetActivity({paper:changed,purpose:'practice',sectionId:listening.id,owner:'guest',now}),changed,'passage_submit',listening.id,now,'attributed');
 const snapshots=a.finalizations.attributed.listeningSections!;
 assert.equal(validListeningSnapshots(snapshots),true);
 changed.sections[0].audio!.attribution[0].title='Future edition';
 assert.equal(snapshots[listening.id].audio.attribution![0].title,'Source');
 const bad=structuredClone(snapshots);bad[listening.id].audio.attribution![0].url='javascript:alert(1)';
 assert.equal(validListeningSnapshots(bad),false);
});

test('source-positive answer evidence cannot select a previously excluded option',()=>{
 assert.deepEqual(explicitAnswerReferences('由此可排除选项A，选项C与文章内容一致，因此为正确答案。'),['C']);
 assert.deepEqual(explicitAnswerReferences('故选项C为正确答案。故选项D可排除。'),['C']);
 assert.deepEqual(explicitAnswerReferences('D)多读参考书。解析：所以答案为A项。'),['A']);
 assert.equal(listening.questions.find(q=>q.number===23)?.answer,'C');
 const audited=auditListeningAnswers(new URL('../data/cet/listening',import.meta.url));
 assert.equal(audited.questions,supplement.summary.questions);assert.equal(audited.explicitReferences,supplement.summary.questions);
 assert.deepEqual(audited.flags,[]);assert.deepEqual(audited.unresolved,[]);
});

test('all listening additions have 25 choices, exhaustive material groups and first-party immutable audio',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../data/cet/listening/catalog.json',import.meta.url),'utf8'));
 assert.equal(catalog.length,62);assert.equal(catalog.length,supplement.summary.total);const urls=new Set();
 for(const item of catalog){
  const s=JSON.parse(readFileSync(new URL(`../data/cet/listening/${item.paperId}.json`,import.meta.url),'utf8')) as CetSection;
  assert.deepEqual(s.questions.map(q=>q.number),Array.from({length:25},(_,i)=>i+1));
  assert.ok(s.questions.every(q=>q.options.map(o=>o.key).join('')==='ABCD'&&q.options.every(o=>o.text.trim())&&q.options.some(o=>o.key===q.answer)&&q.explanation));
  assert.deepEqual(s.listeningGroups!.flatMap(g=>g.questionNumbers),s.questions.map(q=>q.number));
 assert.ok(s.listeningGroups!.every(g=>g.transcript.join(' ').length>150));
  assert.match(s.audio!.url,/^\/cet-audio\/[a-f0-9]{64}\.(mp3|m4a)$/);
  assert.ok(s.audio!.durationSeconds>600&&s.audio!.bytes<105_000_000);urls.add(s.audio!.url);
  assert.ok(!JSON.stringify(item).includes('transcript'));
 }
 assert.equal(urls.size,61);assert.equal(urls.size,supplement.summary.uniqueAudio);
});
test('supplement preserves the original baseline except explicit reversible source corrections',()=>{
 assert.equal(Object.keys(supplement.preserved).length,19);
 for(const [id,hash] of Object.entries(supplement.preserved)){
  const entry=cleanup.files.find((f:{paperId:string})=>f.paperId===id);
  const bytes=readFileSync(new URL(`../data/cet/listening/${id}.json`,import.meta.url));
  if(entry){assert.equal(entry.beforeSha256,hash);assert.equal(sha256(bytes),entry.afterSha256);}
  else assert.equal(sha256(bytes),hash);
 }
 assert.equal(supplement.imported.length,43);
 for(const entry of supplement.imported){
  const s=JSON.parse(readFileSync(new URL(`../data/cet/listening/${entry.paperId}.json`,import.meta.url),'utf8')) as CetSection;
  assert.equal(entry.audio.sha256,s.audio!.sha256);assert.ok(entry.correspondence.mean>=92&&entry.correspondence.minimum>=80);
  assert.equal(entry.correspondence.groupMatches.length,s.listeningGroups!.length);
  for(const q of s.questions)assert.equal(q.answer,entry.answerEvidence[String(q.number)].answer);
  assert.ok(entry.sources.length&&s.audio!.attribution!.every(a=>a.url.startsWith('https://github.com/')));
  const submitted=cetFinalize(createCetActivity({paper:{...original,id:entry.paperId,sections:[s]},purpose:'practice',sectionId:s.id,owner:'guest',now}),{...original,id:entry.paperId,sections:[s]},'passage_submit',s.id,now,'source-check');
  assert.equal(validListeningSnapshots(submitted.finalizations['source-check'].listeningSections),true);
 }
 const dec=JSON.parse(readFileSync(new URL('../data/cet/listening/cet6-2023-12-1.json',import.meta.url),'utf8')) as CetSection;
 assert.ok(dec.questions.find(q=>q.number===24)!.options.find(o=>o.key==='C')!.text.includes('£25,000'));
 assert.equal(supplement.imported.filter((e:{audioSourceCorrection?:string})=>e.audioSourceCorrection).length,2);
});
test('adding audio cannot expand an existing reading-only answer sheet or alter its question snapshots',()=>{
 const old=createCetActivity({paper:original,purpose:'self_test',owner:'guest',now});
 assert.equal(cetViewModel(paper,old).total,30);assert.equal(cetViewModel(paper,old).mismatch,false);
 assert.equal(cetViewModel(paper,null).total,55);
 const submitted=cetFinalize(old,paper,'manual_submit',undefined,'2026-10-02T00:01:00.000Z','f');
 assert.equal(submitted.finalizations.f.questions.length,30);
 assert.equal(submitted.finalizations.f.listeningSections,undefined);
});
test('native-source corrections preserve original choices while fixing OCR and percentage notation',()=>{
 const load=(id:string)=>JSON.parse(readFileSync(new URL(`../data/cet/listening/${id}.json`,import.meta.url),'utf8')) as CetSection;
 const option=(s:CetSection,n:number,key:string)=>s.questions.find(q=>q.number===n)!.options.find(o=>o.key===key)!.text;
 const first=load('cet6-2025-12-1');
 assert.equal(option(first,1,'B'),"He is his country's ambassador to Winopia.");
 assert.equal(option(first,17,'A'),'Its tag may get torn off on the conveyor belt.');
 assert.equal(option(first,18,'C'),"Get the airline agent's phone number before boarding.");
 assert.ok(first.listeningGroups!.some(g=>g.transcript.some(t=>t.includes('15% of Americans'))));
 assert.ok(!JSON.stringify(first.listeningGroups).includes('\\%'));
 const second=load('cet6-2025-12-2');
 assert.equal(option(second,2,'C'),"They are within students' budgets.");
 // The original supplied question/key sheet has a different B/C order from
 // another printed edition. Formatting must not silently reorder choices.
 assert.equal(option(second,13,'B'),'They are constantly being perfected');
 assert.equal(option(second,13,'C'),'They are by-products of health research');
 for(const s of [first,second])for(const q of s.questions){
  const source=supplement.imported.find((e:{paperId:string})=>e.paperId+'-listening'===s.id)!;
  assert.equal(q.answer,source.answerEvidence[String(q.number)].answer);
 }
});
test('listening uses the original drafts and immutable submit package, including its transcript',()=>{
 let a=createCetActivity({paper,purpose:'practice',sectionId:listening.id,owner:'guest',now});
 a=cetAnswer(a,`${listening.id}:1`,'A','2026-10-02T00:00:02.000Z','a');
 assert.equal(cetViewModel(paper,a).state(listening.id,`${listening.id}:1`),'answered');
 assert.equal(listeningVisibleText(listening,()=>false).some(t=>t===listening.listeningGroups![0].transcript[0]),false);
 a=cetFinalize(a,paper,'passage_submit',listening.id,'2026-10-02T00:00:03.000Z','f');
 assert.equal(a.finalizations.f.questions.length,25);
 assert.equal(a.finalizations.f.listeningSections![listening.id].groups[0].transcript[0],listening.listeningGroups![0].transcript[0]);
 assert.equal(cetAnswer(a,`${listening.id}:1`,'B'),a);
 const copy=structuredClone(paper);copy.sections[0].listeningGroups![0].transcript[0]='future edition';
 assert.notEqual(a.finalizations.f.listeningSections![listening.id].groups[0].transcript[0],'future edition');
 assert.ok(listeningVisibleText(listening,()=>true).includes(listening.listeningGroups![0].transcript[0]));
 assert.deepEqual(JSON.parse(JSON.stringify(normalizeCetActivity(JSON.parse(JSON.stringify(a))))),JSON.parse(JSON.stringify(a)));
});
test('audio checkpoints survive independent device merges and interrupted tests remain honestly non-comparable',()=>{
 const a=createCetActivity({paper,purpose:'self_test',sectionId:listening.id,owner:'guest',now,timerMode:'countup'});
 const playing=recordListeningPlayback(a,listening.id,30,'playing',Date.parse(now)+1000);
 const left=cetPause(playing,'2026-10-02T00:00:02.000Z','leave');
 assert.equal(left.listeningPlayback![listening.id].position,30);
 assert.equal(left.listeningPlayback![listening.id].state,'interrupted');
 assert.ok(left.conditions.includes('listening_interrupted'));
 const paused=recordListeningPlayback(playing,listening.id,45,'interrupted',Date.parse(now)+2000);
 const merged=mergeCetActivity(paused,playing);
 assert.equal(merged.listeningPlayback![listening.id].position,45);
 assert.ok(merged.conditions.includes('listening_interrupted'));
 assert.deepEqual(normalizeCetActivity(JSON.parse(JSON.stringify(merged)))?.listeningPlayback,merged.listeningPlayback);
 const result=cetFinalize(merged,paper,'manual_submit',undefined,'2026-10-02T00:00:05.000Z','f');
 assert.ok(result.finalizations.f.conditions.includes('listening_not_completed'));
 assert.equal(cetEligibility(result),'conditions_incomplete');
 assert.equal(recordListeningPlayback(a,'unrelated',4,'playing'),a);
 assert.ok(listeningDefaultMinutes(paper,listening.id)>15);
});
test('verified reading-layout overlay changes only whitespace and five confirmed source footers',()=>{
 const layouts=JSON.parse(readFileSync(new URL('../data/cet/reading-layout.json',import.meta.url),'utf8')) as Record<string,Record<string,string[]>>;
 assert.equal(Object.keys(layouts).length,37);
 const normalize=(t:string)=>t.replace(/第[3-7]\s*页/g,'').replace(/\s/g,'');
 for(const [id,sections] of Object.entries(layouts)){
  const base=JSON.parse(readFileSync(new URL(`../data/cet/${id}.json`,import.meta.url),'utf8')) as CetPaper;
  for(const [sid,paras] of Object.entries(sections))assert.equal(normalize(paras.join('')),normalize(base.sections.find(s=>s.id===sid)!.paragraphs.join('')));
 }
});
