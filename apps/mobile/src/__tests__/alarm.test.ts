import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_ALARM, effectiveSound, parseAlarmSettings, pendingNewOrders } from '../domain/alarm.ts';

describe('alarma de pedidos', () => {
  it('lee ajustes guardados con valores por omisión', () => {
    assert.deepEqual(parseAlarmSettings(null), DEFAULT_ALARM);
    assert.deepEqual(parseAlarmSettings('basura'), DEFAULT_ALARM);
    const s = parseAlarmSettings(JSON.stringify({ sound: 'sirena', volume: 0.5, everySeconds: 15, vibrate: false, x: 1 }));
    assert.equal(s.sound, 'sirena');
    assert.equal(s.volume, 0.5);
    assert.equal(s.everySeconds, 15);
    assert.equal(s.vibrate, false);
    assert.equal(parseAlarmSettings(JSON.stringify({ volume: 7, everySeconds: 1 })).volume, 1);
  });
  it('sonido propio sin archivo cae a la campana', () => {
    assert.equal(effectiveSound({ ...DEFAULT_ALARM, sound: 'custom' }, null), 'campana');
    assert.equal(effectiveSound({ ...DEFAULT_ALARM, sound: 'custom' }, 'https://x/a.mp3'), 'custom');
  });
  it('suena mientras haya pedidos nuevos sin empezar', () => {
    const orders = [{ id: 'a', status: 'confirmed' }, { id: 'b', status: 'preparing' }, { id: 'c', status: 'confirmed' }];
    assert.deepEqual(pendingNewOrders(orders).map((o) => o.id), ['a', 'c']);
    assert.equal(pendingNewOrders([{ status: 'ready' }]).length, 0);
  });
});
