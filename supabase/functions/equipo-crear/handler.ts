/**
 * Edge Function `equipo-crear`: el DUEÑO crea desde el panel la cuenta de
 * un cajero (o de otro dueño) con correo y contraseña temporal, sin que la
 * persona tenga que registrarse antes.
 *
 * La cuenta la crea la API de administración de Auth con la llave de
 * servicio, que solo existe aquí (secreto que pone Supabase). La app nunca
 * la ve. Antes se comprueba, contra la base, que quien llama es dueño de
 * ESE negocio.
 *
 * Si el correo ya tiene cuenta no se toca (ni su contraseña): se contesta
 * "ya_existe" y el panel sugiere "Dar acceso".
 */

import { identificar, leerBearer } from '../checkout/auth.ts';
import { leerNuevaCuenta } from './validar.ts';

export type Sql = (text: string, params?: readonly unknown[]) => Promise<Record<string, unknown>[]>;

export interface EquipoCrearDeps {
  readonly sql: Sql;
  readonly fetch: typeof fetch;
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly serviceKey: string;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function createEquipoCrearHandler(deps: EquipoCrearDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'solo POST' });

    const token = leerBearer(req.headers.get('authorization'));
    if (token === null) return json(401, { error: 'no autorizado' });
    const who = await identificar(deps.fetch, { supabaseUrl: deps.supabaseUrl, anonKey: deps.anonKey, token });
    if (!who.ok) return json(401, { error: 'no autorizado' });

    const lectura = leerNuevaCuenta(await req.json().catch(() => null));
    if (!lectura.ok) return json(400, { error: lectura.error });
    const c = lectura.cuenta;

    const owner = await deps.sql(
      `select 1 from public.restaurant_members
        where restaurant_id = $1 and user_id = $2 and role = 'owner'`,
      [c.restaurantId, who.userId],
    );
    if (owner.length === 0) return json(403, { error: 'solo_dueno' });

    const existing = await deps.sql(`select id from auth.users where lower(email) = $1`, [c.email]);
    if (existing.length > 0) return json(409, { error: 'ya_existe' });

    let res: Response;
    try {
      res = await deps.fetch(`${deps.supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: deps.serviceKey,
          authorization: `Bearer ${deps.serviceKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          email: c.email,
          password: c.password,
          // La crea el dueño: no hace falta confirmar el correo para entrar.
          email_confirm: true,
          user_metadata: { first_name: c.name },
        }),
      });
    } catch {
      return json(502, { error: 'auth_inalcanzable' });
    }
    const created = (await res.json().catch(() => null)) as { id?: unknown; msg?: unknown; message?: unknown } | null;
    if (!res.ok || typeof created?.id !== 'string') {
      const detail = String(created?.msg ?? created?.message ?? '');
      if (/already|registered|exists/i.test(detail)) return json(409, { error: 'ya_existe' });
      if (/password/i.test(detail)) return json(400, { error: 'contrasena_debil' });
      return json(502, { error: 'no_se_pudo_crear' });
    }

    // El nombre va también al perfil (por si el disparador de perfiles no
    // leyó los metadatos): es el que ve el panel en Equipo y Pedidos.
    await deps.sql(
      `insert into public.profiles (id, first_name) values ($1, $2)
       on conflict (id) do update set first_name = coalesce(nullif(public.profiles.first_name, ''), excluded.first_name)`,
      [created.id, c.name],
    );
    await deps.sql(
      `insert into public.restaurant_members (restaurant_id, user_id, role)
       values ($1, $2, $3)
       on conflict (restaurant_id, user_id) do update set role = excluded.role`,
      [c.restaurantId, created.id, c.role],
    );

    return json(200, { user_id: created.id, email: c.email, role: c.role });
  };
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
