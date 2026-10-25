# Ajuste al flujo canónico de Clover — Addendum a la Fase 1

**Propósito:** convertir los seis hallazgos del documento de arquitectura en decisiones concretas de diseño, alineadas con lo que Clover realmente soporta y recomienda.
**Regla de oro de este documento:** donde Clover define un flujo, lo adoptamos tal cual. Donde Clover no define nada, lo resolvemos fuera de Clover, nunca reinterpretando sus objetos.

---

## Principio de ajuste

Hay una diferencia importante entre dos cosas que parecen iguales:

| Enfoque | Ejemplo | Veredicto |
|---|---|---|
| **Usar Clover como Clover espera** | crear la orden con `atomic_order`, cobrarla con "Pay for an order", imprimirla con `print_event` | ✅ es lo que buscamos |
| **Forzar Clover a hacer algo que no modela** | escribir `state = "READY"` en la orden y leerlo después | ❌ frágil, no soportado, se rompe en cualquier update |

Todos los ajustes de abajo aplican esta distinción. El resultado es una integración más pequeña y más estable, no más grande.

---

## Variable 1 — Estado del pedido

### Flujo canónico de Clover

Clover modela **dos hechos**, no un ciclo de vida operativo:

- `state`: `null` → `open` → `locked`. Es interno; Clover lo asigna cuando hay pago, no lo asignamos nosotros.
- `paymentState`: `OPEN` / `PAID` / `CREDITED`. Este sí es confiable y es el que debemos leer.

Lo que se puede observar de verdad desde afuera:

| Hecho | Cómo lo sabemos | Confiabilidad |
|---|---|---|
| Orden existe en Clover | respuesta de `atomic_order/orders` | alta |
| Orden pagada | `paymentState = PAID` + objeto payment | alta |
| Orden reembolsada | `paymentState = CREDITED` + webhook `P` | alta |
| Ticket enviado a impresora | respuesta de `print_event` | media (confirma envío, no impresión física) |
| Orden modificada o cancelada en el POS | webhook `O` UPDATE/DELETE + GET | alta |
| **Preparación terminada** | — | **no existe** |

### Ajuste recomendado

**Separar el estado en dos capas y no mezclarlas nunca.**

```
CAPA CLOVER (hechos financieros/operativos, solo lectura)
  clover_payment_state · clover_order_exists · clover_last_modified

CAPA NUESTRA (experiencia del cliente, derivada)
  order_status: DRAFT → PAYMENT_PENDING → CONFIRMED → PREPARING
                → READY → COMPLETED  (+ FAILED / CANCELED / REFUNDED)
```

Cada transición de nuestra capa se deriva de un hecho de la capa Clover o de un evento nuestro. Nunca al revés. En la base de datos son columnas distintas: `clover_payment_state` y `status`.

**Reglas de derivación:**

| Nuestro estado | Se dispara por | Origen |
|---|---|---|
| `CONFIRMED` | pago exitoso confirmado por Clover | Clover |
| `PREPARING` | `print_event` aceptado | Clover |
| `READY` | v1: reloj (`pickup_at` − buffer) · v2: APK companion | nuestro |
| `COMPLETED` | v1: `pickup_at` + 30 min · v2: APK companion | nuestro |
| `CANCELED` | webhook `O` DELETE | Clover |
| `REFUNDED` | `paymentState = CREDITED` | Clover |

### Recomendación de producto para la v1

Cambiar el lenguaje de la app para no prometer lo que no podemos observar:

| No decir en v1 | Decir en v1 |
|---|---|
| "Tu pedido está listo" | "Tu pedido estará listo a las 4:30 PM" |
| "Listo para recoger" | "Ya puedes pasar por tu pedido" |
| — | "En preparación" (esta sí es real: el ticket se imprimió) |

Es honesto, no requiere nada del empleado, y cuando entre el APK companion la app pasa a decir "listo" de verdad sin rediseñar nada: solo cambia el origen del evento `READY`.

