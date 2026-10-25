/**
 * DOS RECUPERACIONES SEGUIDAS, CONTRA EL SQL DE VERDAD.
 *
 * QUE FIJA ESTA PRUEBA, Y POR QUE NO LO FIJA NINGUNA OTRA
 *
 * `chain.test.ts` prueba el planificador y `worker.test.ts` prueba el
 * bucle con un almacen de mentira. Las dos se quedan cortas para la
 * pregunta que trajo Clover: cuando una conexion sobrevive a base de
 * recuperaciones ENCADENADAS —A -> par C, y luego A -> par D—, ¿que acaba
 * escrito en la fila?
 *
 * Aqui el almacen es el adaptador real (`postgresConnectionStore` y
 * `vaultTokenStore`) sobre un espia de `SqlRunner`, el mismo patron que
 * `postgres.test.ts`. Asi las aserciones no son sobre un objeto de patch
 * intermedio sino sobre EL `update` QUE SE MANDARIA A POSTGRES, que es lo
 * unico que la base va a ver.
 *
 * LAS TRES REGLAS QUE SE COMPRUEBAN DESPUES DE CADA RECUPERACION
 *
 *   1. el token de recuperacion designado sigue siendo A. No el par nuevo,
 *      no el que se sustituye. Es el fallo de la familia de
 *      `applyInitialTokens`: un puntero que se repunta "por simetria" a lo
 *      recien emitido deja la fila prometiendo una red que no existe;
 *   2. el refresh anterior queda invalidado y su secreto se borra de
 *      Vault. En la primera vuelta muere B; en la segunda, C;
 *   3. la ventana se reancla al par nuevo: `ahora + 2 semanas` cada vez.
 *      Esto es lo que cambio la 0016 — antes la fecha se heredaba y una
 *      cadena de recuperaciones envejecia hasta parecer vencida.
 *
 * Y UNA TERCERA VUELTA que no es una recuperacion: el refresco normal de
 * despues. Esa es la unica que separa las dos respuestas que Clover ha
 * dado sobre la cadena (ver el CLOVER-PENDING de `chain.ts`), asi que es
 * la que hay que tener escrita: encadenar recuperaciones no las separa,
 * porque ahi siempre se manda A.
 *
 * EL ESCENARIO
 *
 *   parte de   vigente = B (muerto),  recuperacion = A
 *   vuelta 1   /refresh con B -> 401;  /recovery con B -> 401;
 *              /recovery con A -> par C.   fila: vigente = C, recup = A
 *   vuelta 2   una semana despues, lo mismo: /recovery con A -> par D.
 *              fila: vigente = D, recup = A
 *
 * Que se prueben B y luego A en cada vuelta no es ruido: es la regla del
 * worker de intentar primero con el vigente, que cubre el accidente
 * frecuente (ver la cabecera de `worker.ts`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { RECOVERY_WINDOW_MS } from '../policy.ts';
import { postgresConnectionStore, vaultTokenStore, type SqlRunner } from '../postgres.ts';
import type { CloverTokenApi, WorkerLog } from '../ports.ts';
import { runTokenRefresh } from '../worker.ts';

const DIA = 24 * 60 * 60_000;

interface Ejecutada {
  readonly text: string;
  readonly params: readonly unknown[];
}

/**
 * El espia, con lo justo de Postgres para que el adaptador real funcione.
 *
 * No es una base: es un despachador por texto de SQL sobre una fila y un
 * mapa de secretos. Lo unico que le pedimos es contestar lo bastante bien
 * como para que el worker pueda dar DOS vueltas seguidas, y guardar cada
 * statement tal cual para poder afirmar sobre el.
 *
 * Ojo con el orden de `vault.create_secret`: la firma es
 * `(new_secret, new_name, ...)`, o sea que el SECRETO va primero. Aqui se
 * lee igual que en produccion para que un cambio de orden en el adaptador
 * salga aqui y no media hora despues en un incidente.
 */
