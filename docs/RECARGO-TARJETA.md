# El recargo por tarjeta de crédito en la app

Qué se le enseña al cliente, dónde, y por qué exactamente así. Esto no es
una decisión de diseño: es Nueva Jersey.

## La ley, y qué obliga a cada cosa

**P.L. 2023, c.146** — N.J.S.A. 56:8-156.1 y 56:8-156.2. Lo de abajo sale
de la FAQ oficial de la **NJ Division of Consumer Affairs**.

### 1. Hay que decir el IMPORTE, no que existe un recargo

La ley dice explícitamente que divulgar **solo** que se aplicará un
recargo, sin el importe, **no basta**. El ejemplo de incumplimiento que da
la propia FAQ es un cartel que dice *"imponemos un recargo que no excede
nuestros costes de procesamiento"*.

Consecuencia directa, y corrige lo que este proyecto asumía antes:
**no vale "hasta un 3 %"**. Un máximo no es un importe. Va **"3 %"**.

Cómo está implementado, para que no se pueda romper por descuido:

- `strings.surcharge.*` son **funciones que exigen el porcentaje**. No
  existe ninguna cadena de recargo sin cifra que alguien pueda pintar.
- `SurchargeNotice` no recibe un booleano "hay recargo": recibe la
  divulgación de `domain/surcharge.ts`, y **devuelve `null` si no trae
  `percentLabel`**. La única forma de que el aviso aparezca es teniendo el
  número.
- `formatRatePercent` **redondea hacia arriba** a dos decimales de
  porcentaje. Anunciar 3,45 % y cobrar 3,456 % sería cobrar más de lo
  divulgado, que es la infracción; anunciar 3,46 % solo es ser
  conservador. Cuando el redondeo tiene que equivocarse, se equivoca en
  contra del restaurante.

### 2. El porcentaje vale como importe

No hace falta la cifra en dólares antes de saber con qué tarjeta se paga.
Eso resuelve la tensión que tenía este flujo: `stores.surcharge_rate` se
enseña como porcentaje y con eso ya está divulgado.

**Y por eso la app NO enseña una estimación en dólares.** Podría:
`subtotal × rate`. Sería un número equivocado. El recargo se aplica sobre
el **total**, y el total lleva impuestos que esta app no calcula a
propósito (regla del proyecto: *no inventamos impuestos*, los calcula la
caja). Una estimación sobre el subtotal sale **siempre por debajo** de lo
que se cobra, que es justo el error que la ley castiga. Como el porcentaje
ya es divulgación válida, la cifra en dólares no aporta y solo puede
restar.

`surchargeOnCents()` existe en el módulo pero **no la usa ninguna
pantalla**. Está para el día que la app conozca el total real que devuelve
Clover, que es el único importe sobre el que esa cuenta no miente.

### 3. Dónde: aviso electrónico claro y visible en el checkout

Obligatorio. En la app son **dos apariciones en la misma pantalla**, y no
es un descuido:

| Sitio | Forma | Por qué |
|---|---|---|
| `app/checkout.tsx`, en el resumen | tarjeta | El aviso completo, pegado al dinero |
| `app/checkout.tsx`, en el pie fijo | línea | El botón "Place order" vive en un pie **fijo**: se puede pulsar sin haber bajado nunca al resumen. Un aviso que el cliente puede no llegar a ver no es "claro y visible" |

Y una tercera, en `app/pay/[id].tsx`, que es donde se elige la tarjeta y se
pulsa pagar — el último momento en que el cliente puede echarse atrás. Ahí
el porcentaje se lee de **`order.store_id`**, no de la sucursal elegida
ahora mismo: si el cliente cambió de local con un pedido a medias,
anunciar el porcentaje de otra sucursal sería peor que no anunciar
ninguno.

### 4. Restaurantes: el importe también en la carta

Incluidas **las cartas en línea o por QR**. Viva es un juice bar con
comida, así que aplica. La pestaña de menú de esta app *es* esa carta, y
por eso el aviso sale también ahí.

