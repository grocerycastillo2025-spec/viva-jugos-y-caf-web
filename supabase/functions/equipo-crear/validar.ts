/**
 * Validación de "crear cuenta del equipo" (sin red ni base).
 */

export interface NuevaCuenta {
  readonly restaurantId: string;
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly role: 'owner' | 'staff';
}

export type Lectura = { readonly ok: true; readonly cuenta: NuevaCuenta } | { readonly ok: false; readonly error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function leerNuevaCuenta(body: unknown): Lectura {
  const b = (body ?? {}) as Record<string, unknown>;
  const restaurantId = String(b['restaurant_id'] ?? '');
  const email = String(b['email'] ?? '').trim().toLowerCase();
  const password = String(b['password'] ?? '');
  const name = String(b['name'] ?? '').trim();
  const role = b['role'];
  if (!UUID.test(restaurantId)) return { ok: false, error: 'restaurante_invalido' };
  if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: 'correo_invalido' };
  if (password.length < 8 || password.length > 72) return { ok: false, error: 'contrasena_corta' };
  if (name.length < 1 || name.length > 80) return { ok: false, error: 'nombre_invalido' };
  if (role !== 'owner' && role !== 'staff') return { ok: false, error: 'rol_invalido' };
  return { ok: true, cuenta: { restaurantId, email, password, name, role } };
}
