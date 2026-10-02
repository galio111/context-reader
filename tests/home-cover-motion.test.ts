import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { updateHomeCoverMotion } from "../lib/homeCoverMotion";

function harness() {
  const dom = new JSDOM('<main><section id="stage"></section><div id="field"><canvas></canvas></div><section id="showcase"></section></main>');
  const document = dom.window.document;
  const flow = document.querySelector('main')!;
  const stage = document.querySelector<HTMLElement>('#stage')!;
  const showcase = document.querySelector<HTMLElement>('#showcase')!;
  let top = 0, distance = 1200, departure = 0;
  stage.getBoundingClientRect = () => ({ top } as DOMRect);
  showcase.getBoundingClientRect = () => ({ top: top + distance } as DOMRect);
  return { dom, document, flow, stage, showcase,
    position(y: number, length = 1200) { top = -y; distance = length; },
    sync() { return updateHomeCoverMotion(flow, stage, showcase, value => { departure = value; }); },
    departure: () => departure,
  };
}

test('new desktop scene behind a fixed-body Menu uses actual lower-page geometry', () => {
  const h = harness();
  h.position(4800);
  h.document.body.style.position = 'fixed';
  h.document.body.style.top = '-4800px';
  assert.equal(h.dom.window.scrollY, 0);
  assert.equal(h.sync(), 1);
  assert.equal(h.departure(), 1);
  assert.equal(h.flow.style.getPropertyValue('--cover-balls-visible'), '0');
  h.document.body.removeAttribute('style');
  assert.equal(h.sync(), 1);
  h.dom.window.close();
});

test('departure is reversible at each quarter without changing the existing choreography', () => {
  const h = harness();
  for (const phase of [0, .25, .5, .75, 1, .75, .5, .25, 0]) {
    h.position(phase * 1200);
    assert.equal(h.sync(), phase);
    assert.equal(h.departure(), Math.min(1, Math.max(0, (phase - .04) / .96)));
    assert.equal(h.flow.style.getPropertyValue('--cover-balls-visible'), phase === 1 ? '0' : '1');
  }
  h.dom.window.close();
});

test('resized and late-mounted scenes stay hidden below the hero, independent of canvas style', () => {
  const h = harness();
  h.position(4200, 844); h.sync();
  h.document.querySelector('canvas')!.style.visibility = 'visible';
  h.position(4200, 1447); h.sync();
  assert.equal(h.departure(), 1);
  assert.equal(h.flow.style.getPropertyValue('--cover-balls-visible'), '0');
  h.position(0, 1447); h.sync();
  assert.equal(h.departure(), 0);
  assert.equal(h.flow.style.getPropertyValue('--cover-balls-visible'), '1');
  h.dom.window.close();
});

test('missing geometry keeps the window overlay hidden until real refs are available', () => {
  const h = harness();
  let departure = -1;
  assert.equal(updateHomeCoverMotion(h.flow, null, null, value => { departure = value; }), 1);
  assert.equal(departure, 1);
  assert.equal(h.flow.style.getPropertyValue('--cover-balls-visible'), '0');
  h.sync();
  assert.equal(h.flow.style.getPropertyValue('--cover-balls-visible'), '1');
  h.dom.window.close();
});
