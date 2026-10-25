/**
 * El checkout contra Postgres. SQL explícito, sin ORM (§17).
 *
 * LO QUE **NO** ESTÁ AQUÍ, Y ES LO IMPORTANTE: la validación del carrito.
 * Esa vive en `app.open_checkout_attempt` (0018), dentro de la base, y no
 * se sube aquí ni por comodidad. Dos razones:
 *
 *   valida contra datos que están en la base —catálogo, horario,
 *   capacidad— y traerlos a memoria para decidir es pedir una carrera;
 *
 *   es `security definer`. El cliente sigue sin poder escribir en
 *   `orders`: lo único que puede hacer es pedirle a esa función que
 *   escriba por él, y esa función no le cree ni un precio.
 *
 * Aquí solo hay movimiento de estado y escritura de lo que dijo Clover.
 */

import type { Estado } from './maquina.ts';
import type { CheckoutStore, Cobro, Intento, LineaValidada } from './ports.ts';
// El contrato con la base es el mismo para los tres trabajos y vive suelto
// en `../sql.ts`. No se declara aqui para no acabar con tres declaraciones
// identicas que el compilador ve como tres tipos distintos.
export type { SqlRunner } from '../sql.ts';
import type { SqlRunner } from '../sql.ts';

export function postgresCheckoutStore(sql: SqlRunner): CheckoutStore {
  return {
    /**
     * `where state = $2` no es decoración: es lo que hace que dos
     * ejecuciones sobre el mismo intento no se pisen. La que llega
     * segunda no encuentra la fila en el estado que esperaba y no
     * escribe. El trigger de la 0018 para el caso general —ir hacia
     * atrás—; esto para el concreto de dos procesos a la vez.
     */
    async avanzar(intentoId: string, desde: Estado, hasta: Estado): Promise<void> {
      const filas = await sql(
        `update public.checkout_attempts set state = $3
          where id = $1 and state = $2
         returning id`,
        [intentoId, desde, hasta],
      );
      if (filas.length === 0) {
        throw new Error(
          `El intento ${intentoId} ya no estaba en "${desde}": otra ejecución lo movió. ` +
            'No se escribe nada — en el camino del dinero, perder una carrera es pararse.',
        );
      }
    },

    /**
     * Los totales de `atomic_order/checkouts`. ES EL ÚNICO ORIGEN del
     * total del pedido: calcular impuestos por nuestra cuenta y que Clover
     * cobre otra cosa es un problema legal, no un detalle (regla 9).
     */
    async guardarTotales(orderId, totales): Promise<void> {
      await sql(
        `update public.orders
            set subtotal_cents = $2, tax_cents = $3, total_cents = $4
          where id = $1`,
        [orderId, totales.subtotalCents, totales.taxCents, totales.totalCents],
      );
    },

    async guardarOrdenClover(orderId: string, cloverOrderId: string): Promise<void> {
      await sql('update public.orders set clover_order_id = $2 where id = $1', [
        orderId,
        cloverOrderId,
      ]);
    },

    /**
     * El cobro. Dos escrituras en una sentencia porque son un solo hecho:
     * el pedido está pagado Y existe el pago que lo prueba.
     *
     * `surcharge_cents` va APARTE de `amount_cents` y no sumado: el
     * recargo por tarjeta no está dentro del total de la orden, y lo que
     * el cliente ve en su extracto es la suma de los dos. Sumarlos aquí
     * haría que `amount_cents` dejara de cuadrar con la orden.
     */
    async guardarCobro(orderId: string, cobro: Cobro): Promise<void> {
      await sql(
        `with pago as (
           insert into public.payments
             (order_id, tenant_id, provider, provider_payment_id, amount_cents,
              tip_cents, surcharge_cents, status, card_brand, card_last4)
           select $1, o.tenant_id, 'clover', $2, $3, $4, $5, 'succeeded', $6, $7
             from public.orders o where o.id = $1
           on conflict (provider, provider_payment_id) do update
              set amount_cents = excluded.amount_cents,
                  surcharge_cents = excluded.surcharge_cents,
                  status = 'succeeded'
           returning order_id
         )
         update public.orders
            set status = 'confirmed',
                clover_payment_state = 'paid',
                tip_cents = $4
          where id = (select order_id from pago)`,
        [
          orderId,
          cobro.providerPaymentId,
          cobro.amountCents,
          cobro.tipCents,
          cobro.surchargeCents,
          cobro.cardBrand,
          cobro.cardLast4,
        ],
      );
    },

    /**
     * El pedido no se cancela: se marca `payment_failed`.
     *
     * Son estados distintos y el cliente los lee distinto. `canceled` es
     * "alguien lo canceló"; `payment_failed` es "no se pudo cobrar", que
     * es lo que hay que enseñarle a quien acaba de ver un error en su
     * tarjeta.
     */
    async marcarCobroFallido(orderId: string, error: string): Promise<void> {
      await sql(
        `update public.orders
            set status = 'payment_failed', cancel_reason = left($2, 500)
          where id = $1`,
        [orderId, error],
      );
    },

    async marcarImpreso(orderId: string, ok: boolean): Promise<void> {
      await sql(
        ok
          ? 'update public.orders set printed_at = now(), print_failed_at = null where id = $1'
          : 'update public.orders set print_failed_at = now() where id = $1',
        [orderId],
      );
    },

    /**
     * Quedó una orden SIN PAGAR viva en el POS del merchant. No hay una
     * segunda compensación que inventar: se deja escrito y sale en
     * `checkouts_atascados`, que es donde alguien la ve y la anula a mano.
     */
    async marcarAnulacionPendiente(intentoId: string, error: string): Promise<void> {
      await sql('update public.checkout_attempts set error = left($2, 1000) where id = $1', [
        intentoId,
        error,
      ]);
    },

    async terminar(intentoId: string, resultado: unknown): Promise<void> {
      await sql(
        `update public.checkout_attempts set state = 'done', result = $2::jsonb where id = $1`,
        [intentoId, JSON.stringify(resultado)],
      );
    },
  };
}

