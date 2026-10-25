import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clabeValid,
  customerMethods,
  formatClabe,
  isMercadoPagoLink,
  needsPaymentConfirmation,
  paymentSetupProblems,
} from '../domain/payment-options.ts';

const ALL_ON = { cash: true, card_counter: true, transfer: true, mercadopago: true };

describe('Mercado Pago con liga y transferencia', () => {
  it('CLABE', () => {
    assert.equal(clabeValid('002010077777777771'), true);
    assert.equal(clabeValid('002 010 07777777777 1'), true);
    assert.equal(clabeValid('002010077777777772'), false);
    assert.equal(clabeValid('12345'), false);
    assert.equal(formatClabe('002010077777777771'), '002 010 07777777777 1');
  });

  it('liga de Mercado Pago', () => {
    assert.equal(isMercadoPagoLink('https://link.mercadopago.com.mx/vivajugos'), true);
    assert.equal(isMercadoPagoLink('https://mpago.la/2abcD'), true);
    assert.equal(isMercadoPagoLink('https://mpago.mx/1a2B3c'), true);
    assert.equal(isMercadoPagoLink('http://mpago.la/2abcD'), false);
    assert.equal(isMercadoPagoLink('https://mercadopago.com.mx.estafa.com/x'), false);
    assert.equal(isMercadoPagoLink('https://link.mercadopago.com.mx/'), false);
  });

  it('qué ve el cliente', () => {
    assert.deepEqual(customerMethods({ payment_options: ALL_ON }), ['cash', 'card_counter']);
    assert.deepEqual(
      customerMethods({ payment_options: ALL_ON, transfer_clabe: '002010077777777771', mercadopago_link: 'https://mpago.la/x' }),
      ['cash', 'card_counter', 'transfer', 'mercadopago'],
    );
    assert.deepEqual(
      customerMethods({ payment_options: { ...ALL_ON, mercadopago: false }, transfer_info: 'BBVA', mercadopago_link: 'https://mpago.la/x' }),
      ['cash', 'card_counter', 'transfer'],
    );
    // Base vieja sin opciones: lo de mostrador.
    assert.deepEqual(customerMethods({}), ['cash', 'card_counter', 'transfer']);
  });

  it('pago por confirmar', () => {
    assert.equal(needsPaymentConfirmation('transfer'), true);
    assert.equal(needsPaymentConfirmation('mercadopago'), true);
    assert.equal(needsPaymentConfirmation('cash'), false);
    assert.equal(needsPaymentConfirmation(null), false);
  });

  it('problemas antes de guardar', () => {
    assert.deepEqual(paymentSetupProblems({ options: ALL_ON, clabe: '', transferInfo: '', mpLink: '' }), [
      'transfer_without_data',
      'mp_without_link',
    ]);
    assert.deepEqual(
      paymentSetupProblems({ options: ALL_ON, clabe: '123', transferInfo: 'x', mpLink: 'https://otra.com/a' }),
      ['clabe_invalid', 'mp_link_invalid'],
    );
    assert.deepEqual(
      paymentSetupProblems({ options: { cash: false }, clabe: '', transferInfo: '', mpLink: '' }),
      ['none_on'],
    );
    assert.deepEqual(
      paymentSetupProblems({ options: ALL_ON, clabe: '002010077777777771', transferInfo: '', mpLink: 'https://mpago.la/x' }),
      [],
    );
  });
});
