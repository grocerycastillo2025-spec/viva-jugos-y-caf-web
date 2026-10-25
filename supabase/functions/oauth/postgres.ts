/**
 * Los puertos del flujo de conexión, contra Postgres y Supabase Vault.
 *
 * SQL EXPLÍCITO, SIN ORM (§17), y sin más lógica que traducir: las reglas
 * están en `flow.ts` y las que no se le pueden confiar a nadie están en las
 * migraciones como `check` y como trigger.
 *
 * POR QUÉ SQL DIRECTO Y NO `supabase-js`
 * Porque hay que escribir en Vault, y `vault.create_secret` no está
 * expuesto por PostgREST: `rpc()` solo alcanza funciones de `public`. El
 * worker de refresco tomó la misma decisión y por la misma razón, así que
 * los dos hablan con la base igual.
 *
 * QUIÉN PUEDE EJECUTAR ESTO
 * Solo `service_role`. `clover_connections` tiene RLS sin ninguna policy
 * (0004): con otra clave esto no falla a medias, no lee ni una fila.
 */

import type {
  ConnectStore,
  ConnectionRef,
  InitialTokensPatch,
  TokenVault,
} from './ports.ts';

/** Ejecuta SQL con parámetros posicionales (`$1`, `$2`…) y devuelve filas. */
export type SqlRunner = (
  text: string,
  params: readonly unknown[],
) => Promise<readonly Record<string, unknown>[]>;

const COLUMNAS = `
  id, store_id, environment, merchant_id, status, connect_token_expires_at
`;

export function postgresConnectStore(sql: SqlRunner): ConnectStore {
  return {
    async findByConnectToken(connectToken: string): Promise<ConnectionRef | null> {
      const filas = await sql(
        `select ${COLUMNAS} from public.clover_connections where connect_token = $1`,
        [connectToken],
      );
      const fila = filas[0];
      return fila === undefined ? null : toConnectionRef(fila);
    },

    async findByMerchant(environment: string, merchantId: string): Promise<ConnectionRef | null> {
      const filas = await sql(
        `select ${COLUMNAS} from public.clover_connections
          where environment = $1 and merchant_id = $2`,
        [environment, merchantId],
      );
      const fila = filas[0];
      return fila === undefined ? null : toConnectionRef(fila);
    },

    /**
     * El primer par, y el enlace consumido, en el mismo update.
     *
     * DOS COLUMNAS QUE NO APARECEN AQUÍ, Y NO ES UN OLVIDO:
     *
     * `recovery_token_secret_id` / `recovery_token_expires_at`. El primer
     * par no tiene token de recuperación —no hubo ningún refresh antes que
     * él— y la 0012 dice que `null` es justo el estado normal después del
     * OAuth inicial. Sí aparecen más abajo, puestas a `null` a propósito:
     * ver el comentario dentro del `update`.
     *
     * `api_base_url`. Es anterior a `environments.ts` y hoy no la lee
     * nadie: los cuatro hosts salen de `environment` vía `resolveHosts`.
     * Escribirla aquí obligaría a repetir la tabla de hosts en este
     * archivo, que es exactamente lo que §13.1 prohíbe. Queda pendiente
     * quitarla en una migración; ver docs/OAUTH-CONEXION.md.
     */
    async applyInitialTokens(connectionId: string, patch: InitialTokensPatch): Promise<void> {
      await sql(
        `update public.clover_connections set
           merchant_id              = $2,
           access_token_secret_id   = $3,
           access_token_expires_at  = $4,
           refresh_token_secret_id  = $5,
           refresh_token_expires_at = coalesce($6::timestamptz, refresh_token_expires_at),
           status                   = 'connected',
           consecutive_failures     = 0,
           last_error               = null,
           last_error_at            = null,
           -- LA MARCA DE VIDA, igual que en cada rotacion del worker.
           --
           -- Un canje de OAuth ES la generacion de un par: es el primero,
           -- pero cuenta igual. Sin esta linea, refresh_stale (la vista de
           -- la 0016) da true desde el minuto cero de una sucursal recien
           -- conectada, porque su regla es "null cuenta como obsoleta" — y
           -- con razon, ya que en una conexion vieja null significa que el
           -- worker no la ha tocado nunca.
           --
           -- El worker la corregiria en su siguiente vuelta, o sea en
           -- cinco minutos. Pero una deteccion que enseña en rojo cada
           -- sucursal recien conectada durante cinco minutos es una
           -- deteccion que el operador aprende a ignorar, y entonces deja
           -- de detectar tambien lo que importa.
           --
           -- Con now() de la BASE y no con el reloj de la funcion: la
           -- obsolescencia se calcula comparando contra now() en la vista,
           -- y mezclar dos relojes en esa resta es pedir que la deriva se
           -- lea como salud. Mismo criterio que
           -- workers/src/token-refresh/postgres.ts.
           --
           -- (Sin comillas invertidas en este comentario: va dentro de un
           -- template literal y una sola lo cerraria. Es la misma trampa
           -- que avisa el comentario de mas abajo, y si: cai en ella.)
           last_refresh_success_at  = now(),
           -- El enlace es de un solo uso: se consume al conectar. Sin esto
           -- el mismo state valdría para siempre y el flujo dejaría de
           -- estar atado a un envío concreto.
           connect_token            = null,
           connect_token_expires_at = null,
           -- LA CADENA DE RECUPERACIÓN SE CORTA AQUÍ, Y NO ES OPCIONAL.
           --
           -- Esto es un update, no un insert: una RECONEXIÓN cae sobre una
           -- fila que puede traer un recovery_token_secret_id de la
           -- autorización ANTERIOR. Y una autorización nueva no tiene
           -- token previo del que recuperar: la regla documentada es que
           -- un primer par nace sin red (ver chain.ts).
           --
           -- Dejarlo puesto apuntaría a un token de una autorización que
           -- ya no existe: en el siguiente 401 el worker gastaría una
           -- llamada probándolo, y recovery_token_expires_at estaría
           -- mintiendo sobre una ventana que no existe.
           --
           -- Los dos a la vez porque el check de la 0012 exige que sean
           -- nulos o no nulos juntos. Ese check sigue en pie; el trigger de
           -- la ventana que habia al lado ya no (lo quito la 0016, porque
           -- la regla que imponia resulto ser falsa).
           --
           -- El secreto viejo de Vault queda huérfano. Es basura barata, y
           -- el mismo trato que le da el resto del flujo: se limpia a mano
           -- con el runbook, nunca desde aquí.
           --
           -- (Sin comillas invertidas en este comentario: va dentro de un
           -- template literal y una sola lo cerraría.)
           recovery_token_secret_id  = null,
           recovery_token_expires_at = null
         where id = $1`,
        [
          connectionId,
          patch.merchantId,
          patch.accessTokenSecretId,
          patch.accessTokenExpiresAt.toISOString(),
          patch.refreshTokenSecretId,
          patch.refreshTokenExpiresAt?.toISOString() ?? null,
        ],
      );
    },

    /**
     * Un fallo aquí NO cambia el estado de la conexión.
     *
     * Lo natural sería marcar `degraded`, y sería un error: quien está
     * delante es alguien intentando conectar, no la sucursal trabajando.
     * Un merchant que se equivoca de enlace tres veces dejaría `degraded`
     * una sucursal que en ese momento está vendiendo con tokens buenos, y
     * `degraded` la saca de la app. El fallo se apunta para que se vea en
     * el SaaS, y ya.
     */
    async markFailure(connectionId: string, error: string): Promise<void> {
      await sql(
        `update public.clover_connections set
           consecutive_failures = consecutive_failures + 1,
           last_error           = $2,
           last_error_at        = now()
         where id = $1`,
        [connectionId, error],
      );
    },
  };
}

