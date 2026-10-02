import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Read-only evidence audit. It never changes a question or infers from options.
export function explicitAnswerReferences(explanation) {
  const raw = explanation.replace(/\s+/g, '');
  const text = raw.replace(/解析/g, '').replace(/析/g, '');
  const explicit = [
    ...raw.matchAll(/([ABCD])[)）][【\[](?:精析|解析)[】\]]/g),
    ...raw.matchAll(/答案精析[］】\]]?([ABCD])/g),
    ...text.matchAll(/答案(?:是|为)([ABCD])/g),
    ...text.matchAll(/([ABCD])项为正确答案/g),
    ...text.matchAll(/(?:选项)?([ABCD])为正确答案/g),
    ...text.matchAll(/(?:故选(?:项)?|此题选)([ABCD])(?!(?:可)?排除)/g),
    ...text.matchAll(/选项([ABCD])正确/g),
  ].map(match => match[1]);
  if (explicit.length) return [...new Set(explicit)].sort();
  const bounded = /选项([ABCD])(?:(?!选项[ABCD]|[ABCD]项|排除|错误|不正确|未提及|不符|答案是|答案为|答案精).){0,70}(?:正确答案|故为答案)/g;
  const references = [...text.matchAll(bounded)].map(match => match[1]);
  references.push(...[...text.matchAll(/([ABCD])(?:项|[)）])(?:(?!选项[ABCD]|[ABCD][项)）]|排除|错误|不正确|未提及|不符|答案是|答案为|答案精).){0,50}(?:正确|答案)/g)].map(match => match[1]));
  return [...new Set(references)].sort();
}

export function auditListeningAnswers(directory) {
  if (directory instanceof URL) directory = fileURLToPath(directory);
  const flags = [], unresolved = [];
  let questions = 0;
  for (const file of fs.readdirSync(directory).filter(file => /^cet[46]-.*\.json$/.test(file))) {
    const section = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    for (const question of section.questions) {
      questions++;
      const references = explicitAnswerReferences(question.explanation);
      const item = {paperId: file.replace(/\.json$/, ''), number: question.number, answer: question.answer, references};
      if (!references.length) unresolved.push(item);
      else if (references.length !== 1 || references[0] !== question.answer) flags.push(item);
    }
  }
  return {questions, explicitReferences: questions - unresolved.length, flags, unresolved};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = auditListeningAnswers(path.join(root, 'data/cet/listening'));
  console.log(JSON.stringify(result, null, 2));
  if (result.flags.length || result.unresolved.length) process.exitCode = 1;
}
