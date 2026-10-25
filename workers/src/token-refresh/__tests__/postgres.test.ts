/**
 * El adaptador de Postgres. Parece fontaneria y tiene dos asertos que no
 * lo son: que `sin-cambios` no mencione siquiera las columnas de la
 * ventana, y que toda rotacion con exito deje la marca de vida de la que
 * vive la deteccion de obsolescencia de la 0016.
 *
 * El SQL que sale de aqui se probo contra un Postgres 16 con las
 * migraciones aplicadas. Lo que estas pruebas fijan es que siga saliendo
 * el mismo.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { postgresConnectionStore, vaultTokenStore, type SqlRunner } from '../postgres.ts';

interface Ejecutada {
  readonly text: string;
  readonly params: readonly unknown[];
}

function espia(respuestas: Array<readonly Record<string, unknown>[]> = []): {
  sql: SqlRunner;
  ejecutadas: Ejecutada[];
} {
  const ejecutadas: Ejecutada[] = [];
  const cola = [...respuestas];
  const sql: SqlRunner = async (text, params) => {
    ejecutadas.push({ text, params });
    return cola.shift() ?? [];
  };
  return { sql, ejecutadas };
}

const AHORA = new Date('2026-09-03T12:00:00.000Z');

test('SIN-CAMBIOS: las columnas de recuperacion no se mencionan siquiera', () => {
  // Ya no hay trigger detras (la 0016 quito el de la 0012), y sigue
  // siendo lo correcto: quien escribe `sin-cambios` es `markFailure`, que
  // no sabe nada nuevo sobre la red. Tocar una columna para decir que no
  // cambia es escribir ruido en la fila.
  const { sql, ejecutadas } = espia();
  return postgresConnectionStore(sql)
    .applyRotation('conn-1', {
      accessTokenSecretId: 'sec-access',
      accessTokenExpiresAt: AHORA,
      refreshTokenSecretId: 'sec-nuevo',
      refreshTokenExpiresAt: null,
      recovery: { kind: 'sin-cambios' },
    })
    .then(() => {
      const { text } = ejecutadas[0]!;
      assert.ok(!text.includes('recovery_token'), text);
      assert.ok(text.includes("status = 'connected'"));
      assert.ok(text.includes('refresh_lease_until = null'));
    });
});

test('APUNTAR: id y fecha van juntos, que es lo que exige el check', async () => {
  const { sql, ejecutadas } = espia();
  await postgresConnectionStore(sql).applyRotation('conn-1', {
    accessTokenSecretId: 'sec-access',
    accessTokenExpiresAt: AHORA,
    refreshTokenSecretId: 'sec-nuevo',
    refreshTokenExpiresAt: null,
    recovery: { kind: 'apuntar', secretId: 'sec-A', expiresAt: AHORA },
  });

  const { text, params } = ejecutadas[0]!;
  assert.ok(text.includes('recovery_token_secret_id = $6'));
  assert.ok(text.includes('recovery_token_expires_at = $7'));
  assert.equal(params[5], 'sec-A');
  assert.equal(params[6], AHORA.toISOString());
});

test('LIMPIAR: las dos a null, nunca una sola', async () => {
  const { sql, ejecutadas } = espia();
  await postgresConnectionStore(sql).markFailure('conn-1', {
    error: 'sin recuperacion',
    status: 'degraded',
    leaseUntil: AHORA,
    recovery: { kind: 'limpiar' },
  });

  const { text } = ejecutadas[0]!;
  assert.ok(text.includes('recovery_token_secret_id = null'));
  assert.ok(text.includes('recovery_token_expires_at = null'));
  assert.ok(text.includes('consecutive_failures = consecutive_failures + 1'));
});

test('el fallo no toca la recuperacion si no se pide', async () => {
  const { sql, ejecutadas } = espia();
  await postgresConnectionStore(sql).markFailure('conn-1', {
    error: 'socket hang up',
    status: 'connected',
    leaseUntil: AHORA,
    recovery: { kind: 'sin-cambios' },
  });
  assert.ok(!ejecutadas[0]!.text.includes('recovery_token'));
});

test('toda rotacion con exito deja la marca de vida, y con el reloj de la BASE', async () => {
  // Es lo unico que distingue un worker que rota de uno que corre,
  // contesta 200 y no consigue rotar nada. Y va con `now()` de Postgres
  // porque la obsolescencia se calcula comparando contra `now()` en la
  // vista de la 0016: mezclar dos relojes en esa resta es pedir que la
  // deriva se lea como salud.
  const { sql, ejecutadas } = espia();
  await postgresConnectionStore(sql).applyRotation('conn-1', {
    accessTokenSecretId: 'sec-access',
    accessTokenExpiresAt: AHORA,
    refreshTokenSecretId: 'sec-nuevo',
    refreshTokenExpiresAt: null,
    recovery: { kind: 'apuntar', secretId: 'sec-A', expiresAt: AHORA },
  });

  assert.match(ejecutadas[0]!.text, /last_refresh_success_at = now\(\)/);
  // En el mismo `update` que los punteros. Un segundo statement puede no
  // llegar a ejecutarse, y entonces una rotacion buena pareceria no haber
  // ocurrido nunca.
  assert.equal(ejecutadas.length, 1);
});

test('un FALLO no deja marca de vida', async () => {
  // Si `markFailure` la escribiera, una conexion que falla cada cinco
  // minutos se veria eternamente fresca y la deteccion de obsolescencia
  // no detectaria nada.
  const { sql, ejecutadas } = espia();
  await postgresConnectionStore(sql).markFailure('conn-1', {
    error: 'socket hang up',
    status: 'connected',
    leaseUntil: AHORA,
    recovery: { kind: 'sin-cambios' },
  });
  assert.ok(!ejecutadas[0]!.text.includes('last_refresh_success_at'));
});

test('el claim llama a la funcion de la 0013, no a una consulta suelta', async () => {
  // Seleccionar y reservar tienen que ser el mismo statement: entre uno y
  // otro cabe la otra ejecucion del worker, y dos canjes del mismo
  // refresh token dejan la conexion muerta.
  const { sql, ejecutadas } = espia([
    [
      {
        id: 'conn-1',
        store_id: 'store-1',
        merchant_id: 'MID1',
        environment: 'sandbox',
        status: 'degraded',
        access_token_secret_id: null,
        access_token_expires_at: '2026-09-03T12:05:00.000Z',
        refresh_token_secret_id: 'sec-A',
        recovery_token_secret_id: null,
        recovery_token_expires_at: null,
        consecutive_failures: 2,
      },
    ],
  ]);

  const filas = await postgresConnectionStore(sql).claimDue({
    dueBefore: AHORA,
    leaseSeconds: 120,
    limit: 5,
  });

  assert.match(ejecutadas[0]!.text, /app\.claim_clover_connections_for_refresh/);
  assert.deepEqual(ejecutadas[0]!.params, [AHORA.toISOString(), 120, 5]);

  const fila = filas[0]!;
  assert.equal(fila.status, 'degraded');
  assert.equal(fila.accessTokenSecretId, null);
  assert.equal(fila.accessTokenExpiresAt?.toISOString(), '2026-09-03T12:05:00.000Z');
  assert.equal(fila.consecutiveFailures, 2);
});

test('Vault: el SECRETO va primero en create_secret', async () => {
  // La firma es (new_secret, new_name, new_description). Cambiarlos de
  // sitio no da error: guarda el nombre como secreto, y el fallo aparece
  // media hora despues, cuando el token que se lee resulta ser una ruta.
  const { sql, ejecutadas } = espia([[{ id: 'sec-nuevo' }]]);
  const id = await vaultTokenStore(sql).create('clover/store-1/refresh/1', 'TOKEN_B');

  assert.equal(id, 'sec-nuevo');
  assert.equal(ejecutadas[0]!.params[0], 'TOKEN_B');
  assert.equal(ejecutadas[0]!.params[1], 'clover/store-1/refresh/1');
});

test('Vault: leer usa la vista descifrada, no la tabla', async () => {
  const { sql, ejecutadas } = espia([[{ decrypted_secret: 'TOKEN_A' }]]);
  assert.equal(await vaultTokenStore(sql).read('sec-A'), 'TOKEN_A');
  assert.match(ejecutadas[0]!.text, /vault\.decrypted_secrets/);
});

test('Vault: un secreto que no esta no devuelve vacio, falla', async () => {
  // Devolver '' haria que mandasemos una cadena vacia a Clover y
  // leyesemos el 401 como "el token murio", cuando lo que pasa es que no
  // hay token. Son cosas distintas y llevan a acciones distintas.
  const { sql } = espia([[]]);
  await assert.rejects(vaultTokenStore(sql).read('sec-fantasma'), /no existe en Vault/);
});
