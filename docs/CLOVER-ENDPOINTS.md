# Endpoints de Clover: qué está implementado y de dónde sale

Regla 3 de la Fase 7: *no se inventan endpoints*. Este archivo es la prueba
de que se cumplió. Cada llamada de `packages/clover-client` está aquí con
su fuente, y lo que no pude verificar **no está implementado**.

## Cómo se verificó

**Segunda pasada, con la red abierta.** La primera versión de este
documento se escribió sin poder alcanzar ningún dominio de Clover y lo
decía. Ya no es el caso: `docs.clover.com` y `*.dev.clover.com` están
abiertos, los de producción siguen cerrados a propósito, y todo lo de aquí
abajo se ha leído de la documentación oficial, no recuperado por búsqueda.

Se empezó por el índice para agentes, como decía la versión anterior que
había que hacer:

    https://docs.clover.com/dev/llms.txt

Y valió la pena, porque el problema que quedaba abierto no se resolvía
buscando. Leyendo el índice entero se ve que hay **dos páginas casi
homónimas** para el mismo flujo —una en la sección de plataforma y otra en
la de ecommerce— y que la "contradicción" que arrastraba este documento era
haber leído una de cada. Buscando por palabras nunca se ve eso: la búsqueda
devuelve una de las dos y parece la única.

### Lo que sigue sin verificarse

Leer la documentación entera **no es lo mismo que ejecutar una llamada**.
Sigue sin comprobarse el comportamiento real: los esquemas de respuesta
campo a campo, la latencia, a qué dispositivo llega de verdad un ticket.
Por eso `types.ts` sigue declarando solo lo que consumimos y casi todo
sigue siendo opcional, y por eso la lista del final —ahora más corta— no es
una formalidad.

Lo que cambia respecto a la pasada anterior es de qué tipo son las dudas
que quedan. Antes había dudas sobre **dónde está cada cosa**; eso ya está
resuelto. Las que quedan son sobre **qué hace Clover cuando se le llama**,
y esas no se resuelven leyendo.

## Los cuatro hosts

**Clover no es una API, son cuatro APIs en cuatro dominios distintos.** Es
lo primero que sorprende y lo más fácil de escribir mal.

Lo que hace este reparto peligroso no es que existan cuatro hosts: es cómo
falla equivocarse. Una petición bien formada enviada al host equivocado
**no devuelve 404**. Devuelve:

- **401**, porque el host de destino no reconoce ese token — y entonces se
  pierde una tarde revisando credenciales que estaban bien;
- o **HTML**, porque el host web responde con una página de portal a una
  ruta que no conoce, y el error que ves es un fallo de parseo de JSON que
  no menciona la url por ningún lado.

Los dos síntomas apuntan a cualquier sitio menos a la causa. Y el más caro
está en el camino del cobro: `payOrder` vive en el host de ecommerce, no en
el de plataforma, y son el mismo `Bearer` con la misma pinta.

Por eso el host **no se elige en el punto de llamada**. Se elige una sola
vez en `environments.ts`, y cada endpoint declara a qué API pertenece
(`api: 'platform' | 'oauth' | 'ecommerce' | 'token'`). Es un campo
obligatorio del tipo `CloverRequest`: no se puede escribir una petición sin
decir a cuál de las cuatro va. Hay un test que comprueba que los cuatro
resuelven a dominios distintos, y otro por endpoint que fija su host.