### Ajuste al APK companion (fase 9)

Para que no se convierta en un KDS por la puerta de atrás, definir su alcance por escrito ahora:

**Sí:** listar los pedidos de app del día · dos botones (`En preparación` / `Listo`) · sonido al llegar pedido nuevo.
**No:** editar la orden, cobrar, imprimir, ver otros pedidos del POS, gestionar items, reportes, configuración.

Clover ofrece Order Connector y broadcasts/intents en su SDK de Android para este tipo de app, así que es un camino soportado, no un hack.

---

## Variable 2 — Impresión y llegada a cocina

### Flujo canónico de Clover

```
atomic_order/orders  →  la orden aparece en Orders y Register
                     →  NO se imprime sola
print_event          →  ruteo a impresora de órdenes del dispositivo
                        (o a la integrada si no hay de órdenes)
```

Y hay tres condiciones que Clover exige para que el ticket salga correcto:

1. Los line items deben ser **items reales del inventario** del merchant.
2. Los modificadores deben pertenecer a **modifier groups existentes** ligados a esos items. Los modificadores ad-hoc no imprimen.
3. El merchant debe tener impresora de órdenes configurada y la app los permisos de lectura y escritura de órdenes.

Además, el ruteo a la impresora correcta (barra, cocina, jugos) en Clover se hace con **labels/tags de item**, que son configuración del merchant, no de la orden.

### Ajuste recomendado

**Regla dura de producto: si un producto no existe en el inventario de Clover, no se vende en la app.** Sin excepciones, sin items ad-hoc, sin "productos solo de app". Esto elimina de golpe la mayoría de los fallos de impresión y de reportes descuadrados.

**Checklist de onboarding, bloqueante:**

- [ ] Impresora de órdenes conectada y visible en la app Printers del merchant
- [ ] Labels de item asignados si hay más de una estación
- [ ] Todos los items que irán a la app existen en inventario con precio y tasa de impuesto
- [ ] Todos los modificadores están en modifier groups ligados a sus items
- [ ] Prueba de humo: pedido real de $1 desde la app → ticket impreso → validado por el gerente
- [ ] Verificado que el merchant no opera con Clover Dining

Si un punto falla, la sucursal queda en estado `PENDING_SETUP` y no aparece en la app. El SaaS debe mostrar esta lista y su estado, y ese es su verdadero valor operativo.

**Monitoreo continuo:** si `print_event` falla o no progresa para una orden, alerta inmediata al SaaS y llamada telefónica al local. Un pedido pagado que la cocina nunca vio es el peor fallo posible de esta plataforma.

**Contexto en el ticket:** como Clover no tiene campo de "hora de pickup", usar `title` y `note`, que sí se imprimen. Convención fija en el código, no improvisada por restaurante:

```
title: "APP #1052 · PICKUP 4:30 PM"
note:  "PEDIDO MOVIL\nCliente: Maria G.\nRecoge: 4:30 PM\nCodigo: 7K2"
```

Sin acentos ni emojis: las impresoras térmicas suelen degradarlos.

---

## Variable 3 — Pago y reembolso

### Flujo canónico de Clover

Clover documenta explícitamente esta secuencia para órdenes online:

```
1. Ecommerce: tokenizar la tarjeta          (iframe / hosted checkout)
2. atomic_order/checkouts                    → totales e impuestos reales
3. atomic_order/orders                       → orden creada
4. Ecommerce: "Pay for an order"             → cobra el total de la orden
                                               y permite incluir propina
5. print_event                               → ticket a cocina
```

El paso 4 es la pieza clave que hay que adoptar tal cual: **pagar la orden, no crear un charge suelto**. Un charge independiente cobraría el dinero sin quedar ligado a la orden, y ahí empiezan los descuadres en los reportes del restaurante. La propina va en ese mismo paso.

