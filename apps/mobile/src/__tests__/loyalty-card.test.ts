import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isCustomerQr, nextGoal, progressTo, reachableRewards, staffErrorKey } from '../domain/loyalty-card.ts';

const REWARDS = [
  { id: 'j', name: 'Jugo gratis', cost_points: 100 },
  { id: 'c', name: 'Café gratis', cost_points: 60 },
];

describe('tarjeta de puntos', () => {
  it('reconoce el QR del cliente', () => {
    assert.equal(isCustomerQr('VIVA1.ffffffff-0000-4000-8000-000000000003.A1B2C3D4E5'), true);
    assert.equal(isCustomerQr('https://viva/visita?c=123'), false);
    assert.equal(isCustomerQr('VIVA1.nope.A1B2C3D4E5'), false);
  });
  it('qué alcanza y cuál sigue', () => {
    assert.deepEqual(reachableRewards(70, REWARDS).map((r) => r.id), ['c']);
    assert.deepEqual(reachableRewards(120, REWARDS).map((r) => r.id), ['j', 'c']);
    assert.deepEqual(nextGoal(70, REWARDS), { reward: REWARDS[0], missing: 30, progress: 0.7 });
    assert.equal(nextGoal(150, REWARDS), null);
    assert.equal(progressTo(50, 100), 0.5);
    assert.equal(progressTo(500, 100), 1);
  });
  it('errores del mostrador', () => {
    assert.equal(staffErrorKey('too_soon:2026-10-26T10:00:00Z'), 'too_soon');
    assert.equal(staffErrorKey('customer_qr_expired'), 'qr_expired');
    assert.equal(staffErrorKey('boom'), 'other');
  });
});
