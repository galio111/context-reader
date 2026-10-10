import { test } from "node:test";
import assert from "node:assert/strict";
import { LearningActivity } from "../lib/learningActivity";

test("an untouched page earns no reading time",()=>{
 const clock=new LearningActivity(45000);assert.equal(clock.take(),0);
 clock.touch(200000,true);assert.equal(clock.take(),0);
 clock.touch(210000,true);assert.equal(clock.take(),10000);
});
test("reading quietly between deliberate interactions counts; idle gaps do not",()=>{
 const clock=new LearningActivity(45000);clock.touch(0,true);clock.touch(40000,true);assert.equal(clock.take(),40000);
 clock.touch(200000,true);assert.equal(clock.take(),0);clock.touch(205000,true);assert.equal(clock.take(),5000);
});
test("background, tab switch, dialog and source detours break the interval",()=>{
 const clock=new LearningActivity(30000);clock.start(0);clock.touch(10000,true);clock.pause();clock.touch(20000,true);assert.equal(clock.take(),10000);
 clock.touch(30000,false);clock.touch(40000,true);assert.equal(clock.take(),0);clock.touch(43000,true);assert.equal(clock.take(),3000);
});
test("an explicit card presentation counts until an answer, but an abandoned card does not",()=>{
 const clock=new LearningActivity(30000);clock.start(0);clock.touch(12000,true);assert.equal(clock.take(),12000);assert.equal(clock.take(),0);
 clock.start(20000);clock.touch(100000,true);assert.equal(clock.take(),0);
});