function espiaDePostgres(fila: Record<string, unknown>): {
  sql: SqlRunner;
  ejecutadas: Ejecutada[];
  fila: Record<string, unknown>;
  secretos: Map<string, string>;
  borrados: string[];
  reclamable: boolean;
} {
  const ejecutadas: Ejecutada[] = [];
  const secretos = new Map<string, string>();
  const borrados: string[] = [];
  const estado = { fila, reclamable: true };
  let siguienteId = 0;

  const sql: SqlRunner = async (text, params) => {
    ejecutadas.push({ text, params });

    if (text.includes('claim_clover_connections_for_refresh')) {
      if (!estado.reclamable) return [];
      // Una sola fila por vuelta: el arriendo de la 0013 hace que la
      // segunda llamada de la misma vuelta no devuelva nada.
      estado.reclamable = false;
      return [{ ...estado.fila }];
    }

    if (text.includes('vault.decrypted_secrets')) {
      const valor = secretos.get(String(params[0]));
      return valor === undefined ? [] : [{ decrypted_secret: valor }];
    }

    if (text.includes('vault.create_secret')) {
      const id = `sec-nuevo-${++siguienteId}`;
      secretos.set(id, String(params[0])); // el SECRETO va primero
      return [{ id }];
    }

    if (text.includes('vault.update_secret')) {
      secretos.set(String(params[0]), String(params[1]));
      return [];
    }

    if (text.includes('delete from vault.secrets')) {
      const id = String(params[0]);
      borrados.push(id);
      secretos.delete(id);
      return [];
    }

    if (text.includes('update public.clover_connections')) {
      aplicarUpdate(estado.fila, text, params);
      return [];
    }

    throw new Error(`El espia no sabe contestar a: ${text}`);
  };

  return {
    sql,
    ejecutadas,
    get fila() {
      return estado.fila;
    },
    secretos,
    borrados,
    get reclamable() {
      return estado.reclamable;
    },
    set reclamable(v: boolean) {
      estado.reclamable = v;
    },
  };
}

/**
 * Aplica a la fila en memoria las asignaciones `columna = $n` del update.
 *
 * Solo entiende asignaciones a parametro y a `null`, que es todo lo que
 * el adaptador escribe en las columnas que aqui importan. Lo demas
 * (`now()`, `consecutive_failures + 1`, literales) se ignora a proposito:
 * esta prueba afirma sobre el SQL emitido, no sobre una simulacion de
 * Postgres, y una simulacion mas lista solo daria mas sitios donde
 * equivocarse.
 */
function aplicarUpdate(
  fila: Record<string, unknown>,
  text: string,
  params: readonly unknown[],
): void {
  for (const [, columna, indice] of text.matchAll(/(\w+)\s*=\s*\$(\d+)/g)) {
    fila[columna!] = params[Number(indice) - 1];
  }
  for (const [, columna] of text.matchAll(/(\w+)\s*=\s*null\b/g)) {
    fila[columna!] = null;
  }
}

const SILENCIO: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

/** El ultimo `update` sobre la tabla, que es el que escribe la rotacion. */
function ultimaRotacion(ejecutadas: readonly Ejecutada[]): Ejecutada {
  const rotaciones = ejecutadas.filter((e) =>
    e.text.includes('update public.clover_connections set access_token_secret_id'),
  );
  assert.ok(rotaciones.length > 0, 'no se escribio ninguna rotacion');
  return rotaciones[rotaciones.length - 1]!;
}

/** El valor que el `update` asigna a una columna, resolviendo el `$n`. */
function valorEscrito(ejecutada: Ejecutada, columna: string): unknown {
  const m = new RegExp(`${columna}\\s*=\\s*\\$(\\d+)`).exec(ejecutada.text);
  assert.ok(m !== null, `el update no escribe ${columna}: ${ejecutada.text}`);
  return ejecutada.params[Number(m[1]) - 1];
}

