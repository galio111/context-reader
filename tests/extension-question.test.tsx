import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { JSDOM } from 'jsdom';
import { ExtensionQuestion } from '../chrome-extension/src/question';

test('extension questions send context, show sources and retain follow-up history', async () => {
 const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.com' });
 Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
 const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
 const previousFetch = globalThis.fetch;
 const bodies: any[] = [];
 globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ answer: '她是数学家。[1]', searchNotice: '已联网搜索', sources: [{title: '人物资料', url: 'https://example.com/person'}] }); };
 try {
  const view = render(<ExtensionQuestion context={{ word: 'Ada Lovelace', sentence: 'Ada Lovelace wrote notes.', previousSentence: '', nextSentence: '' } as any} />);
  fireEvent.change(view.getByRole('textbox'), { target: { value: '这个人是谁？' } });
  fireEvent.submit(view.getByRole('button', {name:'提问'}).closest('form')!);
  await waitFor(() => assert.ok(view.getByRole('link', { name: '[1] 人物资料' })));
  assert.equal(bodies[0].sentence, 'Ada Lovelace wrote notes.');
  assert.equal(view.getByRole('link').getAttribute('rel'), 'noopener noreferrer');
  fireEvent.change(view.getByRole('textbox'), { target: { value: '她做了什么？' } });
  fireEvent.submit(view.getByRole('button', {name:'继续追问'}).closest('form')!);
  await waitFor(() => assert.equal(bodies.length, 2));
  assert.equal(bodies[1].history[0].question, '这个人是谁？');
  await waitFor(() => assert.equal(view.getAllByRole('link').length, 2));
 } finally { cleanup(); globalThis.fetch = previousFetch; dom.window.close(); }
});
