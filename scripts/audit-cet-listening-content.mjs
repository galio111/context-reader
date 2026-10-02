import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Read-only import audit: a flag requires source review, never automatic deletion.
const sourceMark = /公[众眾](?:号|號|亏)|语听颖想说|微信(?:公众号|号)|扫码|第\s*\d+\s*页\s*[,，/、]?\s*共\s*\d+\s*页|(?:CET[46]|[四六]级)\s*\d{4}[-年]/i;
export function listeningContentFlags(section) {
  const flags = [];
  const check = (field, text, english) => {
    if (typeof text !== 'string') return;
    if (sourceMark.test(text) || (english && /[\u3400-\u9fff]|https?:\/\//.test(text))) {
      flags.push({field, text});
    }
  };
  section.paragraphs?.forEach((p, i) => check(`paragraphs[${i}]`, typeof p === 'string' ? p : p.text, true));
  for (const q of section.questions ?? []) {
    check(`questions[${q.number}].stem`, q.stem, true);
    for (const o of q.options ?? []) check(`questions[${q.number}].options.${o.key}`, o.text, true);
    // Chinese explanations are expected; only identifiable source marks are flagged.
    check(`questions[${q.number}].explanation`, q.explanation, false);
  }
  section.listeningGroups?.forEach((g, i) => g.transcript?.forEach((t, j) => check(`listeningGroups[${i}].transcript[${j}]`, t, true)));
  return flags;
}

export function auditListeningContent(directory) {
  if (directory instanceof URL) directory = fileURLToPath(directory);
  const result = {papers: 0, questions: 0, options: 0, groups: 0, flags: []};
  for (const file of fs.readdirSync(directory).filter(f => /^cet[46]-.*\.json$/.test(f))) {
    const s = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    result.papers++;
    result.questions += s.questions.length;
    result.options += s.questions.reduce((n, q) => n + q.options.length, 0);
    result.groups += s.listeningGroups.length;
    result.flags.push(...listeningContentFlags(s).map(flag => ({paperId: file.replace(/\.json$/, ''), ...flag})));
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = auditListeningContent(path.join(root, 'data/cet/listening'));
  console.log(JSON.stringify(result, null, 2));
  if (result.flags.length) process.exitCode = 1;
}
