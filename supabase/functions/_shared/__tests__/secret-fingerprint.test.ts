/**
 * La huella existe para cazar los pegados sucios. Estas pruebas fijan
 * justo eso: que un salto de línea o un espacio de más NO pasen
 * desapercibidos, que es como se pierden las tardes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { secretFingerprint } from '../secret-fingerprint.ts';

// Valor de juguete, no un secreto de nadie.
const SECRETO = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

test('la huella es estable: el mismo valor, la misma huella', async () => {
  assert.equal(await secretFingerprint(SECRETO), await secretFingerprint(SECRETO));
});

test('EL SALTO DE LINEA FINAL cambia la huella', async () => {
  // El fallo numero uno al pegar en una terminal, e invisible a ojo.
  assert.notEqual(await secretFingerprint(SECRETO), await secretFingerprint(`${SECRETO}\n`));
});

test('un espacio de mas, a cualquier lado, cambia la huella', async () => {
  assert.notEqual(await secretFingerprint(SECRETO), await secretFingerprint(` ${SECRETO}`));
  assert.notEqual(await secretFingerprint(SECRETO), await secretFingerprint(`${SECRETO} `));
});

test('las comillas metidas dentro del valor cambian la huella', async () => {
  assert.notEqual(await secretFingerprint(SECRETO), await secretFingerprint(`"${SECRETO}"`));
});

test('un pegado truncado cambia la huella', async () => {
  assert.notEqual(await secretFingerprint(SECRETO), await secretFingerprint(SECRETO.slice(0, -4)));
});

test('NO es un trozo del secreto: la huella no aparece dentro del valor', async () => {
  // Si esto fallara, estariamos publicando un prefijo, que es justo lo
  // que la regla de §14 prohibe.
  const huella = await secretFingerprint(SECRETO);
  assert.equal(SECRETO.includes(huella), false);
  assert.equal(huella.length, 12);
  assert.match(huella, /^[0-9a-f]{12}$/);
});

test('coincide con lo que da sha256sum, que es con lo que se compara', async () => {
  // La cadena de la cabecera del modulo:
  //   printf '%s' "" | sha256sum | cut -c1-12
  // El sha256 del vacio es e3b0c44298fc1c14...
  assert.equal(await secretFingerprint(''), 'e3b0c44298fc');
});
