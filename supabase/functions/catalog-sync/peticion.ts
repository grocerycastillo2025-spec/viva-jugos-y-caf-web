/**
 * Lo único que hay que leer del cuerpo de la petición, y validarlo.
 *
 * Separado del handler para que se pueda probar sin levantar la función:
 * un `store_id` mal leído manda el barrido a otra sucursal, y eso no se
 * descubre hasta ver el catálogo de un restaurante en la app de otro.
 */

/** `uuid` canónico. Se valida antes de tocar la base: un `store_id` que
 *  no es un uuid da un error de Postgres feo y sin nombre nuestro. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function leerStoreId(cuerpo: unknown): string | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const valor = (cuerpo as { store_id?: unknown }).store_id;
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return UUID.test(limpio) ? limpio : null;
}
