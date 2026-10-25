/**
 * El worker entero, sin red y sin base.
 *
 * Lo que se prueba aqui no es que Clover conteste: es que NOSOTROS nos
 * comportemos cuando algo se rompe en el peor momento. El escenario que
 * justifica todo el diseno —Clover emite el par y nos caemos antes de
 * guardarlo— es imposible de provocar contra el sandbox, porque exige
 * romper el proceso en un instante concreto. Con los puertos falsos se
 * provoca en tres lineas.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { RECOVERY_WINDOW_MS } from '../policy.ts';
import type {
  ClaimInput,
  ClaimedConnection,
  CloverTokenApi,
  ConnectionStore,
  FailurePatch,
  RotationPatch,
  TokenVault,
} from '../ports.ts';
import { runTokenRefresh, type TokenRefreshDeps } from '../worker.ts';

const AHORA = new Date('2026-09-03T12:00:00.000Z');
const DIA = 24 * 60 * 60_000;

/** Un fallo de Clover con la forma que tiene `CloverApiError`. */
class ErrorClover extends Error {
  readonly status: number;
  readonly recoveryAvailable: boolean | undefined;
  // `CloverApiError` los trae, y son justo lo que hace falta para
  // diagnosticar un 401 sin ir probando: el cuerpo dice QUE rechazo
  // Clover, y el request-id es lo que pide su soporte.
  readonly requestId: string | undefined;
  readonly body: string;

  constructor(status: number, recoveryAvailable?: boolean) {
    super(`Clover ${status} en POST /oauth/v2/refresh: {"message":"[redactado]"}`);
    this.status = status;
    this.recoveryAvailable = recoveryAvailable;
    this.requestId = 'req-abc-123';
    this.body = '{"message":"invalid refresh token"}';
  }
}

interface Guion {
  refresh?: (token: string) => Promise<Record<string, unknown>>;
  recovery?: (token: string) => Promise<Record<string, unknown>>;
}

const par = (access: string, refresh: string): Record<string, unknown> => ({
  access_token: access,
  refresh_token: refresh,
});

