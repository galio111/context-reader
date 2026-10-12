import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/欧阳子浩/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
const base = process.env.AUDIT_BASE || 'http://127.0.0.1:3247';
const output = process.env.AUDIT_OUTPUT || 'artifacts/architecture-audit/reader-login-browser';
await mkdir(output, { recursive: true });
const guest = { configured: true, authenticated: false, profile: null, plan: null, usage: [] };
const member = owner => ({ configured: true, authenticated: true, profile: { userId: owner, nickname: '隔离验收', phone: '19900000001', email: '', status: 'active', readingInterests: [] }, plan: { id: 'free', active: true, limits: [] }, usage: [] });
let active = guest, label = 'A', sessionCalls = 0;
const calls = [], errors = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON();
  calls.push({ path, method: route.request().method() });
  const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  if (path === '/api/auth/session') { sessionCalls++; return json({ account: active }); }
  if (path === '/api/auth/phone-login') { active = member('11111111-1111-4111-8111-111111111111'); return json({ account: active }); }
  if (path === '/api/account/sync') return json({ objects: [], results: [], nextOffset: null, snapshotCursor: '', nextCursor: '', hasMore: false, protocol: 2 });
  if (path === '/api/account/activity') return json({ seconds: 0, todaySeconds: 0, readingDays: 0 });
  if (path === '/api/study') return json({ serverNow: '2026-10-12T12:00:00Z', settings: { reviewsPerDay: 100, retention: .9, forgotMinutes: 5, unsureMinutes: 10, pausedUntil: null, includeAnki: false, reminders: false }, cards: [], entries: [], reviews: [], daily: [], today: null, streak: { current: 0, best: 0, last_day: null }, claims: [], rewards: [], policy: { rewardsEnabled: true, pointsPerNew: 1, dailyRewardCap: 50, rewardDays: 90, streakMinNew: 5, milestones: [], profileEnabled: true, profileCost: 5, minimumReadingMinutes: 60, minimumLookups: 50 } });
  if (path === '/api/study/profile') return json({ activeSeconds: 0, uniqueLookups: 0, eligible: false });
  if (path === '/api/translate-article/start') return json({ actionId: body.actionId, source: 'generated' });
  if (path === '/api/translate-article') return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: body.blocks.map(block => JSON.stringify({ type: 'translation', translation: { id: block.id, type: block.type, translation: `账号${label}的独立验收译文。` } })).join('\n') + '\n' });
  if (path === '/api/public-articles') return json({ articles: [] });
  if (path === '/api/admin/session') return json({ authenticated: false });
  return json({ ok: true, articles: [] });
});
const report = { passed: false, calls, errors };
try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const input = page.getByPlaceholder('粘贴英文文章内容');
  await input.fill('The reader remains mounted.\n\nPrecise context survives a successful login.');
  await page.getByRole('button', { name: '开始阅读', exact: true }).last().click();
  const reader = page.locator('.cr-reader-root'); await reader.waitFor({ timeout: 60000 });
  await reader.evaluate(element => { element.dataset.auditMount = 'original-reader'; });
  await page.getByRole('button', { name: '全文翻译', exact: true }).click();
  await page.getByRole('button', { name: '开始翻译', exact: true }).click();
  await page.getByPlaceholder('中国大陆手机号').fill('19900000001');
  await page.getByPlaceholder('输入密码').fill('TestPassword123');
  await page.locator('form button[type="submit"]').click();
  await page.getByPlaceholder('输入密码').waitFor({ state: 'hidden', timeout: 20000 });
  assert.equal(await reader.getAttribute('data-audit-mount'), 'original-reader');
  await page.getByRole('button', { name: '开始翻译', exact: true }).click();
  await page.getByText('账号A的独立验收译文。', { exact: true }).first().waitFor({ timeout: 20000 });
  report.guestLoginTranslationVisible = true;
  await page.screenshot({ path: output + '/guest-login-translated.png' });
  label = 'B'; active = member('22222222-2222-4222-8222-222222222222'); const previousSessions = sessionCalls;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  for (let retry = 0; retry < 100 && sessionCalls === previousSessions; retry++) await page.waitForTimeout(50);
  assert.ok(sessionCalls > previousSessions, 'real account refresh ran');
  await page.getByText('账号A的独立验收译文。', { exact: true }).first().waitFor({ state: 'hidden', timeout: 15000 });
  assert.equal(await reader.getAttribute('data-audit-mount'), 'original-reader');
  await page.getByRole('button', { name: '开始翻译', exact: true }).click();
  await page.getByText('账号B的独立验收译文。', { exact: true }).first().waitFor({ timeout: 20000 });
  assert.equal(await page.getByText('账号A的独立验收译文。', { exact: true }).count(), 0);
  report.accountSwitchResubscribesAndClearsOldResult = true;
  await page.screenshot({ path: output + '/owner-b-translated.png' });
  assert.deepEqual(errors, []); report.passed = true;
} catch (error) { report.error = error.message; await page.screenshot({ path: output + '/failure.png' }); await writeFile(output + '/failure.txt', await page.locator('body').innerText()); process.exitCode = 1; }
finally { await writeFile(output + '/result.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); await browser.close(); }
