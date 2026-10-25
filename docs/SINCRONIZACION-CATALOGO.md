# Sincronización de catálogo: Clover → Supabase

Fase 7, pieza 2 de 5. **Sandbox únicamente**, Test Merchant `RGW5JAVFT8MB1`.

Este documento es el contrato del mapeo. Se escribió **antes** del código y
el código no puede contradecirlo: si algún día hace falta cambiar una regla
de aquí, se cambia aquí primero y después en `workers/src/catalog-sync`.

## Lo que hace este PR, y lo que no

**Hace**: un barrido completo del catálogo, bajo demanda, idempotente, con
reporte. Categorías, tasas de impuesto, grupos de modificadores,
modificadores e ítems.

**No hace**, y no por falta de tiempo:

- **webhooks de inventario.** Van en un PR posterior. Pero el mapeo vive en
  un módulo puro (`mapping.ts`) que recibe un objeto de Clover y devuelve
  una fila: un webhook que traiga un solo ítem reutiliza exactamente la
  misma función, sin copiar una línea. La puerta queda abierta a propósito;
  lo que no hay es un consumidor de webhooks todavía;
- **purgado de los `SEED-`.** Conviven con lo sincronizado a propósito, para
  poder comparar. Ver *El catálogo seed* abajo;
- **barrido periódico.** Se dispara a mano. No hay `pg_cron` aquí;
- **borrado de lo que desapareció de Clover.** Un barrido completo puede
  decir "este ítem ya no está", y aun así no se marca `deleted_at`. Ver
  *Por qué este barrido no borra*.

## La frontera de propiedad

**Ningún campo tiene dos dueños.** No es una aspiración: es que cada columna
de este sistema tiene exactamente un escritor, y se puede comprobar leyendo
la tabla de abajo.

| Tabla | Dueño | Quién escribe |
|---|---|---|
| `catalog_categories` | Clover | solo la sincronización |
| `catalog_tax_rates` | Clover | solo la sincronización |
| `catalog_items` | Clover | solo la sincronización |
| `catalog_item_tax_rates` | Clover | solo la sincronización |
| `catalog_modifier_groups` | Clover | solo la sincronización |
| `catalog_modifiers` | Clover | solo la sincronización |
| `catalog_item_modifier_groups` | Clover | solo la sincronización |
| `app_item_overrides` | Supabase | solo el SaaS |

La frontera no pasa por dentro de ninguna fila: pasa **entre tablas**. Una
sincronización escribe en las siete primeras y **no menciona
`app_item_overrides` en ninguna sentencia**, ni para leerla. Eso es lo que
hace que "no tocar las fotos" sea una propiedad del código y no una
disciplina: no hay ningún `update` que pudiera tocarlas.

Y al revés: el SaaS nunca escribe en `catalog_*`. Si alguien quiere cambiar
un precio, lo cambia en Clover.

### Dónde se juntan, y por qué eso no es un conflicto

La vista `menu_items` **lee** de los dos lados y decide qué enseña la app:

```
description  = coalesce(overrides.marketing_copy, items.alternate_name)
image_url    = overrides.image_url
sort_order   = overrides.sort_order
price_cents  = items.price_cents          <- nunca de los overrides
is_available = f(items.available, items.hidden, items.price_type,
                 overrides.app_visible, overrides.unavailable_until)
```

Eso es **precedencia de presentación**, no resolución de conflictos. La
diferencia importa y es esta: un conflicto es cuando dos escritores se
pisan una columna y hay que decidir quién gana. Aquí nadie se pisa —cada
columna tiene su dueño— y la vista solo elige cuál de dos columnas
**distintas** enseñar. Si un día hubiera que preguntar "¿el precio de
Clover o el nuestro?", la frontera estaría mal trazada. Hoy no se pregunta,
porque un precio nuestro no existe.

### Un caso que hay que mirar con los datos reales

`menu_items.description` cae a `catalog_items.alternate_name` cuando no hay
`marketing_copy`. En el seed eso funciona porque el seed metió
descripciones en esa columna. **Pero `alternateName` en Clover no es una
descripción**: es el nombre alternativo del POS, y suele ser una abreviatura
de ticket (`GRN JCE 16`). En cuanto entren ítems reales, la app puede
empezar a enseñar abreviaturas de cocina como descripción de producto.