function escenario(
  opciones: {
    fila?: Partial<ClaimedConnection>;
    guion?: Guion;
    alEscribirFila?: () => void;
  } = {},
) {
  const fila: ClaimedConnection = {
    id: 'conn-1',
    storeId: 'store-1',
    merchantId: 'MID1',
    environment: 'sandbox',
    status: 'connected',
    accessTokenSecretId: 'sec-access',
    accessTokenExpiresAt: new Date(AHORA.getTime() + 5 * 60_000),
    refreshTokenSecretId: 'sec-A',
    recoveryTokenSecretId: 'sec-Z',
    recoveryTokenExpiresAt: new Date(AHORA.getTime() + 7 * DIA),
    consecutiveFailures: 0,
    ...opciones.fila,
  };

  // Vault: lo que hay dentro de cada secreto, de verdad.
  const boveda = new Map<string, string>([
    ['sec-access', 'ACCESS_VIEJO'],
    ['sec-A', 'TOKEN_A'],
    ['sec-Z', 'TOKEN_Z'],
  ]);
  const ilegibles = new Set<string>();
  const creados: string[] = [];
  const borrados: string[] = [];
  const sobrescritos: string[] = [];
  let seq = 0;

  const vault: TokenVault = {
    async read(id) {
      const v = boveda.get(id);
      if (v === undefined || ilegibles.has(id)) throw new Error(`secreto ${id} ilegible`);
      return v;
    },
    async create(_nombre, secreto) {
      seq += 1;
      const id = `sec-nuevo-${seq}`;
      boveda.set(id, secreto);
      creados.push(id);
      return id;
    },
    async update(id, secreto) {
      boveda.set(id, secreto);
      sobrescritos.push(id);
    },
    async destroy(id) {
      boveda.delete(id);
      borrados.push(id);
    },
  };

  const claims: ClaimInput[] = [];
  const rotaciones: RotationPatch[] = [];
  const fallos: FailurePatch[] = [];
  let pendiente = true;

  const store: ConnectionStore = {
    async claimDue(input) {
      claims.push(input);
      if (!pendiente) return [];
      pendiente = false;
      return [fila];
    },
    async applyRotation(_id, patch) {
      opciones.alEscribirFila?.();
      rotaciones.push(patch);
    },
    async markFailure(_id, patch) {
      fallos.push(patch);
    },
  };

  const clover: CloverTokenApi = {
    refresh: async ({ refreshToken }) => {
      const fn = opciones.guion?.refresh;
      if (!fn) throw new Error('el guion no dijo que hace /refresh');
      return (await fn(refreshToken)) as never;
    },
    recovery: async ({ refreshToken }) => {
      const fn = opciones.guion?.recovery;
      if (!fn) throw new ErrorClover(401);
      return (await fn(refreshToken)) as never;
    },
  };

  // `datos` lleva `| undefined` explicito y no solo `?`: con
  // `exactOptionalPropertyTypes` no son lo mismo, y `WorkerLog` puede
  // llamar sin datos.
  const avisos: Array<{
    nivel: string;
    evento: string;
    datos: Readonly<Record<string, unknown>> | undefined;
  }> = [];
  const deps: TokenRefreshDeps = {
    store,
    vault,
    cloverFor: () => clover,
    now: () => AHORA,
    log: {
      info: (evento, datos) => avisos.push({ nivel: 'info', evento, datos }),
      warn: (evento, datos) => avisos.push({ nivel: 'warn', evento, datos }),
      error: (evento, datos) => avisos.push({ nivel: 'error', evento, datos }),
    },
  };

  return {
    deps,
    fila,
    boveda,
    ilegibles,
    creados,
    borrados,
    sobrescritos,
    rotaciones,
    fallos,
    claims,
    avisos,
  };
}

const eventos = (avisos: Array<{ evento: string }>): string[] => avisos.map((a) => a.evento);

// --- El camino normal ------------------------------------------------

test('refresca con margen y deja el token gastado como red', async () => {
  const e = escenario({
    guion: {
      refresh: async (token) => (assert.equal(token, 'TOKEN_A'), par('ACCESS_B', 'TOKEN_B')),
    },
  });

  const resumen = await runTokenRefresh(e.deps);

  assert.deepEqual(resumen, { claimed: 1, refreshed: 1, recovered: 0, degraded: 0, failed: 0 });

  // Se reclama con margen: la frontera es ahora + 10 min, no ahora.
  assert.equal(e.claims[0]!.dueBefore.getTime(), AHORA.getTime() + 10 * 60_000);

  const rot = e.rotaciones[0]!;
  // El refresh nuevo va a un secreto NUEVO...
  assert.equal(rot.refreshTokenSecretId, 'sec-nuevo-1');
  assert.equal(e.boveda.get('sec-nuevo-1'), 'TOKEN_B');
  // ...y el de recuperacion es el que se acaba de mandar.
  assert.equal(rot.recovery.kind, 'apuntar');
  assert.equal(rot.recovery.kind === 'apuntar' && rot.recovery.secretId, 'sec-A');
  assert.equal(
    rot.recovery.kind === 'apuntar' && rot.recovery.expiresAt.getTime(),
    AHORA.getTime() + RECOVERY_WINDOW_MS,
  );
});

