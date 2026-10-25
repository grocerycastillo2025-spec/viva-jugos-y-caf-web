/**
 * El transporte. Aqui viven las decisiones que cuestan dinero si fallan.
 *
 * Ninguna de estas pruebas toca la red: `fetch` se inyecta. Lo que se
 * comprueba no es que Clover responda, es que NOSOTROS nos comportemos.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CloverApiError, CloverCircuitOpenError, CloverTransportError, redact, redactBody } from '../errors.ts';
import { CloverHttp, type CloverRequest } from '../http.ts';

interface Llamada {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | null;
}

/** Un `fetch` de mentira que devuelve el guion que se le da. */
function fakeFetch(guion: Array<Response | Error>) {
  const llamadas: Llamada[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    llamadas.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    });
    const siguiente = guion.shift();
    if (siguiente === undefined) throw new Error('el guion se quedo corto');
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  }) as unknown as typeof globalThis.fetch;
  return { fn, llamadas };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function nuevoHttp(guion: Array<Response | Error>, extra: Record<string, unknown> = {}) {
  const { fn, llamadas } = fakeFetch(guion);
  const esperas: number[] = [];
  // Reloj falso: dormir no espera, ADELANTA el reloj. Asi el limitador
  // avanza de verdad y la suite no tarda un segundo por prueba.
  let ahora = 1_700_000_000_000;
  const http = new CloverHttp({
    environment: 'sandbox',
    appId: 'P1D7HRWSRKB76',
    fetch: fn,
    now: () => ahora,
    sleep: async (ms) => {
      esperas.push(ms);
      ahora += ms;
    },
    rand: () => 0,
    ...extra,
  });
  return { http, llamadas, esperas };
}

const GET: CloverRequest = {
  api: 'platform',
  method: 'GET',
  path: '/v3/merchants/M1/items',
  auth: { kind: 'bearer', token: 'TOKEN_SECRETO' },
  priority: 'catalog',
  rateKey: 'M1',
};

test('arma la url con el host de la API que declara el endpoint', async () => {
  const { http, llamadas } = nuevoHttp([json({ elements: [] })]);
  await http.request({ ...GET, query: { limit: 100, offset: 0, filter: undefined } });

  const url = new URL(llamadas[0]!.url);
  assert.equal(url.origin, 'https://apisandbox.dev.clover.com');
  assert.equal(url.pathname, '/v3/merchants/M1/items');
  assert.equal(url.searchParams.get('limit'), '100');
  // `undefined` no se manda: `filter=undefined` seria un filtro literal.
  assert.equal(url.searchParams.has('filter'), false);
});

test('cada tipo de auth va en su cabecera y no en otra', async () => {
  const { http, llamadas } = nuevoHttp([json({}), json({}), json({})]);
  await http.request(GET);
  await http.request({ ...GET, api: 'token', auth: { kind: 'apikey', key: 'PAKMS' } });
  await http.request({ ...GET, method: 'POST', auth: { kind: 'none' }, body: { a: 1 } });

  assert.equal(llamadas[0]!.headers.get('authorization'), 'Bearer TOKEN_SECRETO');
  assert.equal(llamadas[1]!.headers.get('apikey'), 'PAKMS');
  assert.equal(llamadas[1]!.headers.get('authorization'), null);
  assert.equal(llamadas[2]!.headers.get('authorization'), null);
  assert.equal(llamadas[2]!.body, '{"a":1}');
});

test('un 429 se reintenta esperando lo que dice retry-after', async () => {
  const { http, llamadas, esperas } = nuevoHttp([
    json({ message: 'slow down' }, 429, { 'retry-after': '3' }),
    json({ elements: [] }),
  ]);

  await http.request(GET);

  assert.equal(llamadas.length, 2);
  // Clover documenta que pedir antes de tiempo ALARGA la espera, asi que
  // el header manda sobre nuestro calculo exponencial.
  assert.ok(esperas[0]! >= 3000, `esperó ${esperas[0]}ms, debía ser >= 3000`);
});

