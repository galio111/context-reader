import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// All API requests are intercepted. This fixture never mutates a live account.
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/欧阳子浩/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
const base = process.env.AUDIT_BASE || 'https://context-reader.com';
const output = process.env.AUDIT_OUTPUT || 'artifacts/architecture-audit/baseline-browser';
await mkdir(output, { recursive: true });
const account = { configured: true, authenticated: true, profile: { userId: '11111111-1111-4111-8111-111111111111', nickname: '独立功能验收', status: 'active', email: '', phone: '13800000000', readingInterests: [] }, plan: { id: 'free', displayName: '免费账号', priceCny: 0, active: true, limits: [] }, usage: [] };
const paragraphs = ['Architecture Equivalence Audit', 'The resilient team worked together and found a fascinating new source of information.', ...Array.from({ length: 430 }, (_, i) => `Paragraph ${i + 1}. A thoughtful reader explores precise language, reliable knowledge, and unfamiliar expressions. Scientific writing improves through careful observation and repeated experiments.`)];
const study = { serverNow: '2026-10-12T12:00:00Z', settings: { reviewsPerDay: 100, retention: .9, forgotMinutes: 5, unsureMinutes: 10, pausedUntil: null, includeAnki: false, reminders: false }, cards: [], entries: [], reviews: [], daily: [], today: null, streak: { current: 0, best: 0, last_day: null }, claims: [], rewards: [], policy: { rewardsEnabled: true, pointsPerNew: 1, dailyRewardCap: 50, rewardDays: 90, streakMinNew: 5, milestones: [], profileEnabled: true, profileCost: 5, minimumReadingMinutes: 60, minimumLookups: 50 } };
const results = [];
for (const scenario of [
  { name: 'desktop-day', width: 1440, height: 1000, reducedMotion: 'no-preference', theme: 'day' },
  { name: 'mobile-day', width: 390, height: 844, reducedMotion: 'no-preference', theme: 'day' },
  { name: 'desktop-night-reduced', width: 1440, height: 1000, reducedMotion: 'reduce', theme: 'night' },
  { name: 'mobile-night-reduced', width: 390, height: 844, reducedMotion: 'reduce', theme: 'night' },
]) {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-proxy-server', '--host-resolver-rules=MAP context-reader.com 43.143.122.238'] });
  const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, reducedMotion: scenario.reducedMotion, serviceWorkers: 'block' });
  await context.addInitScript(({ theme }) => { localStorage.setItem('context-reader-home-ui-v1', JSON.stringify({ theme })); }, scenario);
  const page = await context.newPage(), errors = [], requests = [], failedRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  await page.route('**/api/**', async route => {
    const p = new URL(route.request().url()).pathname;
    const body = route.request().postDataJSON();
    requests.push({ path: p, method: route.request().method(), ...(body ? { body } : {}) });
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (p === '/api/auth/session') return json({ account });
    if (p === '/api/account/sync') return json({ objects: [], results: [], nextOffset: null, snapshotCursor: '', nextCursor: '', hasMore: false, protocol: 2 });
    if (p === '/api/account/activity') return json({ seconds: 128, todaySeconds: 45, readingDays: 2, since: '2026-10-12T00:00:00Z' });
    if (p === '/api/study') return json(study);
    if (p === '/api/study/profile') return json({ activeSeconds: 128, uniqueLookups: 5, eligible: false });
    if (p === '/api/public-articles') return json({ articles: [] });
    if (p === '/api/admin/session') return json({ authenticated: false });
    if (p === '/api/explain-word-stream') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture fallback"}' });
    if (p === '/api/explain-word') return json({ explanation: { word: body.word, lemma: body.word, phonetic: '', phoneticFor: '', partOfSpeech: 'adjective', basicMeaning: '深思熟虑的', contextMeaning: '认真思考的', sentenceTranslation: '认真思考的读者探索准确的语言、可靠的知识与陌生表达。', usageNote: '形容认真思考的人。', collocation: 'a thoughtful reader', exampleEnglish: 'She is a thoughtful reader.', exampleChinese: '她是一位认真思考的读者。', difficulty: 'easy', shouldAddToVocabulary: true, anki: { canMakeCloze: true, cardMode: 'cloze_context', clozeSentence: body.sentence.replace(body.word, '________'), contextCue: '认真思考的', basicCue: '深思熟虑的', frontPreview: '', backPreview: '', ankiNoteId: null, ankiImportedAt: null } } });
    if (p === '/api/summarize-article') return json({ summary: '固定的验收文章摘要。' });
    if (p === '/api/pronunciation') return route.fulfill({ status: 503, body: '{"error":"fixture audio unavailable"}' });
    return json({ ok: true, count: 0, articles: [] });
  });
  const report = { scenario, errors, requests, failedRequests, screenshots: [], geometry: [] };
  const shot = async name => {
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    const filename = scenario.name + '-' + name + '.png';
    await page.screenshot({ path: output + '/' + filename });
    report.screenshots.push(filename);
  };
  const geometry = async name => {
    const value = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, scrollHeight: document.documentElement.scrollHeight, tokenCount: document.querySelectorAll('[data-reader-token]').length, blocks: [...document.querySelectorAll('[data-reader-block]')].map(e => ({ id: e.dataset.readerBlock, text: e.textContent, tag: e.tagName, height: Math.round(e.getBoundingClientRect().height * 100) / 100 })), theme: document.documentElement.dataset.contextTheme }));
    assert.ok(value.scrollWidth <= value.innerWidth + 1, name + ' must not overflow horizontally');
    assert.equal(value.theme || 'day', scenario.theme, name + ' uses requested day/night palette');
    report.geometry.push({ name, ...value });
  };
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const work = page.getByRole('region', { name: '阅读工作台' });
    await work.getByRole('textbox').waitFor({ timeout: 60000 });
    await page.locator('[class*="_memberOpening__"]').waitFor({ state: 'hidden', timeout: 25000 });
    await shot('workbench');
    await work.getByRole('textbox').fill(paragraphs.join('\n\n'));
    const started = Date.now();
    await work.getByRole('button', { name: '开始阅读', exact: true }).click();
    await page.locator('[data-reader-block]').first().waitFor({ timeout: 60000 });
    report.readerOpenMs = Date.now() - started;
    await page.waitForTimeout(2300);
    await geometry('reader-start'); await shot('reader-start');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight / 2));
    await page.waitForTimeout(2300);
    await geometry('reader-middle'); await shot('reader-middle');
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(2300);
    await geometry('reader-return'); await shot('reader-return');
    assert.equal(report.geometry[0].blocks.length, report.geometry[1].blocks.length);
    assert.ok(report.geometry[0].blocks.length > 400, 'long reader crosses the former 400-block cache boundary');
    const thoughtful = page.locator('[data-reader-block="paragraph-4"] [data-reader-token]').filter({ hasText: /^thoughtful$/ });
    await thoughtful.click();
    await page.locator('dd:visible').filter({ hasText: /^认真思考的$/ }).first().waitFor({ timeout: 20000 });
    const lookup = requests.find(request => request.path === '/api/explain-word-stream');
    assert.equal(lookup.body.word, 'thoughtful');
    assert.equal(lookup.body.sentence, 'A thoughtful reader explores precise language, reliable knowledge, and unfamiliar expressions.');
    assert.equal(lookup.body.previousSentence, 'Paragraph 1.');
    assert.equal(lookup.body.nextSentence, 'Scientific writing improves through careful observation and repeated experiments.');
    report.lookupContext = lookup.body; await shot('contextual-lookup');
    await page.keyboard.press('Escape');
    if (scenario.width > 600) {
      const rail = page.getByRole('complementary', { name: '阅读快捷入口' });
      const dictionary = page.locator('aside[class*="dictionaryWindow"]');
      const importer = page.getByRole('dialog', { name: '导入新文章', exact: true });
      await rail.getByRole('button', { name: /查词/ }).click(); await dictionary.waitFor();
      await rail.getByRole('button', { name: /导入/ }).click(); await importer.waitFor();
      await page.keyboard.press('Escape'); await importer.waitFor({ state: 'hidden' });
      assert.ok(await dictionary.isVisible()); await shot('dictionary');
      await dictionary.getByRole('button', { name: '隐藏单独查词窗口' }).click();
      const tools = page.getByRole('banner', { name: '文章工具' });
      const editorButton = page.getByRole('button', { name: '编辑文章', exact: true });
      await editorButton.click();
      const editor = page.locator('[contenteditable="true"]').first(); await editor.waitFor();
      await editor.evaluate(element => {
        const first = element.querySelector('p');
        first.textContent += ' — edited';
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' — edited' }));
      });
      await page.getByRole('button', { name: '保存编辑', exact: true }).click();
      await editor.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('[data-reader-block="paragraph-0"]').innerText(), paragraphs[0] + ' — edited');
      assert.equal(await page.locator('[data-reader-block="paragraph-1"]').innerText(), '\n');
      await editorButton.click(); await editor.waitFor();
      await page.getByRole('button', { name: '撤销文章编辑', exact: true }).click();
      assert.equal(await editor.locator('p').first().innerText(), paragraphs[0]);
      await page.getByRole('button', { name: '重做文章编辑', exact: true }).click();
      assert.equal(await editor.locator('p').first().innerText(), paragraphs[0] + ' — edited');
      await page.getByRole('button', { name: '取消编辑', exact: true }).click();
      report.editSaveUndoRedoBlankLines = true;
      page.once('dialog', d => d.dismiss());
      await rail.getByRole('button', { name: '返回首页', exact: true }).click();
      await work.waitFor(); report.repeatReturn = true;
    }
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) {
    report.passed = false; report.error = error.message;
    await shot('failure').catch(() => {});
    await writeFile(output + '/' + scenario.name + '-failure.txt', await page.locator('body').innerText().catch(() => ''));
    process.exitCode = 1;
  } finally { results.push(report); console.log(JSON.stringify({ scenario: scenario.name, passed: report.passed, error: report.error, failedRequests })); await context.close(); await browser.close(); }
}
await writeFile(output + '/result.json', JSON.stringify({ base, results }, null, 2));
console.log(JSON.stringify(results.map(({ scenario, passed, error, readerOpenMs, errors }) => ({ scenario: scenario.name, passed, error, readerOpenMs, errors })), null, 2));
