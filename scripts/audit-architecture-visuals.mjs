import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
const baseline = process.env.AUDIT_BASELINE_DIR || 'artifacts/architecture-audit/baseline-local-browser';
const candidate = process.env.AUDIT_CANDIDATE_DIR || 'artifacts/architecture-audit/candidate-browser';
const output = process.env.AUDIT_OUTPUT || 'artifacts/architecture-audit/visual-comparison';
await mkdir(output, { recursive: true });
const before = JSON.parse(await readFile(baseline + '/result.json', 'utf8'));
const after = JSON.parse(await readFile(candidate + '/result.json', 'utf8'));
const results = [];
for (const original of before.results) {
  if (process.env.AUDIT_SCENARIO && original.scenario.name !== process.env.AUDIT_SCENARIO) continue;
  const current = after.results.find(item => item.scenario.name === original.scenario.name);
  assert.ok(original.passed && current?.passed, original.scenario.name + ' passes behavioral flow on both versions');
  assert.deepEqual(current.lookupContext, original.lookupContext, 'same selected word and neighboring sentences');
  assert.deepEqual(current.geometry, original.geometry, 'same rendered text, blocks, dimensions and token hydration: ' + original.scenario.name);
  for (const filename of original.screenshots) {
    assert.ok(current.screenshots.includes(filename), 'candidate captured ' + filename);
    const left = await sharp(baseline + '/' + filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const right = await sharp(candidate + '/' + filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual(right.info, left.info);
    const delta = Buffer.alloc(left.data.length); let changed = 0, maximum = 0;
    for (let offset = 0; offset < left.data.length; offset += 4) {
      let different = false;
      for (let channel = 0; channel < 3; channel++) { const difference = Math.abs(left.data[offset + channel] - right.data[offset + channel]); delta[offset + channel] = difference; maximum = Math.max(maximum, difference); if (difference) different = true; }
      delta[offset + 3] = 255; if (different) changed++;
    }
    const changedFraction = changed / (left.info.width * left.info.height);
    results.push({ filename, changedPixels: changed, changedFraction, maximumChannelDifference: maximum });
    if (changed) await sharp(delta, { raw: left.info }).png().toFile(output + '/' + filename);
  }
}
await writeFile(output + '/result.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
// Every changed pixel is reported for human inspection. Reader text/layout has a hard zero-diff gate.
assert.ok(results.filter(item => /reader-(start|middle|return)/.test(item.filename)).every(item => item.changedPixels === 0), 'reader screenshots must match exactly');
