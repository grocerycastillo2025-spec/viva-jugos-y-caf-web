/**
 * Las fronteras del flujo de conexión: la fila, Vault y el canje.
 *
 * Mismo reparto que en `workers/src/token-refresh`: la lógica vive en
 * `flow.ts` y no importa ni `postgres` ni el cliente de Clover, así que las
 * pruebas ejercitan los caminos que importan —el enlace caducado, el
 * merchant que no es, el canje que falla después de haber creado secretos—
 * sin red y sin base. Provocar esos casos de verdad exige un merchant real
 * y romper el proceso en el instante justo.
 *
 * AQUÍ NO VIAJA NINGÚN TOKEN HACIA LA FILA. Los tokens van a Vault y a
 * variables locales; en `clover_connections` solo hay ids de secreto (§14).
 */

/**
 * IMPORT RELATIVO Y NO `@juicebar/clover-client`, A PROPÓSITO.
 *
 * Esto se despliega en Deno, dentro del bundle de la Edge Function, y Deno
 * no resuelve el especificador de un paquete de workspace de pnpm. El
 * especificador relativo lo entienden los tres: Deno al desplegar, tsc al
 * comprobar tipos y `node --test` al pasar las pruebas. Que
 * `packages/clover-client` no importe nada de `node:` y escriba las
 * extensiones `.ts` a mano —que ya lo hacía— es lo que lo hace posible.
 */
import type { CloverTokenPair } from '../../../packages/clover-client/src/index.ts';

/**
 * La conexión que se está intentando conectar.
 *
 * Es un espejo parcial de `clover_connections`: solo lo que este flujo
 * necesita para decidir. Sin tokens y sin ids de secreto que no se vayan a
 * tocar.
 */
export interface ConnectionRef {
  readonly id: string;
  readonly storeId: string;
  /** `'sandbox' | 'production'` tal como está en la fila. */
  readonly environment: string;
  /** `null` mientras nadie ha conectado nunca esta sucursal. */
  readonly merchantId: string | null;
  readonly status: string;
  /** Cuándo caduca el enlace que se le mandó al merchant. */
  readonly connectTokenExpiresAt: Date | null;
}

/**
 * Lo que se escribe cuando el canje sale bien. Un solo `update`.
 *
 * NO HAY CAMPOS DE RECUPERACIÓN, Y ES CORRECTO: el primer par no tiene
 * token de recuperación porque no hubo ningún refresh antes que él. La 0012
 * lo dice explícitamente —`null` es el estado normal justo después del
 * OAuth inicial— y el `check` de esa migración exige que las dos columnas
 * vayan juntas. Escribir aquí una ventana de recuperación sería prometer
 * una red que no existe.
 */
export interface InitialTokensPatch {
  readonly merchantId: string;
  readonly accessTokenSecretId: string;
  readonly accessTokenExpiresAt: Date;
  readonly refreshTokenSecretId: string;
  /** `null` = Clover no lo dijo; no se inventa. */
  readonly refreshTokenExpiresAt: Date | null;
}

export interface ConnectStore {
  /**
   * Busca por el token del enlace. Solo devuelve la fila; que el enlace
   * esté caducado lo decide `flow.ts`, para que la regla se pueda probar.
   */
  findByConnectToken(connectToken: string): Promise<ConnectionRef | null>;
  /**
   * Busca por merchant. Es el camino de la REINSTALACIÓN desde el App
   * Market de Clover, que llega sin `state` porque no la originamos
   * nosotros. Sin esto, un merchant que reinstala la app se queda con la
   * conexión muerta y nadie sabe por qué.
   */
  findByMerchant(environment: string, merchantId: string): Promise<ConnectionRef | null>;
  /** Escribe el primer par y deja la conexión `connected`. Un solo update. */
  applyInitialTokens(connectionId: string, patch: InitialTokensPatch): Promise<void>;
  /** Anota el fallo sin tocar tokens ni el estado de una conexión que ya funcionaba. */
  markFailure(connectionId: string, error: string): Promise<void>;
}

/** Supabase Vault, lo poco que hace falta aquí. */
export interface TokenVault {
  /** Devuelve el id del secreto nuevo. `name` tiene que ser único. */
  create(name: string, secret: string): Promise<string>;
  destroy(secretId: string): Promise<void>;
}

/**
 * El canje, con el App Secret ya atado.
 *
 * Se ata en el cableado (`index.ts`) para que el secreto entre una vez y no
 * viaje por la lógica: en `flow.ts` no aparece la palabra `appSecret` ni una
 * sola vez, igual que en `worker.ts`.
 */
export interface CloverExchangeApi {
  exchangeCode(input: { readonly code: string }): Promise<CloverTokenPair>;
}

/** Construye la URL de autorización. La implementa `CloverOAuth` del cliente. */
export interface CloverAuthorizeUrlBuilder {
  authorizeUrl(params: {
    readonly appId: string;
    readonly redirectUri: string;
    readonly state: string;
  }): string;
}

/**
 * De qué entorno es cada llamada.
 *
 * NO HAY UN CLIENTE, HAY UNO POR ENTORNO, y quien lo decide es la FILA, no
 * una variable de entorno del despliegue. La misma Edge Function atiende
 * sucursales en sandbox y en producción —durante el alta de un restaurante
 * conviven— y `authorize` de sandbox contra el host de producción no da un
 * 404: da una pantalla de Clover que parece que el merchant hizo algo mal.
 *
 * Mismo patrón que `cloverFor` en el worker de refresco.
 */
export type CloverFor<T> = (environment: string) => T;

/**
 * Traza.
 *
 * `datos` NO lleva tokens, ni el `code` del canje: el código de
 * autorización es de un solo uso pero sigue siendo una credencial mientras
 * vive, y los logs de Edge Functions los lee más gente que Vault.
 */
export interface ConnectLog {
  info(event: string, datos?: Readonly<Record<string, unknown>>): void;
  warn(event: string, datos?: Readonly<Record<string, unknown>>): void;
  error(event: string, datos?: Readonly<Record<string, unknown>>): void;
}

export const SILENT_LOG: ConnectLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