test('NUNCA se sobrescribe el secreto del refresh vigente', async () => {
  // Es la regla que sostiene todo lo demas: mientras A siga entero en
  // Vault, hay con que volver. Sobrescribirlo con B destruye la red en el
  // mismo instante en que se crea.
  const e = escenario({ guion: { refresh: async () => par('ACCESS_B', 'TOKEN_B') } });
  await runTokenRefresh(e.deps);

  assert.equal(e.boveda.get('sec-A'), 'TOKEN_A', 'se sobrescribio el token vigente');
  assert.deepEqual(e.sobrescritos, ['sec-access'], 'solo el access se sobrescribe en sitio');
  assert.ok(!e.borrados.includes('sec-A'), 'se borro el token que acaba de ser la red');
  // Y el de recuperacion viejo TAMPOCO se borra, mientras dure el seguro
  // del CLOVER-PENDING: Clover lo mato al aceptar el refresco *segun la
  // respuesta que estamos implementando*, y esa es justo la que esta en
  // duda. Se queda huerfano en Vault hasta que llegue la aclaracion.
  assert.deepEqual(e.borrados, []);
});

test('si la fila no se puede escribir, el token anterior sobrevive entero', async () => {
  // El accidente: Clover ya emitio B y la escritura se cae. Lo unico que
  // importa es que A siga siendo utilizable, porque es lo que Clover
  // tiene como token de recuperacion de B.
  const e = escenario({
    guion: { refresh: async () => par('ACCESS_B', 'TOKEN_B') },
    alEscribirFila: () => {
      throw new Error('la Edge Function se corto');
    },
  });

  const resumen = await runTokenRefresh(e.deps);

  assert.equal(resumen.failed, 1);
  assert.equal(e.boveda.get('sec-A'), 'TOKEN_A');
  assert.deepEqual(e.borrados, [], 'no se borro nada con la fila sin escribir');
  assert.ok(eventos(e.avisos).includes('rotacion_no_persistida'));
});

// --- La red ----------------------------------------------------------

test('tras perder el par, se recupera con el VIGENTE, que es lo que Clover espera', async () => {
  // Continuacion exacta de la prueba anterior, una vuelta despues: la
  // fila sigue diciendo vigente = A y recuperacion = Z (muerto). Un
  // worker que solo probase Z fallaria aqui, que es el unico escenario
  // para el que se construyo la red.
  const e = escenario({
    guion: {
      refresh: async () => {
        throw new ErrorClover(401, true);
      },
      recovery: async (token) => {
        assert.equal(token, 'TOKEN_A', 'se recupero con el token equivocado');
        return par('ACCESS_C', 'TOKEN_C');
      },
    },
  });

  const resumen = await runTokenRefresh(e.deps);

  assert.deepEqual(resumen, { claimed: 1, refreshed: 0, recovered: 1, degraded: 0, failed: 0 });
  const rot = e.rotaciones[0]!;
  assert.equal(rot.refreshTokenSecretId, 'sec-nuevo-1');
  assert.equal(e.boveda.get('sec-nuevo-1'), 'TOKEN_C');
  // El de recuperacion pasa a ser A: el que se mando. "El que acabo de
  // sustituir" habria escrito B, que en este camino ni existe.
  assert.equal(rot.recovery.kind === 'apuntar' && rot.recovery.secretId, 'sec-A');
});

test('LA VENTANA SE REANCLA AL RECUPERAR', async () => {
  // Hasta la 0016 esta prueba afirmaba lo contrario, y no por descuido:
  // la documentacion publica admite las dos lecturas. Clover confirmo que
  // la ventana cuelga de la creacion del par nuevo, asi que una
  // recuperacion la estrena entera igual que un refresco.
  const ventana = new Date(AHORA.getTime() + 2 * DIA);
  const e = escenario({
    fila: { recoveryTokenExpiresAt: ventana },
    guion: {
      refresh: async () => {
        throw new ErrorClover(401, true);
      },
      recovery: async () => par('ACCESS_C', 'TOKEN_C'),
    },
  });

  await runTokenRefresh(e.deps);

  const rot = e.rotaciones[0]!;
  assert.equal(rot.recovery.kind, 'apuntar');
  assert.equal(
    rot.recovery.kind === 'apuntar' && rot.recovery.expiresAt.getTime(),
    AHORA.getTime() + RECOVERY_WINDOW_MS,
  );
});

