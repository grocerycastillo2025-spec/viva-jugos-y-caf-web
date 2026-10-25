/**
 * Cómo se habla con Postgres, en una línea, para todos los trabajos.
 *
 * Vive suelto y no dentro de un trabajo porque es el MISMO contrato: el
 * worker de refresco y el barrido de catálogo no comparten ni una regla,
 * pero los dos ejecutan SQL con parámetros posicionales contra la misma
 * base. Dos declaraciones idénticas con el mismo nombre en dos módulos
 * son dos tipos distintos para el compilador y una sola cosa para quien
 * lee, que es la peor combinación.
 *
 * NO SE ATA A NINGÚN DRIVER. Sirve `postgres.js`, `pg`, o el `rpc` de
 * supabase-js envuelto. La razón práctica: las pruebas no necesitan una
 * base, y el día que cambie el driver esto es un adaptador de veinte
 * líneas, no una reescritura.
 */

/** Ejecuta SQL con parámetros posicionales (`$1`, `$2`…) y devuelve filas. */
export type SqlRunner = (
  text: string,
  params: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>;