test('DOS RECUPERACIONES ENCADENADAS: A sigue siendo la red, y la ventana se reancla', async () => {
  const espia = espiaDePostgres({
    id: 'conn-1',
    store_id: 'store-1',
    merchant_id: 'MID1',
    environment: 'sandbox',
    status: 'degraded',
    access_token_secret_id: 'sec-access',
    access_token_expires_at: '2026-09-03T12:01:00.000Z',
    // El par que se perdio: la fila lo da por vigente y Clover ya lo mato.
    refresh_token_secret_id: 'sec-B',
    recovery_token_secret_id: 'sec-A',
    recovery_token_expires_at: '2026-09-10T00:00:00.000Z',
    consecutive_failures: 1,
  });

  espia.secretos.set('sec-access', 'ACCESS_VIEJO');
  espia.secretos.set('sec-A', 'TOKEN_A');
  espia.secretos.set('sec-B', 'TOKEN_B');

  // Clover: el refresco falla siempre (el vigente esta muerto) y la
  // recuperacion solo acepta A, que es el token de recuperacion designado
  // y lo sigue siendo despues de cada recuperacion.
  const emitidos: string[] = [];
  const recuperadosCon: string[] = [];
  const refrescadosCon: string[] = [];
  // Las dos primeras vueltas el vigente esta muerto; en la tercera ya no.
  let refrescoFunciona = false;
  const api: CloverTokenApi = {
    refresh: async ({ refreshToken }) => {
      if (!refrescoFunciona) {
        throw Object.assign(new Error('401'), { status: 401, recoveryAvailable: true });
      }
      refrescadosCon.push(refreshToken);
      return { access_token: 'ACCESS_E', refresh_token: 'TOKEN_E' };
    },
    recovery: async ({ refreshToken }) => {
      recuperadosCon.push(refreshToken);
      if (refreshToken !== 'TOKEN_A') {
        throw Object.assign(new Error('401'), { status: 401, recoveryAvailable: true });
      }
      const nuevo = emitidos.length === 0 ? 'TOKEN_C' : 'TOKEN_D';
      emitidos.push(nuevo);
      return { access_token: `ACCESS_${nuevo.slice(-1)}`, refresh_token: nuevo };
    },
  };

  let ahora = new Date('2026-09-03T12:00:00.000Z');
  const deps = {
    store: postgresConnectionStore(espia.sql),
    vault: vaultTokenStore(espia.sql),
    cloverFor: () => api,
    now: () => ahora,
    log: SILENCIO,
  };

  // ── VUELTA 1: A -> par C ──────────────────────────────────────────
  const primera = await runTokenRefresh(deps);
  assert.equal(primera.recovered, 1, 'la primera recuperacion no llego a escribirse');

  // Se probo el vigente antes que el apuntado. No es un detalle de orden:
  // es la regla que cubre el accidente frecuente.
  assert.deepEqual(recuperadosCon, ['TOKEN_B', 'TOKEN_A']);

  const rot1 = ultimaRotacion(espia.ejecutadas);
  const secretoC = valorEscrito(rot1, 'refresh_token_secret_id');

  // 1. El puntero de recuperacion NO se movio al par nuevo.
  assert.equal(valorEscrito(rot1, 'recovery_token_secret_id'), 'sec-A');
  assert.notEqual(valorEscrito(rot1, 'recovery_token_secret_id'), secretoC);
  assert.equal(espia.secretos.get('sec-A'), 'TOKEN_A', 'A dejo de existir en Vault');

  // 2. El refresh anterior queda invalidado: B se borra.
  assert.deepEqual(espia.borrados, ['sec-B']);
  assert.equal(espia.secretos.has('sec-B'), false);

  // 3. La ventana se reancla al par C.
  assert.equal(
    valorEscrito(rot1, 'recovery_token_expires_at'),
    new Date(ahora.getTime() + RECOVERY_WINDOW_MS).toISOString(),
  );

  // Y la marca de vida, que es de lo que vive la deteccion de obsolescencia.
  assert.match(rot1.text, /last_refresh_success_at = now\(\)/);

  // ── VUELTA 2: una semana despues, A -> par D ──────────────────────
  //
  // La fila ya dice vigente = C. Se vuelve a caer el refresco y se vuelve
  // a recuperar con A, que sigue siendo el token designado.
  ahora = new Date(ahora.getTime() + 7 * DIA);
  espia.reclamable = true;
  espia.fila['access_token_expires_at'] = new Date(ahora.getTime() + 60_000).toISOString();

  const segunda = await runTokenRefresh(deps);
  assert.equal(segunda.recovered, 1, 'la segunda recuperacion no llego a escribirse');
  assert.deepEqual(emitidos, ['TOKEN_C', 'TOKEN_D']);

  const rot2 = ultimaRotacion(espia.ejecutadas);
  const secretoD = valorEscrito(rot2, 'refresh_token_secret_id');
  assert.notEqual(secretoD, secretoC, 'el par nuevo reutilizo el secreto del anterior');

  // 1. Otra vez A, dos recuperaciones despues.
  assert.equal(valorEscrito(rot2, 'recovery_token_secret_id'), 'sec-A');
  assert.notEqual(valorEscrito(rot2, 'recovery_token_secret_id'), secretoD);

  // 2. Ahora muere C, y A sigue sin tocarse.
  assert.deepEqual(espia.borrados, ['sec-B', secretoC]);
  assert.equal(espia.secretos.get('sec-A'), 'TOKEN_A', 'se borro la red en la segunda vuelta');

  // 3. La ventana se reancla otra vez, ahora al par D. Bajo la regla
  //    anterior aqui seguiria la fecha del par que se perdio hace una
  //    semana, y el SaaS la ensenaria a punto de vencer.
  assert.equal(
    valorEscrito(rot2, 'recovery_token_expires_at'),
    new Date(ahora.getTime() + RECOVERY_WINDOW_MS).toISOString(),
  );
  assert.equal(
    espia.fila['recovery_token_expires_at'],
    new Date(ahora.getTime() + RECOVERY_WINDOW_MS).toISOString(),
  );

  // ── VUELTA 3: el refresco NORMAL de despues ───────────────────────
  //
  // AQUI ES DONDE LAS DOS RESPUESTAS DE CLOVER DIVERGEN, y por eso esta
  // vuelta existe. La fila dice vigente = D, recuperacion = A.
  //
  //   respuesta 2 (la implementada)  recuperacion := D, ventana fresca
  //   respuesta 1 (anterior)         A seguiria siendo la red — o el
  //                                  refresco habria cerrado la ventana
  //
  // Encadenar recuperaciones no separa las dos respuestas: alli siempre
  // se manda A y las dos apuntan a A. Esta vuelta si las separa.
  refrescoFunciona = true;
  ahora = new Date(ahora.getTime() + 60_000);
  espia.reclamable = true;
  espia.fila['access_token_expires_at'] = new Date(ahora.getTime() + 60_000).toISOString();

  const tercera = await runTokenRefresh(deps);
  assert.equal(tercera.refreshed, 1, 'el refresco normal no llego a escribirse');
  assert.deepEqual(refrescadosCon, ['TOKEN_D'], 'no se mando el refresh vigente');

  const rot3 = ultimaRotacion(espia.ejecutadas);
  // El puntero se mueve al token que se acaba de CONSUMIR, que es D.
  assert.equal(valorEscrito(rot3, 'recovery_token_secret_id'), secretoD);
  assert.notEqual(valorEscrito(rot3, 'recovery_token_secret_id'), 'sec-A');
  assert.equal(
    valorEscrito(rot3, 'recovery_token_expires_at'),
    new Date(ahora.getTime() + RECOVERY_WINDOW_MS).toISOString(),
  );

  // Y A NO SE BORRA, que es justo lo que compra el seguro.
  //
  // La fila deja de referenciarlo, asi que sin el seguro este era el
  // momento en que el worker destruia el unico token con el que esa
  // conexion podria volver si la respuesta 1 acaba siendo la buena. Se
  // queda huerfano en Vault: feo, inofensivo, y reversible.
  assert.deepEqual(espia.borrados, ['sec-B', secretoC]);
  assert.equal(espia.secretos.get('sec-A'), 'TOKEN_A', 'el seguro no conservo A');
});