Va en la **cabecera fija**, no en un pie de lista: un pie lo cumpliría de
boquilla, porque nadie baja cincuenta productos para leerlo. Ocupa una
línea, y solo cuando la sucursal tiene recargo.

El carrito lo lleva por el mismo motivo que la carta: enseña un subtotal
que tampoco lo incluye.

### 5. El recargo no puede exceder el coste real de procesamiento

Responsabilidad del **negocio**, no de la app. Pero la app no debe
facilitar el incumplimiento, y por eso `stores.surcharge_rate` es **lo
último leído de Clover** (`ecomm_payment_configs`, migración `0011`), no
un valor que alguien tecleó. `domain/surcharge.ts` no acepta otra fuente.

## Las salidas de `surchargeDisclosure`

| `surcharge_rate` | Política | Qué pasa |
|---|---|---|
| `null` | cualquiera | Silencio. No se ha consultado Clover: no sabemos si hay recargo. Con `show` se marca `unknownRate` |
| `0` | cualquiera | Silencio. Consultado y sin recargo. Correcto |
| `> 0` | `show` | **Se divulga con su porcentaje.** El caso normal |
| `> 0` | `block` | Silencio: esa sucursal no toma pedidos |

Una política desconocida cae en `show`: callarse mientras se cobra de más
es el único fallo caro. **Un `absorb` que sobreviva** en una fila vieja o
en un cliente sin actualizar cae también en `show`, que es exactamente lo
que hace la migración al convertir los datos.

Nótese que ya no hay ninguna salida que **calle mientras se cobra**. La
única que calla es `block`, y calla porque no hay pedido. Hay una prueba
que recorre las políticas y exige justo eso.

## Dos cosas pendientes, dichas en voz alta

### `absorb` se retiró: prometía algo que no podía cumplir

**Decisión tomada el 2026-09-12. La política ya no existe**
(`0019_sin_absorb.sql`). Quedan dos: `show`, por defecto, y `block`.

`absorb` significaba *"el restaurante asume el recargo, así que al cliente
no se le enseña nada"*. La segunda mitad se cumplía. La primera no.

**El hallazgo que lo cierra, y es concreto: el endpoint de cobro no tiene
campo para renunciar al recargo.** `POST /v1/orders/{id}/pay` acepta
`source`, `amount`, `tip_amount` y `currency`, y nada más. El recargo lo
aplica Clover según la configuración del merchant y el BIN de la tarjeta,
y aparece después en `additionalCharges` del pago. No hay parámetro que
mandar ni cabecera que poner: no es que no lo hubiéramos implementado, es
que no se puede pedir.

Así que una sucursal con `absorb` y recargo activo **no absorbía nada**:

- el cliente pagaba el recargo igual,
- y además **en silencio**, porque `absorb` suprimía el aviso.

Dos fallos a la vez, y el segundo es el caro:

1. **faltaba un aviso obligatorio.** En Nueva Jersey eso es *la*
   infracción, no un detalle de redacción;
2. **el restaurante se equivocaba sobre su propia economía**, y en la
   dirección que le hacía creer que estaba siendo generoso: creía pagar un
   coste que pagaba su cliente.

Que el cliente pague el recargo en silencio es exactamente lo que el aviso
existe para evitar. Una política que promete absorber y no absorbe es peor
que no tenerla.

**La única forma real de absorber sigue existiendo y no es nuestra:** que
el restaurante apague el recargo en su cuenta de Clover. Entonces
`surcharge_rate` llega a 0 y no hace falta ninguna política.

#### Qué le pasó a los datos

Las filas que estaban en `absorb` pasaron a `show`, no a `block`: `block`
las dejaría sin vender por un cambio nuestro, y el problema no era que
vendieran, era que callaban.

**Consecuencia que se busca:** esas sucursales ahora **enseñan** el aviso
en la app. Si alguien eligió `absorb` creyendo que su local pagaba la
diferencia, se va a encontrar con un aviso que antes no estaba. Conviene
avisar al restaurante, porque puede que llevara tiempo creyendo que
asumía un coste que en realidad pagaba su cliente.

