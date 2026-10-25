/**
 * Lo que se lee del cuerpo de la peticion.
 *
 * Un `store_id` mal leido manda el barrido a otra sucursal, y eso no se
 * descubre hasta ver el catalogo de un restaurante en la app de otro. Por
 * eso se valida antes de tocar la base y no se deja que lo rechace
 * Postgres con un error sin nombre nuestro.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { leerStoreId } from '../peticion.ts';

const UUID = '22222222-2222-4222-8222-222222222222';

test('un uuid valido pasa, con espacios alrededor o sin ellos', () => {
  assert.equal(leerStoreId({ store_id: UUID }), UUID);
  assert.equal(leerStoreId({ store_id: `  ${UUID}  ` }), UUID);
  assert.equal(leerStoreId({ store_id: UUID.toUpperCase() }), UUID.toUpperCase());
});

test('lo que no es un uuid no pasa, y no se intenta arreglar', () => {
  for (const cuerpo of [
    null,
    undefined,
    'una cadena',
    {},
    { store_id: '' },
    { store_id: 'viva-juice-coffee' }, // el slug no es el id
    { store_id: 123 },
    { store_id: `${UUID}; drop table stores` },
    { tienda: UUID }, // el nombre del campo importa
  ]) {
    assert.equal(leerStoreId(cuerpo), null, JSON.stringify(cuerpo));
  }
});