Los reembolsos van por la Ecommerce API (refunds / voids), no por la Platform API.

### Ajuste recomendado

**Orden de operaciones definitiva** (y esto sí cambia respecto al borrador inicial, donde el orden era ambiguo):

```
tokenizar → checkout (totales) → crear orden → pagar orden → imprimir
```

La orden se crea **antes** del cobro. Si el cobro falla, tenemos una orden sin pagar en Clover que anulamos; es un caso recuperable y visible. El inverso (cobrar primero y fallar al crear la orden) deja dinero cobrado sin pedido, que es el escenario crítico R10.

**Manejo de fallos, por paso:**

| Falla en | Acción | Estado del cliente |
|---|---|---|
| Tokenización | reintento en el iframe | sigue en checkout |
| Checkout de totales | error, no se cobra nada | "Intenta de nuevo" |
| Creación de orden | error, no se cobra nada | "Intenta de nuevo" |
| **Pago** | anular la orden en Clover | `PAYMENT_FAILED` |
| **Impresión** | orden pagada y válida; alerta P1 al SaaS + llamada al local | `CONFIRMED`, sin `PREPARING` |

Nótese que el fallo de impresión **no** cancela ni reembolsa automáticamente: el pedido es válido y el restaurante puede verlo en la app Orders. Es un problema operativo, no financiero.

**Propina:** decidir ahora si se pide en la app. Si sí, se envía en el paso de pago de la orden y aparece en los reportes del merchant como propina real. Si se cobrara aparte, no llegaría al empleado correctamente. Recomiendo incluirla desde v1: en EE. UU. es esperada y es dinero directo para el local, lo cual ayuda a vender la plataforma.

**Reembolsos, dos orígenes:**

- Desde nuestro SaaS (super admin) → Ecommerce API refund → webhook `P` confirma → app y loyalty se actualizan.
- Desde el restaurante (Dashboard o app de Refunds de Clover) → webhook `P` + `paymentState = CREDITED` → detectamos y actualizamos.

El segundo caso es el que suele olvidarse y el que produce clientes con puntos de loyalty por una compra reembolsada. Hay que revertir la transacción de loyalty al detectar el reembolso.

---

## Variable 4 — Límites de rate

### Flujo canónico de Clover

| Nivel | Req/s | Concurrencia |
|---|---|---|
| Por app | 50 | 10 |
| Por token (merchant) | 16 | 5 |

Y las prácticas que Clover recomienda explícitamente: usar webhooks en lugar de polling constante, cachear, filtrar por `modifiedTime` para no re-consultar lo que no cambió, escalonar las peticiones entre merchants, y hacer backfills fuera de horas pico. Ante `429`, backoff exponencial respetando `retry-after`.

### Ajuste recomendado

**Presupuesto de llamadas por pedido** (fijarlo y medirlo en CI):

| Paso | Llamadas |
|---|---|
| Checkout de totales | 1 |
| Buscar/crear cliente | 0–2 |
| Crear orden | 1 |
| Pagar orden | 1 |
| Imprimir | 1 |
| Verificación post-orden | 1 |
| **Total** | **5–7** |

Con 50 req/s de techo, la operación transaccional soporta del orden de 7 pedidos por segundo. Eso no es el problema.

**El problema es el catálogo.** Ahí va el ajuste real:

1. **Partición del presupuesto global.** Reservar la capacidad, con un rate limiter global compartido por todos los workers:
   - 60% transaccional (pedidos en curso) — prioridad absoluta
   - 25% sync de catálogo
   - 15% reconciliación y reparación
   El tráfico transaccional siempre puede robar de las otras dos colas; nunca al revés.

2. **Un solo sync completo por sucursal, en el onboarding.** Después, solo deltas por webhook y barridos por `modifiedTime`. Prohibido el "sync completo cada noche por si acaso": con 200 sucursales eso es una tormenta autoinfligida.