No se arregla aquí a ciegas: el reporte cuenta cuántos ítems traen
`alternateName` no vacío, y con el catálogo real delante se decide en el PR
de merchandising. Marcado `CLOVER-PENDING` en `mapping.ts`.

## El mapeo, campo a campo

Todas las marcas de tiempo de Clover (`modifiedTime`) son **milisegundos**
epoch. Todos los precios son **centavos**. Las tasas de impuesto **no**:
ver más abajo, que ahí está la trampa.

### Categorías — `GET /v3/merchants/{mId}/categories`

| Clover | Supabase | Nota |
|---|---|---|
| `id` | `clover_category_id` | clave natural, junto con `store_id` |
| `name` | `name` | `''` si falta; nunca `null` (la columna es `not null`) |
| `sortOrder` | `sort_order` | 0 si falta |
| `modifiedTime` | `clover_modified_time` | |

`sort_order` aquí es de Clover, y eso **no** choca con "el orden de
presentación es nuestro": el orden nuestro vive en
`app_item_overrides.sort_order`, que es otra columna en otra tabla y ordena
ítems dentro de una categoría. El orden **entre categorías** hoy lo manda
Clover y no hay ninguna columna nuestra que compita. Si algún día el
operador quiere reordenar categorías desde el SaaS, eso es una columna
nueva en una tabla de overrides de categoría, no un segundo escritor de
esta.

### Tasas de impuesto — `GET /v3/merchants/{mId}/tax_rates`

| Clover | Supabase | Nota |
|---|---|---|
| `id` | `clover_tax_rate_id` | |
| `name` | `name` | |
| `rate` | `rate` | **milésimas de porcentaje**: `8250` = 8,25 % |
| `isDefault` | `is_default` | |

> **La escala es una trampa documentada.** `catalog_tax_rates.rate` va en
> milésimas de porcentaje. `stores.surcharge_rate` (recargo por tarjeta,
> 0011) va en **fracción**: `0.03` = 3 %. Son dos campos que se llaman
> parecido y no se miden igual; mezclarlos da un número cien mil veces
> mayor. El aviso ya está en `apps/mobile/src/api/types.ts` y se repite
> aquí porque este PR es el que empieza a poblar la primera.

### Grupos de modificadores — `GET /v3/merchants/{mId}/modifier_groups`

| Clover | Supabase | Nota |
|---|---|---|
| `id` | `clover_group_id` | |
| `name` | `name` | |
| `minRequired` | `min_required` | 0 si falta |
| `maxAllowed` | `max_allowed` | `null` = sin tope |
| `sortOrder` | `sort_order` | |
| `modifiedTime` | `clover_modified_time` | |

`max_allowed < min_required` lo rechaza un `check` de la 0002. Si Clover
mandara ese par, el grupo **se ignora y se reporta**: escribir una fila que
la base rechaza aborta el barrido entero por un grupo mal configurado.

### Modificadores — `GET .../modifier_groups/{id}/modifiers`

No hay listado plano: cuelgan de su grupo, así que son **N peticiones para
N grupos**. Por eso todo esto va con prioridad `catalog` (cuota del 25 %):
mientras se sincroniza un menú, alguien está pagando.

| Clover | Supabase | Nota |
|---|---|---|
| `id` | `clover_modifier_id` | |
| `name` | `name` | |
| `price` | `price_cents` | puede ser 0 o **negativo** (descuentos) |
| `available` | `available` | |
| `modifiedTime` | `clover_modified_time` | |

### Ítems — `GET /v3/merchants/{mId}/items?expand=categories,modifierGroups,taxRates`

| Clover | Supabase | Nota |
|---|---|---|
| `id` | `clover_item_id` | |
| `name` | `name` | |
| `alternateName` | `alternate_name` | ver el aviso de arriba |
| `sku` | `sku` | |
| `price` | `price_cents` | ver *Price type* |
| `priceType` | `price_type` | `FIXED` \| `VARIABLE` \| `PER_UNIT` |
| `hidden` | `hidden` | ver *Show on POS* |
| `available` | `available` | |
| `defaultTaxRates` | `default_tax_rates` | columna nueva (0017) |
| `categories.elements` | `category_id` | ver *Una categoría, no varias* |
| `modifierGroups.elements` | `catalog_item_modifier_groups` | |
| `taxRates.elements` | `catalog_item_tax_rates` | ver *Impuesto* |
| `modifiedTime` | `clover_modified_time` | |

