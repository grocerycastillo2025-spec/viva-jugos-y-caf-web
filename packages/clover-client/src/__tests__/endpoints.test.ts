/**
 * Que cada llamada vaya al host, la ruta y el cuerpo que documenta Clover.
 *
 * Estas pruebas parecen tontas —comprobar una ruta— y son las que impiden
 * el fallo mas caro de una integracion: mandar la peticion correcta al
 * sitio equivocado. Clover no responde 404 a eso; responde 401, o un HTML
 * de portal. Cada aserto de aqui tiene su fuente en
 * docs/CLOVER-ENDPOINTS.md.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CloverClient } from '../client.ts';
import { collect } from '../pagination.ts';

interface Llamada {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}

function nuevoCliente(respuestas: unknown[] = [{}]) {
  const llamadas: Llamada[] = [];
  const cola = [...respuestas];
  const fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    llamadas.push({
      url: new URL(String(url)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    const cuerpo = cola.length > 1 ? cola.shift() : cola[0];
    return new Response(JSON.stringify(cuerpo ?? {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  let ahora = 1_700_000_000_000;
  const cliente = new CloverClient({
    environment: 'sandbox',
    appId: 'P1D7HRWSRKB76',
    fetch,
    now: () => ahora,
    sleep: async (ms) => {
      ahora += ms;
    },
  });
  return { cliente, llamadas };
}

const TOKEN = 'ACCESO';
const M = 'MERCHANT1';

// --- OAuth -----------------------------------------------------------

test('la url de autorizacion la abre el MERCHANT, y lleva state', () => {
  const { cliente } = nuevoCliente();
  const url = new URL(
    cliente.oauth.authorizeUrl({
      appId: 'P1D7HRWSRKB76',
      redirectUri: 'https://ejemplo.test/clover/callback',
      state: 'abc123',
    }),
  );

  // Host web, no el de la API: son dominios distintos.
  assert.equal(url.origin, 'https://sandbox.dev.clover.com');
  assert.equal(url.pathname, '/oauth/v2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'P1D7HRWSRKB76');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://ejemplo.test/clover/callback');
  // Sin `state` cualquiera puede completar el flujo en nombre de otro.
  assert.equal(url.searchParams.get('state'), 'abc123');
});

test('el canje manda las credenciales en el CUERPO, no en cabecera', async () => {
  const { cliente, llamadas } = nuevoCliente([{ access_token: 'A', refresh_token: 'R' }]);
  await cliente.oauth.exchangeCode({ appId: 'APP', appSecret: 'SECRETO', code: 'CODE' });

  const l = llamadas[0]!;
  assert.equal(l.method, 'POST');
  assert.equal(l.url.pathname, '/oauth/v2/token');
  assert.deepEqual(l.body, { client_id: 'APP', client_secret: 'SECRETO', code: 'CODE' });
  assert.equal(l.headers.get('authorization'), null);
});

test('el refresco no lleva el app secret, solo el refresh token', async () => {
  const { cliente, llamadas } = nuevoCliente([{ access_token: 'A2' }]);
  await cliente.oauth.refresh({ appId: 'APP', refreshToken: 'R1' });

  assert.equal(llamadas[0]!.url.pathname, '/oauth/v2/refresh');
  assert.deepEqual(llamadas[0]!.body, { client_id: 'APP', refresh_token: 'R1' });
});

test('el refresco NO se reintenta: el token es de un solo uso', async () => {
  // Reintentarlo puede invalidar el par que el primer intento si creo, y
  // dejar la conexion del merchant muerta.
  const llamadas: string[] = [];
  const fetch = (async (): Promise<Response> => {
    llamadas.push('x');
    return new Response('{"m":"boom"}', { status: 500 });
  }) as unknown as typeof globalThis.fetch;

  const cliente = new CloverClient({
    environment: 'sandbox',
    appId: 'APP',
    fetch,
    sleep: async () => {},
  });

  await assert.rejects(cliente.oauth.refresh({ appId: 'APP', refreshToken: 'R1' }));
  assert.equal(llamadas.length, 1);
});

test('la recuperacion va al host de PLATAFORMA y lleva el app secret', async () => {
  // El secret es lo que distingue a una app de alta confianza; sin el,
  // Clover no recupera. Y el host: si esto se fuera al web, la respuesta
  // seria un 401 que parece "el token no vale" en vez de "host mal".
  const { cliente, llamadas } = nuevoCliente([{ access_token: 'A3', refresh_token: 'R3' }]);
  await cliente.oauth.recovery({ appId: 'APP', appSecret: 'SECRETO', refreshToken: 'A' });

  const l = llamadas[0]!;
  assert.equal(l.method, 'POST');
  assert.equal(l.url.origin, 'https://apisandbox.dev.clover.com');
  assert.equal(l.url.pathname, '/oauth/v2/recovery');
  assert.deepEqual(l.body, { client_id: 'APP', client_secret: 'SECRETO', refresh_token: 'A' });
  assert.equal(l.headers.get('authorization'), null);
});

test('la recuperacion TAMPOCO se reintenta', async () => {
  // Mismo motivo que el refresco: si Clover llego a emitir el par y se
  // perdio la respuesta, el segundo intento mata el par recien creado.
  const llamadas: string[] = [];
  const fetch = (async (): Promise<Response> => {
    llamadas.push('x');
    return new Response('{"m":"boom"}', { status: 500 });
  }) as unknown as typeof globalThis.fetch;

  const cliente = new CloverClient({
    environment: 'sandbox',
    appId: 'APP',
    fetch,
    sleep: async () => {},
  });

  await assert.rejects(
    cliente.oauth.recovery({ appId: 'APP', appSecret: 'S', refreshToken: 'A' }),
  );
  assert.equal(llamadas.length, 1);
});

// --- Catalogo --------------------------------------------------------

test('los items van paginados y con el filtro por modifiedTime', async () => {
  const { cliente, llamadas } = nuevoCliente([{ elements: [{ id: 'I1' }] }]);
  await collect(cliente.inventory.items(M, TOKEN, { modifiedSinceMs: 1_700_000_000_000 }));

  const l = llamadas[0]!;
  assert.equal(l.url.origin, 'https://apisandbox.dev.clover.com');
  assert.equal(l.url.pathname, '/v3/merchants/MERCHANT1/items');
  assert.equal(l.url.searchParams.get('limit'), '100');
  assert.equal(l.url.searchParams.get('filter'), 'modifiedTime>=1700000000000');
  assert.equal(l.headers.get('authorization'), 'Bearer ACCESO');
});

test('cada recurso del catalogo cuelga de su ruta documentada', async () => {
  const { cliente, llamadas } = nuevoCliente([{ elements: [] }]);

  await collect(cliente.inventory.categories(M, TOKEN));
  await collect(cliente.inventory.modifierGroups(M, TOKEN));
  await collect(cliente.inventory.modifiers(M, TOKEN, 'MG1'));
  await collect(cliente.inventory.taxRates(M, TOKEN));

  assert.deepEqual(
    llamadas.map((l) => l.url.pathname),
    [
      '/v3/merchants/MERCHANT1/categories',
      '/v3/merchants/MERCHANT1/modifier_groups',
      // Los modificadores NO tienen listado plano: cuelgan de su grupo.
      '/v3/merchants/MERCHANT1/modifier_groups/MG1/modifiers',
      '/v3/merchants/MERCHANT1/tax_rates',
    ],
  );
  // Todo el catalogo es GET. Regla 26: Clover manda, nosotros espejamos.
  assert.deepEqual(new Set(llamadas.map((l) => l.method)), new Set(['GET']));
});

test('el catalogo es de solo lectura: no hay un metodo que escriba', () => {
  const metodos = Object.getOwnPropertyNames(
    Object.getPrototypeOf(nuevoCliente().cliente.inventory) as object,
  );
  // Si alguien anade un create/update/delete, esto lo para en la revision.
  for (const m of metodos) {
    assert.doesNotMatch(m, /^(create|update|delete|post|put)/i, `${m} escribe catálogo`);
  }
});

// --- Ordenes ---------------------------------------------------------

test('los totales se piden a Clover, no se calculan aqui', async () => {
  const { cliente, llamadas } = nuevoCliente([{ total: 1075 }]);
  await cliente.orders.checkout({
    merchantId: M,
    token: TOKEN,
    cart: { lineItems: [{ item: { id: 'I1' } }] },
  });

  const l = llamadas[0]!;
  assert.equal(l.url.pathname, '/v3/merchants/MERCHANT1/atomic_order/checkouts');
  assert.deepEqual(l.body, { orderCart: { lineItems: [{ item: { id: 'I1' } }] } });
});

test('crear la orden exige clave de idempotencia y la manda', async () => {
  const { cliente, llamadas } = nuevoCliente([{ id: 'O1' }]);
  await cliente.orders.createAtomicOrder({
    merchantId: M,
    token: TOKEN,
    cart: { lineItems: [{ item: { id: 'I1' } }], title: 'APP #1052 · PICKUP 4:30 PM' },
    idempotencyKey: 'chk_9',
  });

  const l = llamadas[0]!;
  assert.equal(l.method, 'POST');
  assert.equal(l.url.pathname, '/v3/merchants/MERCHANT1/atomic_order/orders');
  assert.equal(l.headers.get('idempotency-key'), 'chk_9');
});

test('print_event manda orderRef, que es lo unico que espera', async () => {
  // Una orden creada por API NO se imprime sola. Sin esta llamada, el
  // pedido esta pagado y la cocina no lo ha visto.
  const { cliente, llamadas } = nuevoCliente([{ id: 'PE1', state: 'CREATED' }]);
  await cliente.orders.print({
    merchantId: M,
    token: TOKEN,
    orderId: 'O1',
    idempotencyKey: 'chk_9',
  });

  const l = llamadas[0]!;
  assert.equal(l.url.pathname, '/v3/merchants/MERCHANT1/print_event');
  assert.deepEqual(l.body, { orderRef: { id: 'O1' } });
});

// --- Cobro -----------------------------------------------------------

test('cobrar va al host de ecommerce y SOBRE la orden', async () => {
  // Regla 27: nunca un charge suelto. Un charge sin orden descuadra los
  // informes del merchant y le impide reembolsar desde su POS.
  const { cliente, llamadas } = nuevoCliente([{ id: 'P1', status: 'succeeded' }]);
  await cliente.ecommerce.payOrder({
    merchantId: M,
    token: TOKEN,
    orderId: 'O1',
    source: 'clv_token',
    idempotencyKey: 'chk_9',
    tipAmount: 200,
  });

  const l = llamadas[0]!;
  assert.equal(l.url.origin, 'https://scl-sandbox.dev.clover.com');
  assert.equal(l.url.pathname, '/v1/orders/O1/pay');
  assert.deepEqual(l.body, { source: 'clv_token', tip_amount: 200 });
  assert.equal(l.headers.get('idempotency-key'), 'chk_9');
});

test('tokenizar usa el host de tokens y la cabecera apikey, no el Bearer', async () => {
  const { cliente, llamadas } = nuevoCliente([{ id: 'clv_1' }]);
  await cliente.ecommerce.tokenizeCard({
    merchantId: M,
    apiAccessKey: 'PUBLICA',
    card: { number: '4111111111111111', exp_month: '12', exp_year: '2030', cvv: '123' },
  });

  const l = llamadas[0]!;
  assert.equal(l.url.origin, 'https://token-sandbox.dev.clover.com');
  assert.equal(l.url.pathname, '/v1/tokens');
  assert.equal(l.headers.get('apikey'), 'PUBLICA');
  assert.equal(l.headers.get('authorization'), null);
});

test('PAKMS devuelve la clave publica, y va con el Bearer del merchant', async () => {
  const { cliente, llamadas } = nuevoCliente([{ apiAccessKey: 'PUBLICA' }]);
  const r = await cliente.ecommerce.apiAccessKey({ merchantId: M, token: TOKEN });

  assert.equal(r.apiAccessKey, 'PUBLICA');
  assert.equal(llamadas[0]!.url.origin, 'https://scl-sandbox.dev.clover.com');
  assert.equal(llamadas[0]!.url.pathname, '/pakms/apikey');
  assert.equal(llamadas[0]!.headers.get('authorization'), 'Bearer ACCESO');
});

test('no existe createCharge: cobrar fuera de una orden no es una opcion', () => {
  const ecommerce = nuevoCliente().cliente.ecommerce as unknown as Record<string, unknown>;
  const proto = Object.getPrototypeOf(ecommerce) as object;
  for (const m of Object.getOwnPropertyNames(proto)) {
    assert.doesNotMatch(m, /charge/i, `${m} cobraría fuera de una orden`);
  }
});

// --- Merchant --------------------------------------------------------

test('las dos llamadas de onboarding van a sus rutas', async () => {
  const { cliente, llamadas } = nuevoCliente([{}]);
  await cliente.merchants.gateway({ merchantId: M, token: TOKEN });
  await cliente.merchants.ecommPaymentConfigs({ merchantId: M, token: TOKEN });

  assert.deepEqual(
    llamadas.map((l) => l.url.pathname),
    ['/v3/merchants/MERCHANT1/gateway', '/v3/merchants/MERCHANT1/ecomm_payment_configs'],
  );
  // Van con prioridad de reconciliacion: son del alta, no del camino de
  // un pago, y no deben robarle presupuesto a quien esta cobrando.
  assert.deepEqual(new Set(llamadas.map((l) => l.method)), new Set(['GET']));
});

test('el merchant se pide por su id, escapado', async () => {
  const { cliente, llamadas } = nuevoCliente([{ id: 'M/1', timezone: 'America/Chicago' }]);
  await cliente.merchants.get({ merchantId: 'M/1', token: TOKEN });
  // Sin escapar, un id con barra se comeria un segmento de la ruta.
  assert.equal(llamadas[0]!.url.pathname, '/v3/merchants/M%2F1');
});
