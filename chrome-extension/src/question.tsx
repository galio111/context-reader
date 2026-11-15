import React, { useEffect, useRef, useState } from 'react';
import type { WordContext } from '@/types/reader';

type Turn = { question: string; answer: string; sources: { title: string; url: string }[]; searchNotice: string };
export function ExtensionQuestion({ context }: { context: WordContext }) {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !question.trim()) return;
    const ticket = ++generation.current;
    const current = question.trim();
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/ask-sentence', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: context.word, sentence: context.sentence || context.word,
          previousSentence: context.previousSentence || '', nextSentence: context.nextSentence || '',
          question: current, history: turns.slice(-8).map(({ question, answer }) => ({ question, answer })) }) });
      const data = await response.json();
      if (!response.ok || !data.answer) throw new Error(data.error || '回答暂时不可用，请重试。');
      if (ticket !== generation.current) return;
      const sources = (Array.isArray(data.sources) ? data.sources : []).filter((s: { url?: unknown }) => typeof s?.url === 'string' && /^https?:\/\//i.test(s.url));
      setTurns(previous => [...previous, { question: current, answer: data.answer, sources, searchNotice: data.searchNotice || '' }]);
      setQuestion('');
    } catch (e) { if (ticket === generation.current) setError(e instanceof Error ? e.message : '提问失败，请重试。'); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  return <section className="extension-question" aria-label="AI 问答">
    <h2>AI 问答</h2>
    <p>结合选区与上下文回答；人物、事件等问题会联网查证。</p>
    {turns.map((turn, index) => <article key={index}>
      <h3>{turn.question}</h3><p className="question-answer">{turn.answer}</p>
      {turn.searchNotice && <p className="search-notice">{turn.searchNotice}</p>}
      {turn.sources.length > 0 && <ol aria-label="搜索来源">{turn.sources.map((source, i) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">[{i + 1}] {source.title}</a></li>)}</ol>}
    </article>)}
    <form onSubmit={submit}>
      <textarea aria-label="向 AI 提问" maxLength={500} value={question} onChange={e => setQuestion(e.target.value)} placeholder="例如：这个人是谁？当时发生了什么？这里为什么用过去时？"
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
      <button type="submit" disabled={busy || !question.trim()}>{busy ? '正在查证并回答…' : turns.length ? '继续追问' : '提问'}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