**Tres expansiones de un nivel, no anidadas.** El §4.5 del addendum prohíbe
las anidadas (timeouts y 502, y el sandbox es peor). `expand=categories,
modifierGroups,taxRates` son tres expansiones hermanas de primer nivel, que
es otra cosa. Aun así abultan, así que la página se pide de **50 y no de
100**: la mitad de elementos por respuesta, el doble de peticiones, y
ninguna respuesta gigante. `CLOVER-PENDING`: medir si el sandbox aguanta
las tres a la vez con el catálogo real; si no, se parten en pasadas.

#### Una categoría, no varias

Clover permite que un ítem esté en **varias** categorías.
`catalog_items.category_id` es **una sola** FK. Esa asimetría hay que
resolverla con una regla, y la regla tiene que ser **determinista** o la
idempotencia se rompe sola: dos barridos seguidos elegirían categorías
distintas y el segundo reportaría cambios que no existen.

La regla: **menor `sortOrder`; a igualdad, menor `id` de Clover**. Es
estable entre ejecuciones porque solo depende de los datos, no del orden en
que llegaron.

Un ítem en más de una categoría se **cuenta en el reporte**
(`items_multicategoria`). Con el catálogo de Viva delante se verá si es un
caso real o una rareza de configuración.

## Los tres campos problemáticos

### 1. `Show on POS` / visibilidad

`hidden = true` en Clover es la casilla *Show on POS* desactivada: el ítem
existe en el inventario y **no sale en la caja registradora**.

**Lo que significa para la app: ni se lista ni se puede pedir.** Un ítem que
el merchant sacó de su propia caja no es un ítem agotado —es un ítem
retirado, estacional o de trastienda—, y enseñarlo atenuado en la app pone
una lápida permanente en el menú.

**No está confirmado contra los datos reales, y no lo pude confirmar: este
entorno no tiene credenciales de Clover.** Así que:

1. el espejo guarda `hidden` tal cual, sin interpretarlo. Esa columna es de
   Clover y se copia;
2. **la vista `menu_items` no cambia su trato de `hidden` en este PR.** Hoy
   un ítem oculto sale listado con `is_available = false`, y así se queda.
   Cambiarlo a "no listar" es una decisión sobre la app basada en una
   suposición sobre el merchant, que es exactamente lo que no hay que hacer
   a ciegas;
3. el reporte del primer barrido real **cuenta y nombra** los ítems ocultos.
   Con esa lista delante, la pregunta se contesta en un minuto: si son
   productos retirados, se deja de listarlos; si son productos que el
   merchant vende pero no por caja, listarlos atenuados era lo correcto.

Marcado `CLOVER-PENDING` en `mapping.ts` y en la 0017, con esas palabras.

### 2. `Price type`

Clover admite tres, y la app móvil solo puede pedir uno:

| `priceType` | Qué significa | Qué hace la app |
|---|---|---|
| `FIXED` | el precio del ítem es el precio | **se puede pedir** |
| `VARIABLE` | el precio lo teclea el cajero al vender | **no se puede pedir** |
| `PER_UNIT` | el precio es por unidad de medida (libra) y se pesa en caja | **no se puede pedir** |

**No se rechaza la sincronización.** Un ítem de precio variable se
sincroniza igual, con su nombre, su categoría y su `price_type`. Rechazarlo
lo dejaría fuera del espejo, y entonces el operador que se pregunte por qué
no está en la app no tendría dónde mirar. Se sincroniza y **se marca como
no pedible**.

Por qué importa que esto entre en el mismo PR que la sincronización: antes
de este PR `price_type` era siempre `FIXED`, porque lo único que había en
la tabla era el seed. En cuanto entra el catálogo real pueden aparecer
`VARIABLE`, y un `VARIABLE` trae `price = 0`. Sin esta regla, la app
enseñaría un producto a **$0.00 y dejaría pedirlo**. No es un riesgo
teórico: es la consecuencia directa de esta pieza.

**Cómo se marca, y por qué no es una columna.** No se guarda ningún
`orderable` en `catalog_items`. Se **deriva** en `menu_items`:

```
orderable = (price_type = 'FIXED')   and available and not hidden ...
```

Guardar la bandera crearía un campo cuyo dueño no está claro —lo calcula la
sincronización a partir de datos de Clover, pero lo consume la app— y que
se puede quedar desincronizado del campo del que depende. Derivada, es
cierta por construcción y no hay nada que mantener.