3. **Escalonar por sucursal.** Los barridos se distribuyen con un offset determinístico derivado del `store_id` para que 200 tiendas no consulten en el mismo segundo.

4. **Backfills y reparaciones profundas entre 2 y 5 AM hora local de la sucursal**, usando `timezone` de `stores`.

5. **Evitar `expand` anidados.** Clover documenta que las expansiones anidadas provocan timeouts y 502. Preferir varias consultas simples y paginadas.

6. **Un circuit breaker por merchant.** Si una sucursal acumula errores, se aísla en estado `DEGRADED` sin arrastrar al resto de tenants. Este punto es el que protege el techo compartido de 50 req/s.

---

## Variable 5 — OAuth y onboarding del merchant

### Flujo canónico de Clover

El merchant instala la app desde el App Market (o desde un enlace que la app publique), Clover lo lleva al flujo v2/OAuth, el merchant autoriza, y nuestro backend recibe el código y lo canjea por un access token y un refresh token expirables. Los permisos concedidos son los declarados en el Developer Dashboard.

Y el punto que más impacta al diseño del SaaS: **si cambiamos los permisos después de que el merchant instaló la app, ese merchant no recibe los nuevos hasta desinstalar y reinstalar.**

### Ajuste recomendado

**1. Congelar los permisos antes del primer merchant real.** Declarar de una vez el set completo, incluyendo lo que se usará en fases posteriores:

```
Inventory     read + write*
Orders        read + write
Merchant      read + write*
Customers     read + write
Payments      read
Ecommerce     online payments habilitado
```

(*) `write` de inventario y merchant probablemente no se usen nunca, pero pedirlos ahora evita forzar reinstalaciones más adelante. Contrapartida: más permisos hacen la revisión de la app más estricta y generan más fricción con el merchant. **Esta es una decisión tuya**; mi recomendación es pedirlos, y documentar internamente que no se usan.

**2. Rediseñar la pantalla de Clover del SaaS.** El brief la plantea como un botón que el super admin presiona. En realidad es un proceso de dos actores:

```
SaaS · Sucursal · Integración Clover

Estado: NO CONECTADA

[ Generar enlace de conexión ]   → link firmado, expira en 72 h
[ Enviar por email al merchant ]

────────────────────────────────
El dueño del restaurante debe abrir el enlace
e iniciar sesión con su cuenta de Clover.
────────────────────────────────

Estado: PENDIENTE DE AUTORIZACIÓN · enviado hace 2 h
```

Y una vez conectada:

```
Estado: CONECTADA ✓
Merchant           ****4F2
Permisos           7 de 7 concedidos
Pagos online       habilitado ✓
Order type         "Online Pickup" ✓
Impresora órdenes  configurada ✓
Última sync        hace 4 min
Último webhook     hace 40 s
Token              válido, renueva en 12 días
```

Sin secretos, sin tokens, ni siquiera enmascarados.

**3. Verificar habilitación de pagos online en el momento de conectar**, no en la primera venta. Si el merchant no está habilitado para ecommerce, la sucursal queda en `PENDING_SETUP` con un mensaje accionable dirigido a su representante de Clover.

**4. Refresh proactivo de tokens.** Un worker que renueva antes del vencimiento, con alerta si falla dos veces seguidas. Un token vencido en silencio equivale a una sucursal caída.

**5. Escuchar el webhook `A`.** Si el merchant desinstala la app, la sucursal se cierra en la app móvil de inmediato. Sin esto, seguiríamos aceptando pedidos que nunca llegarían a la cocina.

---

## Variable 6 — Sucursal = merchant de Clover

### Flujo canónico de Clover

Cada local es un `merchantId` independiente, con su propio catálogo, sus propias tasas de impuesto, su propio `order_type`, su propia autorización y su propio token. No hay una entidad "cadena" que podamos consumir.

### Ajuste recomendado

