/**
 * El criterio de "esta sucursal puede cobrar", entero y sin red.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateEcommerceReadiness, type EcommerceEvidence } from '../onboarding.ts';

const TODO_BIEN: EcommerceEvidence = {
  apiAccessKey: 'PUBLICA',
  gateway: { accountName: 'Sandbox Test Merchant', supportsMultiPayToken: true },
  paymentConfigs: { surcharging: { supported: false } },
};

test('con las tres respuestas buenas, la sucursal abre', () => {
  const r = evaluateEcommerceReadiness(TODO_BIEN);
  assert.equal(r.ready, true);
  assert.deepEqual(r.blockers, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.gatewayAccount, 'Sandbox Test Merchant');
  assert.equal(r.surchargeRate, null);
});

test('sin clave de PAKMS no abre, y da igual lo demas', () => {
  // Es la prueba funcional: si el merchant no puede producir una clave de
  // ecommerce, no se le puede cobrar. Ninguna otra respuesta lo arregla.
  const r = evaluateEcommerceReadiness({ ...TODO_BIEN, apiAccessKey: null });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join(' '), /PAKMS/);

  // Una cadena vacia es lo mismo que no tenerla.
  assert.equal(evaluateEcommerceReadiness({ ...TODO_BIEN, apiAccessKey: '   ' }).ready, false);
});

test('sin pasarela legible tampoco abre', () => {
  const r = evaluateEcommerceReadiness({ ...TODO_BIEN, gateway: null });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join(' '), /quién procesa/);
  assert.equal(r.gatewayAccount, null);
});

test('el recargo AVISA pero no bloquea: la decision es de producto', () => {
  // Absorberlo, mostrarlo o no abrir esa sucursal no lo decide el codigo.
  const r = evaluateEcommerceReadiness({
    ...TODO_BIEN,
    paymentConfigs: { surcharging: { supported: true, rate: 0.035 } },
  });

  assert.equal(r.ready, true, 'el recargo no impide abrir');
  assert.equal(r.surchargeRate, 0.035);
  // El porcentaje sale en el aviso: "3,5 %" se entiende, "0.035" no.
  assert.match(r.warnings.join(' '), /3,5 %/);
  assert.match(r.warnings.join(' '), /MÁS de lo que le enseña la app/);
});

test('si no se puede leer la configuracion de pagos, se avisa en vez de callar', () => {
  // Un recargo que existe y no vemos es peor que uno que vemos tarde.
  const r = evaluateEcommerceReadiness({ ...TODO_BIEN, paymentConfigs: null });
  assert.equal(r.ready, true);
  assert.match(r.warnings.join(' '), /no sabemos si esta sucursal aplica recargo/);
});

test('el rate de /gateway solo se usa como respaldo', () => {
  // Fuente buena ausente -> vale el respaldo.
  const conRespaldo = evaluateEcommerceReadiness({
    ...TODO_BIEN,
    gateway: { accountName: 'X', rate: 0.04 },
    paymentConfigs: null,
  });
  assert.equal(conRespaldo.surchargeRate, 0.04);

  // Fuente buena que dice que NO hay recargo -> manda ella, no el respaldo.
  const sinRecargo = evaluateEcommerceReadiness({
    ...TODO_BIEN,
    gateway: { accountName: 'X', rate: 0.04 },
    paymentConfigs: { surcharging: { supported: false } },
  });
  assert.equal(sinRecargo.surchargeRate, null);
});

test('no admitir tokens de varios usos no bloquea nada hoy', () => {
  // Usamos tokens de un solo uso. Se anota para el dia que haya "tarjeta
  // guardada"; bloquear por esto cerraria sucursales que funcionan.
  const r = evaluateEcommerceReadiness({
    ...TODO_BIEN,
    gateway: { accountName: 'X', supportsMultiPayToken: false },
  });
  assert.equal(r.ready, true);
  assert.match(r.warnings.join(' '), /un solo uso/);
});

test('varios problemas a la vez salen todos, no solo el primero', () => {
  // Quien da de alta una sucursal quiere la lista entera, no ir de uno en
  // uno descubriendo el siguiente.
  const r = evaluateEcommerceReadiness({ apiAccessKey: null, gateway: null, paymentConfigs: null });
  assert.equal(r.ready, false);
  assert.equal(r.blockers.length, 2);
  assert.equal(r.warnings.length, 1);
});
