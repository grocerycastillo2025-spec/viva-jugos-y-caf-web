/**
 * La única puerta de esta función.
 *
 * Se despliega con `verify_jwt = false` —el razonamiento está en
 * `auth.ts`— así que esto no es defensa en profundidad: es LA defensa. Si
 * `authorizeCronRequest` deja pasar algo que no debe, el endpoint queda
 * abierto a internet.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCronSecret,
  authorizeCronRequest,
  CronSecretError,
  MIN_SECRET_CHARS,
} from '../auth.ts';

const SECRETO = 'x'.repeat(MIN_SECRET_CHARS);

test('pasa el Bearer correcto, y nada mas', () => {
  assert.deepEqual(authorizeCronRequest(`Bearer ${SECRETO}`, SECRETO), { ok: true });
  // El esquema no distingue mayusculas (RFC 7235); el secreto si.
  assert.deepEqual(authorizeCronRequest(`bearer ${SECRETO}`, SECRETO), { ok: true });
});

test('NO PASA: sin cabecera, otro esquema, otro secreto', () => {
  for (const cabecera of [
    null,
    '',
    SECRETO, // el secreto a pelo, sin esquema
    `Basic ${SECRETO}`,
    'Bearer',
    `Bearer ${SECRETO} de-mas`,
    `Bearer ${SECRETO}x`,
    `Bearer ${SECRETO.slice(0, -1)}`,
    'Bearer ',
  ]) {
    const salida = authorizeCronRequest(cabecera, SECRETO);
    assert.equal(salida.ok, false, `deberia rechazar: ${JSON.stringify(cabecera)}`);
  }
});

test('un prefijo correcto NO es mejor que uno equivocado', () => {
  // No comprueba tiempos —una prueba de temporización sería inestable en
  // CI— pero sí que la respuesta es la misma, que es lo que un atacante
  // mira primero: el motivo no dice cuánto acertó.
  const casi = authorizeCronRequest(`Bearer ${SECRETO.slice(0, -1)}z`, SECRETO);
  const nada = authorizeCronRequest('Bearer zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', SECRETO);
  assert.deepEqual(casi, nada);
});

test('EL SECRETO CORTO REVIENTA EN EL ARRANQUE, no en la peticion', () => {
  // Un despliegue mal configurado tiene que caerse al desplegar. Si esto
  // se comprobara por petición, un secreto de tres letras se descubriría
  // la noche que hace falta rotar.
  assert.throws(() => assertCronSecret('corto'), CronSecretError);
  assert.throws(() => assertCronSecret(`  ${'y'.repeat(MIN_SECRET_CHARS - 1)}  `), CronSecretError);
  assert.equal(assertCronSecret(`  ${SECRETO}  `), SECRETO);
});
