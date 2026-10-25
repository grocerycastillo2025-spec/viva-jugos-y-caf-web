/**
 * ¿El recargo por tarjeta está dentro del total de `atomic_order/checkouts`?
 *
 * ─────────────────────────────────────────────────────────────────────
 * ESTO NO SE PUEDE CONTESTAR EN SANDBOX, Y POR ESO ES UN SCRIPT
 * ─────────────────────────────────────────────────────────────────────
 *
 * El recargo por tarjeta NO se puede activar en un Test Merchant
 * (comprobado en el panel el 2026-09-06; ver docs/RECARGO-TARJETA.md). Un
 * `checkouts` de sandbox devolvería un total sin recargo dentro, y ese
 * resultado es compatible con las DOS hipótesis a la vez: no hay recargo
 * que incluir, así que no incluirlo no demuestra nada.
 *
 * Hace falta un merchant CON RECARGO ACTIVO, y eso es producción. Por eso
 * esto no es una prueba de CI: es algo que una persona ejecuta a mano, una
 * vez, cuando exista ese merchant.
 *
 * ─────────────────────────────────────────────────────────────────────
 * COBRA DINERO DE VERDAD
 * ─────────────────────────────────────────────────────────────────────
 *
 * Crea una orden y la paga. Contra un merchant de producción vivo eso es
 * un cobro real que hay que reembolsar, y no se hace sin avisar al
 * restaurante. El script pide confirmación explícita antes de cobrar.
 *
 *   CLOVER_APP_ID=... CLOVER_APP_SECRET=... \
 *   CLOVER_MERCHANT_ID=... CLOVER_ACCESS_TOKEN=... \
 *   CLOVER_ITEM_ID=<un item FIXED del inventario> \
 *   CLOVER_ENVIRONMENT=production CONFIRMO_QUE_COBRA=si \
 *   node --experimental-strip-types scripts/clover/medir-recargo.ts
 *
 * Sin `CONFIRMO_QUE_COBRA=si` se para justo antes del cobro y enseña lo
 * que haya averiguado hasta ahí — que ya incluye la mitad de la respuesta:
 * el total de `checkouts`.
 */

import { CloverClient } from '../../packages/clover-client/src/index.ts';
import type { CloverEnvironment } from '../../packages/clover-client/src/environments.ts';

function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') {
    console.error(`Falta ${nombre}. Ver la cabecera de este archivo.`);
    process.exit(2);
  }
  return valor;
}

const APP_ID = requerida('CLOVER_APP_ID');
const MERCHANT = requerida('CLOVER_MERCHANT_ID');
const TOKEN = requerida('CLOVER_ACCESS_TOKEN');
const ITEM = requerida('CLOVER_ITEM_ID');
const ENTORNO = (process.env['CLOVER_ENVIRONMENT'] ?? 'sandbox') as CloverEnvironment;
const COBRA = process.env['CONFIRMO_QUE_COBRA'] === 'si';

/** Tarjeta de prueba de Clover. En producción hace falta una real. */
const TARJETA = {
  number: process.env['CLOVER_TEST_CARD'] ?? '4111111111111111',
  exp_month: '12',
  exp_year: '2027',
  cvv: '123',
};

const cliente = new CloverClient({ environment: ENTORNO, appId: APP_ID });

function dinero(centavos: number | undefined): string {
  return centavos === undefined ? '(ausente)' : `${centavos} (${(centavos / 100).toFixed(2)})`;
}

