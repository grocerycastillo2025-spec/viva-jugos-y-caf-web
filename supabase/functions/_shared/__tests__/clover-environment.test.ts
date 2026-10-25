/**
 * La traducción de entorno: dos cadenas cortas que deciden contra qué
 * cuatro hosts se habla.
 *
 * Lo que estas pruebas protegen no es el mapeo —que es obvio— sino el
 * caso de abajo: que un entorno desconocido REVIENTE. Un `default` que
 * cayera a Norteamérica compilaría igual, pasaría la revisión, y se
 * descubriría el día que una sucursal de sandbox mandase un cobro de
 * verdad al host de producción.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { cloverEnvironment, ENTORNOS_DE_LA_FILA } from '../clover-environment.ts';

test('los dos entornos que puede haber en la fila (0002)', () => {
  assert.equal(cloverEnvironment('sandbox'), 'sandbox');
  assert.equal(cloverEnvironment('production'), 'na-production');
  assert.deepEqual([...ENTORNOS_DE_LA_FILA], ['sandbox', 'production']);
});

test('produccion NO se llama igual en la fila y en el cliente', () => {
  // Cuando entre Europa, "producción" dejará de ser una sola cosa y el
  // cambio se hace aquí. Si esto se "simplifica" a la identidad, el día
  // que exista `eu-production` no habrá dónde ponerlo.
  assert.notEqual(cloverEnvironment('production'), 'production');
});

test('UN ENTORNO DESCONOCIDO REVIENTA: nunca cae a Norteamerica en silencio', () => {
  for (const raro of ['', 'PRODUCTION', 'prod', 'na-production', 'eu-production']) {
    assert.throws(() => cloverEnvironment(raro), /no está mapeado/);
  }
});