test('recuperando con el token APUNTADO, el puntero se queda y la fecha se mueve', async () => {
  // El caso de la documentacion: la fila ya apunta a A como recuperacion
  // y el vigente (B) es ilegible. A sigue siendo la red —el puntero no se
  // toca— pero la ventana se reancla al par C que acaba de nacer. Son dos
  // reglas distintas sobre las mismas dos columnas.
  const e = escenario({
    fila: { refreshTokenSecretId: 'sec-B', recoveryTokenSecretId: 'sec-A' },
    guion: {
      recovery: async (token) => {
        assert.equal(token, 'TOKEN_A');
        return par('ACCESS_C', 'TOKEN_C');
      },
    },
  });
  e.boveda.set('sec-B', 'TOKEN_B');
  e.ilegibles.add('sec-B');

  const resumen = await runTokenRefresh(e.deps);

  assert.equal(resumen.recovered, 1);
  const rotApuntado = e.rotaciones[0]!;
  assert.equal(rotApuntado.recovery.kind === 'apuntar' && rotApuntado.recovery.secretId, 'sec-A');
  assert.equal(
    rotApuntado.recovery.kind === 'apuntar' && rotApuntado.recovery.expiresAt.getTime(),
    AHORA.getTime() + RECOVERY_WINDOW_MS,
  );
  // Y B muere: ya no lo referencia nadie.
  assert.deepEqual(e.borrados, ['sec-B']);
  assert.ok(eventos(e.avisos).includes('vault_vigente_ilegible'));
});

test('la ventana vencida NO impide intentar la recuperacion', async () => {
  // Nuestra fecha es una estimacion con nuestro reloj; la autoridad es la
  // cabecera. Si la fecha decidiera, una conexion recuperable se quedaria
  // muerta por un error de calculo nuestro.
  let intentada = false;
  const e = escenario({
    fila: { recoveryTokenExpiresAt: new Date(AHORA.getTime() - 30 * DIA) },
    guion: {
      refresh: async () => {
        throw new ErrorClover(401, true);
      },
      recovery: async () => {
        intentada = true;
        return par('ACCESS_C', 'TOKEN_C');
      },
    },
  });

  const resumen = await runTokenRefresh(e.deps);

  assert.ok(intentada, 'no se intento recuperar por una fecha nuestra');
  assert.equal(resumen.recovered, 1);
  assert.ok(eventos(e.avisos).includes('ventana_vencida_segun_nosotros'));
});

test('sin token de recuperacion apuntado tambien se intenta con el vigente', async () => {
  const e = escenario({
    fila: { recoveryTokenSecretId: null, recoveryTokenExpiresAt: null },
    guion: {
      refresh: async () => {
        throw new ErrorClover(401, true);
      },
      recovery: async (token) => {
        assert.equal(token, 'TOKEN_A');
        return par('ACCESS_C', 'TOKEN_C');
      },
    },
  });

  const resumen = await runTokenRefresh(e.deps);
  assert.equal(resumen.recovered, 1);
  // Se apunta A como red, y con ventana entera: el par C acaba de nacer y
  // la ventana cuelga de el, no de cuanto lleva A por ahi.
  const rot = e.rotaciones[0]!;
  assert.equal(rot.recovery.kind === 'apuntar' && rot.recovery.secretId, 'sec-A');
  assert.equal(
    rot.recovery.kind === 'apuntar' && rot.recovery.expiresAt.getTime(),
    AHORA.getTime() + RECOVERY_WINDOW_MS,
  );
});

test('se prueban los DOS candidatos antes de rendirse', async () => {
  const probados: string[] = [];
  const e = escenario({
    guion: {
      refresh: async () => {
        throw new ErrorClover(401, true);
      },
      recovery: async (token) => {
        probados.push(token);
        if (token === 'TOKEN_Z') return par('ACCESS_C', 'TOKEN_C');
        throw new ErrorClover(401, true);
      },
    },
  });

  const resumen = await runTokenRefresh(e.deps);

  assert.deepEqual(probados, ['TOKEN_A', 'TOKEN_Z'], 'el vigente va primero');
  assert.equal(resumen.recovered, 1);
});