`menu_items` gana `price_type` y `unorderable_reason`, y su `is_available`
pasa a exigir `FIXED`. Es el único cambio de comportamiento que este PR
hace sobre la app, y es el que impide vender aire.

### 3. Impuesto por producto

Primero, un hecho que cambia el tamaño del problema, y que conviene tener
delante antes de diseñar nada:

> **La app no calcula impuestos. No calcula ningún total.**

Está en el código, no es una intención: `hasAuthoritativeTotal()` en
`apps/mobile/src/domain/order.ts` solo da por bueno un total que venga de
la base, y mientras no lo haya la app enseña **subtotal** y el texto
*"Taxes and total are calculated by the register when the order is
confirmed"*. El impuesto lo calcula Clover al crear la orden.

Así que el riesgo descrito —que el total de la app no cuadre con el de
Clover— **hoy no puede ocurrir, porque no hay un total de la app**. Y el
trabajo de este mapeo no es habilitar ese cálculo: es **espejar las tasas
sin crear un segundo origen del número**. Nada de lo que se escribe aquí
puede acabar alimentando un total de cara al cliente; si algún día alguien
quiere enseñar impuestos antes de confirmar, eso es una decisión de
producto que empieza por preguntarle a Clover, no por sumar estas filas.

Dicho eso, el espejo tiene que ser fiel, porque de él vive el reconciliador
diario de catálogo (§9 de la arquitectura).

**El modelo de Clover tiene dos piezas:**

- `item.defaultTaxRates` (booleano): si el ítem usa las tasas **por defecto
  del merchant**;
- `item.taxRates` (expansión): las tasas **asociadas al ítem**.

**Las tres situaciones, y cómo se distinguen:**

| Situación | Cómo llega | Qué se escribe |
|---|---|---|
| tasas explícitas | `taxRates.elements` con filas | una fila por tasa en `catalog_item_tax_rates` |
| **exento** | `defaultTaxRates = false` y `taxRates.elements = []` | cero filas, y `tax_synced_at` puesto |
| **sin resolver** | `taxRates` **ausente** de la respuesta | **no se toca nada**, y se reporta |

La tercera fila es la importante y es el motivo de la columna nueva
`tax_synced_at`. *Exento* y *no lo sabemos* son estados distintos que en la
base se verían igual —cero filas en la tabla de enlace— y llevan a acciones
opuestas. Si la expansión no llega (Clover la omite, la respuesta se
recorta, el sandbox se atraganta), escribir cero filas sería **declarar
exento un producto que quizá paga impuesto**. Así que no se escribe: los
enlaces se dejan como estaban, `tax_synced_at` se queda como estaba —`null`
si nunca se resolvió— y el ítem sale en el reporte como
`impuesto_sin_resolver`.

**Las tasas por defecto no se materializan.** Cuando `defaultTaxRates` es
`true`, las que aplican son las del merchant marcadas `is_default`, y eso
ya está en `catalog_tax_rates`. Copiarlas a la tabla de enlace duplicaría
el dato y crearía la pregunta de qué hacer cuando el merchant cambie su
tasa por defecto. Se resuelven en lectura, en la vista
`catalog_item_tax_effective`, que aplica la regla en un solo sitio.

`CLOVER-PENDING`: falta confirmar contra el sandbox si Clover devuelve las
tasas por defecto **dentro** de `taxRates` cuando `defaultTaxRates = true`.
Si lo hace, la vista las contaría dos veces y hay que quitar la rama de
defaults. El reporte trae el recuento cruzado (`items_default_con_enlaces`)
justamente para contestarlo en el primer barrido real.

## Idempotencia

**Correrlo dos veces seguidas no produce cambios la segunda vez.** No es
una aspiración: se prueba.

Cómo se consigue:

1. **upsert por clave natural**, nunca insert-a-ciegas. La clave es
   `(store_id, clover_*_id)`, que ya tiene índice único en la 0002;
2. **el `update` solo toca las columnas de Clover.** `synced_at` se escribe
   siempre (es fontanería, dice cuándo se miró), pero no cuenta como
   cambio;
3. **el recuento de cambios sale de la base, no de nuestra opinión.** Cada
   upsert devuelve si la fila **realmente** cambió, comparando los valores
   viejos con los nuevos dentro del propio `update`. Contar "he mandado 50
   upserts, luego 50 actualizaciones" sería contar peticiones, no cambios;
4. **toda elección es determinista**: la categoría de un ítem
   multicategoría, el orden de los enlaces, todo. Ver *Una categoría, no
   varias*;
