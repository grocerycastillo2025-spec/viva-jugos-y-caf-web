/**
 * Las fronteras del worker: Vault, la fila, y las dos llamadas de Clover.
 *
 * El worker no importa `@juicebar/clover-client` ni `supabase-js` en
 * tiempo de ejecución. Depende de estas interfaces, y el cableado —que va
 * en la Edge Function que lo dispara— es quien las rellena. Dos razones,
 * las dos prácticas:
 *
 *   1. las pruebas ejercitan el camino de "Clover emitió el par y nos
 *      caímos antes de guardarlo" sin red y sin base, que es el único modo
 *      de probarlo, porque provocarlo de verdad exige romper el proceso en
 *      el instante exacto;
 *   2. cambiar de cliente HTTP o de driver de Postgres no toca ni una
 *      línea de la lógica de la cadena.
 *
 * NINGUNA DE ESTAS INTERFACES DEVUELVE UN TOKEN A LA FILA. Los tokens
 * viven en Vault y en variables locales del worker; en `clover_connections`
 * solo hay ids de secreto. Ver §14 de la arquitectura.
 */

import type { CloverTokenPair } from '@juicebar/clover-client';
import type { RecoveryWrite } from './chain.ts';

/** El estado de conexión que este worker sabe manejar. */
export type ManagedStatus = 'connected' | 'degraded';

/**
 * Una conexión ya RESERVADA para esta ejecución.
 *
 * Que venga reservada no es un detalle: el refresh token es de un solo
 * uso, y dos ejecuciones que lo canjeen a la vez dejan la conexión
 * muerta. Por eso no hay un `list()` suelto — solo se puede obtener una
 * conexión reclamándola.
 */
export interface ClaimedConnection {
  readonly id: string;
  readonly storeId: string;
  readonly merchantId: string | null;
  /** 'sandbox' | 'production'. Decide contra qué hosts se habla. */
  readonly environment: string;
  readonly status: ManagedStatus;
  readonly accessTokenSecretId: string | null;
  readonly accessTokenExpiresAt: Date | null;
  readonly refreshTokenSecretId: string;
  readonly recoveryTokenSecretId: string | null;
  readonly recoveryTokenExpiresAt: Date | null;
  readonly consecutiveFailures: number;
}

/**
 * Supabase Vault, visto desde aquí.
 *
 * OJO CON `create` Y `update`: son operaciones distintas y no
 * intercambiables. El refresh nuevo SIEMPRE se guarda con `create`, nunca
 * sobrescribiendo el secreto del vigente — sobrescribirlo destruye el
 * token de recuperación en el mismo movimiento que lo crea, y no se nota
 * hasta el día que hace falta.
 */
export interface TokenVault {
  read(secretId: string): Promise<string>;
  /** Devuelve el id del secreto nuevo. `name` tiene que ser único. */
  create(name: string, secret: string): Promise<string>;
  update(secretId: string, secret: string): Promise<void>;
  destroy(secretId: string): Promise<void>;
}

export interface ClaimInput {
  readonly dueBefore: Date;
  readonly leaseSeconds: number;
  readonly limit: number;
}

/** Lo que se escribe tras una rotación con éxito. Un solo `update`. */
export interface RotationPatch {
  readonly accessTokenSecretId: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshTokenSecretId: string;
  /** `null` = Clover no lo dijo; se deja lo que hubiera. */
  readonly refreshTokenExpiresAt: Date | null;
  readonly recovery: RecoveryWrite;
}

export interface FailurePatch {
  /** Ya redactado: los errores del cliente de Clover salen limpios de origen. */
  readonly error: string;
  readonly status: ManagedStatus;
  /** El arriendo hace de backoff: hasta aquí, esta conexión no se vuelve a tocar. */
  readonly leaseUntil: Date;
  /** `limpiar` solo cuando Clover ha dicho que no hay red. Nunca por nuestra fecha. */
  readonly recovery: Extract<RecoveryWrite, { kind: 'sin-cambios' | 'limpiar' }>;
}

export interface ConnectionStore {
  /** Reserva y devuelve. Las dos cosas en el mismo statement, o no sirve. */
  claimDue(input: ClaimInput): Promise<readonly ClaimedConnection[]>;
  applyRotation(connectionId: string, patch: RotationPatch): Promise<void>;
  markFailure(connectionId: string, patch: FailurePatch): Promise<void>;
}

/**
 * Las dos llamadas de OAuth que este worker necesita, con las credenciales
 * de la app ya puestas.
 *
 * `CloverOAuth` del cliente encaja estructuralmente con
 * `bindCloverTokenApi`, así que el App Secret se ata una vez en el
 * cableado y no viaja por el bucle del worker.
 */
export interface CloverTokenApi {
  refresh(input: { readonly refreshToken: string }): Promise<CloverTokenPair>;
  recovery(input: { readonly refreshToken: string }): Promise<CloverTokenPair>;
}

/**
 * Un fallo de Clover que trae respuesta. Se identifica por forma y no con
 * `instanceof` para no arrastrar el cliente como dependencia de ejecución;
 * `CloverApiError` encaja tal cual.
 */
export interface CloverErrorShape {
  readonly status: number;
  /** `X-Clover-Recovery-Available`: `true`, `false`, o ausente. */
  readonly recoveryAvailable?: boolean | undefined;
  readonly message?: string | undefined;
  /**
   * `X-Clover-Request-Id`. Es lo que hay que darle a soporte de Clover
   * para que miren UNA petición concreta en vez de pedir que se
   * reproduzca. Sin esto, un incidente con ellos empieza de cero.
   */
  readonly requestId?: string | undefined;
  /**
   * El cuerpo de la respuesta, ya redactado y recortado en origen
   * (`clover-client/errors.ts`): las claves sensibles salen como
   * `[redactado]`. Es lo que distingue un 401 de otro — "token
   * expirado" no se arregla igual que "client_id desconocido".
   */
  readonly body?: string | undefined;
}

export function asCloverError(err: unknown): CloverErrorShape | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as {
    status?: unknown;
    recoveryAvailable?: unknown;
    message?: unknown;
    requestId?: unknown;
    body?: unknown;
  };
  if (typeof e.status !== 'number') return null;
  return {
    status: e.status,
    recoveryAvailable: typeof e.recoveryAvailable === 'boolean' ? e.recoveryAvailable : undefined,
    message: typeof e.message === 'string' ? e.message : undefined,
    // `CloverApiError` ya traía estos dos y este adaptador los tiraba, así
    // que un 401 llegaba al log sin nada que mirar. El `body` sale
    // redactado y recortado de origen (`clover-client/errors.ts`), y el
    // `requestId` es LO QUE PIDE SOPORTE DE CLOVER: sin él, un incidente
    // con ellos empieza por reproducirlo.
    requestId: typeof e.requestId === 'string' ? e.requestId : undefined,
    body: typeof e.body === 'string' ? e.body : undefined,
  };
}

/**
 * Traza del worker.
 *
 * `datos` NO lleva tokens nunca — ni el valor, ni un prefijo, ni una
 * longitud. Ids de secreto sí: son punteros a Vault, no credenciales, y
 * sin ellos un incidente de rotación no se puede reconstruir.
 */
export interface WorkerLog {
  info(event: string, datos?: Readonly<Record<string, unknown>>): void;
  warn(event: string, datos?: Readonly<Record<string, unknown>>): void;
  error(event: string, datos?: Readonly<Record<string, unknown>>): void;
}

export const SILENT_LOG: WorkerLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
