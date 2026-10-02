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
const original=JSON.parse(readFileSync(new URL('../data/cet/cet4-2025-06-1.json',import.meta.url),'utf8')) as CetPaper;
const listening=JSON.parse(readFileSync(new URL('../data/cet/listening/cet4-2025-06-1.json',import.meta.url),'utf8')) as CetSection;
const paper={...original,sections:[listening,...original.sections]};
const now='2026-10-02T00:00:00.000Z';
const supplement=JSON.parse(readFileSync(new URL('../docs/evidence/cet-listening-supplement/source-manifest.json',import.meta.url),'utf8'));

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
test('supplement preserves all original listening bytes and exposes only complete source-backed additions',()=>{
 assert.equal(Object.keys(supplement.preserved).length,19);
 for(const [id,hash] of Object.entries(supplement.preserved))assert.equal(createHash('sha256').update(readFileSync(new URL(`../data/cet/listening/${id}.json`,import.meta.url))).digest('hex'),hash);
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