// --- Cuando ya no hay salvacion --------------------------------------

test('la cabecera en false limpia la red y degrada', async () => {
  const e = escenario({
    guion: {
      refresh: async () => {
        throw new ErrorClover(401, false);
      },
      recovery: async () => {
        throw new ErrorClover(401, false);
      },
    },
  });

  const resumen = await runTokenRefresh(e.deps);

  assert.equal(resumen.degraded, 1);
  const fallo = e.fallos[0]!;
  assert.equal(fallo.status, 'degraded');
  assert.equal(fallo.recovery.kind, 'limpiar');
  // Y el secreto muerto se va con ella.
  assert.deepEqual(e.borrados, ['sec-Z']);
  assert.ok(eventos(e.avisos).includes('red_de_recuperacion_perdida'));
});

test('SIN cabecera no se limpia nada: ausente no es "no"', async () => {
  // Si Clover deja de mandar la cabecera en algun 401, colapsar ausente
  // con false tiraria la red de una conexion sana.
  const e = escenario({
    guion: {
      refresh: async () => {
        throw new ErrorClover(401);
      },
      recovery: async () => {
        throw new ErrorClover(401);
      },
    },
  });

  const resumen = await runTokenRefresh(e.deps);

  assert.equal(resumen.degraded, 1);
  assert.equal(e.fallos[0]!.recovery.kind, 'sin-cambios');
  assert.deepEqual(e.borrados, [], 'se borro el token de recuperacion sin que Clover lo dijera');
});

test('un 401 degrada a la primera: no hay token con el que vender', async () => {
  const e = escenario({
    guion: {
      refresh: async () => {
        throw new ErrorClover(401);
      },
    },
  });

  await runTokenRefresh(e.deps);
  assert.equal(e.fallos[0]!.status, 'degraded');
});

test('un fallo de transporte NO degrada a la primera, y espera antes de reintentar', async () => {
  // Un 500 o un timeout no dicen nada del token. Degradar ahi cerraria la
  // tienda por un mal rato de la red.
  const e = escenario({
    guion: {
      refresh: async () => {
        throw new Error('socket hang up');
      },
    },
  });

  const resumen = await runTokenRefresh(e.deps);

  assert.equal(resumen.failed, 1);
  const fallo = e.fallos[0]!;
  assert.equal(fallo.status, 'connected');
  assert.equal(fallo.recovery.kind, 'sin-cambios');
  // El arriendo hacia adelante es el backoff: 1 minuto al primer fallo.
  assert.equal(fallo.leaseUntil.getTime(), AHORA.getTime() + 60_000);
});

test('al tercer fallo seguido si se degrada', async () => {
  const e = escenario({
    fila: { consecutiveFailures: 2 },
    guion: {
      refresh: async () => {
        throw new Error('socket hang up');
      },
    },
  });

  const resumen = await runTokenRefresh(e.deps);
  assert.equal(resumen.degraded, 1);
  assert.equal(e.fallos[0]!.status, 'degraded');
  assert.equal(e.fallos[0]!.leaseUntil.getTime(), AHORA.getTime() + 4 * 60_000);
});

test('una conexion ya degradada se sigue intentando, y vuelve sola', async () => {
  // Si no se reintentara, una conexion degradada se quedaria muerta hasta
  // que alguien la mirase, y la recuperacion es justo para eso.
  const e = escenario({
    fila: { status: 'degraded', consecutiveFailures: 5 },
    guion: { refresh: async () => par('ACCESS_B', 'TOKEN_B') },
  });

  const resumen = await runTokenRefresh(e.deps);
  assert.equal(resumen.refreshed, 1);
  // `applyRotation` la devuelve a 'connected' y pone el contador a cero;
  // eso lo escribe el adaptador, aqui basta con que la rotacion ocurriera.
  assert.equal(e.rotaciones.length, 1);
});

