import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  amountToCents,
  centsToAmount,
  checkoutUrl,
  decidePayment,
  paymentIdFromNotification,
  preferenceBody,
  readPayment,
  summarizeItems,
} from '../mercadopago.ts';

const ORDER = {
  id: '6f1d2c3b-0000-4000-8000-000000000001',
  orderNumber: 1004,
  amountCents: 13000,
  currency: 'MXN',
  storeName: 'VIVA Jugos y Café',
  itemsSummary: '2× Viva Juice, 1× Café',
  payerEmail: 'cliente@correo.mx',
};

describe('Mercado Pago', () => {
  it('montos sin errores de coma flotante', () => {
    assert.equal(centsToAmount(13000), 130);
    assert.equal(centsToAmount(4550), 45.5);
    assert.equal(amountToCents(0.1 + 0.2), 30);
    assert.equal(amountToCents(45.5), 4550);
  });

  it('preferencia con el monto exacto y amarrada al pedido', () => {
    const body = preferenceBody(ORDER, {
      appUrl: 'https://viva.mx/app/',
      notificationUrl: 'https://x.supabase.co/functions/v1/mp-webhook',
    }) as {
      items: { unit_price: number; currency_id: string; quantity: number; title: string }[];
      external_reference: string;
      back_urls: { success: string };
      notification_url: string;
      payer: { email: string };
      auto_return: string;
    };
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0]?.unit_price, 130);
    assert.equal(body.items[0]?.quantity, 1);
    assert.equal(body.items[0]?.currency_id, 'MXN');
    assert.equal(body.items[0]?.title, 'Pedido #1004 · VIVA Jugos y Café');
    assert.equal(body.external_reference, ORDER.id);
    assert.equal(body.back_urls.success, `https://viva.mx/app/order/${ORDER.id}`);
    assert.equal(body.notification_url, 'https://x.supabase.co/functions/v1/mp-webhook');
    assert.equal(body.payer.email, 'cliente@correo.mx');
    assert.equal(body.auto_return, 'approved');
    const sinCorreo = preferenceBody({ ...ORDER, payerEmail: null }, { appUrl: 'a/', notificationUrl: 'b' });
    assert.equal('payer' in sinCorreo, false);
  });

  it('liga de prueba o real según el token', () => {
    const pref = { init_point: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=1', sandbox_init_point: 'https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=1' };
    assert.equal(checkoutUrl(pref, 'APP_USR-123'), pref.init_point);
    assert.equal(checkoutUrl(pref, 'TEST-123'), pref.sandbox_init_point);
    assert.equal(checkoutUrl({ init_point: 'javascript:alert(1)' }, 'APP_USR-1'), null);
  });

  it('id del pago en los distintos avisos', () => {
    const u = (s: string) => new URL(`https://x.co/mp-webhook${s}`);
    assert.equal(paymentIdFromNotification(u(''), { type: 'payment', data: { id: '123456' } }), '123456');
    assert.equal(paymentIdFromNotification(u('?type=payment&data.id=987'), null), '987');
    assert.equal(paymentIdFromNotification(u('?topic=payment&id=555'), null), '555');
    assert.equal(paymentIdFromNotification(u(''), { action: 'payment.updated', data: { id: 42 } }), '42');
    assert.equal(paymentIdFromNotification(u('?topic=merchant_order&id=1'), null), null);
    assert.equal(paymentIdFromNotification(u(''), { type: 'payment', data: { id: '1; drop table' } }), null);
  });

  it('lee el pago de la API', () => {
    const p = readPayment({ id: 77, status: 'approved', external_reference: ORDER.id, transaction_amount: 130, currency_id: 'MXN' });
    assert.deepEqual(p, { id: '77', status: 'approved', externalReference: ORDER.id, amountCents: 13000, currency: 'MXN' });
    assert.equal(readPayment({ status: 'approved' }), null);
    assert.equal(readPayment(null), null);
  });

  it('decide si el pedido queda pagado', () => {
    const order = { id: ORDER.id, amountCents: 13000, currency: 'MXN', payWith: 'mercadopago' };
    const pay = (over: Partial<{ status: string; amountCents: number; externalReference: string | null; currency: string }>) => ({
      id: '1',
      status: 'approved',
      externalReference: ORDER.id,
      amountCents: 13000,
      currency: 'MXN',
      ...over,
    });
    assert.deepEqual(decidePayment(pay({}), order), { kind: 'mark_paid' });
    assert.equal(decidePayment(pay({ amountCents: 12999 }), order).kind, 'reject');
    assert.equal(decidePayment(pay({ externalReference: 'otro' }), order).kind, 'reject');
    assert.equal(decidePayment(pay({ currency: 'USD' }), order).kind, 'reject');
    assert.equal(decidePayment(pay({}), null).kind, 'reject');
    assert.equal(decidePayment(pay({}), { ...order, payWith: 'cash' }).kind, 'reject');
    assert.deepEqual(decidePayment(pay({ status: 'pending' }), order), { kind: 'record_only', reason: 'pending' });
    assert.deepEqual(decidePayment(pay({ status: 'refunded' }), order), { kind: 'mark_unpaid', reason: 'refunded' });
  });

  it('resumen de productos', () => {
    assert.equal(summarizeItems([{ name: 'Viva Juice', quantity: 2 }, { name: 'Café', quantity: 1 }]), '2× Viva Juice, 1× Café');
  });
});
