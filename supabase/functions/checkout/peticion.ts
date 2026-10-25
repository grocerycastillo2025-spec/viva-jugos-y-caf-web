/**
 * Lo que se lee del cuerpo, y lo que NO se lee.
 *
 * ─────────────────────────────────────────────────────────────────────
 * DE AQUÍ NO SALE NI UN PRECIO
 * ─────────────────────────────────────────────────────────────────────
 *
 * El teléfono manda ids y cantidades. Si mandara además `price_cents`,
 * este módulo lo tiraría sin mirarlo: los precios se releen del catálogo
 * en `app.open_checkout_attempt` (0018). No es una comprobación, es que
 * el tipo de salida no tiene dónde meterlo.
 *
 * Lo mismo con el total y con el impuesto: los pone Clover.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una línea tal como la manda la app: qué y cuánto, nada más. */
export interface LineaPedida {
  readonly cloverItemId: string;
  readonly quantity: number;
  readonly note: string | null;
  readonly modifiers: readonly string[];
}

export interface PeticionCheckout {
  readonly storeId: string;
  readonly idempotencyKey: string;
  readonly pickupAt: string;
  readonly isAsap: boolean;
  readonly customerNote: string | null;
  readonly items: readonly LineaPedida[];
  /** El token `clv_...` de un solo uso. Nunca una tarjeta. */
  readonly source: string;
  readonly tipCents: number;
}

export type Lectura =
  | { readonly ok: true; readonly peticion: PeticionCheckout }
  | { readonly ok: false; readonly error: string };

export function leerPeticion(cuerpo: unknown): Lectura {
  if (typeof cuerpo !== 'object' || cuerpo === null) return mal('cuerpo_invalido');
  const c = cuerpo as Record<string, unknown>;

  const storeId = texto(c['store_id']);
  if (storeId === null || !UUID.test(storeId)) return mal('store_id_invalido');

  // El mínimo es el mismo que exige la 0008 y ahora la 0018: una clave
  // corta es una clave adivinable, y adivinar una clave ajena devuelve el
  // pedido de otro.
  const idempotencyKey = texto(c['idempotency_key']);
  if (idempotencyKey === null || idempotencyKey.length < 8) return mal('idempotency_key_invalida');

  const pickupAt = texto(c['pickup_at']);
  if (pickupAt === null || Number.isNaN(Date.parse(pickupAt))) return mal('pickup_at_invalido');

  // SIN TOKEN NO SE EMPIEZA. Abrir el intento —que crea un pedido en
  // nuestra base— para descubrir después que no hay con qué cobrar deja
  // basura y ocupa una franja de recogida.
  const source = texto(c['source']);
  if (source === null) return mal('source_requerido');

  const brutos = c['items'];
  if (!Array.isArray(brutos) || brutos.length === 0) return mal('carrito_vacio');

  const items: LineaPedida[] = [];
  for (const bruto of brutos) {
    if (typeof bruto !== 'object' || bruto === null) return mal('item_invalido');
    const i = bruto as Record<string, unknown>;
    const cloverItemId = texto(i['clover_item_id']);
    if (cloverItemId === null) return mal('item_sin_id');

    const mods = i['modifiers'];
    items.push({
      cloverItemId,
      // El tope de 99 es el mismo que la base: aquí se recorta para que
      // un número absurdo no llegue a construir un carrito gigante.
      quantity: Math.max(1, Math.min(99, entero(i['quantity'], 1))),
      note: texto(i['note']),
      modifiers: Array.isArray(mods) ? mods.map((m) => String(m)).filter((m) => m !== '') : [],
    });
  }

  return {
    ok: true,
    peticion: {
      storeId,
      idempotencyKey,
      pickupAt,
      isAsap: c['is_asap'] === true,
      customerNote: texto(c['customer_note']),
      items,
      source,
      // Negativa no: una propina negativa es un descuento que nadie
      // autorizó. Cero es legítimo.
      tipCents: Math.max(0, entero(c['tip_cents'], 0)),
    },
  };
}

/** Lo que se le manda a la base: ids y cantidades. Ni un importe. */
export function itemsParaLaBase(items: readonly LineaPedida[]): unknown {
  return items.map((i) => ({
    clover_item_id: i.cloverItemId,
    quantity: i.quantity,
    note: i.note,
    modifiers: i.modifiers,
  }));
}

function mal(error: string): Lectura {
  return { ok: false, error };
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

function entero(valor: unknown, porDefecto: number): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : porDefecto;
}
