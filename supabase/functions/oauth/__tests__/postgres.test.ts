/**
 * El adaptador de Postgres del callback. Igual que el del worker: lo que
 * se fija aqui es el SQL que sale.
 *
 * La asercion que no es fontaneria: que una RECONEXION corte la cadena de
 * recuperacion. `applyInitialTokens` es un `update` sobre una fila que
 * puede venir de una autorizacion anterior, y esa cadena vieja apunta a
 * tokens que ya no sirven.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { postgresConnectStore, type SqlRunner } from '../postgres.ts';

interface Ejecutada {
  readonly text: string;
  readonly params: readonly unknown[];
}

function espia(): { sql: SqlRunner; ejecutadas: Ejecutada[] } {
  const ejecutadas: Ejecutada[] = [];
  const sql: SqlRunner = async (text, params) => {
    ejecutadas.push({ text, params });
    return [];
  };
  return { sql, ejecutadas };
}

const PATCH = {
  merchantId: 'MID1',
  accessTokenSecretId: 'sec-access',
  accessTokenExpiresAt: new Date('2026-09-06T12:00:00.000Z'),
  refreshTokenSecretId: 'sec-refresh',
  refreshTokenExpiresAt: new Date('2026-09-20T12:00:00.000Z'),
};

test('UNA RECONEXION CORTA LA CADENA DE RECUPERACION', async () => {
  // El caso real que lo motiva: rotar el App Secret desautoriza la app, el
  // merchant vuelve a autorizar, y esta fila ya traia un
  // `recovery_token_secret_id` de la autorizacion anterior. Ese token no
  // sirve para nada: pertenece a una autorizacion que ya no existe.
  const { sql, ejecutadas } = espia();
  await postgresConnectStore(sql).applyInitialTokens('conn-1', PATCH);

  const texto = ejecutadas[0]!.text;
  assert.match(texto, /recovery_token_secret_id\s*=\s*null/);
  assert.match(texto, /recovery_token_expires_at\s*=\s*null/);
});

test('los dos nulos a la vez: lo exige el check de la 0012', async () => {
  // `check ((recovery_token_secret_id is null) = (recovery_token_expires_at
  // is null))`. Anular uno solo lo rechaza la base.
  const { sql, ejecutadas } = espia();
  await postgresConnectStore(sql).applyInitialTokens('conn-1', PATCH);

  const texto = ejecutadas[0]!.text;
  const unSoloNulo =
    /recovery_token_secret_id\s*=\s*null/.test(texto) !==
    /recovery_token_expires_at\s*=\s*null/.test(texto);
  assert.equal(unSoloNulo, false, 'se anula una columna de recuperacion sin la otra');
});

test('EL CANJE DE OAUTH DEJA MARCA DE VIDA: es un par nuevo tambien', async () => {
  // Sin esto, `refresh_stale` (0016) da true desde el minuto cero de una
  // sucursal recien conectada: su regla es "null cuenta como obsoleta", y
  // en una conexion vieja null significa que el worker no la ha tocado
  // nunca. El worker lo corregiria en cinco minutos, pero una deteccion
  // que enseña en rojo cada sucursal recien conectada es una deteccion
  // que el operador aprende a ignorar.
  const { sql, ejecutadas } = espia();
  await postgresConnectStore(sql).applyInitialTokens('conn-1', PATCH);

  const texto = ejecutadas[0]!.text;
  // Con `now()` de la BASE, no con el reloj de la Edge Function: la
  // obsolescencia se calcula comparando contra `now()` en la vista, y
  // mezclar dos relojes en esa resta es pedir que la deriva se lea como
  // salud. Mismo criterio que el worker de refresco.
  assert.match(texto, /last_refresh_success_at\s*=\s*now\(\)/);
});

test('un FALLO del canje no deja marca de vida', async () => {
  // `markFailure` se llama cuando alguien se equivoca de enlace, y esa
  // sucursal puede estar vendiendo con tokens buenos. Escribir la marca
  // ahi diria que algo funciono cuando lo que hubo fue un error.
  const { sql, ejecutadas } = espia();
  await postgresConnectStore(sql).markFailure('conn-1', 'enlace caducado');
  assert.ok(!ejecutadas[0]!.text.includes('last_refresh_success_at'));
});

test('el enlace se consume: sigue siendo de un solo uso', async () => {
  const { sql, ejecutadas } = espia();
  await postgresConnectStore(sql).applyInitialTokens('conn-1', PATCH);

  const texto = ejecutadas[0]!.text;
  assert.match(texto, /connect_token\s*=\s*null/);
  assert.match(texto, /connect_token_expires_at\s*=\s*null/);
});

test('la conexion queda limpia: connected y sin fallos arrastrados', async () => {
  // Reconectar despues de una degradacion tiene que borrar el rastro, o el
  // SaaS seguiria ensenando el error que ya se arreglo.
  const { sql, ejecutadas } = espia();
  await postgresConnectStore(sql).applyInitialTokens('conn-1', PATCH);

  const texto = ejecutadas[0]!.text;
  assert.match(texto, /status\s*=\s*'connected'/);
  assert.match(texto, /consecutive_failures\s*=\s*0/);
  assert.match(texto, /last_error\s*=\s*null/);
});
