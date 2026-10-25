/**
 * Columnas de migraciones recientes que la base puede no tener todavía.
 *
 * La app web se publica en cuanto se sube el código, y el SQL lo corre el
 * dueño en Supabase cuando puede. Pedir una columna que no existe hace
 * fallar toda la consulta (Postgres 42703) y dejaría la app sin tienda ni
 * pedidos. Así que se pide con las columnas nuevas y, si la base aún no
 * las tiene, se repite sin ellas y se recuerda para esta sesión.
 */

export const STORE_COLUMNS_0026 = ', transfer_bank, transfer_holder, transfer_clabe, mercadopago_link';
export const ORDER_COLUMNS_0026 = ', paid_confirmed_at';

let baseHas0026 = true;

interface Result<T> {
  readonly data: T | null;
  readonly error: { message: string; code?: string } | null;
}

export async function with0026<T>(run: (withNew: boolean) => PromiseLike<Result<T>>): Promise<Result<T>> {
  if (!baseHas0026) return run(false);
  const first = await run(true);
  if (first.error?.code === '42703') {
    baseHas0026 = false;
    return run(false);
  }
  return first;
}