| API | Sandbox | Producción (Norteamérica) | Fuente |
|---|---|---|---|
| Plataforma (REST v3) | `apisandbox.dev.clover.com` | `api.clover.com` | [Ecommerce API tutorials](https://docs.clover.com/dev/docs/ecommerce-api-tutorials) · [tabla OAuth](https://docs.clover.com/dev/docs/use-oauth) |
| OAuth (**solo** `authorize`) | `sandbox.dev.clover.com` | `www.clover.com` | [Authenticate with the v2/OAuth flow](https://docs.clover.com/dev/docs/use-oauth) |
| Ecommerce (cobro, PAKMS) | `scl-sandbox.dev.clover.com` | `scl.clover.com` | [Ecommerce API tutorials](https://docs.clover.com/dev/docs/ecommerce-api-tutorials) |
| Tokenización | `token-sandbox.dev.clover.com` | `token.clover.com` | [Ecommerce API tutorials](https://docs.clover.com/dev/docs/ecommerce-api-tutorials) |

**El host de tokenización en producción ya está confirmado:**
`token.clover.com`, de la tabla "Sandbox and production URLs" de *Ecommerce
API tutorials*, que da los tres hosts de ecommerce de una vez. Era el único
de los ocho que faltaba, y era el que habría fallado en el primer cobro
real. `resolveHosts('na-production')` ya no necesita que le pasen nada.

El mecanismo que obligaba a pasarlo se queda, porque sigue haciendo falta:
si algún día se añade Europa o Latinoamérica, sus dominios no están aquí y
el arranque tiene que fallar en vez de caer a Norteamérica en silencio.

**Ojo con la fila de OAuth.** El único endpoint que vive en ese host es
`/oauth/v2/authorize`. El canje y el refresco viven en el de plataforma —
ver la sección de OAuth más abajo, que era la contradicción que quedaba
abierta.

## Implementado

| Método del cliente | Llamada | Fuente |
|---|---|---|
| `oauth.authorizeUrl` | `GET {oauth}/oauth/v2/authorize` | [Authenticate with the v2/OAuth flow](https://docs.clover.com/dev/docs/use-oauth) |
| `oauth.exchangeCode` | `POST {platform}/oauth/v2/token` | [Generate OAuth expiring token](https://docs.clover.com/dev/docs/generate-expiring-tokens-using-v2-oauth-flow) |
| `oauth.refresh` | `POST {platform}/oauth/v2/refresh` | [Use refresh token to generate new expiring token](https://docs.clover.com/dev/docs/refresh-access-tokens) |
| `oauth.recovery` | `POST {platform}/oauth/v2/recovery` | [Use refresh token to generate new expiring token](https://docs.clover.com/dev/docs/refresh-access-tokens), sección *Reauthenticate with a recovery token* |
| `merchants.get` | `GET /v3/merchants/{mId}` | [Use Clover REST API](https://docs.clover.com/dev/docs/making-rest-api-calls) |
| `merchants.gateway` | `GET /v3/merchants/{mId}/gateway` | [Get a merchant's payment gateway configuration](https://docs.clover.com/dev/reference/merchantgetmerchantgateway) |
| `merchants.ecommPaymentConfigs` | `GET /v3/merchants/{mId}/ecomm_payment_configs` | [Manage transaction data (REST API)](https://docs.clover.com/dev/docs/working-with-transaction-data-rest) |
| `inventory.items` | `GET /v3/merchants/{mId}/items` | [Get all inventory items](https://docs.clover.com/dev/reference/inventorygetitems) |
| `inventory.categories` | `GET /v3/merchants/{mId}/categories` | [Manage categories](https://docs.clover.com/dev/docs/managing-categories) |
| `inventory.modifierGroups` | `GET /v3/merchants/{mId}/modifier_groups` | [Get all modifier groups](https://docs.clover.com/dev/reference/modifiergetmodifiergroups) |
| `inventory.modifiers` | `GET /v3/merchants/{mId}/modifier_groups/{id}/modifiers` | [Manage modifier groups and modifiers](https://docs.clover.com/dev/docs/managing-modifier-groups-modifiers) |
| `inventory.taxRates` | `GET /v3/merchants/{mId}/tax_rates` | [Create a tax rate for a merchant](https://docs.clover.com/dev/reference/taxratecreatetaxrate) |
| `orders.checkout` | `POST /v3/merchants/{mId}/atomic_order/checkouts` | [Checkout an atomic order](https://docs.clover.com/dev/reference/ordercheckoutatomicorder) |
| `orders.createAtomicOrder` | `POST /v3/merchants/{mId}/atomic_order/orders` | [Create an atomic order](https://docs.clover.com/dev/docs/create-an-atomic-order) |
| `orders.get` | `GET /v3/merchants/{mId}/orders/{orderId}` | [Manage orders data](https://docs.clover.com/dev/docs/working-with-orders) |
| `orders.orderTypes` | `GET /v3/merchants/{mId}/order_types` | [Create custom orders](https://docs.clover.com/dev/docs/creating-custom-orders) |
| `orders.print` | `POST /v3/merchants/{mId}/print_event` | [Submit a print request to the merchant's default order printer](https://docs.clover.com/dev/reference/ordercreateprintevent-3) |
| `orders.printEvent` | `GET /v3/merchants/{mId}/print_event/{id}` | [Get a print event by its ID](https://docs.clover.com/dev/reference/ordergetprintevent-3) |
| `ecommerce.apiAccessKey` | `GET {scl}/pakms/apikey` | [Generate a public API access key or PAKMS key](https://docs.clover.com/dev/docs/generate-ecommerce-api-key-or-pakms-key) |
| `ecommerce.tokenizeCard` | `POST {token}/v1/tokens` | [Create a card token](https://docs.clover.com/dev/docs/create-a-card-token) |
| `ecommerce.payOrder` | `POST {scl}/v1/orders/{orderId}/pay` | [Pay for an order](https://docs.clover.com/dev/reference/postordersidpay) |

### Reglas de la API que el cliente aplica solo

- **100 elementos por página.** Sin paginar, un merchant con 250 productos
  sincroniza 100 y los otros 150 no existen para la app, sin ningún error.
  ([Add pagination requests](https://docs.clover.com/dev/docs/paginating-elements))
- **90 días por filtro de tiempo.** Un rango mayor se recorta al tramo más
  reciente **sin avisar**: un backfill de un año trae tres meses y parece
  que funcionó. `timeWindows` lo parte.
  ([Apply filters to API requests](https://docs.clover.com/dev/docs/applying-filters))
- **`modifiedTime` en milisegundos.** En segundos no da error: devuelve el
  catálogo entero cada vez, contra el presupuesto compartido.
- **50 req/s por app, 16 por token.** El de app es compartido entre TODOS
  los merchants. ([API usage and rate limits](https://docs.clover.com/dev/docs/api-usage-rate-limits))
- **`retry-after` manda.** Clover documenta que pedir antes de tiempo alarga
  la espera.
- **Nada de `expand` anidados**: dan timeouts y 502, y el sandbox es más
  frágil que producción.

## Cuál de los dos sirve para el checklist de onboarding

Ninguno de los dos. **Los tres, y con papeles distintos.**

Ni `/gateway` ni `/ecomm_payment_configs` devuelven un "ecommerce
habilitado: sí/no", y buscar ese booleano es perder el tiempo. La prueba
funcional es otra:

| Llamada | Qué aporta | Papel |
|---|---|---|
| `GET {scl}/pakms/apikey` | la clave de ecommerce del merchant | **la puerta** |
| `GET /v3/merchants/{mId}/gateway` | `accountName`, `supportsMultiPayToken`, `rate` | quién procesa |
| `GET /v3/merchants/{mId}/ecomm_payment_configs` | `surcharging.supported` y su `rate` | **el recargo** |

**PAKMS es la puerta.** Si el merchant no puede producir una clave de
ecommerce, no se le puede cobrar, y da igual lo que digan las otras dos. Es
la única de las tres que se comprueba ejecutando lo que de verdad hace
falta, en vez de leyendo un campo que lo describe.

**`/gateway` responde "¿quién procesa esto?".** `accountName` es lo que se
enseña en el checklist del SaaS: *"Sandbox Test Merchant"* se lee; un
booleano no le dice nada a quien está dando de alta la sucursal. Su
`supportsMultiPayToken` **no bloquea**: es para tokens de varios usos
(tarjeta guardada) y nosotros usamos tokens de un solo uso. Bloquear por
eso cerraría sucursales que funcionan perfectamente.

**`/ecomm_payment_configs` es el que da la sorpresa incómoda**, y por eso
merece estar. Dice si el merchant tiene **recargo por tarjeta de crédito**
activo. Si lo tiene, **al cliente se le cobra más de lo que le enseñamos en
la app**. Eso no es un ajuste de configuración: es una diferencia entre el
precio anunciado y el cobrado, y en bastantes sitios eso tiene nombre
legal. Sale como **aviso, no como bloqueo**, porque la decisión es de
producto y no del código: mostrarlo, o no abrir esa sucursal. Absorberlo
no es una opción, y no por decisión nuestra — ver abajo.

El criterio entero vive en `src/onboarding.ts`, en una función pura que
recibe las tres respuestas y dictamina. No llama a nada, así que se puede
probar completo sin red — y el orquestador, que es de otra fase, decide
cuándo preguntar.

### Qué se hace con el recargo: dos políticas por sucursal

`stores.surcharge_policy` (migración `0011_recargo.sql`), no una constante
en el código: la respuesta correcta depende del restaurante y puede cambiar
sin que nosotros toquemos nada.

| Política | Qué hace |
|---|---|
| `show` **(defecto)** | se le muestra al cliente antes de pagar |
| `block` | esa sucursal no se activa |

`show` es el defecto porque es lo más seguro legalmente: el cliente ve lo
que va a pagar antes de pagarlo.

**Lo que la app enseña con `show`, y por qué así, está en
[`RECARGO-TARJETA.md`](RECARGO-TARJETA.md)**: Nueva Jersey exige el
IMPORTE, no un aviso de que existe un recargo, y eso descarta el "hasta un
3 %" que este proyecto daba por bueno.

**El aviso al super admin no es configurable.** Sale con las dos
políticas, siempre, y no hay ningún valor que lo apague: es información
para decidir antes de firmar. Con `show` va a `warnings`; con `block`, a
`blockers`. El texto es el mismo en los dos casos.

#### Había una tercera, `absorb`, y se retiró

Prometía que el restaurante asumía el recargo. **No podía cumplirlo, y el
motivo está en esta misma página:** `POST /v1/orders/{id}/pay` acepta
`source`, `amount`, `tip_amount` y `currency`, y nada más. **No hay campo
para renunciar al recargo.** Lo aplica Clover según la configuración del
merchant y el BIN de la tarjeta, y llega en `additionalCharges` del pago.

Así que con `absorb` el cliente lo pagaba igual, y encima en silencio
—esa política suprimía el aviso—. Una política que promete absorber y no
absorbe es peor que no tenerla. Se quitó en
`0019_sin_absorb.sql`; el detalle, en
[`RECARGO-TARJETA.md`](RECARGO-TARJETA.md).

`surchargeOutcome` **no suma dinero al cobro**, y ahora se sabe por qué no
puede: el recargo no está dentro del total de `atomic_order/checkouts` —va
aparte, en el pago— así que sumarlo nosotros lo cobraría dos veces. Su
`estimatedCents` es para enseñar; el importe que se cobra sale siempre de
Clover.

### Cuidado con los dos `rate`

`CloverGateway.rate` y `CloverEcommPaymentConfigs.surcharging.rate` son
**fracciones**: `0.035` = 3,5 %. `CloverTaxRate.rate` son **milésimas de
porcentaje**: `8250` = 8,25 %. Se llaman igual y no se miden igual;
mezclarlos da un total con dos órdenes de magnitud de error.

## NO implementado, a propósito

| Qué | Por qué |
|---|---|
| Cualquier escritura de catálogo (`POST/PUT/DELETE` de items, categorías, modificadores) | Regla 26: si un producto no existe en el inventario de Clover, no se vende en la app. Escribir catálogo desde la app rompe el ruteo a impresora, que va por *labels* de item —configuración del merchant— y descuadra sus informes. Hay un test que falla si alguien añade un método que escriba. |
| `createCharge` (cobro suelto) | Regla 27: se cobra **sobre la orden**. Un charge suelto no queda ligado a la orden en el POS: el merchant no puede reembolsar desde su dispositivo y sus informes descuadran. Hay un test que lo vigila. |
| Reembolsos y anulaciones | Van en su fase. §0.4: no se hacen con la Platform API. |
| Webhooks | Son la PR 5. |
| Clientes (`/v3/merchants/{mId}/customers`) | El permiso está concedido, pero no hay ninguna llamada nuestra que lo necesite todavía. Se añade cuando la haya. |

### Una nota honesta sobre la regla 26

La referencia de *Create an atomic order* dice ahora esto: *"Clover has
revoked the limitations of non-Clover inventory items and ad-hoc line items
from the create an atomic order endpoint."* Es decir: **la API ya nos
dejaría** mandar líneas ad-hoc que no existan en el inventario del merchant.

La regla 26 se queda igual, y conviene tener claro por qué, porque alguien
va a citar esa frase tarde o temprano. La regla nunca se sostuvo en que la
API lo prohibiera: se sostiene en que el ruteo a impresora va por *labels*
de item —configuración del merchant— y en que los informes del merchant
descuadran si le aparecen ventas de productos que no tiene. Ninguna de esas
dos cosas ha cambiado. Que Clover lo permita no lo hace buena idea.

**Límite duro que sí conviene anotar:** una orden admite como máximo
**3.000 líneas**; pasarse da un 400. Muy lejos de un pedido de zumos, pero
está escrito.

## Dónde aterriza el merchant: el `redirect_uri`

Ya está decidido y construido: una Edge Function de Supabase.

```
https://<project-ref>.supabase.co/functions/v1/oauth/callback
```

Se registra **idéntica, sin barra final**, en el Developer Dashboard. Clover
compara la cadena byte a byte y, cuando no coincide, el flujo muere en una
pantalla suya sin dejar rastro en nuestros logs. El porqué de la decisión, el
ciclo completo y el runbook están en `docs/OAUTH-CONEXION.md`; el código, en
`supabase/functions/oauth/`.

Ojo con el reparto de hosts que viene justo abajo: `authorize` vive en el host
**web** y el canje en el de **plataforma**. El `redirect_uri` no es de Clover,
es nuestro, y no tiene nada que ver con ninguno de los dos.

## La contradicción del host de OAuth: resuelta, y no era una contradicción

Quedaba abierto **dónde viven `oauth/v2/token` y `oauth/v2/refresh`**. La
respuesta es que la documentación nunca se contradijo; lo que hay es una
tabla, y aparece **idéntica en tres páginas distintas** del flujo v2/OAuth
([Authenticate with the v2/OAuth flow](https://docs.clover.com/dev/docs/use-oauth),
[Generate OAuth expiring token](https://docs.clover.com/dev/docs/generate-expiring-tokens-using-v2-oauth-flow)
y [Use refresh token](https://docs.clover.com/dev/docs/use-refresh-token-to-generate-new-expiring-token)):

| Ruta | Sandbox | Producción NA | Europa | Latinoamérica |
|---|---|---|---|---|
| `/oauth/v2/authorize` | `sandbox.dev.clover.com` | `www.clover.com` | `www.eu.clover.com` | `www.la.clover.com` |
| `/oauth/v2/token` | `apisandbox.dev.clover.com` | `api.clover.com` | `api.eu.clover.com` | `api.la.clover.com` |
| `/oauth/v2/refresh` | `apisandbox.dev.clover.com` | `api.clover.com` | `api.eu.clover.com` | `api.la.clover.com` |
| `/oauth/token/migrate_v2` | `apisandbox.dev.clover.com` | `api.clover.com` | `api.eu.clover.com` | `api.la.clover.com` |

**El `authorize` en el host web; el canje y el refresco en el de
plataforma.** Que es exactamente lo que el cliente ya hacía: la decisión
que se tomó siguiendo el ejemplo de `curl` era la correcta.

### De dónde salió la contradicción

De dos sitios, y ninguno de los dos era un error de Clover.

**Primero, dos páginas casi homónimas.** El mismo flujo está documentado
dos veces, una en la sección de plataforma y otra en la de ecommerce, con
títulos que solo se distinguen mirándolos con cuidado:

| Plataforma | Ecommerce |
|---|---|
| `generate-expiring-tokens-using-v2-oauth-flow` | `generate-oauth-expiring-access-and-refresh-token` |
| `refresh-access-tokens` | `use-refresh-token-to-generate-new-expiring-token` |

La segunda pareja lleva dentro un comentario de los redactores que lo dice
sin rodeos: *"This topic is a copy of the one in the REST API section (…)
but was needed here to complete the information related to the v2/OAuth
flow in Ecomm."* Son copias. Dicen lo mismo. Citar una de cada, que es lo
que hizo la pasada anterior, hace parecer que discrepan.

**Segundo, un path leído de más.** El `www.clover.com/oauth/v2/token` que
parecía cerrar el caso no existe. Está en la página del flujo **legacy**,
en un ejemplo del parámetro `state`, y el path de ese ejemplo es
`/oauth/v2/authorize`, no `/oauth/v2/token`. Coincide con la tabla: en
producción `www.clover.com` sirve `authorize` y nada más.

### Un endpoint que no estaba en el inventario: `/oauth/v2/recovery`

Sale de la misma lectura, y **cambia el peor caso del worker de la PR 2**.

El refresh token es de un solo uso —eso ya estaba— pero además: al usar el
token A para obtener el B, **A queda como token de recuperación de B**. Si
el par nuevo se pierde entre que Clover lo emite y nosotros lo
persistimos, la conexión del merchant no está muerta: se puede canjear el
anterior en `POST {platform}/oauth/v2/recovery`.

| | |
|---|---|
| Host | plataforma (`apisandbox.dev.clover.com` / `api.clover.com`) |
| Requiere | `client_secret`; solo apps de alta confianza |
| Ventana | **2 semanas** desde que se generó el **par actual**, y cada par nuevo la reancla |
| Se invalida | en cuanto un refresh se usa con éxito en el flujo estándar |
| Después | no hay atajo: rehacer el flujo OAuth entero |

Ya está implementado: `oauth.recovery` en el cliente pone el token en el
cuerpo y lo manda; **con qué token llamar** —que es la parte difícil— lo
decide el worker (`workers/src/token-refresh`). La cadena es lineal
(A → B → C) y **eso condiciona el diseño del worker**: hay que guardar el
refresh anterior, no solo el vigente. Guardar solo el vigente tira la red
de seguridad a la basura sin que se note hasta el día que haga falta.

Y hay un detalle que solo se ve al escribir el worker: en el accidente que
esta red cubre —perder el par nuevo antes de guardarlo— el token que Clover
espera en `/oauth/v2/recovery` es **el que nosotros tenemos apuntado como
vigente**, no el que tenemos apuntado como de recuperación. Ver
`docs/REFRESCO-TOKENS.md`.

El sitio donde se guarda es `clover_connections.recovery_token_secret_id`
y `recovery_token_expires_at` (migración `0012_recovery_token.sql`).

#### El detalle contraintuitivo, leído de la documentación

Después de una **recuperación**, el token de recuperación **no cambia**:

| Camino | Refresh vigente | Token de recuperación |
|---|---|---|
| refresco `A → B` | B | **A** |
| recuperación `A → C` | C | **A todavía** (B muere) |

O sea que *«el de recuperación es siempre el refresh que acabo de
sustituir»* es **falso** en el camino de recuperación: ahí lo que se
sustituye es B, que ya no vale para nada. Escribir esa regla deja la
conexión sin red justo después del susto en el que se usó.

Literal: *"In this case, `Token A` remains the recovery token for
`Token C`, and `Token B` becomes invalid."*

#### Pero la ventana sí se reancla — confirmado, y antes se asumía lo contrario

Son **dos reglas distintas sobre las mismas dos columnas**, y solo una de
ellas se queda quieta al recuperar:

| Camino | Recuperación | Ventana |
|---|---|---|
| refresco `A → B` | pasa a ser A | `ahora + 2 semanas` |
| recuperación `A → C` | **sigue siendo A** | **`ahora + 2 semanas`** |

La ventana cuelga de **cuándo nació el par actual**, no de cuándo nació el
token de recuperación. Emitir un par la reancla, venga del endpoint que
venga.

**Esto cambió, y conviene saber por qué.** La documentación pública admite
dos lecturas: dice *"two weeks have passed since the **current** access and
refresh token pair was generated"* —que reanclaría— y también que la cadena
*"continues until a refresh token is successfully used"* —que leído solo,
haría que una cadena de recuperaciones no caducara nunca—. Sin poder
medirlo (haría falta perder un refresh y esperar dos semanas) se tomó la
lectura pesimista: la ventana no se movía, y `0012_recovery_token.sql`
llegó a imponerlo con un trigger.

Developer Relations de Clover lo resolvió: **la ventana se ancla a la hora
de creación de cada par nuevo**. De las dos reglas de la 0012, la del
puntero era correcta —y sigue siendo lo contraintuitivo— y la de la
ventana era falsa. `0016_recovery_window_reanclada.sql` quita el trigger.

Lo que costaba la lectura vieja no era teórico: una conexión que sobrevive
a base de recuperaciones encadenadas arrastraba una fecha cada vez más
vieja, el SaaS la enseñaba vencida, y el operador llamaba al restaurante a
rehacer un OAuth que no hacía falta.

**Y hay una segunda regla, para la otra ruta.** Sobre qué pasa en un
refresco estándar, Clover contestó:

> Cada refresco con éxito genera un par nuevo **y** una ventana fresca de
> dos semanas. El refresh token consumido pasa a ser el token de
> recuperación del par nuevo.

Durante unos días pareció que eso contradecía lo de arriba. **No lo
contradice: son dos endpoints distintos**, y así lo aclaró Clover el
2026-09-16:

> *"Persist the most recently consumed refresh token during standard daily
> refreshes. Only retain Token A as the recovery token when a recovery
> flow is specifically triggered."*

| endpoint | quién queda como token de recuperación |
|---|---|
| `/oauth/v2/refresh` | el refresh que se acaba de **consumir** |
| `/oauth/v2/recovery` | el **Token A original**, sin moverse |

Y la ventana se reancla al par nuevo por las dos rutas.

El worker ya se comportaba así, con una sola línea, y no es casualidad:
`/oauth/v2/recovery` **solo acepta el Token A**, así que una llamada que
triunfa por esa ruta demuestra que lo que se mandó era A. El detalle y las
pruebas, una por ruta, en `workers/src/token-refresh/chain.ts`.

#### Y hay una cabecera que lo dice

Cuando un refresco falla con 401 **y existe recuperación disponible**,
Clover lo anuncia en la respuesta:

    X-Clover-Recovery-Available: true

Esa cabecera es la autoridad. Nuestra `recovery_token_expires_at` es una
estimación con nuestro reloj (creación del par actual + 2 semanas; Clover
no devuelve esa fecha), así que sirve para avisar y para limpiar,
**nunca para decidir no intentarlo**. Se intenta, y que conteste Clover.

## Resuelto en esta pasada

Lo que la lectura de la documentación cerró, para que no se vuelva a abrir:

- [x] **host de `oauth/v2/token` y `oauth/v2/refresh`** → el de plataforma.
      Sección de arriba. No había contradicción.
- [x] **host de tokenización en producción** → `token.clover.com`.
      `resolveHosts('na-production')` ya arranca solo.
- [x] **`printed: true` llega por webhook** → confirmado: al imprimirse,
      Clover pone `printed` a `true` **en cada línea** de la orden y manda
      esas actualizaciones al callback. De ahí sale `PREPARING`.
- [x] **`/gateway` está en la referencia oficial**, no solo en una guía
      suelta: *Get a merchant's payment gateway configuration*, con
      `accountName` y `supportsMultiPayToken` en el esquema.
- [x] **si `atomic_order/checkouts` incluye el recargo** → **no lo
      incluye.** Ver abajo; afecta a la PR del recargo.
- [ ] ~~cuántos refresh tokens activos permite Clover por merchant~~ →
      **la premisa era falsa.** No hay ningún "límite de N activos" en la
      documentación. Lo que hay es: un solo uso, y una cadena lineal de
      recuperación (A → B → C) de dos semanas. Reformulado arriba.

## El recargo no va en el total de la orden

Esto contesta la pregunta que la PR del recargo dejó explícitamente
abierta, y la contesta en el sentido incómodo.

El recargo **no está dentro del total** que devuelve `checkouts`. Va aparte,
en el pago, como `additionalCharges` de tipo `CREDIT_SURCHARGE`. La
documentación lo dice con un ejemplo aritmético: sobre `amount` de $35,00 y
un 3,5 %, *"the customer was charged $36.22"*, y el $1,22 sale de
`additionalCharges`, no del total.

    total que cobra Clover = payment.amount + additionalCharges.amount

Se lee después con `?expand=additionalCharges` sobre el pago o el
reembolso. En un reembolso parcial, Clover devuelve **la parte
proporcional** del recargo (de $15,00 reembolsados salen $15,52).

**La consecuencia mala para la app:** el importe exacto no se puede enseñar
antes de conocer la tarjeta. El recargo se aplica *solo* a tarjetas de
crédito con BIN elegible — **no a débito, no a efectivo**, y las reglas las
ponen las redes de tarjetas. Así que la política `show` no puede prometer
un número exacto antes del pago; puede advertir de que puede haber recargo
y de cuánto sería. El importe firme solo existe después de cobrar.

Y con propina, ojo al orden: en el dispositivo la propina se **suma al
`amount` antes** de aplicar la tasa, así que el recargo también cae sobre
la propina. En recibo de papel, no.

Tasas de referencia: Canadá es un **2,40 % plano**; en Estados Unidos varía
por merchant, y lo más común es **3,00 %**. Por eso la tasa se lee del
merchant y no se codifica.

## Pendiente de confirmar en sandbox

Ya no hay dudas sobre **dónde** está nada. Las que quedan son sobre **qué
hace Clover cuando se le llama**, y esas no se resuelven leyendo.

Lo del **recargo por tarjeta no está aquí**: no se puede montar en
sandbox. Va en la lista siguiente.

- [x] **vida real del access token: ~24 h en sandbox, no los 30 minutos
      documentados.** Medido el 2026-09-05 en el primer OAuth real contra
      el Test Merchant `RGW5JAVFT8MB1`. De paso queda confirmado que
      `access_token_expiration` **sí viene** en la respuesta del canje, así
      que la caducidad que se guarda es la real. No cambia el margen del
      worker ni la constante; el porqué está en `docs/REFRESCO-TOKENS.md`,
      *La vida real del token, medida*. Sigue sin medir en **producción**.
- [ ] vida real del **refresh** token
- [ ] **a qué dispositivo se enruta el `print_event`.** La documentación
      dice "a la impresora de órdenes del *firing device*, o a la integrada
      si no tiene". Lo que no dice es **cuál es el firing device cuando la
      orden entra por API** — y Viva tiene tres dispositivos. La respuesta
      trae `deviceRef`, así que la primera prueba real lo contesta sola.
- [ ] **el GET de `print_event` no sirve para confirmar éxito.** Solo
      responde mientras el trabajo está en `CREATED`, `PRINTING` o
      `FAILED`; en cuanto se imprime, se descarta y la respuesta pasa a ser
      *"The print event is missing"*. Es decir: **ausencia = impreso, o
      nunca existió**, y son indistinguibles. Confirmar la forma exacta de
      esa respuesta, porque de ella depende no marcar `PREPARING` por error.
- [ ] comportamiento del cobro sobre orden atómica **con propina**
- [ ] forma exacta de la respuesta de `payOrder` (nombre del campo de propina)
- [ ] si `atomic_order/checkouts` acepta el mismo `orderCart` que `orders`
      en todos los casos
- [ ] latencia entre crear la orden por API y verla en el dispositivo
- [x] ~~si la ventana de recuperación se renueva al recuperar~~ →
      **sí se renueva.** Developer Relations lo confirmó: la ventana se
      ancla a la hora de creación de cada par nuevo, venga del endpoint
      que venga. Se asumía lo contrario y la 0012 llegó a imponerlo con un
      trigger; la 0016 lo quita. Ver la sección de arriba
- [x] ~~la contradicción entre las dos respuestas de Clover~~ →
      **no había contradicción: eran dos rutas.** Aclarado el 2026-09-16.
      En `/oauth/v2/refresh` la recuperación pasa a ser el token que se
      acaba de consumir; en `/oauth/v2/recovery` sigue siendo el Token A
      original. El código ya se comportaba así en las dos, y ahora hay una
      prueba por ruta. Ver la sección de arriba
- [ ] **ejercer `/oauth/v2/recovery` de verdad.** Es lo único de la cadena
      que no se ha recorrido nunca: todo lo que sabemos de esa ruta viene
      de leer y de pruebas con un Clover de mentira. De esto depende quitar
      el seguro que impide borrar el token de recuperación desplazado
      (`CONSERVAR_TOKEN_RECUPERACION_DESPLAZADO`, en `chain.ts`). Ya no es
      una pregunta para Clover: es una prueba nuestra
- [ ] **la forma exacta del cuerpo de `/oauth/v2/recovery`.** Se manda
      `client_id` + `client_secret` + `refresh_token`, por analogía con
      `/oauth/v2/token` y `/oauth/v2/refresh` y con lo que describe el
      flujo. Es lo único del endpoint que no está verificado palabra por
      palabra, y se ve en la primera prueba contra el sandbox
- [ ] qué devuelve `/ecomm_payment_configs` en un merchant SIN recargo:
      ¿`supported: false`, o el campo no viene? La documentación solo
      enseña el caso con recargo. El código trata los dos.
- [ ] si `/gateway` responde algo útil en un merchant que no tiene
      ecommerce habilitado, o directamente falla

## Pendiente de respuesta de Clover (no se puede probar en sandbox)

Esto no está en la lista de arriba porque no es cuestión de llamar al
endpoint y mirar: **el recargo por tarjeta no se puede activar en un Test
Merchant de sandbox**, así que no hay manera de montar el escenario que
habría que observar.

Comprobado en el panel del Test Merchant el 2026-09-06:

- **Additional Charges** solo permite *service charges*, y la propia
  documentación de Clover advierte de que **no** se usen para recuperar
  el coste de procesamiento — que es exactamente lo que es un recargo por
  tarjeta. Así que ni siquiera sirve como sustituto aproximado.
- **Payments** trae cash back, redondeo, pagos offline, umbral, firma y
  *tenders*. Ninguna casilla de recargo.

Las dos preguntas que había aquí están **cerradas**, y ninguna hizo falta
medirla en sandbox:

- [x] ~~quién paga el recargo con `absorb` puesta~~ → **lo paga el
      cliente, y `absorb` se retiró.** El motivo es estructural y está en
      esta misma página: el endpoint de cobro no tiene campo para
      renunciar al recargo. Lo aplica Clover según el BIN de la tarjeta.
      Una política que promete absorber y no absorbe es peor que no
      tenerla: `0019_sin_absorb.sql`
- [x] ~~si el total de `atomic_order/checkouts` ya trae el recargo
      dentro~~ → **no lo trae.** Va aparte, en `additionalCharges` del
      pago. La documentación lo dice con aritmética: sobre $35,00 y un
      3,5 %, *"the customer was charged $36.22"*. Ver *El recargo no va en
      el total de la orden*
- [ ] **DECISIÓN DE PRODUCTO, no de Clover — cómo se le dice al cliente
      que el número que ve no es el que se cobra.** El recargo cae solo
      sobre crédito con BIN elegible, así que el importe exacto no existe
      antes de conocer la tarjeta. `"3,5 %"` es divulgación válida y aun
      así es un número distinto del cobro. Hay que decidirlo **antes de
      abrir la primera sucursal con recargo activo**; no bloquea el
      sandbox, donde el recargo ni se puede encender. Detalle en
      `docs/RECARGO-TARJETA.md`, *El número que se enseña no es el que se
      cobra*

Y una consecuencia que conviene tener delante: **la parte de dinero de
este flujo no se puede ensayar en ningún sitio antes de producción.** Lo
que sí se ensaya es la PANTALLA, poniendo `surcharge_rate` a mano en la
base (`docs/RECARGO-TARJETA.md`, *Cómo verlo en desarrollo*). Se ensaya
lo que se ve; no lo que se cobra.