test('un POST SIN clave de idempotencia no se reintenta nunca', async () => {
  // Es la regla que separa "reintentar" de "cobrar dos veces": un 500 no
  // dice si la orden se creó o no.
  const { http, llamadas } = nuevoHttp([json({ m: 'boom' }, 500), json({ id: 'O1' })]);

  await assert.rejects(
    http.request({ ...GET, method: 'POST', body: { a: 1 } }),
    (e: unknown) => e instanceof CloverApiError && e.status === 500,
  );
  assert.equal(llamadas.length, 1, 'no debió reintentarse');
});

test('un POST CON clave de idempotencia si se reintenta, y la manda', async () => {
  const { http, llamadas } = nuevoHttp([json({ m: 'boom' }, 500), json({ id: 'O1' })]);

  const orden = await http.request<{ id: string }>({
    ...GET,
    method: 'POST',
    body: { a: 1 },
    idempotencyKey: 'chk_123',
  });

  assert.equal(orden.id, 'O1');
  assert.equal(llamadas.length, 2);
  assert.equal(llamadas[0]!.headers.get('idempotency-key'), 'chk_123');
  assert.equal(llamadas[1]!.headers.get('idempotency-key'), 'chk_123');
});

test('un 400 no se reintenta y no ensucia la salud del merchant', async () => {
  // Un 400 es nuestro payload, no la sucursal. Si abriera el breaker,
  // un bug nuestro dejaria la tienda aislada.
  const { http, llamadas } = nuevoHttp([json({ message: 'bad' }, 400)]);

  await assert.rejects(http.request(GET), (e: unknown) => {
    assert.ok(e instanceof CloverApiError);
    assert.equal(e.status, 400);
    assert.equal(e.isAuth, false);
    return true;
  });
  assert.equal(llamadas.length, 1);
  assert.equal(http.isolated('M1'), false);
});

test('el breaker aisla al merchant y deja de emitir peticiones', async () => {
  const guion = Array.from({ length: 20 }, () => json({ m: 'boom' }, 503));
  const { http, llamadas } = nuevoHttp(guion, { maxAttempts: 1, breakerThreshold: 3 });

  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(http.request(GET));
  }
  assert.equal(http.isolated('M1'), true);

  await assert.rejects(http.request(GET), CloverCircuitOpenError);
  // La cuarta no llegó a salir: es justo el sentido del breaker, no
  // gastar el techo compartido de 50 req/s en una sucursal enferma.
  assert.equal(llamadas.length, 3);

  // Y aisla solo a esa: otro merchant sigue funcionando.
  assert.equal(http.isolated('M2'), false);
});

test('un fallo de red sin respuesta es CloverTransportError', async () => {
  const { http } = nuevoHttp([new Error('ECONNRESET')], { maxAttempts: 2 });
  await assert.rejects(http.request(GET), (e: unknown) => {
    assert.ok(e instanceof CloverTransportError);
    assert.ok(e.attempts >= 1);
    return true;
  });
});

test('un 204 sin cuerpo no revienta el parseo', async () => {
  const { http } = nuevoHttp([new Response(null, { status: 204 })]);
  assert.equal(await http.request(GET), undefined);
});

test('el mensaje de error nunca lleva el token', async () => {
  // El caso real que da miedo: Clover devuelve un 400 cuyo cuerpo repite
  // la peticion, y ese cuerpo acaba en el gestor de errores.
  const { http } = nuevoHttp([
    json({ message: 'invalid', access_token: 'AAAA1111', source: 'clv_abc123' }, 400),
  ]);

  await assert.rejects(http.request(GET), (e: unknown) => {
    assert.ok(e instanceof CloverApiError);
    assert.doesNotMatch(e.message, /AAAA1111/);
    assert.doesNotMatch(e.message, /clv_abc123/);
    assert.doesNotMatch(e.message, /TOKEN_SECRETO/);
    assert.match(e.message, /redactado/);
    return true;
  });
});

test('redact tapa por clave y tambien por pinta del valor', () => {
  const limpio = redact({
    access_token: 'x',
    anidado: { refresh_token: 'y', nota: 'clv_1ABCdef' },
    numero: '4111111111111111',
    inocente: 'jugo de naranja',
  }) as Record<string, unknown>;

  assert.equal(limpio['access_token'], '[redactado]');
  assert.equal((limpio['anidado'] as Record<string, unknown>)['refresh_token'], '[redactado]');
  // La clave `nota` no es sospechosa, pero el VALOR tiene pinta de token.
  assert.equal((limpio['anidado'] as Record<string, unknown>)['nota'], '[redactado]');
  assert.equal(limpio['numero'], '[redactado]');
  assert.equal(limpio['inocente'], 'jugo de naranja');
});

