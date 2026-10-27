import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  communityError,
  hasPersonalData,
  starBars,
  timeAgo,
  validatePost,
} from '../domain/community.ts';

describe('comunidad', () => {
  it('detecta datos personales como la base', () => {
    assert.equal(hasPersonalData('llámame al 442 123 4567'), true);
    assert.equal(hasPersonalData('ana@correo.mx'), true);
    assert.equal(hasPersonalData('CLABE 012180001234567891'), true);
    assert.equal(hasPersonalData('El jugo de 500 ml a $65, pedido #1002'), false);
  });

  it('valida publicaciones', () => {
    assert.equal(validatePost('review', 'Muy rico', null), 'rating');
    assert.equal(validatePost('review', 'ok', 5), 'short');
    assert.equal(validatePost('question', 'x'.repeat(601), null), 'long');
    assert.equal(validatePost('question', '¿Abren el domingo? 4421234567', null), 'personal');
    assert.equal(validatePost('review', 'Muy rico', 5), null);
  });

  it('tiempo relativo', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    assert.equal(timeAgo('2026-10-27T11:59:30Z', now), 'ahora');
    assert.equal(timeAgo('2026-10-27T11:30:00Z', now), 'hace 30 min');
    assert.equal(timeAgo('2026-10-27T09:00:00Z', now), 'hace 3 h');
    assert.equal(timeAgo('2026-10-26T10:00:00Z', now), 'ayer');
    assert.match(timeAgo('2026-09-12T12:00:00Z', now), /^12 sep$/);
  });

  it('barras de estrellas', () => {
    const bars = starBars({ '5': 3, '4': 1 });
    assert.deepEqual(bars[0], { stars: 5, count: 3, pct: 75 });
    assert.deepEqual(bars[4], { stars: 1, count: 0, pct: 0 });
    assert.equal(starBars(null)[0]?.pct, 0);
  });

  it('errores', () => {
    assert.equal(communityError('personal_data'), 'personal');
    assert.equal(communityError('x', 'PGRST202'), 'missing');
    assert.equal(communityError('boom'), 'generic');
  });
});
