import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultSelection, relevant, toggleId } from '../domain/ingredients.ts';

const IMPACT = {
  items: [
    { id: 'viva', available: true, other_missing: [] },
    { id: 'flu', available: false, other_missing: [] },
    { id: 'verde', available: false, other_missing: ['Kale'] },
  ],
  modifiers: [
    { id: 'm1', available: true },
    { id: 'm2', available: false },
  ],
};

describe('ingredientes', () => {
  it('al apagar propone los disponibles', () => {
    assert.deepEqual(defaultSelection(IMPACT, false), { items: ['viva'], modifiers: ['m1'] });
  });
  it('al prender propone los apagados que ya pueden volver', () => {
    assert.deepEqual(defaultSelection(IMPACT, true), { items: ['flu'], modifiers: ['m2'] });
    assert.deepEqual(relevant(IMPACT.items, true).map((i) => i.id), ['flu', 'verde']);
  });
  it('marcar y desmarcar', () => {
    assert.deepEqual(toggleId(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
  });
});
