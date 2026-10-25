/**
 * El cableado del catalogo de Clover.
 *
 * Aqui no hay reglas de mapeo —esas estan en workers/src/catalog-sync—
 * pero si dos decisiones que cuestan caro si se pierden: las tres
 * expansiones que el mapeo necesita, y el tamaño de pagina reducido que
 * las hace tragables.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { cloverCatalogSource, EXPANSIONES_DE_ITEM, PAGE_SIZE_CON_EXPANSIONES } from '../source.ts';

const M = 'RGW5JAVFT8MB1';
const TOKEN = 'ACCESS_TOKEN';

function clienteEspia() {
  const llamadas: Array<{ metodo: string; args: readonly unknown[] }> = [];
  const anotar =
    (metodo: string) =>
    (...args: unknown[]) => {
      llamadas.push({ metodo, args });
      return (async function* () {})();
    };
  return {
    llamadas,
    cliente: {
      inventory: {
        categories: anotar('categories'),
        taxRates: anotar('taxRates'),
        modifierGroups: anotar('modifierGroups'),
        modifiers: anotar('modifiers'),
        items: anotar('items'),
      },
    },
  };
}

test('los items se piden con las TRES expansiones que el mapeo necesita', () => {
  // Sin `taxRates` el mapeo no puede distinguir "exento" de "no lo
  // sabemos", y por defecto dice "no lo sabemos": el catalogo entero se
  // quedaria sin impuesto resuelto.
  const { cliente, llamadas } = clienteEspia();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cloverCatalogSource(cliente as any, M, TOKEN).items();

  const { args } = llamadas[0]!;
  assert.equal(args[0], M);
  assert.equal(args[1], TOKEN);
  assert.deepEqual((args[2] as { expand: string[] }).expand, [
    'categories',
    'modifierGroups',
    'taxRates',
  ]);
  assert.deepEqual([...EXPANSIONES_DE_ITEM], ['categories', 'modifierGroups', 'taxRates']);
});

test('con expansiones la pagina es la MITAD del tope de Clover', () => {
  // El tope son 100. Con tres expansiones, 50: la mitad de elementos por
  // respuesta, el doble de peticiones, y ninguna respuesta gigante contra
  // un sandbox que es mas fragil que produccion.
  assert.equal(PAGE_SIZE_CON_EXPANSIONES, 50);

  const { cliente, llamadas } = clienteEspia();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cloverCatalogSource(cliente as any, M, TOKEN).items();
  assert.equal((llamadas[0]!.args[2] as { pageSize: number }).pageSize, 50);
});

test('los modificadores se piden POR GRUPO: no hay listado plano', () => {
  const { cliente, llamadas } = clienteEspia();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cloverCatalogSource(cliente as any, M, TOKEN).modifiers('MG-MILK');
  assert.deepEqual(llamadas[0]!.args, [M, TOKEN, 'MG-MILK']);
});

test('lo demas va sin expansiones: no las necesita y abultan', () => {
  const { cliente, llamadas } = clienteEspia();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const source = cloverCatalogSource(cliente as any, M, TOKEN);
  source.categories();
  source.taxRates();
  source.modifierGroups();
  for (const { args } of llamadas) assert.equal(args.length, 2);
});
