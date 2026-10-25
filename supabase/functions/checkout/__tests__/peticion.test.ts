/**
 * Lo que se lee del cuerpo. La asercion que no es fontaneria: que de aqui
 * NO salga ni un precio.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { itemsParaLaBase, leerPeticion } from '../peticion.ts';

const TIENDA = '22222222-2222-4222-8222-222222222222';

function cuerpo(extra: Record<string, unknown> = {}) {
  return {
    store_id: TIENDA,
    idempotency_key: 'clave-de-prueba-123',
    pickup_at: '2026-09-12T16:30:00.000Z',
    source: 'clv_token',
    items: [{ clover_item_id: 'IT-GREEN', quantity: 2 }],
    ...extra,
  };
}

test('DE AQUI NO SALE NI UN PRECIO, aunque el telefono lo mande', () => {
  // No es una comprobacion: es que el tipo de salida no tiene donde
  // meterlo. Los precios se releen del catalogo en la 0018.
  const lectura = leerPeticion(
    cuerpo({
      items: [
        {
          clover_item_id: 'IT-GREEN',
          quantity: 1,
          price_cents: 1,
          unit_price_cents: 1,
          total_cents: 1,
        },
      ],
      total_cents: 1,
      tax_cents: 0,
    }),
  );

  assert.ok(lectura.ok);
  const serializado = JSON.stringify(itemsParaLaBase(lectura.peticion.items));
  for (const prohibido of ['price', 'cents', 'total', 'tax']) {
    assert.ok(!serializado.includes(prohibido), `se colo "${prohibido}": ${serializado}`);
  }
  assert.deepEqual(JSON.parse(serializado), [
    { clover_item_id: 'IT-GREEN', quantity: 1, note: null, modifiers: [] },
  ]);
});

test('SIN TOKEN NO SE EMPIEZA', () => {
  // Abrir el intento crea un pedido en nuestra base y ocupa una franja de
  // recogida. Descubrir despues que no hay con que cobrar deja basura.
  const lectura = leerPeticion(cuerpo({ source: undefined }));
  assert.ok(!lectura.ok);
  assert.equal(lectura.error, 'source_requerido');
});

test('una clave corta no pasa: es adivinable, y adivinarla da el pedido de otro', () => {
  assert.equal(leerPeticion(cuerpo({ idempotency_key: 'corta' })).ok, false);
  assert.equal(leerPeticion(cuerpo({ idempotency_key: '12345678' })).ok, true);
});

test('lo que no es valido se rechaza con su motivo, no con un 500', () => {
  const casos: Array<[Record<string, unknown> | null, string]> = [
    [null, 'cuerpo_invalido'],
    [cuerpo({ store_id: 'freehold' }), 'store_id_invalido'],
    [cuerpo({ pickup_at: 'mañana' }), 'pickup_at_invalido'],
    [cuerpo({ items: [] }), 'carrito_vacio'],
    [cuerpo({ items: [{ quantity: 1 }] }), 'item_sin_id'],
  ];
  for (const [entrada, esperado] of casos) {
    const lectura = leerPeticion(entrada);
    assert.ok(!lectura.ok, JSON.stringify(entrada));
    assert.equal(lectura.error, esperado);
  }
});

test('la cantidad se recorta a un rango sensato', () => {
  const mil = leerPeticion(cuerpo({ items: [{ clover_item_id: 'IT', quantity: 1000 }] }));
  assert.ok(mil.ok);
  assert.equal(mil.peticion.items[0]!.quantity, 99);

  const cero = leerPeticion(cuerpo({ items: [{ clover_item_id: 'IT', quantity: 0 }] }));
  assert.ok(cero.ok);
  assert.equal(cero.peticion.items[0]!.quantity, 1);
});

test('una propina NEGATIVA es un descuento que nadie autorizo', () => {
  const lectura = leerPeticion(cuerpo({ tip_cents: -500 }));
  assert.ok(lectura.ok);
  assert.equal(lectura.peticion.tipCents, 0);
});
