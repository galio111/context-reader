import assert from 'node:assert/strict';
import test from 'node:test';
import { adoptedJevChecks, evaluateJevSamples, jevDecision, JEV_CALIBRATION_VERSION, JEV_CHECKS, type JevSample } from '../lib/jevCalibration';
import { EDITORIAL_POLICY_VERSION, type EditorialCheck } from '../lib/editorialReviewPolicy';
import { editorialDailyReport } from '../lib/editorialReport';
import { reviewEditorialArticle } from '../lib/editorialReview';
import type { ImportedArticle } from '../types/article';

const checks = { incomplete: false, contamination: false, orphanCaption: false, mediaDependent: false, promotional: false };
function samples(): JevSample[] {
  return Array.from({ length: 35 }, (_, i) => ({ id: String(i), source: `source-${i % 3}`, certain: true,
    probabilities: Object.fromEntries(JEV_CHECKS.map(k => [k, i < 5 ? 0.99 : 0.01])),
    reference: Object.fromEntries(JEV_CHECKS.map(k => [k, i < 5])) as typeof checks }));
}
test('unanimous clean articles and repeated retries cannot prove defect detection', () => {
  const clean = samples().map(s => ({ ...s, probabilities: Object.fromEntries(JEV_CHECKS.map(k => [k, 0.01])), reference: checks }));
  assert.ok(evaluateJevSamples(clean).every(s => s.agreement === 1 && !s.approved));
  assert.ok(evaluateJevSamples(Array(100).fill(samples()[0])).every(s => s.paired === 1 && !s.approved));
});
test('a missed reference defect or insufficient source coverage blocks adoption', () => {
  const all = samples();
  assert.ok(evaluateJevSamples(all).every(s => s.approved));
  all[0].probabilities.contamination = 0.01;
  assert.equal(evaluateJevSamples(all).find(s => s.key === 'contamination')!.approved, false);
  assert.ok(evaluateJevSamples(all.map(s => ({ ...s, source: 'same' }))).every(s => !s.approved));
  assert.ok(evaluateJevSamples(all.map(s => ({ ...s, certain: false }))).every(s => s.paired === 0 && !s.approved));
});
test('adoption requires completed trial and activates strictly after the sample day', () => {
  const policy = { sampleDay: '2026-09-21', version: JEV_CALIBRATION_VERSION, policyVersion: EDITORIAL_POLICY_VERSION, completed: true, approvedChecks: ['contamination'] as EditorialCheck[] };
  assert.deepEqual(adoptedJevChecks(policy, '2026-09-21'), []);
  assert.deepEqual(adoptedJevChecks(policy, '2026-09-22'), ['contamination']);
  assert.deepEqual(adoptedJevChecks({ ...policy, completed: false }, '2026-09-22'), []);
  assert.deepEqual(adoptedJevChecks({ ...policy, policyVersion: -1 }, '2026-09-22'), []);
  for (const p of [NaN, Infinity, -1, 1.1, 0.5, undefined]) assert.equal(jevDecision(p), null);
});

const article = { title: 'A substantive article', url: 'https://example.com/article', text: 'word '.repeat(450), blocks: [{ id: 'p', type: 'paragraph', text: 'word '.repeat(450) }, { id: 'i', type: 'image', src: 'https://example.com/image.webp' }] } as ImportedArticle;
const config = { enabled: true, provider: 'jev-shadow' as const, dailyReviewLimit: 150, jevMonthlyBudgetUsd: 4 };
function jev(probability: number) { return (async () => ({ answers: Object.fromEntries(JEV_CHECKS.map(key => [key, { type: 'boolean', probability }])), usage: { inputTokens: 100, outputTokens: 0 }, providerMetadata: { gateway: { cost: '0' } } })) as never; }
test('approved confident Jev decisions skip duplicate text review while retaining actual image checks', async () => {
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = 'test';
  try {
    const calls: { images: number; stage?: string }[] = [];
    const complete = async (_p: string, _m: string, images: string[] = [], _tokens = 800, stage?: string) => {
      calls.push({ images: images.length, stage });
      return { parsed: { checks, uncertain: false, relevant: true }, usage: { prompt_tokens: 10, completion_tokens: 5 }, cost: 1 };
    };
    const approved = await reviewEditorialArticle(article, { ...config, approvedJevChecks: JEV_CHECKS }, { complete, reserve: async () => true, jev: jev(0.01) });
    assert.equal(approved.status, 'passed');
    assert.equal(approved.jevIndependentChecks?.length, 5);
    assert.deepEqual(calls.map(c => c.images), [1]);
    calls.length = 0;
    const uncertain = await reviewEditorialArticle(article, { ...config, approvedJevChecks: JEV_CHECKS }, { complete, reserve: async () => true, jev: jev(0.5) });
    assert.equal(uncertain.status, 'passed');
    assert.equal(uncertain.jevIndependentChecks?.length, 0);
    assert.deepEqual(calls.map(c => c.images), [0, 1]);
    assert.equal(calls[0].stage, '全文审核');
    calls.length = 0;
    await reviewEditorialArticle(article, config, { complete, reserve: async () => true, jev: jev(0.01) });
    assert.equal(calls[0].stage, 'DeepSeek 验证 Jev');
  } finally { if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous; }
});

test('mail exposes provider totals and subtraction without calling agreement ground truth accuracy', () => {
  const report = editorialDailyReport('2026-09-21', [], 35, false, { actualMicrocny: 500000, actualMicrousd: 70000, reservedMicrocny: 10000, calls: 80, inputTokens: 1000, outputTokens: 500, blocked: false, stages: { 'DeepSeek 验证 Jev': { calls: 35, microcny: 200000 } }, providers: { jev: { calls: 40, settledCalls: 39, microcny: 20000, microusd: 3000, reservedMicrocny: 10000, inputTokens: 100, outputTokens: 0 }, deepseek: { calls: 40, settledCalls: 40, microcny: 480000, microusd: 67000, reservedMicrocny: 0, inputTokens: 900, outputTokens: 500 } } }, evaluateJevSamples(samples()), Infinity);
  assert.match(report.text, /¥0.3000/);
  assert.match(report.text, /deepseek：请求 40/);
  assert.match(report.text, /不是人工真值准确率/);
  assert.doesNotMatch(report.text, /通过替代门槛，次日/);
});