test('redactBody recorta lo enorme y sobrevive a lo que no es JSON', () => {
  const largo = redactBody(JSON.stringify({ a: 'x'.repeat(5000) }), 100);
  assert.ok(largo.length <= 120);
  assert.match(largo, /recortado/);

  assert.match(redactBody('<html>token clv_abc</html>'), /\[redactado\]/);
});

test('el limite por token son 16/s: la peticion 17 espera turno', async () => {
  // Se mide con trafico transaccional a proposito: es el unico que no
  // tiene cuota propia por encima, asi que lo que le frena es el limite
  // por token y no otra cosa.
  const guion = Array.from({ length: 20 }, () => json({}));
  const { http, esperas, llamadas } = nuevoHttp(guion);
  const pago = { ...GET, priority: 'transactional' } as const;

  for (let i = 0; i < 16; i += 1) await http.request(pago);
  assert.equal(esperas.length, 0, 'las 16 primeras caben en el segundo');

  await http.request(pago);
  assert.ok(esperas.length > 0, 'la 17 debió esperar');
  assert.equal(llamadas.length, 17);
});

test('el trafico transaccional puede robar cuota, el catalogo no', async () => {
  // La cuota de catalogo es el 25 % de 50 = 12,5 req/s. Agotada, un
  // barrido espera; un pago no. Es la regla que protege a quien esta
  // pagando mientras se sincroniza un menu.
  const guion = Array.from({ length: 40 }, () => json({}));
  const { http, esperas } = nuevoHttp(guion);

  for (let i = 0; i < 12; i += 1) await http.request({ ...GET, rateKey: `M${i}` });
  assert.equal(esperas.length, 0);

  // La 13 de catalogo ya no cabe en su cuota.
  await http.request({ ...GET, rateKey: 'MX' });
  const trasCatalogo = esperas.length;
  assert.ok(trasCatalogo > 0, 'el catálogo debió esperar al agotar su cuota');

  // Pero una transaccional pasa igualmente: el global aun tiene margen.
  await http.request({ ...GET, priority: 'transactional', rateKey: 'MY' });
  assert.equal(esperas.length, trasCatalogo, 'lo transaccional no debió esperar');
});

test('un 401 saca X-Clover-Recovery-Available, y sus TRES estados', async () => {
  // Es la unica cabecera que este paquete deja salir en un error, y sale
  // porque manda sobre nuestra fecha estimada de recuperacion. Que
  // `undefined` no se confunda con `false` es la mitad del valor: si
  // Clover dejase de mandarla en algun 401, colapsarlas haria que el
  // worker borrase el token de recuperacion de una conexion sana.
  const casos: Array<[Record<string, string>, boolean | undefined]> = [
    [{ 'x-clover-recovery-available': 'true' }, true],
    [{ 'x-clover-recovery-available': 'TRUE' }, true],
    [{ 'x-clover-recovery-available': 'false' }, false],
    [{}, undefined],
  ];

  for (const [cabeceras, esperado] of casos) {
    const { http } = nuevoHttp([json({ message: 'unauthorized' }, 401, cabeceras)]);
    const err = await http.request(GET).then(
      () => null,
      (e: unknown) => e,
    );
    assert.ok(err instanceof CloverApiError);
    assert.equal(err.status, 401);
    assert.equal(err.recoveryAvailable, esperado, JSON.stringify(cabeceras));
  }
});

test('el 401 no gasta reintentos ni abre el breaker: no es un fallo de la sucursal', async () => {
  // Importa para el worker de refresco: un token muerto tiene que llegar
  // arriba en el primer intento, con la cabecera intacta, para que decida
  // si toca recuperar. Reintentarlo solo retrasaria esa decision.
  const { http, llamadas } = nuevoHttp([
    json({ message: 'unauthorized' }, 401, { 'x-clover-recovery-available': 'true' }),
  ]);
  await assert.rejects(http.request(GET));
  assert.equal(llamadas.length, 1);
  assert.equal(http.isolated(GET.rateKey), false);
});