5. **los enlaces se reconcilian por diferencia de conjuntos**, no
   borrando-y-reinsertando. Borrar e insertar lo mismo son dos escrituras
   que dejan la fila idéntica y cuentan como cambio: la segunda vuelta
   diría que cambió algo que no cambió.

La prueba (`idempotencia.test.ts`) corre el barrido dos veces contra el
mismo catálogo y exige que el segundo reporte traiga **cero creados y cero
actualizados**, y además que no se emita ni un `insert` ni un `update` con
valores distintos.

## Paginación

El catálogo de Viva son ~50 productos. **No se asume que quepa en una
página**, y hay una prueba con 120 ítems que lo comprueba.

Lo hace `paginate()` de `@juicebar/clover-client`, que ya existía: pide
páginas hasta que una viene incompleta, con un tope de páginas para que un
endpoint que no avance no deje el barrido girando contra la cuota
compartida. El tope de Clover por página son 100 elementos; aquí se piden
**50** por las expansiones (ver arriba).

Los modificadores paginan **por grupo**, que es como los sirve Clover.

## Por qué este barrido no borra

Un barrido completo sabe qué ítems tiene Clover, así que podría marcar
`deleted_at` en los que no vinieron. **No lo hace, y es deliberado:**

- el `SEED-` no se purga en este PR (decisión explícita del alcance), y un
  barrido que borrase "lo que no vino de Clover" se llevaría todo el seed
  por delante en su primera ejecución;
- una respuesta **parcial** —una página que falla a mitad, un filtro mal
  puesto, un token que caduca— es indistinguible de "el merchant borró
  medio catálogo". Borrar por ausencia convierte un fallo de red en una
  carta vacía.

El borrado va en el PR del purgado, junto con la decisión sobre el seed, y
ahí tendrá que apoyarse en un barrido que se declare **completo** (todas
las páginas, sin errores) antes de borrar nada.

Mientras tanto, el reporte trae `en_supabase_no_en_clover`: los ítems que
el espejo tiene y Clover no devolvió. Se cuentan, se nombran, y no se tocan.

## El reporte

Es lo que se lee para validar el mapeo, así que no es un recuento: dice
**qué se creó, qué se actualizó, qué se ignoró y por qué**.

Se devuelve en la respuesta HTTP y se guarda en `app.catalog_sync_runs`,
porque un reporte que solo existe en la respuesta de un `curl` se pierde en
cuanto se cierra la terminal.

```
{
  "store_id": "...", "merchant_id": "RGW5JAVFT8MB1",
  "empezado": "...", "terminado": "...",
  "completo": true, "error": null,
  "paginas": { "items": 3, "categorias": 1, ... },
  "entidades": {
    "categorias":  { "creadas": 13, "actualizadas": 0, "sin_cambios": 0 },
    "items":       { "creados": 48, "actualizados": 0, "sin_cambios": 0 },
    ...
  },
  "ignorados": [
    { "tipo": "item", "clover_id": "...", "nombre": "...",
      "motivo": "sin_id" | "grupo_con_limites_imposibles" | ... }
  ],
  "avisos": {
    "items_ocultos":            [ { clover_id, nombre } ],
    "items_no_pedibles":        [ { clover_id, nombre, price_type } ],
    "items_multicategoria":     [ { clover_id, nombre, categorias } ],
    "impuesto_sin_resolver":    [ { clover_id, nombre } ],
    "items_default_con_enlaces":[ { clover_id, nombre } ],
    "items_con_alternate_name": [ { clover_id, nombre, alternate_name } ],
    "en_supabase_no_en_clover": [ { clover_id, nombre } ]
  }
}
```

Los `avisos` **no son errores**. Son las preguntas abiertas de este
documento, contestadas con los datos del merchant real en cuanto se ejecute
una vez. Están para eso.

`completo: false` con `error` puesto significa que alguna página falló. El
reporte parcial **sigue siendo válido para lo que llegó a escribirse** —cada
upsert es su propia verdad— pero no sirve para decidir qué falta en Clover,
y por eso en ese caso `en_supabase_no_en_clover` viene vacío en vez de
acusar a medio catálogo de haber desaparecido.

Y queda guardado, así que se puede comparar un barrido con el anterior, que
es como se ve si algo dejó de mapearse:

```sql
select started_at, complete,
       report->'entidades'->'items'   as items,
       jsonb_array_length(report->'avisos'->'items_ocultos') as ocultos
  from app.catalog_sync_runs
 where store_id = '...'
 order by started_at desc limit 5;
```

## El catálogo seed

Los `SEED-` **no se purgan aquí**. Conviven con lo sincronizado a propósito,
para poder comparar el catálogo real contra el que se cargó a mano.

Que convivan es posible sin ningún caso especial: la clave natural es
`(store_id, clover_item_id)`, y ningún id de Clover empieza por `SEED-`, así
que los dos conjuntos no se tocan. El barrido **no filtra** los `SEED-`
—no los toca porque no aparecen en la respuesta de Clover, no porque haya
un `not like 'SEED-%'` en ningún sitio—.

Consecuencia mientras dure la convivencia: **el menú de la app enseña las
dos cosas a la vez**, y va a haber productos duplicados con nombres
parecidos. Es lo esperado en esta fase y por eso el purgado es el PR
siguiente.

Para comparar, el reporte y la vista:

```sql
select case when clover_item_id like 'SEED-%' then 'seed' else 'clover' end as origen,
       count(*), min(price_cents), max(price_cents)
  from public.catalog_items
 where store_id = '...' and deleted_at is null
 group by 1;
```

## Cómo se dispara

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $WORKER_CRON_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"store_id":"<uuid de la sucursal>"}' \
  https://<project-ref>.supabase.co/functions/v1/catalog-sync
```

Misma puerta que el worker de refresco y por la misma razón
(`supabase/functions/token-refresh/auth.ts`): la comprobación del gateway la
pasa cualquier clave del proyecto y la anónima viaja dentro del APK, así que
`verify_jwt` no autorizaría nada. El secreto es el mismo `WORKER_CRON_SECRET`
que ya existe; no se añade una credencial nueva para esto.

**Un barrido a la vez por sucursal.** Se toma el mismo tipo de arriendo que
el refresco (0013), en una columna propia: dos barridos simultáneos sobre la
misma tienda se pisarían los upserts y el reporte de los dos mentiría. Un
`409` significa «o hay un barrido en marcha, o esa sucursal no está
conectada»; las dos se contestan igual a propósito, porque distinguirlas por
HTTP le diría a quien prueba uuids al azar cuándo ha acertado uno.

**El barrido no refresca tokens.** Lee el access token vigente de Vault y
ya. De rotar se encarga el worker de refresco, con su propio arriendo: un
barrido que además rotase sería un segundo escritor de un token de un solo
uso, y dos escritores de eso dejan la conexión muerta. Con el token
caducado, el barrido se lleva un 401 y lo reporta; el refresco lo arregla
en su siguiente vuelta, que como mucho es dentro de cinco minutos.

### Comprobar la idempotencia a mano

Lo mismo que hace la prueba, contra el merchant real:

```sql
select started_at, report->'entidades'->'items' as items
  from app.catalog_sync_runs where store_id = '...'
 order by started_at desc limit 2;
```

El barrido más reciente de los dos tiene que traer `creadas: 0` y
`actualizadas: 0`. Si trae actualizaciones sin que nadie haya tocado el
catálogo en Clover entre las dos ejecuciones, hay un campo que se está
reescribiendo con un valor distinto cada vez, y eso es un fallo del mapeo.

## Lo que queda por confirmar

Todo esto necesita el sandbox con credenciales, que este entorno no tiene.
Está marcado `CLOVER-PENDING` en el código, no solo aquí.

- **`hidden`**: si los ítems ocultos del merchant real son productos
  retirados (→ no listarlos) o productos que se venden fuera de caja
  (→ listarlos atenuados). El reporte los nombra;
- **`taxRates` con `defaultTaxRates = true`**: si Clover devuelve las tasas
  por defecto dentro de la expansión. Si lo hace, la vista
  `catalog_item_tax_effective` las cuenta dos veces;
- **las tres expansiones a la vez**: si el sandbox las aguanta con el
  catálogo real. Si da 502 o timeouts, se parten en pasadas y el mapeo no
  cambia;
- **`priceType` real del merchant**: si Viva tiene algún `VARIABLE` o
  `PER_UNIT`. Si no tiene ninguno, la regla sigue haciendo falta igual —el
  día que añadan uno, nadie va a acordarse—;
- **`alternateName`**: qué trae de verdad, para decidir si puede seguir
  haciendo de descripción en `menu_items`.