function toConnectionRef(fila: Record<string, unknown>): ConnectionRef {
  return {
    id: String(fila['id']),
    storeId: String(fila['store_id']),
    environment: String(fila['environment'] ?? 'sandbox'),
    merchantId: texto(fila['merchant_id']),
    status: String(fila['status'] ?? 'not_connected'),
    connectTokenExpiresAt: fecha(fila['connect_token_expires_at']),
  };
}

/** Unos drivers devuelven `Date` y otros el texto de Postgres. Los dos valen. */
function fecha(valor: unknown): Date | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor;
  const d = new Date(String(valor));
  return Number.isNaN(d.getTime()) ? null : d;
}

function texto(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : String(valor);
}

/**
 * Supabase Vault.
 *
 * EL ORDEN DE LOS ARGUMENTOS DE `vault.create_secret` ES UNA TRAMPA: la
 * firma es `(new_secret, new_name, new_description)`, o sea que el SECRETO
 * VA PRIMERO. Cambiarlos de sitio no da error: guarda el nombre como
 * secreto, y se descubre media hora después, cuando el token que se lee
 * resulta ser una ruta. Mismo aviso que en el worker, y por lo mismo.
 */
export function vaultTokenStore(sql: SqlRunner): TokenVault {
  return {
    async create(name: string, secret: string): Promise<string> {
      const filas = await sql('select vault.create_secret($1, $2, $3) as id', [
        secret,
        name,
        'Token de Clover del flujo de conexion OAuth',
      ]);
      const id = filas[0]?.['id'];
      if (typeof id !== 'string' || id === '') {
        throw new Error(`Vault no devolvió id al crear el secreto ${name}`);
      }
      return id;
    },

    async destroy(secretId: string): Promise<void> {
      await sql('delete from vault.secrets where id = $1', [secretId]);
    },
  };
}