test('un par incompleto no rota NADA', async () => {
  // Mover el puntero del refresh a un secreto sin token es perder la
  // conexion de forma definitiva. Mejor fallar y que la vuelta siguiente
  // encuentre el 401 con la red puesta.
  const e = escenario({
    guion: { refresh: async () => ({ access_token: 'ACCESS_B' }) },
  });

  const resumen = await runTokenRefresh(e.deps);

  assert.equal(resumen.failed, 1);
  assert.equal(e.rotaciones.length, 0);
  assert.equal(e.boveda.get('sec-A'), 'TOKEN_A');
  assert.deepEqual(e.borrados, []);
});

// --- Exclusion mutua -------------------------------------------------

test('el lote se corta antes de que venza el arriendo', async () => {
  // Pasado el arriendo, otra ejecucion puede coger la misma fila, y dos
  // canjes del mismo refresh token dejan la conexion muerta. Con un
  // arriendo mas corto que lo que puede tardar una conexion, no se
  // procesa ninguna.
  const e = escenario({ guion: { refresh: async () => par('ACCESS_B', 'TOKEN_B') } });

  const resumen = await runTokenRefresh(e.deps, { leaseMs: 1_000 });

  assert.deepEqual(resumen, { claimed: 0, refreshed: 0, recovered: 0, degraded: 0, failed: 0 });
  assert.equal(e.rotaciones.length, 0);
  assert.ok(eventos(e.avisos).includes('lote_cortado_por_arriendo'));
});

test('el arriendo que se pide es el que dice la politica', async () => {
  const e = escenario({ guion: { refresh: async () => par('ACCESS_B', 'TOKEN_B') } });
  await runTokenRefresh(e.deps);
  assert.equal(e.claims[0]!.leaseSeconds, 120);
});

// ---------------------------------------------------------------------
// LO QUE SE PUEDE DIAGNOSTICAR DESDE UN LOG
//
// Estas dos no prueban comportamiento: prueban que el 401 deja rastro
// suficiente para no tener que ir probando. `CloverApiError` ya traia el
// cuerpo (redactado en origen) y el request-id, y el worker los tiraba.
// ---------------------------------------------------------------------

test('el refresco_401 deja el cuerpo y el request-id, no solo el evento', async () => {
  const e = escenario({
    guion: {
      refresh: async () => {
        throw new ErrorClover(401, true);
      },
      recovery: async () => par('ACCESS_C', 'TOKEN_C'),
    },
  });

  await runTokenRefresh(e.deps);

  const aviso = e.avisos.find((a) => a.evento === 'refresco_401');
  assert.ok(aviso, 'no se registro el refresco_401');
  // Sin esto, un 401 de "token expirado" y uno de "client_id desconocido"
  // se ven exactamente igual desde fuera.
  assert.equal(aviso.datos?.cuerpo, '{"message":"invalid refresh token"}');
  // Sin esto, abrir un ticket con Clover empieza por reproducirlo.
  assert.equal(aviso.datos?.requestId, 'req-abc-123');
});

test('un 401 de la recuperacion tambien se registra, con que token se intento', async () => {
  // Antes no se registraba: desde fuera, `refresco_401` seguido de
  // `conexion_degradada` no distinguia "se intento recuperar y Clover
  // dijo que no" de "ni se intento".
  const e = escenario({
    guion: {
      refresh: async () => {
        throw new ErrorClover(401);
      },
      recovery: async () => {
        throw new ErrorClover(401, false);
      },
    },
  });

  await runTokenRefresh(e.deps);

  const aviso = e.avisos.find((a) => a.evento === 'recuperacion_401');
  assert.ok(aviso, 'no se registro el recuperacion_401');
  assert.equal(aviso.datos?.con, 'el vigente');
  assert.equal(aviso.datos?.recoveryAvailable, false);
  assert.equal(aviso.datos?.requestId, 'req-abc-123');
});
