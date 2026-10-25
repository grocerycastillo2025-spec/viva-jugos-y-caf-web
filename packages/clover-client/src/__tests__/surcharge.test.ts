/**
 * Las tres politicas de recargo, y la linea que ninguna cruza.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateEcommerceReadiness, type EcommerceEvidence } from '../onboarding.ts';
import {
  DEFAULT_SURCHARGE_POLICY,
  formatSurchargeRate,
  SURCHARGE_POLICIES,
  surchargeOutcome,
  toSurchargePolicy,
} from '../surcharge.ts';

test('por defecto se MUESTRA, que es lo mas seguro legalmente', () => {
  // El cliente ve lo que va a pagar antes de pagarlo. Cualquier otro
  // defecto le cobraria de mas sin avisarle.
  assert.equal(DEFAULT_SURCHARGE_POLICY, 'show');

  const r = surchargeOutcome({ policy: 'show', rate: 0.035, subtotalCents: 1000 });
  assert.equal(r.disclose, true);
  assert.equal(r.blocksActivation, false);
  assert.equal(r.estimatedCents, 35);
});

test('YA NO HAY UNA POLITICA QUE CALLE MIENTRAS SE COBRA', () => {
  // Habia una tercera, `absorb`, que no enseñaba nada al cliente porque
  // "lo pagaba el restaurante". No lo pagaba: el recargo lo aplica Clover
  // y el endpoint de cobro no tiene campo para renunciar a el, asi que el
  // cliente lo pagaba igual y en silencio. Se quito en la 0019.
  //
  // De las dos que quedan, la unica que calla es `block`, y calla porque
  // no hay pedido que enseñar.
  assert.deepEqual([...SURCHARGE_POLICIES], ['show', 'block']);
  for (const policy of SURCHARGE_POLICIES) {
    const r = surchargeOutcome({ policy, rate: 0.035, subtotalCents: 1000 });
    const calla = !r.disclose;
    assert.equal(
      calla,
      r.blocksActivation,
      `${policy} calla sin bloquear la sucursal: el cliente pagaria sin aviso`,
    );
  }
});

test('block impide activar la sucursal', () => {
  const r = surchargeOutcome({ policy: 'block', rate: 0.035 });
  assert.equal(r.blocksActivation, true);
  assert.equal(r.disclose, false);
});

test('EL AVISO AL ADMIN SALE CON LAS DOS POLITICAS: no hay forma de apagarlo', () => {
  // Es la regla que no se negocia. El super admin tiene que ver "esta
  // sucursal tiene recargo" para decidir ANTES de firmar, y ningun valor
  // de configuracion puede silenciarlo.
  for (const policy of SURCHARGE_POLICIES) {
    const r = surchargeOutcome({ policy, rate: 0.035 });
    assert.notEqual(r.adminNotice, null, `${policy} silenció el aviso`);
    assert.match(r.adminNotice ?? '', /3,5 %/);
  }
});

test('sin recargo no hay aviso que dar', () => {
  for (const rate of [null, 0]) {
    const r = surchargeOutcome({ policy: 'show', rate });
    assert.equal(r.active, false);
    assert.equal(r.adminNotice, null);
    assert.equal(r.disclose, false);
    assert.equal(r.blocksActivation, false);
  }
});

test('sin subtotal no se inventa un importe', () => {
  const r = surchargeOutcome({ policy: 'show', rate: 0.035 });
  assert.equal(r.estimatedCents, null);
});

test('la estimacion va en centavos enteros', () => {
  // Ningun float toca un precio. 1099 * 0.035 = 38.465 -> 38.
  assert.equal(surchargeOutcome({ policy: 'show', rate: 0.035, subtotalCents: 1099 }).estimatedCents, 38);
  assert.equal(surchargeOutcome({ policy: 'show', rate: 0.03, subtotalCents: 1050 }).estimatedCents, 32);
});

test('un valor desconocido cae en show, y un `absorb` viejo tambien', () => {
  // Si algun dia entra un valor nuevo en la base, el peor comportamiento
  // posible seria callarse y cobrar de mas. Enseñarlo de sobra no daña.
  assert.equal(toSurchargePolicy('inventado'), 'show');
  assert.equal(toSurchargePolicy(null), 'show');
  assert.equal(toSurchargePolicy(undefined), 'show');
  assert.equal(toSurchargePolicy(3), 'show');
  // Y un `absorb` que sobreviva en una fila vieja, o en un cliente sin
  // actualizar, cae en `show`: lo mismo que hace la 0019 al migrar.
  assert.equal(toSurchargePolicy('absorb'), 'show');
  // Los dos validos pasan tal cual.
  assert.equal(toSurchargePolicy('block'), 'block');
  assert.equal(toSurchargePolicy('show'), 'show');
});

test('el porcentaje se escribe como lo lee una persona', () => {
  assert.equal(formatSurchargeRate(0.035), '3,5 %');
  assert.equal(formatSurchargeRate(0.03), '3 %');
  assert.equal(formatSurchargeRate(0.0425), '4,25 %');
});

// --- Enganche con el checklist de alta -------------------------------

const BASE: EcommerceEvidence = {
  apiAccessKey: 'PUBLICA',
  gateway: { accountName: 'Viva Juice', supportsMultiPayToken: true },
  paymentConfigs: { surcharging: { supported: true, rate: 0.035 } },
};

test('con show, el recargo avisa pero la sucursal abre', () => {
  const r = evaluateEcommerceReadiness({ ...BASE, surchargePolicy: 'show' });
  assert.equal(r.ready, true);
  assert.match(r.warnings.join(' '), /3,5 %/);
  assert.equal(r.surcharge.disclose, true);
});

test('con block, el mismo recargo impide abrir', () => {
  const r = evaluateEcommerceReadiness({ ...BASE, surchargePolicy: 'block' });
  assert.equal(r.ready, false);
  assert.match(r.blockers.join(' '), /3,5 %/);
});

test('sin politica declarada se comporta como show', () => {
  // Es lo que hace la base: `surcharge_policy` tiene default 'show'.
  const r = evaluateEcommerceReadiness(BASE);
  assert.equal(r.ready, true);
  assert.equal(r.surcharge.policy, 'show');
});

test('con `show` abre, se le enseña al cliente, y el admin lo ve igual', () => {
  const r = evaluateEcommerceReadiness({ ...BASE, surchargePolicy: 'show' });
  assert.equal(r.ready, true);
  assert.equal(r.surcharge.disclose, true);
  assert.match(r.warnings.join(' '), /recargo del 3,5 %/);
});