Y a esas sucursales se les vuelve a marcar `surcharge_reviewed` en
`false`: tomaron una decisión que ya no existe. **No deja a nadie sin
servicio** — el trigger de activación salta en `update of status`, y la
migración no cambia el estado de nadie. Una sucursal activa sigue activa;
lo que cambia es que la próxima vez que alguien toque su estado tendrá que
repasar el recargo.

### El número que se enseña no es el que se cobra

**`CLOVER-PENDING` — decisión de PRODUCTO, pendiente antes de abrir la
primera sucursal con recargo activo.** No la desbloquea Clover ni una
línea de código: hay que decidirla.

Cuando hay recargo, el número que enseña la app **nunca** será el que se
cobra. El recargo cae solo sobre tarjetas de crédito con **BIN elegible**:
no sobre débito, no sobre efectivo, y las reglas las ponen las redes de
tarjetas. Así que el importe exacto no existe hasta conocer la tarjeta.

`"3,5 %"` es divulgación válida según la FAQ de NJ, y es lo mejor que se
puede hacer por adelantado. Sigue siendo un número distinto del cobro, en
dos sentidos a la vez: puede que al cliente no se le aplique, y si se le
aplica, el importe en dólares depende de un total que la app no calcula.

Lo que falta decidir es **cómo se le dice eso al cliente sin que parezca
que se le oculta algo**. Hoy la app enseña el porcentaje y un subtotal, y
dice que la caja calcula el total. Falta la frase que explique que el
recargo puede no aplicarse a su tarjeta.

No bloquea el sandbox, donde el recargo ni siquiera se puede encender.

### `unknownRate` no bloquea el pedido

Hay recargo activo y no sabemos cuánto es. No se puede pintar un aviso
—sería el cartel sin cifra del punto 1— y tampoco se debería cobrar.

Hoy ese estado **no puede llegar a una sucursal viva**: la casilla
`surcharge_reviewed` del checklist (migración `0011`) impide activar una
sucursal sin que alguien haya mirado el recargo, y el trigger
`trg_stores_activation` cuenta esa casilla. El candado está antes, en la
activación, no en el checkout.

Se expone el flag igualmente para que el día que ese candado se afloje,
esto no se caiga en silencio. Bloquear el checkout sería la decisión
segura desde el punto de vista legal y la peligrosa desde el punto de
vista del negocio —dejaría la sucursal sin vender por un fallo de carga de
datos—, así que **no se toma aquí**: es una decisión de producto.

## Cómo verlo en desarrollo

El seed no rellena estas columnas a propósito: el valor tiene que venir de
Clover, no de un fichero nuestro. Para probar la pantalla en local:

```sql
update public.stores
   set surcharge_rate = 0.03,          -- fracción: 0.03 = 3 %
       surcharge_policy = 'show',
       surcharge_checked_at = now()
 where slug = 'freehold';
```

Y para volver al estado real, `surcharge_rate = null`.

Ojo con la escala: `stores.surcharge_rate` es una **fracción** (`0.03`),
mientras que `catalog_tax_rates.rate` va en **milésimas de porcentaje**
(`8250` = 8,25 %). Mezclarlas da un número cien veces mayor.

## Dónde está cada pieza

| Fichero | Qué hace |
|---|---|
| `apps/mobile/src/domain/surcharge.ts` | Decide **si** se divulga y **con qué cifra**. Puro y probado |
| `apps/mobile/src/__tests__/surcharge.test.ts` | Las reglas de arriba, como aserciones |
| `apps/mobile/src/hooks/use-surcharge.ts` | Resuelve **de qué sucursal** hablamos |
| `apps/mobile/src/components/SurchargeNotice.tsx` | Las dos formas del aviso |
| `apps/mobile/src/strings.ts` (`surcharge`) | La copia. Todas las cadenas exigen el porcentaje |
| `supabase/migrations/0011_recargo.sql` | Las tres columnas y la casilla del checklist |
| `supabase/migrations/0019_sin_absorb.sql` | Retira `absorb`, migra los datos y explica por qué |
| `packages/clover-client/src/surcharge.ts` | El lado del **super admin**, en español. Es otro público: no se comparte código con este |
