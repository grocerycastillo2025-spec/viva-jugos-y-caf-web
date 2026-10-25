# Crear y cobrar un pedido contra Clover

Fase 7, bloque de órdenes. **Sandbox únicamente**, Test Merchant
`RGW5JAVFT8MB1`.

Empieza por la pregunta que bloqueaba este bloque, porque la respuesta
cambia lo que hay debajo.

---

# Parte 1 — ¿El recargo va dentro del total de `checkouts`?

## La respuesta: NO va dentro

Y no viene de deducirla. La documentación de Clover lo dice con un ejemplo
aritmético: sobre un `amount` de $35,00 y un 3,5 %, *"the customer was
charged $36.22"*. Los $1,22 no están en el total: salen de
`additionalCharges`, de tipo `CREDIT_SURCHARGE`, en el **pago**.

```
total que cobra Clover = payment.amount + additionalCharges.amount
```

O sea la segunda rama de la disyuntiva: **el total que enseña la app no es
el que se cobra.**

## No se pudo medir, y hay dos razones — la segunda es la que importa

**La primera es de este entorno:** no tiene credenciales de Clover. Hay red
—`apisandbox.dev.clover.com` contesta `401`, que es el host respondiendo—
pero no hay `CLOVER_APP_ID`, ni `CLOVER_APP_SECRET`, ni token de acceso del
merchant, y el `SUPABASE_ACCESS_TOKEN` que sí está no autoriza (`supabase
projects list` devuelve `Unauthorized`). Sin credenciales no hay llamada.

**La segunda vale aunque aparezcan las credenciales, y es la que cierra el
asunto: el escenario no se puede montar en sandbox.** El recargo por
tarjeta **no se puede activar en un Test Merchant**. Está comprobado en el
panel el 2026-09-06 y escrito en `docs/RECARGO-TARJETA.md`:

- **Additional Charges** solo ofrece *service charges*, y la propia
  documentación de Clover advierte de que no se usen para recuperar el
  coste de procesamiento — que es exactamente lo que es un recargo por
  tarjeta;
- **Payments** trae cash back, redondeo, pagos offline, umbral, firma y
  *tenders*. Ninguna casilla de recargo.

Lo que significa para la prueba: un `checkouts` contra el sandbox
devolvería un total **sin recargo dentro**, y ese resultado es compatible
con las dos hipótesis a la vez. No hay recargo que incluir, así que no
incluirlo no demuestra nada. Sería un experimento que **parece** una
medición y no distingue nada, que es peor que no hacerlo: quedaría escrito
como "medido en sandbox" y cerraría la pregunta en falso.

Para medirlo de verdad hace falta un merchant **con recargo activo**, y eso
es producción. El arnés está escrito y listo para ese día:
`scripts/clover/medir-recargo.ts`. Hace la secuencia real y responde con un
veredicto; ver *Cómo medirlo cuando haya un merchant con recargo*.

## Lo que la respuesta cambia, y lo que no

**No cambia el flujo**, y esa es la buena noticia. La regla 27 ya dice que
se paga **la orden**, no un charge suelto, y nosotros **no le pasamos
`amount`** a `payOrder`: Clover cobra lo que la orden dice y aplica el
recargo por su cuenta. Así que el riesgo que abría la pregunta —*"si lo
incluye y nosotros lo sumamos, se cobra dos veces"*— **no existe en este
código: nosotros no sumamos nada, nunca**. Está fijado con una prueba, no
con una intención.

**Sí cambia dos cosas.**

### 1. `absorb` no era implementable, y se retiró

`absorb` significaba que el restaurante asume el recargo. Para que eso
ocurriera, alguien tendría que impedir que Clover se lo cobre al cliente. Y
mirando por dónde entra el recargo:

- lo aplica **Clover**, en el pago, según la configuración del merchant y
  el BIN de la tarjeta;
- `payOrder` manda `source`, `amount`, `tip_amount` y `currency`. **No hay
  un campo para renunciar al recargo**, ni lo habría: no es nuestro dinero
  ni nuestra decisión.

Así que una sucursal con `absorb` y recargo activo **no absorbía nada**: el
cliente lo pagaba igual, y encima en silencio, porque `absorb` suprimía el
aviso.