async function main(): Promise<void> {
  console.log(`\nMerchant ${MERCHANT} en ${ENTORNO}\n${'='.repeat(60)}`);

  // ── ¿Tiene recargo activo? Si no, la medición no distingue nada ──
  const configs = await cliente.merchants.ecommPaymentConfigs({
    merchantId: MERCHANT,
    token: TOKEN,
  });
  const recargoActivo = configs.surcharging?.supported === true;
  const tasa = configs.surcharging?.rate;
  console.log(`recargo activo en el merchant   ${recargoActivo ? 'SI' : 'NO'}`);
  console.log(`tasa (fraccion)                 ${tasa ?? '(ausente)'}`);

  if (!recargoActivo) {
    console.log(
      `\nPARA. Este merchant no tiene recargo activo, asi que un total sin` +
        `\nrecargo dentro no demuestra nada: es compatible con las dos` +
        `\nhipotesis. Hace falta un merchant CON recargo. Ver` +
        `\ndocs/PEDIDOS-COBRO.md, parte 1.\n`,
    );
    process.exit(1);
  }

  // ── 2. Totales ──────────────────────────────────────────────────
  const carrito = { lineItems: [{ item: { id: ITEM } }] };
  const totales = await cliente.orders.checkout({
    merchantId: MERCHANT,
    token: TOKEN,
    cart: carrito,
  });
  console.log(`\nsubtotal de checkouts           ${dinero(totales.subtotal)}`);
  console.log(`impuesto de checkouts           ${dinero(totales.tax)}`);
  console.log(`TOTAL de checkouts              ${dinero(totales.total)}   <- ¿lleva el recargo?`);

  const esperadoSinRecargo = (totales.subtotal ?? 0) + (totales.tax ?? 0);
  const sobra = (totales.total ?? 0) - esperadoSinRecargo;
  console.log(`total - (subtotal + impuesto)   ${sobra}   <- si es 0, no lo lleva`);

  if (!COBRA) {
    console.log(
      `\nNo se cobra: falta CONFIRMO_QUE_COBRA=si.` +
        `\nLa otra mitad de la respuesta —additionalCharges— solo existe` +
        `\ndespues de un cobro real.\n`,
    );
    return;
  }

  // ── 3. Crear, cobrar y leer el recargo ───────────────────────────
  const clave = `medir-recargo-${Date.now()}`;
  const orden = await cliente.orders.createAtomicOrder({
    merchantId: MERCHANT,
    token: TOKEN,
    cart: carrito,
    idempotencyKey: clave,
  });
  console.log(`\norden creada                    ${orden.id}  (total ${dinero(orden.total)})`);

  const llave = await cliente.ecommerce.apiAccessKey({ merchantId: MERCHANT, token: TOKEN });
  const tarjeta = await cliente.ecommerce.tokenizeCard({
    merchantId: MERCHANT,
    apiAccessKey: llave.apiAccessKey,
    card: TARJETA,
  });

  const pago = await cliente.ecommerce.payOrder({
    merchantId: MERCHANT,
    token: TOKEN,
    orderId: orden.id,
    source: tarjeta.id,
    idempotencyKey: clave,
  });

  const cargos = pago.additionalCharges?.elements ?? [];
  const recargo = cargos.reduce((suma, c) => suma + (c.amount ?? 0), 0);

  console.log(`\npayment.amount                  ${dinero(pago.amount)}`);
  console.log(
    `additionalCharges               ${dinero(recargo)}  ${cargos.map((c) => c.type ?? '?').join(', ')}`,
  );
  console.log(`COBRADO DE VERDAD               ${dinero((pago.amount ?? 0) + recargo)}`);

  const dentro = sobra > 0 && recargo === 0;
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    dentro
      ? 'VEREDICTO: el recargo SI esta en el total de checkouts.\n' +
          '  -> NO sumarlo en ningun sitio. Revisar que nadie lo sume.'
      : 'VEREDICTO: el recargo NO esta en el total de checkouts.\n' +
          '  -> va aparte, en additionalCharges del pago. Es lo que el codigo\n' +
          '     ya asume: se paga LA ORDEN y no se le pasa importe.',
  );
  console.log(`\nHAY UN COBRO DE ${dinero((pago.amount ?? 0) + recargo)} QUE REEMBOLSAR.`);
  console.log(`pago: ${pago.id} | orden: ${orden.id}\n`);
}

main().catch((err: unknown) => {
  console.error('\nFALLO:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
