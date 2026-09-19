import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {summarizeZhipuUsage} from '../lib/zhipuUsage';
import {AdminZhipuUsage} from '../components/AdminZhipuUsage';
test('Zhipu statistics find old calls outside the latest 200 general executions',()=>{
 const primary=Array.from({length:220},()=>({provider:'deepseek',model:'deepseek-flash',status:'succeeded'}));
 const usage=summarizeZhipuUsage([...primary,{provider:'zhipu',model:'glm-4.5-air',status:'succeeded',prompt_tokens:1000,completion_tokens:200,created_at:'2026-09-19T01:00:00Z',route:'/api/dictionary-stream'},{provider:'deepseek',model:'glm-4.5-air',status:'failed',created_at:'2026-09-19T02:00:00Z',error_code:'timeout'}]);
 assert.equal(usage.calls,2);assert.equal(usage.succeeded,1);assert.equal(usage.failed,1);assert.equal(usage.estimatedCostCny,0.0012);assert.equal(usage.recent[0].status,'failed');
 const html=renderToStaticMarkup(React.createElement(AdminZhipuUsage,{usage}));
 for(const text of ['智谱备用调用','单独查词','glm-4.5-air','成功','失败','timeout']) assert.ok(html.includes(text));
});
test('Zhipu empty state and bounded recent list retain complete totals',()=>{
 const empty=renderToStaticMarkup(React.createElement(AdminZhipuUsage,{usage:summarizeZhipuUsage([])}));assert.ok(empty.includes('还没有已记录'));
 const usage=summarizeZhipuUsage(Array.from({length:120},()=>({provider:'zhipu',status:'succeeded'})));assert.equal(usage.calls,120);assert.equal(usage.recent.length,100);assert.equal(usage.hasMore,true);
 const html=renderToStaticMarkup(React.createElement(AdminZhipuUsage,{usage,truncated:true}));assert.ok(html.includes('统计可能不完整'));
});
