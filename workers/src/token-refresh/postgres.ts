/**
 * Los puertos, implementados contra Postgres y Supabase Vault.
 *
 * SQL EXPLÍCITO, SIN ORM (§17). Aquí no hay más lógica que la de traducir:
 * las reglas viven en `chain.ts` y en `policy.ts`, y la que no se le puede
 * confiar a nadie —una conexion, una rotacion a la vez— vive en la 0013
 * como el `claim` de un solo statement.
 *
 * NO SE ATA A NINGÚN DRIVER. Se le pasa una función que ejecuta SQL con
 * parámetros; sirve `postgres.js`, `pg`, o el `rpc` de supabase-js
 * envuelto. La razón práctica: las pruebas del worker no necesitan una
 * base, y el día que cambie el driver esto es un adaptador de veinte
 * líneas, no una reescritura.
 *
 * QUIÉN PUEDE EJECUTAR ESTO
 * Solo `service_role`. `clover_connections` tiene RLS sin ninguna policy
 * (0004), o sea que nadie más llega a la tabla, y `vault` no está expuesto
 * a los roles de la app. Si esto corre con otra clave, no falla a medias:
 * no lee ni una fila.
 */

import type { RecoveryWrite } from './chain.ts';
import type {
  ClaimInput,
  ClaimedConnection,
  ConnectionStore,
  FailurePatch,
  ManagedStatus,
  RotationPatch,
  TokenVault,
} from './ports.ts';

// El contrato con la base es el mismo para todos los trabajos y vive en
// `../sql.ts`. Se re-exporta para no romper a quien lo importaba de aquí.
export type { SqlRunner } from '../sql.ts';
import type { SqlRunner } from '../sql.ts';

/**
 * El repositorio de conexiones.
 *
 * El `claim` es una llamada a la función de la 0013 y no una consulta
 * suelta a propósito: seleccionar y reservar tienen que ser el mismo
 * statement o entre uno y otro se cuela la otra ejecución del worker.
 */
export function postgresConnectionStore(sql: SqlRunner): ConnectionStore {
  return {
    async claimDue(input: ClaimInput): Promise<readonly ClaimedConnection[]> {
      const filas = await sql(
        'select * from app.claim_clover_connections_for_refresh($1, $2, $3)',
        [input.dueBefore.toISOString(), input.leaseSeconds, input.limit],
      );
      return filas.map(toClaimedConnection);
    },

    async applyRotation(connectionId: string, patch: RotationPatch): Promise<void> {
      // `refresh_token_expires_at` con `coalesce`: si Clover no lo dijo,
      // se deja lo que hubiera en vez de borrarlo.
      const set = [
        'access_token_secret_id = $2',
        'access_token_expires_at = $3',
        'refresh_token_secret_id = $4',
        'refresh_token_expires_at = coalesce($5::timestamptz, refresh_token_expires_at)',
        // La rotación funcionó: la conexión está sana otra vez, venga de
        // donde venga. Una recuperación también cuenta — el par es bueno.
        "status = 'connected'",
        'consecutive_failures = 0',
        'last_error = null',
        // LA MARCA DE VIDA. Es lo único que distingue un worker que rota
        // de uno que corre y no consigue rotar nada, y de ahí sale
        // `refresh_stale` (0016). Con `now()` de la BASE y no con el
        // reloj del worker: la obsolescencia se calcula comparando contra
        // `now()` en la vista, y mezclar dos relojes en esa resta es
        // pedir que la deriva se lea como salud. Va aquí y no en un
        // `update` aparte porque un segundo statement puede no llegar a
        // ejecutarse, y entonces una rotación buena parecería no haber
        // ocurrido.
        'last_refresh_success_at = now()',
        // Se suelta el arriendo: la siguiente vez que toque, que toque.
        'refresh_lease_until = null',
      ];
      const params: unknown[] = [
        connectionId,
        patch.accessTokenSecretId,
        patch.accessTokenExpiresAt.toISOString(),
        patch.refreshTokenSecretId,
        patch.refreshTokenExpiresAt?.toISOString() ?? null,
      ];
      añadirRecuperacion(set, params, patch.recovery);

      await sql(`update public.clover_connections set ${set.join(', ')} where id = $1`, params);
    },

    async markFailure(connectionId: string, patch: FailurePatch): Promise<void> {
      const set = [
        'consecutive_failures = consecutive_failures + 1',
        'last_error = $2',
        'last_error_at = now()',
        'status = $3::app.connection_status',
        // El arriendo hacia adelante ES el backoff. Ver `policy.ts`.
        'refresh_lease_until = $4',
      ];
      const params: unknown[] = [
        connectionId,
        patch.error,
        patch.status,
        patch.leaseUntil.toISOString(),
      ];
      añadirRecuperacion(set, params, patch.recovery);

      await sql(`update public.clover_connections set ${set.join(', ')} where id = $1`, params);
    },
  };
}

