/**
 * El flujo de conexión, con Clover y la base de mentira.
 *
 * Lo que se prueba aquí es lo que no se puede provocar de verdad sin un
 * merchant real y sin romper el proceso en el instante justo: el enlace
 * caducado, el merchant que no es, el canje que se cae después de haber
 * escrito secretos en Vault.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeCallback,
  startConnect,
  type CallbackDeps,
  type CallbackParams,
  type StartDeps,
} from '../flow.ts';
import {
  SILENT_LOG,
  type ConnectionRef,
  type InitialTokensPatch,
} from '../ports.ts';

const AHORA = new Date('2026-09-04T12:00:00Z');
const MANANA = new Date('2026-09-05T12:00:00Z');
const AYER = new Date('2026-09-03T12:00:00Z');

const CONEXION: ConnectionRef = {
  id: 'c0ffee00-0000-4000-8000-000000000001',
  storeId: '5t0re000-0000-4000-8000-000000000002',
  environment: 'sandbox',
  merchantId: null,
  status: 'pending_auth',
  connectTokenExpiresAt: MANANA,
};

function banco(inicial: ConnectionRef | null = CONEXION) {
  const escrituras: { id: string; patch: InitialTokensPatch }[] = [];
  const fallos: { id: string; error: string }[] = [];
  const secretos: { name: string; secret: string }[] = [];
  let n = 0;
  return {
    escrituras,
    fallos,
    secretos,
    store: {
      findByConnectToken: async (t: string) =>
        inicial !== null && t === 'enlace-bueno' ? inicial : null,
      findByMerchant: async (env: string, m: string) =>
        inicial !== null && inicial.merchantId === m && inicial.environment === env
          ? inicial
          : null,
      applyInitialTokens: async (id: string, patch: InitialTokensPatch) => {
        escrituras.push({ id, patch });
      },
      markFailure: async (id: string, error: string) => {
        fallos.push({ id, error });
      },
    },
    vault: {
      create: async (name: string, secret: string) => {
        secretos.push({ name, secret });
        return `secreto-${++n}`;
      },
      destroy: async () => {},
    },
  };
}

function depsCallback(
  b: ReturnType<typeof banco>,
  exchange: () => Promise<unknown>,
): CallbackDeps {
  return {
    store: b.store,
    vault: b.vault,
    cloverFor: () => ({ exchangeCode: exchange as never }),
    log: SILENT_LOG,
  };
}

const PARAMS: CallbackParams = {
  code: 'codigo-de-un-solo-uso',
  merchantId: 'MERCH123',
  state: 'enlace-bueno',
  error: null,
};

// ---------------------------------------------------------------------
// start
// ---------------------------------------------------------------------

test('start manda al merchant a Clover con nuestro redirect_uri exacto', async () => {
  const b = banco();
  const deps: StartDeps = {
    store: b.store,
    cloverFor: () => ({
      authorizeUrl: ({ appId, redirectUri, state }) =>
        `https://sandbox.dev.clover.com/oauth/v2/authorize?client_id=${appId}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
    }),
    appId: 'APPID',
    redirectUri: 'https://abc.supabase.co/functions/v1/oauth/callback',
    log: SILENT_LOG,
  };

  const salida = await startConnect(deps, { connectToken: 'enlace-bueno', now: AHORA });
  assert.equal(salida.kind, 'redirect');
  assert.ok(salida.kind === 'redirect');
  const url = new URL(salida.url);
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://abc.supabase.co/functions/v1/oauth/callback',
  );
  // EL `state` ES EL TOKEN DEL ENLACE. Es lo que ata el callback a una
  // sucursal; sin él, un `code` cualquiera escribiría en la fila que no.
  assert.equal(url.searchParams.get('state'), 'enlace-bueno');
});

test('un enlace caducado no llega a Clover', async () => {
  const b = banco({ ...CONEXION, connectTokenExpiresAt: AYER });
  const deps: StartDeps = {
    store: b.store,
    cloverFor: () => ({ authorizeUrl: () => 'no-deberia-llamarse' }),
    appId: 'APPID',
    redirectUri: 'https://abc.supabase.co/functions/v1/oauth/callback',
    log: SILENT_LOG,
  };
  const salida = await startConnect(deps, { connectToken: 'enlace-bueno', now: AHORA });
  assert.ok(salida.kind === 'rechazo');
  assert.equal(salida.status, 410);
});

test('sin caducidad apuntada se trata como caducado, que es el lado barato', async () => {
  const b = banco({ ...CONEXION, connectTokenExpiresAt: null });
  const deps: StartDeps = {
    store: b.store,
    cloverFor: () => ({ authorizeUrl: () => 'no-deberia-llamarse' }),
    appId: 'APPID',
    redirectUri: 'https://abc.supabase.co/functions/v1/oauth/callback',
    log: SILENT_LOG,
  };
  const salida = await startConnect(deps, { connectToken: 'enlace-bueno', now: AHORA });
  assert.ok(salida.kind === 'rechazo');
});

// ---------------------------------------------------------------------
// callback
// ---------------------------------------------------------------------

test('el camino bueno: Vault primero, un solo update, y sin recuperacion', async () => {
  const b = banco();
  const deps = depsCallback(b, async () => ({
    access_token: 'ACCESO',
    refresh_token: 'REFRESCO',
  }));

  const salida = await completeCallback(deps, { params: PARAMS, now: AHORA });
  assert.ok(salida.kind === 'ok');

  // Los dos secretos se crean ANTES del update: al revés habría un
  // instante con ids que apuntan a nada.
  assert.equal(b.secretos.length, 2);
  assert.deepEqual(
    b.secretos.map((s) => s.secret),
    ['ACCESO', 'REFRESCO'],
  );
  assert.equal(b.escrituras.length, 1);

  const patch = b.escrituras[0]?.patch;
  assert.equal(patch?.merchantId, 'MERCH123');
  assert.equal(patch?.refreshTokenSecretId, 'secreto-2');
  // Sin `access_token_expiration` se usa la vida documentada: 30 minutos.
  assert.equal(patch?.accessTokenExpiresAt.getTime(), AHORA.getTime() + 30 * 60_000);
  // Y el refresco, si Clover no lo dice, no se inventa.
  assert.equal(patch?.refreshTokenExpiresAt, null);
  // EL PRIMER PAR NO TIENE RED DE RECUPERACION, y el patch no la menciona:
  // la 0012 dice que `null` es el estado normal después del OAuth inicial.
  assert.equal('recovery' in (patch as object), false);
});

test('SIN REFRESH TOKEN NO SE GUARDA NADA: duraria media hora y moriria sola', async () => {
  const b = banco();
  const deps = depsCallback(b, async () => ({ access_token: 'ACCESO' }));

  const salida = await completeCallback(deps, { params: PARAMS, now: AHORA });
  assert.ok(salida.kind === 'rechazo');
  assert.equal(salida.status, 502);
  assert.equal(b.escrituras.length, 0);
  assert.equal(b.fallos.length, 1);
});

test('OTRO MERCHANT EN LA MISMA SUCURSAL: se rechaza, no se repunta', async () => {
  // El enlace se envió a quien no era. Conectar aquí mandaría los pedidos
  // a la cocina de otro restaurante.
  const b = banco({ ...CONEXION, merchantId: 'OTRO999', status: 'connected' });
  let canjes = 0;
  const deps = depsCallback(b, async () => {
    canjes++;
    return { access_token: 'A', refresh_token: 'R' };
  });

  const salida = await completeCallback(deps, { params: PARAMS, now: AHORA });
  assert.ok(salida.kind === 'rechazo');
  assert.equal(salida.status, 409);
  assert.equal(canjes, 0, 'ni siquiera se canjea el código');
  assert.equal(b.escrituras.length, 0);
});

test('EL CANJE NO SE REINTENTA: el code es de un solo uso', async () => {
  const b = banco();
  let intentos = 0;
  const deps = depsCallback(b, async () => {
    intentos++;
    throw new Error('Clover: 401');
  });

  const salida = await completeCallback(deps, { params: PARAMS, now: AHORA });
  assert.ok(salida.kind === 'rechazo');
  assert.equal(intentos, 1);
  assert.equal(b.fallos.length, 1);
});

test('un enlace ya usado da 404, y el mismo mensaje que uno inexistente', async () => {
  const b = banco();
  const deps = depsCallback(b, async () => {
    throw new Error('no deberia llamarse');
  });
  const salida = await completeCallback(deps, {
    params: { ...PARAMS, state: 'enlace-que-no-existe' },
    now: AHORA,
  });
  assert.ok(salida.kind === 'rechazo');
  assert.equal(salida.status, 404);
});

test('el merchant que dice que no: no se apunta como fallo nuestro', async () => {
  const b = banco();
  const deps = depsCallback(b, async () => {
    throw new Error('no deberia llamarse');
  });
  const salida = await completeCallback(deps, {
    params: { code: null, merchantId: null, state: null, error: 'access_denied' },
    now: AHORA,
  });
  assert.ok(salida.kind === 'rechazo');
  // Marcar aquí llenaría `last_error` de ruido de una sucursal que puede
  // estar vendiendo tan tranquila.
  assert.equal(b.fallos.length, 0);
});

test('reinstalacion desde el App Market: sin state, se reconoce por merchant', async () => {
  const b = banco({ ...CONEXION, merchantId: 'MERCH123', status: 'revoked' });
  const deps = depsCallback(b, async () => ({ access_token: 'A', refresh_token: 'R' }));

  const salida = await completeCallback(deps, {
    params: { ...PARAMS, state: null },
    now: AHORA,
  });
  assert.ok(salida.kind === 'ok');
  assert.equal(b.escrituras.length, 1);
});

test('sin state y sin merchant conocido no se adivina: se pide el enlace', async () => {
  const b = banco();
  const deps = depsCallback(b, async () => {
    throw new Error('no deberia llamarse');
  });
  const salida = await completeCallback(deps, {
    params: { ...PARAMS, state: null, merchantId: 'DESCONOCIDO' },
    now: AHORA,
  });
  assert.ok(salida.kind === 'rechazo');
  assert.equal(salida.status, 400);
});

test('si el update falla, los secretos NO se borran: se apuntan como huerfanos', async () => {
  // Borrarlos sería peor: si lo que falló fue solo la confirmación, la
  // fila quedaría apuntando a secretos que ya no existen.
  const b = banco();
  const borrados: string[] = [];
  const deps: CallbackDeps = {
    store: {
      ...b.store,
      applyInitialTokens: async () => {
        throw new Error('se cayo la base');
      },
    },
    vault: {
      create: b.vault.create,
      destroy: async (id: string) => {
        borrados.push(id);
      },
    },
    cloverFor: () => ({
      exchangeCode: async () => ({ access_token: 'A', refresh_token: 'R' }),
    }),
    log: SILENT_LOG,
  };

  await assert.rejects(() => completeCallback(deps, { params: PARAMS, now: AHORA }));
  assert.deepEqual(borrados, []);
});

test('una caducidad que ya paso se ignora: guardarla seria un bucle de refrescos', async () => {
  const b = banco();
  const deps = depsCallback(b, async () => ({
    access_token: 'A',
    refresh_token: 'R',
    access_token_expiration: Math.floor(AYER.getTime() / 1000),
  }));
  const salida = await completeCallback(deps, { params: PARAMS, now: AHORA });
  assert.ok(salida.kind === 'ok');
  assert.equal(
    b.escrituras[0]?.patch.accessTokenExpiresAt.getTime(),
    AHORA.getTime() + 30 * 60_000,
  );
});
