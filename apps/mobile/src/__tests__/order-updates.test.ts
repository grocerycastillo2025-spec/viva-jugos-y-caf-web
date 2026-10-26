import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hasLiveOrders, statusChanges } from '../domain/order-updates.ts';

describe('avisos de estatus al cliente', () => {
  const now = [
    { id: 'a', order_number: 1001, status: 'preparing' },
    { id: 'b', order_number: 1002, status: 'ready' },
    { id: 'c', order_number: 1003, status: 'completed' },
    { id: 'd', order_number: 1004, status: 'confirmed' },
  ];
  it('primera lectura no avisa', () => {
    assert.deepEqual(statusChanges(null, now), []);
  });
  it('avisa preparando, listo y cancelado; no entregado ni pedidos nuevos', () => {
    const prev = new Map([['a', 'confirmed'], ['b', 'preparing'], ['c', 'ready']]);
    assert.deepEqual(statusChanges(prev, now), [
      { orderId: 'a', orderNumber: 1001, kind: 'preparing' },
      { orderId: 'b', orderNumber: 1002, kind: 'ready' },
    ]);
  });
  it('pedido hecho entre dos revisiones que ya va en preparación sí avisa', () => {
    const prev = new Map<string, string>();
    assert.deepEqual(statusChanges(prev, [{ id: 'x', order_number: 7, status: 'preparing' }, { id: 'y', order_number: 8, status: 'confirmed' }]), [
      { orderId: 'x', orderNumber: 7, kind: 'preparing' },
    ]);
  });
  it('pedidos vivos', () => {
    assert.equal(hasLiveOrders(now), true);
    assert.equal(hasLiveOrders([{ status: 'completed' }]), false);
  });
});
