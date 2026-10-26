import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { activeHours, hourRange, hourTick, pctChange, peak, shares } from '../domain/stats.ts';

describe('estadísticas', () => {
  it('cambio contra el periodo anterior', () => {
    assert.equal(pctChange(120, 100), 20);
    assert.equal(pctChange(80, 100), -20);
    assert.equal(pctChange(5, 0), null);
  });
  it('pico', () => {
    assert.deepEqual(peak([{ h: 8, n: 1 }, { h: 9, n: 4 }, { h: 10, n: 4 }], (r) => r.n), { h: 9, n: 4 });
    assert.equal(peak([{ n: 0 }], (r) => r.n), null);
  });
  it('horas en palabras', () => {
    assert.equal(hourRange(9), '9 a 10 am');
    assert.equal(hourRange(11), '11 am a 12 pm');
    assert.equal(hourRange(13), '1 a 2 pm');
    assert.equal(hourRange(23), '11 pm a 12 am');
    assert.equal(hourTick(0), '12');
    assert.equal(hourTick(15), '3');
  });
  it('porcentajes que suman 100', () => {
    assert.deepEqual(shares([1, 1, 1]), [34, 33, 33]);
    assert.equal(shares([3, 5, 9, 1]).reduce((a, b) => a + b, 0), 100);
    assert.deepEqual(shares([0, 0]), [0, 0]);
  });
  it('horas activas', () => {
    assert.deepEqual(activeHours([{ hour: 6, orders: 2 }, { hour: 22, orders: 1 }]), { from: 6, to: 22 });
    assert.deepEqual(activeHours([]), { from: 7, to: 21 });
  });
});