/**
 * Abre —o recupera— el intento, llamando a la función de la 0018.
 *
 * Todo lo que decide sale de ahí: si la sucursal puede vender, si la hora
 * vale, qué cuestan las cosas. Aquí solo se traduce la forma.
 */
export async function abrirIntento(
  sql: SqlRunner,
  input: {
    readonly userId: string;
    readonly storeId: string;
    readonly idempotencyKey: string;
    readonly pickupAt: string;
    readonly isAsap: boolean;
    readonly customerNote: string | null;
    readonly items: unknown;
  },
): Promise<Intento> {
  const filas = await sql(
    'select app.open_checkout_attempt($1, $2, $3, $4::timestamptz, $5, $6, $7::jsonb) as intento',
    [
      input.userId,
      input.storeId,
      input.idempotencyKey,
      input.pickupAt,
      input.isAsap,
      input.customerNote,
      JSON.stringify(input.items),
    ],
  );
  const crudo = filas[0]?.['intento'];
  if (crudo === undefined || crudo === null) {
    throw new Error('app.open_checkout_attempt no devolvió intento');
  }
  return toIntento(
    typeof crudo === 'string' ? JSON.parse(crudo) : (crudo as Record<string, unknown>),
  );
}

/**
 * El título y la nota son el ÚNICO sitio donde cabe la hora de recogida:
 * Clover no tiene campo para eso y estos dos sí se imprimen.
 *
 * Sin acentos ni emojis: las impresoras térmicas los degradan y el ticket
 * llega a cocina con caracteres rotos. La convención está fijada en el
 * addendum, variable 2.
 */
export function tituloDePedido(orderNumber: number, pickupAt: Date | null): string {
  return `APP #${orderNumber}${pickupAt === null ? '' : ` - PICKUP ${horaCorta(pickupAt)}`}`;
}

export function notaDePedido(
  orderNumber: number,
  pickupCode: string,
  pickupAt: Date | null,
): string {
  const lineas = [
    'PEDIDO MOVIL',
    `Pedido: #${orderNumber}`,
    pickupAt === null ? null : `Recoge: ${horaCorta(pickupAt)}`,
    `Codigo: ${pickupCode}`,
  ];
  return lineas.filter((l): l is string => l !== null).join('\n');
}

function horaCorta(fecha: Date): string {
  // UTC a propósito: la zona del merchant no está aquí, y una hora
  // convertida con la zona equivocada es peor que una hora en UTC — la
  // primera parece correcta. La Edge Function pasa la hora ya local.
  const h = fecha.getUTCHours();
  const m = String(fecha.getUTCMinutes()).padStart(2, '0');
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

function toIntento(fila: Record<string, unknown>): Intento {
  const orderNumber = Number(fila['order_number'] ?? 0);
  const pickupAt = fecha(fila['pickup_at']);
  const pickupCode = String(fila['pickup_code'] ?? '');
  return {
    id: String(fila['attempt_id']),
    idempotencyKey: String(fila['idempotency_key']),
    estado: String(fila['state']) as Intento['estado'],
    orderId: String(fila['order_id']),
    storeId: String(fila['store_id']),
    merchantId: String(fila['merchant_id'] ?? ''),
    environment: String(fila['environment'] ?? 'sandbox'),
    orderNumber,
    pickupCode,
    pickupAt,
    subtotalCents: Number(fila['subtotal_cents'] ?? 0),
    lineas: leerLineas(fila['lineas']),
    cloverOrderId: texto(fila['clover_order_id']),
    titulo: tituloDePedido(orderNumber, pickupAt),
    nota: notaDePedido(orderNumber, pickupCode, pickupAt),
  };
}

function leerLineas(valor: unknown): readonly LineaValidada[] {
  if (!Array.isArray(valor)) return [];
  return valor.map((l) => {
    const linea = l as Record<string, unknown>;
    const mods = Array.isArray(linea['modificadores']) ? linea['modificadores'] : [];
    return {
      cloverItemId: String(linea['clover_item_id']),
      nombre: String(linea['nombre'] ?? ''),
      cantidad: Number(linea['cantidad'] ?? 1),
      unitPriceCents: Number(linea['unit_price_cents'] ?? 0),
      nota: texto(linea['nota']),
      modificadores: mods.map((m) => ({
        cloverModifierId: String((m as Record<string, unknown>)['clover_modifier_id']),
      })),
    };
  });
}

function fecha(valor: unknown): Date | null {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor;
  const d = new Date(String(valor));
  return Number.isNaN(d.getTime()) ? null : d;
}

function texto(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : String(valor);
}
