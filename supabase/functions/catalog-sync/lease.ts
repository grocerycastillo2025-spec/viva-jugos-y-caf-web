/**
 * El arriendo del barrido y de dónde sale el token de acceso.
 *
 * Se separa del handler porque son las dos cosas que se pueden probar sin
 * red: que el barrido no arranca si otro lo tiene cogido, y que el
 * arriendo se suelta pase lo que pase.
 */

import type { SqlRunner } from '../../../workers/src/catalog-sync/index.ts';

/** Lo que dura el arriendo. Un barrido de ~50 productos tarda segundos;
 *  esto cubre un catálogo grande y un sandbox lento sin dejar la
 *  sucursal bloqueada media hora si el proceso muere. */
export const LEASE_SECONDS = 600;

export interface SucursalReservada {
  readonly connectionId: string;
  readonly storeId: string;
  readonly merchantId: string;
  readonly environment: string;
}

/**
 * Reserva la sucursal. `null` = ya hay un barrido en marcha, o la
 * sucursal no está conectada.
 *
 * La función de la 0017 hace las dos cosas —comprobar y reservar— en el
 * mismo statement: en dos pasos cabe la otra ejecución entre medias.
 */
export async function reservarSucursal(
  sql: SqlRunner,
  storeId: string,
): Promise<SucursalReservada | null> {
  const filas = await sql('select * from app.claim_catalog_sweep($1, $2)', [
    storeId,
    LEASE_SECONDS,
  ]);
  const fila = filas[0];
  if (fila === undefined) return null;
  return {
    connectionId: String(fila['connection_id']),
    storeId: String(fila['store_id']),
    merchantId: String(fila['merchant_id']),
    environment: String(fila['environment'] ?? 'sandbox'),
  };
}

export async function soltarSucursal(sql: SqlRunner, connectionId: string): Promise<void> {
  await sql('select app.release_catalog_sweep($1)', [connectionId]);
}

/**
 * El access token vigente de esa conexión, desde Vault.
 *
 * NO SE REFRESCA AQUÍ, y es deliberado: de rotar tokens se encarga el
 * worker de refresco, que tiene su propio arriendo (0013) y su propia
 * cadena de recuperación. Un barrido que además rotase sería un segundo
 * escritor de `refresh_token_secret_id`, y dos escritores de un token de
 * un solo uso dejan la conexión muerta.
 *
 * Si el token está caducado, el barrido se lleva un 401 y lo reporta. El
 * refresco lo arregla en su siguiente vuelta, que como mucho es dentro de
 * cinco minutos.
 */
export async function leerAccessToken(sql: SqlRunner, connectionId: string): Promise<string> {
  const filas = await sql(
    `select s.decrypted_secret
       from public.clover_connections c
       join vault.decrypted_secrets s on s.id = c.access_token_secret_id
      where c.id = $1`,
    [connectionId],
  );
  const valor = filas[0]?.['decrypted_secret'];
  if (typeof valor !== 'string' || valor === '') {
    throw new Error(
      `La conexión ${connectionId} no tiene un access token legible en Vault. ` +
        'El worker de refresco lo arregla en su siguiente vuelta; si persiste, ' +
        'mirar app.token_refresh_worker_status().',
    );
  }
  return valor;
}
