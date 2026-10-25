/**
 * Ata las credenciales de la app a las dos llamadas que usa el worker.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO DE DIEZ LÍNEAS
 * Para que el App Secret entre UNA vez, en el arranque, y no viaje por el
 * bucle de rotación. En `worker.ts` no aparece la palabra `appSecret` ni
 * una sola vez, y eso no es casualidad: cuantos menos sitios lo tocan,
 * menos sitios pueden loguearlo.
 *
 * Y para que el worker no importe `@juicebar/clover-client` en tiempo de
 * ejecución. Aquí el cliente entra por parámetro y solo se le exige la
 * forma que se usa, así que las pruebas del worker no necesitan levantar
 * un cliente HTTP entero para probar qué pasa cuando Clover contesta 401.
 *
 * LOS DOS ENDPOINTS VIVEN EN EL HOST DE PLATAFORMA, no en el web. Lo
 * resuelve `resolveHosts` dentro del cliente; se recuerda aquí porque
 * mandarlos al host equivocado no da un 404 claro, da un 401 que parece
 * "el token no vale".
 */

import type { CloverTokenPair } from '@juicebar/clover-client';
import type { CloverTokenApi } from './ports.ts';

/** Lo que se necesita de `CloverOAuth`. El cliente encaja tal cual. */
export interface CloverOAuthShape {
  refresh(input: {
    readonly appId: string;
    readonly refreshToken: string;
  }): Promise<CloverTokenPair>;
  recovery(input: {
    readonly appId: string;
    readonly appSecret: string;
    readonly refreshToken: string;
  }): Promise<CloverTokenPair>;
}

export interface CloverAppCredentials {
  /** App Id del Developer Dashboard. Identifica la app, no es un secreto. */
  readonly appId: string;
  /**
   * App Secret. Solo lo pide `/oauth/v2/recovery`, y es lo que distingue a
   * una app de alta confianza. De una variable de entorno del backend,
   * nunca de la base ni de la app.
   */
  readonly appSecret: string;
}

export function bindCloverTokenApi(
  oauth: CloverOAuthShape,
  credenciales: CloverAppCredentials,
): CloverTokenApi {
  return {
    refresh: ({ refreshToken }) => oauth.refresh({ appId: credenciales.appId, refreshToken }),
    recovery: ({ refreshToken }) =>
      oauth.recovery({
        appId: credenciales.appId,
        appSecret: credenciales.appSecret,
        refreshToken,
      }),
  };
}