**El catálogo vive en `store`, no en `restaurant`.** Aunque las tres sucursales de la misma marca tengan el mismo menú hoy, mañana una sube el precio y la otra no. Modelarlo a nivel de marca obligaría a un refactor.

**Menú maestro como capa de merchandising, no de datos:** el SaaS puede mostrar una vista comparativa por marca ("este item cuesta $8.99 en Downtown y $9.49 en Midtown", "este item existe en 2 de 3 sucursales") y alertar de divergencias. Pero no escribe en Clover: el gerente corrige en su POS. Esa vista es, en la práctica, una de las funciones más vendibles del SaaS.

**En la app:** el cliente elige sucursal **antes** de ver el menú, no después. Es el orden que ya tienes en el brief y es el correcto; ahora hay una razón técnica dura detrás. Si el cliente cambia de sucursal con el carrito lleno, hay que re-validar cada item contra el catálogo de la nueva y avisar de las diferencias, no fallar en silencio.

---

## Reglas absolutas, versión ajustada

Reemplaza las reglas 9, 11 y 21 de tu sección 47, y añade cuatro:

| # | Regla | Cambio |
|---|---|---|
| 9 | Clover es fuente de verdad de **catálogo, impuestos, dinero y la orden operativa**. El estado de preparación es nuestro, alimentado desde el dispositivo Clover. | ajustada |
| 11 | Usar webhooks como disparador, **nunca como dato**: siempre re-consultar el objeto en Clover antes de actuar. | ajustada |
| 21 | No construir KDS propio. El APK companion se limita a dos botones y no gestiona cocina. | ajustada |
| 26 | Si un producto no existe en el inventario de Clover, no se vende en la app. | nueva |
| 27 | El cobro se hace **sobre la orden** de Clover, nunca como charge suelto. | nueva |
| 28 | Ninguna sucursal se activa sin superar el checklist de onboarding completo. | nueva |
| 29 | Los permisos de la app se congelan antes del primer merchant real. | nueva |

---

## Qué cambia en las fases

| Fase | Ajuste |
|---|---|
| 2 | El esquema separa `clover_payment_state` de `status`. Añadir `stores.setup_checklist jsonb`. |
| 5 | El modelo de estados se implementa con las dos capas desde el inicio, aunque `READY` sea por reloj. |
| 6.5 | Congelar permisos. Es una decisión, no una tarea técnica. |
| 7 | Añadir a la lista de verificación: prueba de impresión con modificadores reales, y comportamiento de "Pay for an order" con propina. |
| 8 | Rate limiter global con particiones antes de conectar la segunda sucursal, no después. |
| 9 | APK companion con alcance cerrado por escrito. |
| 13 | El SaaS incluye el checklist de onboarding y la vista de divergencia de menús entre sucursales. |

---

## Lo único que sigue pendiente de tu decisión

1. **Propina en la app:** ¿sí desde v1? (recomiendo que sí)
2. **Permisos amplios desde el inicio** aunque no se usen todos: ¿lo aceptas? (recomiendo que sí)
3. **APK companion:** ¿fase 9 comprometida, o queda condicionado a que el piloto muestre que el tiempo estimado no basta?
4. **Sucursales del piloto:** el número exacto define cuánto rigor necesita el rate limiter desde el día uno.

Con estas cuatro respuestas, la Fase 2 arranca sin ambigüedades.

---

# Addendum · KDS en lugar de impresora (septiembre 2026)

**Dato del negocio:** Viva usa **KDS en pantalla**, no impresora térmica en cocina.
Esto se verificó contra la documentación oficial antes de dar por buena la
Variable 2 de este documento.

## El `print_event` sigue siendo el camino

La documentación de la Print API dice que la solicitud **se enruta a la
impresora de órdenes del dispositivo de disparo** o, si no hay ninguna, a su
impresora integrada.

