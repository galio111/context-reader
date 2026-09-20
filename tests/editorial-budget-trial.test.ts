import assert from 'node:assert/strict';
import test from 'node:test';
import { editorialBudgetForDay, parseEditorialBudgetTrial } from '../lib/editorialBudgetPolicy';
import { shanghaiDay } from '../lib/discoveryPolicy';

test('trial applies only to its Shanghai date and never changes the persistent base', () => {
  const config = { dailyBudgetCny: 1, budgetTrial: { day: '2026-09-21', cny: 3 } };
  for (const [instant, expected] of [
    ['2026-09-20T15:59:59Z', 1], ['2026-09-20T16:00:00Z', 3],
    ['2026-09-21T15:59:59Z', 3], ['2026-09-21T16:00:00Z', 1],
    ['2026-10-21T00:00:00Z', 1],
  ] as const) assert.equal(editorialBudgetForDay(config, shanghaiDay(new Date(instant))), expected);
  assert.equal(config.dailyBudgetCny, 1);
});

test('invalid or removed trials cannot expand the budget', () => {
  for (const value of [null, {}, { day: '2026-02-30', cny: 3 }, { day: '2026-09-21', cny: NaN }, { day: '2026-09-21', cny: 11 }, { day: '2026-09-21', cny: '3' }]) {
    assert.equal(parseEditorialBudgetTrial(value), null);
    assert.equal(editorialBudgetForDay({ dailyBudgetCny: 1, budgetTrial: parseEditorialBudgetTrial(value) }, '2026-09-21'), 1);
  }
});

test('explicit uncapped date removes only that days application spending ceiling', () => {
  const config = { dailyBudgetCny: 1, budgetTrial: { day: '2026-09-21', cny: null } };
  assert.deepEqual(parseEditorialBudgetTrial(config.budgetTrial), config.budgetTrial);
  assert.equal(editorialBudgetForDay(config, '2026-09-21'), Infinity);
  assert.equal(editorialBudgetForDay(config, '2026-09-22'), 1);
  assert.equal(parseEditorialBudgetTrial({ day: '2026-09-21' }), null);
});
