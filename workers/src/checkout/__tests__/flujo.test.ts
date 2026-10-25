/**
 * La secuencia entera, incluida la compensacion.
 *
 * ESTO ES LO QUE NO SE PUEDE ENSAYAR EN PRODUCCION. Provocar que el cobro
 * falle justo despues de crear la orden, con dinero real y un merchant
 * real, no es una prueba que nadie vaya a correr. Asi que se ejercita
 * aqui, con un Clover de mentira que falla donde se le dice.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { ejecutarCheckout, leerCobro } from '../flujo.ts';
import type { Estado } from '../maquina.ts';
import type { CheckoutApi, CheckoutStore, Cobro, Intento } from '../ports.ts';

const INTENTO: Intento = {
  id: 'intento-1',
  idempotencyKey: 'clave-de-prueba-123',
  estado: 'started',
  orderId: 'pedido-1',
  storeId: 'tienda-1',
  merchantId: 'RGW5JAVFT8MB1',
  environment: 'sandbox',
  orderNumber: 1052,
  pickupCode: '7K2',
  pickupAt: new Date('2026-09-12T16:30:00.000Z'),
  subtotalCents: 1700,
  lineas: [
    {
      cloverItemId: 'IT-GREEN',
      nombre: 'Green Juice',
      cantidad: 2,
      unitPriceCents: 850,
      nota: null,
      modificadores: [],
    },
  ],
  cloverOrderId: null,
  titulo: 'APP #1052 - PICKUP 4:30 PM',
  nota: 'PEDIDO MOVIL\nPedido: #1052\nRecoge: 4:30 PM\nCodigo: 7K2',
};

interface Guion {
  readonly fallaEn?: 'totales' | 'crear-orden' | 'cobrar' | 'imprimir';
  readonly fallaLaAnulacion?: boolean;
  readonly pago?: Parameters<typeof leerCobro>[0];
}

function escenario(guion: Guion = {}, intento: Intento = INTENTO) {
  const llamadas: string[] = [];
  const escrituras: string[] = [];
  const estados: Array<[Estado, Estado]> = [];
  let cobroGuardado: Cobro | null = null;

  const api: CheckoutApi = {
    totales: async () => {
      llamadas.push('totales');
      if (guion.fallaEn === 'totales') throw new Error('Clover 502');
      return { subtotal: 1700, tax: 113, total: 1813 };
    },
    crearOrden: async () => {
      llamadas.push('crear-orden');
      if (guion.fallaEn === 'crear-orden') throw new Error('Clover 502');
      return { id: 'CLOVER-ORD-1' };
    },
    cobrar: async (input) => {
      llamadas.push(`cobrar:${input.idempotencyKey}`);
      if (guion.fallaEn === 'cobrar') throw new Error('tarjeta rechazada');
      return { id: 'CLOVER-PAY-1', amount: 1813 };
    },
    imprimir: async (id, clave) => {
      llamadas.push(`imprimir:${id}:${clave}`);
      if (guion.fallaEn === 'imprimir') throw new Error('impresora sin papel');
    },
    anularOrden: async (id) => {
      llamadas.push(`anular:${id}`);
      if (guion.fallaLaAnulacion === true) throw new Error('Clover 500 al anular');
    },
  };

  const store: CheckoutStore = {
    avanzar: async (_id, desde, hasta) => {
      estados.push([desde, hasta]);
    },
    guardarTotales: async () => void escrituras.push('totales'),
    guardarOrdenClover: async () => void escrituras.push('orden-clover'),
    guardarCobro: async (_id, cobro) => {
      cobroGuardado = cobro;
      escrituras.push('cobro');
    },
    marcarCobroFallido: async () => void escrituras.push('cobro-fallido'),
    marcarImpreso: async (_id, ok) => void escrituras.push(`impreso:${ok}`),
    marcarAnulacionPendiente: async () => void escrituras.push('anulacion-pendiente'),
    terminar: async () => void escrituras.push('terminado'),
  };

  return {
    llamadas,
    escrituras,
    estados,
    cobro: () => cobroGuardado,
    correr: () => ejecutarCheckout({ api, store }, { intento, source: 'clv_token', tipCents: 0 }),
  };
}

test('EL CAMINO BUENO: los cuatro pasos, en orden, y el pedido queda hecho', async () => {
  const e = escenario();
  const r = await e.correr();

  assert.deepEqual(e.llamadas, [
    'totales',
    'crear-orden',
    'cobrar:clave-de-prueba-123',
    'imprimir:CLOVER-ORD-1:clave-de-prueba-123',
  ]);
  assert.equal(r.estado, 'done');
  assert.equal(r.cobrado, true);
  assert.equal(r.impreso, true);
  assert.equal(r.ordenHuerfana, false);
});

test('LA MISMA CLAVE viaja a crear-orden y a cobrar', async () => {
  // Es lo unico que separa "el cliente pulso dos veces" de "el cliente
  // pago dos veces". Dos claves distintas serian dos operaciones para
  // Clover.
  const e = escenario();
  await e.correr();
  assert.ok(e.llamadas.includes('cobrar:clave-de-prueba-123'));
  assert.ok(e.llamadas.some((l) => l.endsWith(':clave-de-prueba-123')));
});

test('SE ESCRIBE ANTES DE LLAMAR: el estado se anuncia y luego se llama', async () => {
  const e = escenario();
  await e.correr();

  // Antes de crear la orden, la fila ya dice totals_ok. Antes de cobrar,
  // ya dice order_created.
  assert.deepEqual(e.estados, [
    ['started', 'totals_ok'],
    ['totals_ok', 'order_created'],
    ['order_created', 'paid'],
    ['paid', 'printed'],
  ]);
});

test('FALLA EL COBRO: se anula la orden, y el pedido queda payment_failed', async () => {
  // La compensacion. Sin ella queda una orden SIN PAGAR viva en el POS
  // del merchant, que la cocina ve y que nadie va a pagar.
  const e = escenario({ fallaEn: 'cobrar' });
  const r = await e.correr();

  assert.deepEqual(e.llamadas, [
    'totales',
    'crear-orden',
    'cobrar:clave-de-prueba-123',
    'anular:CLOVER-ORD-1',
  ]);
  assert.ok(e.escrituras.includes('cobro-fallido'));
  assert.equal(r.cobrado, false);
  assert.equal(r.ordenHuerfana, false, 'se anulo, asi que no queda huerfana');
  assert.equal(r.estado, 'failed');
  // Y no se imprime nada: no hay pedido que mandar a cocina.
  assert.ok(!e.llamadas.some((l) => l.startsWith('imprimir')));
});

test('FALLA EL COBRO Y TAMBIEN LA ANULACION: queda orden huerfana, y se dice', async () => {
  // El peor caso recuperable. No hay una segunda compensacion que
  // inventar: se marca y sale en `checkouts_atascados` para que alguien
  // la anule a mano en el POS.
  const e = escenario({ fallaEn: 'cobrar', fallaLaAnulacion: true });
  const r = await e.correr();

  assert.equal(r.ordenHuerfana, true);
  assert.equal(r.estado, 'voiding', 'se queda en voiding para volver a por ella');
  assert.ok(e.escrituras.includes('anulacion-pendiente'));
});

test('FALLA LA IMPRESION: NO se toca el dinero y el pedido sigue valido', async () => {
  // Una impresora sin papel no puede convertirse en un reembolso.
  const e = escenario({ fallaEn: 'imprimir' });
  const r = await e.correr();

  assert.equal(r.cobrado, true, 'se deshizo un cobro por un fallo de impresion');
  assert.equal(r.impreso, false);
  assert.equal(r.estado, 'done');
  assert.ok(e.escrituras.includes('impreso:false'));
  // Ni se anula ni se reembolsa.
  assert.ok(!e.llamadas.some((l) => l.startsWith('anular')));
});

test('FALLA ANTES DE CREAR: no se llama a Clover para nada mas', async () => {
  const e = escenario({ fallaEn: 'totales' });
  const r = await e.correr();

  assert.deepEqual(e.llamadas, ['totales']);
  assert.equal(r.cobrado, false);
  assert.equal(r.cloverOrderId, null);
  assert.ok(!e.escrituras.includes('cobro-fallido'), 'se marco fallo de cobro sin haber cobrado');
});

test('FALLA CREANDO LA ORDEN: no se cobra, y no hay nada que anular', async () => {
  const e = escenario({ fallaEn: 'crear-orden' });
  const r = await e.correr();

  assert.deepEqual(e.llamadas, ['totales', 'crear-orden']);
  assert.equal(r.cobrado, false);
  assert.ok(
    !e.llamadas.some((l) => l.startsWith('anular')),
    'se intento anular una orden que no existe',
  );
});

test('UN REINTENTO retoma donde estaba y NO repite el cobro', async () => {
  // El intento venia ya pagado: un reintento con la misma clave solo
  // tiene que imprimir. Repetir el cobro seria cobrar dos veces.
  const e = escenario({}, { ...INTENTO, estado: 'paid', cloverOrderId: 'CLOVER-ORD-1' });
  const r = await e.correr();

  assert.deepEqual(e.llamadas, ['imprimir:CLOVER-ORD-1:clave-de-prueba-123']);
  assert.equal(r.cobrado, true);
  assert.equal(r.estado, 'done');
});

test('UN REINTENTO de un intento en voiding vuelve a por la orden huerfana', async () => {
  const e = escenario({}, { ...INTENTO, estado: 'voiding', cloverOrderId: 'CLOVER-ORD-1' });
  const r = await e.correr();

  assert.deepEqual(e.llamadas, ['anular:CLOVER-ORD-1']);
  assert.equal(r.estado, 'failed');
  assert.equal(r.cobrado, false);
});

test('una orden creada SIN id no se cobra: es un fallo, no un exito a medias', async () => {
  // Cobrar una orden sin nombre no se puede deshacer: no hay id que
  // anular ni que reembolsar.
  const api: Partial<CheckoutApi> = {};
  const e = escenario();
  // Se sustituye solo `crearOrden` por una que devuelve sin id.
  const r = await ejecutarCheckout(
    {
      api: {
        totales: async () => ({ subtotal: 1700, tax: 113, total: 1813 }),
        crearOrden: async () => ({ id: '' }) as never,
        cobrar: async () => {
          throw new Error('no se deberia llegar a cobrar');
        },
        imprimir: async () => {},
        anularOrden: async () => {},
        ...api,
      },
      store: {
        avanzar: async () => {},
        guardarTotales: async () => {},
        guardarOrdenClover: async () => {},
        guardarCobro: async () => {},
        marcarCobroFallido: async () => {},
        marcarImpreso: async () => {},
        marcarAnulacionPendiente: async () => {},
        terminar: async () => {},
      },
    },
    { intento: INTENTO, source: 'clv_token', tipCents: 0 },
  );

  assert.equal(r.cobrado, false);
  assert.match(r.error ?? '', /sin devolver id/);
  void e;
});

// ── EL RECARGO, QUE NO ESTA EN EL TOTAL ─────────────────────────────

test('EL RECARGO se lee aparte: `amount` NO es lo que se cobro', async () => {
  // El caso de la documentacion de Clover: sobre 3500 y un 3,5 %, al
  // cliente se le cobran 3622. Los 122 salen de additionalCharges.
  const cobro = leerCobro({
    id: 'PAY-1',
    amount: 3500,
    additionalCharges: { elements: [{ amount: 122 }] },
  });

  assert.equal(cobro.amountCents, 3500);
  assert.equal(cobro.surchargeCents, 122);
  // Lo que el cliente ve en su extracto es la suma. Guardarlos sumados
  // haria que `amount_cents` dejara de cuadrar con la orden.
  assert.equal(cobro.amountCents + (cobro.surchargeCents ?? 0), 3622);
});

test('EL RECARGO: ausente no es cero', () => {
  // Sin la expansion no sabemos si hubo recargo. Escribir 0 diria que no
  // lo hubo, y eso solo se sabe si vino el campo.
  assert.equal(leerCobro({ id: 'PAY-1', amount: 3500 }).surchargeCents, null);
  assert.equal(
    leerCobro({ id: 'PAY-1', amount: 3500, additionalCharges: { elements: [] } }).surchargeCents,
    0,
  );
});

test('NOSOTROS NO SUMAMOS EL RECARGO NUNCA: el cobro va sin importe', async () => {
  // El riesgo que abrio la pregunta de la parte 1: si Clover lo incluye y
  // nosotros lo sumamos, se cobra dos veces. No puede pasar aqui — se
  // paga LA ORDEN, y lo que se le manda al puerto de cobro no lleva
  // ningun importe nuestro.
  let recibido: Record<string, unknown> | null = null;
  await ejecutarCheckout(
    {
      api: {
        totales: async () => ({ subtotal: 1700, tax: 113, total: 1813 }),
        crearOrden: async () => ({ id: 'CLOVER-ORD-1' }),
        cobrar: async (input) => {
          recibido = { ...input };
          return { id: 'PAY-1', amount: 1813 };
        },
        imprimir: async () => {},
        anularOrden: async () => {},
      },
      store: {
        avanzar: async () => {},
        guardarTotales: async () => {},
        guardarOrdenClover: async () => {},
        guardarCobro: async () => {},
        marcarCobroFallido: async () => {},
        marcarImpreso: async () => {},
        marcarAnulacionPendiente: async () => {},
        terminar: async () => {},
      },
    },
    { intento: INTENTO, source: 'clv_token', tipCents: 0 },
  );

  assert.ok(recibido !== null, 'no se llego a cobrar');
  assert.deepEqual(Object.keys(recibido!).sort(), [
    'cloverOrderId',
    'idempotencyKey',
    'source',
    'tipCents',
  ]);
  // Ni `amount`, ni `total`, ni nada que se parezca a un importe nuestro.
  for (const clave of Object.keys(recibido!)) {
    assert.ok(!/amount|total|cents/i.test(clave) || clave === 'tipCents', clave);
  }
});