**Decisión tomada: la política se retira** (`0019_sin_absorb.sql`). Quedan
`show`, por defecto, y `block`. Las filas que estaban en `absorb` pasan a
`show`, que divulga — que es justo lo que faltaba. La única forma real de
absorber sigue existiendo y no es nuestra: que el restaurante apague el
recargo en su cuenta de Clover, y entonces `surcharge_rate` llega a 0 y la
política sobra.

El detalle, con lo que le pasa a los datos y por qué a `show` y no a
`block`, en `docs/RECARGO-TARJETA.md`.

### 2. El importe exacto no existe antes de pagar

El recargo solo cae sobre **tarjetas de crédito con BIN elegible**: no
sobre débito, no sobre efectivo, y las reglas las ponen las redes. Así que
ni el checkout ni la app pueden prometer la cifra final antes de conocer la
tarjeta.

Esto encaja con lo que la app ya hacía: enseña **subtotal** y dice que la
caja calcula el total. Ver `hasAuthoritativeTotal()`. Lo que este PR añade
es que, **después** de cobrar, el importe real queda guardado:
`payments.amount_cents` más `payments.surcharge_cents`.

**`CLOVER-PENDING` — decisión de producto, no de Clover.** Si el número que
enseña la app nunca va a ser el que se cobra, `"3,5 %"` es lo mejor que se
puede divulgar por adelantado y **sigue siendo un número distinto**. Falta
decidir cómo se le dice eso al cliente sin que parezca que se le oculta
algo, y hay que decidirlo antes de abrir la primera sucursal con recargo
activo. El detalle está en `docs/RECARGO-TARJETA.md`, *El número que se
enseña no es el que se cobra*.

---

# Parte 2 — El flujo

## El orden de operaciones, que no se negocia

```
1. tokenizar la tarjeta          el cliente, contra Clover. Aquí no entra un PAN
2. atomic_order/checkouts        totales e impuestos REALES
3. atomic_order/orders           la orden existe en el POS
4. POST /v1/orders/{id}/pay      se cobra LA ORDEN
5. print_event                   el ticket llega a cocina
```

**La orden se crea antes de cobrar.** Si el cobro falla, queda una orden
sin pagar que se anula: recuperable y visible. Al revés —cobrar y luego
crear— deja dinero cobrado sin pedido, que es el riesgo R10 y el peor
estado posible del sistema.

Está en `docs/AJUSTES-FLUJO-CLOVER.md`, variable 3, y el orden vive en el
código como un tipo: `Paso` en `workers/src/checkout/maquina.ts`. No es una
secuencia de llamadas que alguien pueda reordenar sin querer.

## Qué pasa cuando falla cada paso

| Falla en | Qué se hace con Clover | Estado del pedido | ¿Se cobró? |
|---|---|---|---|
| checkout de totales | nada que deshacer | `payment_pending`, reintentable | no |
| crear la orden | nada que deshacer | `payment_pending`, reintentable | no |
| **pagar** | **se anula la orden** | `payment_failed` | no |
| imprimir | nada: el pedido es válido | `confirmed`, sin `printed_at` | **sí** |

Las dos últimas filas son las que importan.

**El pago falla → se anula la orden.** Es la compensación, y es lo único
que impide dejar órdenes fantasma en el POS del merchant. Si la anulación
**también** falla, el pedido queda marcado y sale en una vista de guardia:
una orden viva en Clover que nadie va a pagar es basura que el restaurante
ve en su caja.

**La impresión falla y no se reembolsa nada.** El pedido está pagado y es
válido; el restaurante lo ve en la app de Orders. Es un problema operativo,
no financiero, y tratarlo como financiero —cancelar, devolver— convertiría
una impresora sin papel en un reembolso.

## La idempotencia, que es de lo que va todo esto

Una clave por intento, la misma de punta a punta: la de nuestra fila de
`checkout_attempts` viaja como `Idempotency-Key` a `atomic_order/orders` y
a `/pay`. Es lo único que separa «el cliente pulsó dos veces» de «el cliente
pagó dos veces».

El intento es una **máquina de estados persistida**, y cada paso se escribe
**antes** de la llamada que puede no volver:

```
started ─▶ totals_ok ─▶ order_created ─▶ paid ─▶ printed ─▶ done
                             │             │
                             │             └─▶ (fallo) ─▶ voiding ─▶ failed
                             └─▶ (fallo) ─▶ failed
```

Un reintento con la misma clave **no repite lo hecho**: mira el estado y
sigue desde ahí. Las dos propiedades que hacen que eso sea seguro:

1. **se apunta la intención antes de actuar.** Si el proceso muere entre el
   `update` y la llamada, el reintento sabe que esa llamada pudo haber
   ocurrido, y lo comprueba en vez de repetirla;
2. **nunca se salta hacia atrás.** Un intento en `paid` no vuelve a
   `order_created` ni aunque llegue una petición que lo pida.

`orders.idempotency_key` es `unique` desde la 0003, así que ni siquiera una
carrera puede crear dos pedidos con la misma clave: la base lo rechaza.

## Ya no hay puerta de `absorb`

Una versión anterior de este PR hacía que el checkout se negara a cobrar en
una sucursal con `absorb` y recargo activo. Sobra: la política ya no
existe. `open_checkout_attempt` solo comprueba `block`, que es la que dice
que esa sucursal no toma pedidos.

## Dónde vive cada cosa

| Pieza | Qué hace |
|---|---|
| `workers/src/checkout/maquina.ts` | El orden y los estados. Puro, sin red ni base |
| `workers/src/checkout/ports.ts` | Las fronteras: Clover y la base |
| `workers/src/checkout/flujo.ts` | La secuencia, con su compensación |
| `workers/src/checkout/postgres.ts` | El SQL |
| `supabase/functions/checkout/` | El cableado y la puerta de entrada |
| `supabase/migrations/0018_checkout_edge.sql` | Retira la RPC y añade lo que falta |
| `supabase/migrations/0019_sin_absorb.sql` | Retira la política `absorb` |
| `scripts/clover/medir-recargo.ts` | El arnés de la parte 1 |

## La RPC de la 0008 se retira aquí

`create_pickup_order` era explícitamente temporal, y su propio comentario
decía por qué y cuándo se retiraba: crear el pedido y cobrarlo tienen que
compartir idempotencia, y un RPC de Postgres no puede llamar a una API
externa.

**Se retira el `grant`, no la función.** Quitar el `execute` a
`authenticated` cierra la puerta —que es lo que importa: mientras siga
abierta, un cliente puede crear pedidos saltándose Clover— y dejar el
cuerpo permite volver atrás sin recuperar código de git si la Edge Function
diera problemas el primer día. El `drop function` va en una migración
posterior, cuando el flujo lleve semanas en pie.

Lo que se conserva al mudarla, porque son las reglas y no el envoltorio:

- los precios se releen de la base, **nunca llegan del teléfono**;
- un modificador tiene que pertenecer a un grupo de **ese** producto;
- horario, cierres y capacidad se validan en el servidor;
- la clave de idempotencia se graba **antes** de crear nada;
- la misma clave devuelve el pedido anterior, no crea un segundo.

Eso ahora vive en `app.open_checkout_attempt` (0018), que es la misma
lógica de validación sin la parte de Clover: la Edge Function la llama para
abrir el intento y después habla con Clover con lo que devuelve.

## Cómo medirlo cuando haya un merchant con recargo

```bash
CLOVER_APP_ID=... CLOVER_APP_SECRET=... \
CLOVER_MERCHANT_ID=... CLOVER_ACCESS_TOKEN=... \
CLOVER_ENVIRONMENT=production \
node --experimental-strip-types scripts/clover/medir-recargo.ts
```

Hace la secuencia real con una tarjeta de prueba y contesta lo único que
hay que saber:

```
subtotal de checkouts      3500
total de checkouts         3500   <- ¿lleva el recargo dentro?
payment.amount             3500
additionalCharges          122    <- CREDIT_SURCHARGE
cobrado de verdad          3622

VEREDICTO: el recargo NO esta en el total de checkouts.
```

Cobra de verdad. **No se apunta a un merchant de producción vivo sin
avisar al restaurante**, y lo que cobre hay que reembolsarlo. Por eso es un
script que alguien ejecuta a mano y no un test de CI.