/**
 * Las tres formas de tocar el par de columnas de recuperación, y ninguna
 * más.
 *
 * `sin-cambios` no las menciona en el `update`. Ya no hay ningún trigger
 * que dependa de eso —la 0016 quitó el de la 0012—, pero sigue siendo lo
 * correcto: un fallo (`markFailure`) no sabe nada nuevo sobre la red, y
 * escribirle el mismo valor "por simetría" es tocar una columna para
 * decir que no cambia.
 *
 * Y van siempre las dos juntas, nunca una: el `check` de la 0012 rechaza
 * un id sin fecha y una fecha sin id, y ese sí sigue en pie.
 */
function añadirRecuperacion(set: string[], params: unknown[], recovery: RecoveryWrite): void {
  if (recovery.kind === 'sin-cambios') return;
  if (recovery.kind === 'limpiar') {
    set.push('recovery_token_secret_id = null', 'recovery_token_expires_at = null');
    return;
  }
  set.push(
    `recovery_token_secret_id = $${params.length + 1}`,
    `recovery_token_expires_at = $${params.length + 2}`,
  );
  params.push(recovery.secretId, recovery.expiresAt.toISOString());
}

function toClaimedConnection(fila: Record<string, unknown>): ClaimedConnection {
  return {
    id: String(fila['id']),
    storeId: String(fila['store_id']),
    merchantId: texto(fila['merchant_id']),
    environment: String(fila['environment'] ?? 'sandbox'),
    status: (texto(fila['status']) ?? 'connected') as ManagedStatus,
    accessTokenSecretId: texto(fila['access_token_secret_id']),
    accessTokenExpiresAt: fecha(fila['access_token_expires_at']),
    refreshTokenSecretId: String(fila['refresh_token_secret_id']),
    recoveryTokenSecretId: texto(fila['recovery_token_secret_id']),
    recoveryTokenExpiresAt: fecha(fila['recovery_token_expires_at']),
    consecutiveFailures: Number(fila['consecutive_failures'] ?? 0),
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
 * EL ORDEN DE LOS ARGUMENTOS DE `vault.create_secret` ES UNA TRAMPA:
 * la firma es `(new_secret, new_name, new_description)`, o sea que el
 * SECRETO VA PRIMERO. Cambiarlos de sitio no da error: guarda el nombre
 * como secreto, y el fallo aparece media hora después, cuando el token que
 * se lee resulta ser una ruta.
 *
 * `update_secret` sí lleva el id delante: `(secret_id, new_secret, …)`.
 *
 * Y LEER NO ES `select * from vault.secrets`: ahí el valor está cifrado.
 * El descifrado sale por la vista `vault.decrypted_secrets`.
 */
export function vaultTokenStore(sql: SqlRunner): TokenVault {
  return {
    async read(secretId: string): Promise<string> {
      const filas = await sql(
        'select decrypted_secret from vault.decrypted_secrets where id = $1',
        [secretId],
      );
      const valor = filas[0]?.['decrypted_secret'];
      if (typeof valor !== 'string' || valor === '') {
        throw new Error(`El secreto ${secretId} no existe en Vault o está vacío`);
      }
      return valor;
    },

    async create(name: string, secret: string): Promise<string> {
      const filas = await sql('select vault.create_secret($1, $2, $3) as id', [
        secret,
        name,
        'Token de Clover rotado por el worker de refresco',
      ]);
      const id = filas[0]?.['id'];
      if (typeof id !== 'string' || id === '') {
        throw new Error(`Vault no devolvió id al crear el secreto ${name}`);
      }
      return id;
    },

    async update(secretId: string, secret: string): Promise<void> {
      await sql('select vault.update_secret($1, $2)', [secretId, secret]);
    },

    async destroy(secretId: string): Promise<void> {
      await sql('delete from vault.secrets where id = $1', [secretId]);
    },
  };
}