Si el KDS está configurado como *order printer* del dispositivo de disparo por
defecto, la orden le llega igual. **No hay que cambiar la arquitectura**: el
`print_event` vale para los dos casos.

Lo que cambia es el **checklist de onboarding**: donde decía "impresora de
órdenes conectada", ahora hay que verificar **qué dispositivo está configurado
como destino de las órdenes**, sea impresora o KDS.

## Hallazgo mejor: confirmación real de que la cocina lo recibió

Cuando una orden se imprime, **Clover pone `printed = true` en cada línea de la
orden**, y esos cambios llegan como webhook de tipo `O`.

Eso es mejor que lo que teníamos. Hasta ahora derivábamos `PREPARING` de que la
llamada a `print_event` respondiera bien, que solo confirma que **se aceptó la
solicitud**. Con este webhook tenemos confirmación de que **la orden llegó de
verdad al destino**.

**Ajuste al mapa de estados:**

| Estado | Antes | Ahora |
|---|---|---|
| `PREPARING` | respuesta OK de `print_event` | webhook `O` con `printed = true` en las líneas |

El estado del propio print event también se puede consultar, pero es de vida
corta: solo responde mientras el trabajo está en `CREATED`, `PRINTING` o
`FAILED`. Una vez impreso se descarta. Sirve para detectar fallos, no para
confirmar éxito.

## Un caso a verificar en sandbox

Hay reportes en la comunidad de desarrolladores de que el KDS de Clover **no
muestra automáticamente los items añadidos a una orden ya existente**: hay que
volver a dispararla desde el POS.

No es nuestro caso —creamos una orden completa y la disparamos una vez—, pero
conviene comprobarlo en la Fase 7 por si algún día hay que añadir algo a un
pedido ya enviado.

## Confirmado con Viva (septiembre 2026)

| Pregunta | Respuesta |
|---|---|
| Qué KDS usan | **El de Clover**, no uno de terceros |
| Se imprime papel en cocina | **No.** Solo pantalla |
| Las órdenes del POS llegan solas al KDS | **Sí**, sin que nadie pulse nada |

**Lectura:** el KDS está enlazado como destino de órdenes de la tablet del POS.
Es la configuración que necesitábamos, así que el `print_event` debería
enrutarse igual. Se verifica en la Fase 7 con un pedido real.

## Los tres dispositivos de la tienda

1. **Tablet del POS** — donde se toman los pedidos de mostrador
2. **KDS** — pantalla de cocina, recibe del POS automáticamente
3. **Pantalla de autoservicio en la entrada** — posiblemente un Clover Kiosk

**Aclaración de Viva:** lo que se pide en el kiosco **entra al POS como una venta
normal** y de ahí pasa al KDS. El kiosco no es un destino de órdenes, es un
**origen**.

Eso simplifica el cuadro: hay **varios orígenes y un solo destino**.

```
   Mostrador (tablet POS) ─┐
   Kiosco de la entrada  ──┼──►  POS  ──►  KDS  ──►  cocina prepara
   Nuestra app móvil     ──┘
```

Nuestra app es simplemente **un origen más**, que desemboca donde ya desembocan
los otros dos. Es exactamente lo que buscaba la regla de no duplicar Clover: no
construimos un camino paralelo a cocina, usamos el que el restaurante ya tiene y
en el que su gente ya está entrenada.

**Lo que queda por verificar en la Fase 7** es menor de lo que parecía: confirmar
con un pedido de prueba que el `print_event` de una orden creada por API acaba en
ese mismo KDS, igual que las del mostrador y el kiosco.

**Pregunta de negocio:** si el cliente ya puede pedir en el kiosco al entrar,
¿qué aporta la app? La respuesta es que el kiosco sirve a quien ya está en la
tienda, y la app sirve a quien pide desde fuera y llega a recoger. Son momentos
distintos y no compiten. Vale la pena tenerlo formulado, porque otros
restaurantes con kiosco harán la misma pregunta.
