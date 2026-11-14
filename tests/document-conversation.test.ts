import test from 'node:test';
import assert from 'node:assert/strict';
import {documentConversation} from '../lib/documentConversation';
import {sanitizeSentenceQuestionRequest} from '../lib/deepseek';
test('continuous document conversation retains older questions beyond four turns and keeps normal answers intact',()=>{
 const turns=Array.from({length:12},(_,i)=>({question:`Question ${i}`,answer:`Answer ${i}`}));
 assert.deepEqual(documentConversation(turns),turns);
 const safe=sanitizeSentenceQuestionRequest({word:'test',sentence:'A test.',previousSentence:'',nextSentence:'',question:'Why?',history:turns});
 assert.deepEqual(safe.history,turns);
});
test('long histories use labelled excerpts while preserving every question and the original durable data',()=>{
 const turns=Array.from({length:150},(_,i)=>({question:`Question ${i}`,answer:'Opening fact. '+ 'A long explanation. '.repeat(800)+' Final conclusion.'}));
 const result=documentConversation(turns);
 assert.equal(result.length,150);assert.equal(result[0].question,'Question 0');assert.match(result[0].answer,/Opening fact/);assert.match(result[0].answer,/Final conclusion/);
 assert.ok(result.reduce((n,t)=>n+t.question.length+t.answer.length,0)<=40000);
 assert.ok(!turns[0].answer.includes('节选'));
});
