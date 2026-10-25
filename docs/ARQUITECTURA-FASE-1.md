# Plataforma de Mobile Ordering sobre Clover — Entregable Fase 1 (Arquitectura)

**Estado:** propuesta para revisión. No se escribe código hasta tu aprobación.
**Fuente de verdad técnica:** documentación oficial de Clover (`docs.clover.com`), consultada para este documento.
**Fecha de verificación de la documentación:** agosto 2026.

---

## 0. Resumen ejecutivo: lo que cambia respecto al brief

Tu brief es sólido y la regla "no duplicar Clover" es la correcta. Pero la documentación oficial impone cuatro correcciones que hay que absorber **ahora**, no en la Fase 8:

### 0.1 Clover NO tiene estados operativos de cocina en su API pública

El objeto `order` de Clover tiene un campo `state` cuyos valores son `null`, `open` y `locked`. La documentación advierte explícitamente que esos valores no son validados por el servidor y que no deben usarse para tomar decisiones lógicas. Existe además `paymentState` (OPEN / PAID / CREDITED), que describe el pago, no la preparación.

**No existe** `PREPARING`, no existe `READY`, y no hay un webhook "order ready".

Consecuencia directa: **la sección 17 de tu brief no es implementable como está escrita**. Clover no puede ser source of truth del estado operativo porque no lo modela. Ver §7 para las tres opciones y la recomendación.

### 0.2 Una sucursal = un merchant de Clover = una conexión OAuth

Clover no tiene un concepto de "cadena con sucursales" accesible por API para nuestro caso. Cada local tiene su propio `merchantId` (mId), su propio catálogo, sus propios impuestos y su propia autorización OAuth. Un restaurante con 3 sucursales son 3 conexiones y potencialmente 3 catálogos que divergen entre sí.

Esto define el modelo de datos: `store` ≡ `clover_connection` ≡ `mId`. Ver §11.

### 0.3 El SUPER ADMIN no puede conectar Clover solo

La sección 13 del brief asume que nuestro super administrador ejecuta el OAuth. En la práctica el flujo requiere que **el merchant** se autentique en Clover y autorice la app; nadie puede hacerlo por él sin sus credenciales. Nuestro SaaS puede *originar* y *supervisar* el proceso (generar el link, recibir el callback, guardar los tokens, mostrar el estado), pero el clic de autorización es del dueño del restaurante. Además, en producción la app debe estar aprobada y publicada en el Clover App Market (o ser una app privada aprobada) para que merchants reales puedan instalarla.

### 0.4 Los reembolsos no se hacen con la Platform API

La API de plataforma (`/v3/...`) no procesa reembolsos. Los reembolsos de pagos online se hacen con la **Ecommerce API** o desde el Merchant Dashboard. Esto ata `RefundService` a la misma API que usamos para cobrar, no a la de órdenes.

---

## 1. Arquitectura recomendada

### 1.1 Principio rector (versión corregida del tuyo)

> Clover es source of truth de **catálogo, impuestos, órdenes y dinero**.
> Nosotros somos source of truth de **identidad del cliente, experiencia, promesa de tiempo, loyalty y comunicación**.
> Donde Clover no modela algo (estado de preparación), lo modelamos nosotros **sin construir un KDS**, y lo alimentamos desde el dispositivo Clover.

### 1.2 Diagrama de contexto

```
┌──────────────┐
│   CLIENTE    │
└──────┬───────┘
       │
┌──────▼───────────────┐        ┌───────────────────────────┐
│  MOBILE APP (RN)     │        │  SAAS ADMIN (Next.js)     │
│  Expo · TypeScript   │        │  Super Admin              │
└──────┬───────────────┘        └───────────┬───────────────┘
       │ HTTPS (anon key + JWT)             │ HTTPS (JWT admin)
       │                                    │
┌──────▼────────────────────────────────────▼───────────────┐
│                    NUESTRO BACKEND (Supabase)             │
│                                                            │
│  ┌────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ PostgreSQL │  │ Auth + RLS   │  │ Storage (branding)│  │
│  └────────────┘  └──────────────┘  └───────────────────┘  │
│                                                            │
│  Edge Functions:                                           │
│   /catalog      /checkout       /orders      /webhooks     │
│   /oauth        /notifications  /loyalty                   │
│                                                            │
│  Workers (pg_cron + pgmq):                                 │
│   sync-catalog · reconcile · retry-queue · token-refresh   │
└──────┬─────────────────────────────────────────────┬───────┘
       │ REST (Bearer OAuth por merchant)            │ webhooks
       │                                             │ (una sola URL,
       ▼                                             │  todos los tenants)
┌────────────────────────────────────────────────────┴───────┐
│                        CLOVER                              │
│                                                            │
│  Platform API /v3      Ecommerce API      Webhooks (app)   │
│  · inventory           · tokens           · I / IC / IG/IM │
│  · atomic_order        · charges          · O  (orders)    │
│  · order_types         · orders/pay       · P  (payments)  │
│  · print_event         · refunds          · A  (app)       │
└──────┬─────────────────────────────────────────────────────┘
       │ sync a dispositivos del merchant
       ▼
┌────────────────────────────────────────────────────────────┐
│  DISPOSITIVOS DEL RESTAURANTE                              │
│  Register / Orders app  ·  Impresora de órdenes  ·  KDS    │
│  (+ FASE 9: nuestro APK "Pickup" con botón READY)          │
└────────────────────────────────────────────────────────────┘
       │
       ▼  Empleado: 100% dentro del ecosistema Clover
```

### 1.3 Componentes

| Componente | Tecnología | Responsabilidad |
|---|---|---|
| Mobile App | React Native + Expo + TypeScript | Experiencia del cliente. Cero credenciales de Clover. |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions) | Puente seguro, catálogo espejo, órdenes propias, loyalty, notificaciones. |
| Workers | pg_cron + pgmq (o Supabase Queues) | Sync, reintentos, reconciliación, refresh de tokens. |
| SaaS Admin | Next.js + TypeScript + Tailwind, Vercel | Alta de restaurantes, branding, conexión Clover, analytics. |
| Clover | Platform API + Ecommerce API + Webhooks | POS, catálogo, impuestos, órdenes, pagos, impresión, KDS. |
| Clover Companion APK (fase posterior) | Android + Clover SDK | Un solo botón: marcar pedido online como listo. |

**Por qué workers y no solo Edge Functions:** las Edge Functions son ideales para request/response y para recibir webhooks, pero los reintentos, la reconciliación nocturna y el sync de catálogos necesitan durabilidad y backoff. `pgmq` + `pg_cron` dentro de la misma Postgres evita introducir infraestructura extra en la v1.

---

## 2. Flujo APP → BACKEND → CLOVER (creación de pedido)

```
APP                    BACKEND                          CLOVER
 │                        │                                │
 │ POST /checkout/quote   │                                │
 │  {store_id, items[]}   │                                │
 ├───────────────────────►│                                │
 │                        │ valida store abierto,          │
 │                        │ items disponibles (espejo)     │
 │                        │                                │
 │                        │ POST /v3/merchants/{mId}/      │
 │                        │   atomic_order/checkouts       │
 │                        ├───────────────────────────────►│
 │                        │◄───────────────────────────────┤
 │                        │  totales + impuestos REALES    │
 │                        │                                │
 │◄───────────────────────┤ quote_id + total autoritativo  │
 │                        │ (guardado en nuestra DB)       │
 │                        │                                │
 │ [ el cliente paga: ver §4 — el PAN nunca toca           │
 │   nuestro backend ni nuestro código nativo ]            │
 │                        │                                │
 │ POST /checkout/confirm │                                │
 │  {quote_id, source_tok,│                                │
 │   idempotency_key}     │                                │
 ├───────────────────────►│                                │
 │                        │ 1) POST atomic_order/orders    │
 │                        │    (orderType=ONLINE PICKUP,   │
 │                        │     title, note, customer)     │
 │                        ├───────────────────────────────►│
 │                        │◄──── clover_order_id ──────────┤
 │                        │                                │
 │                        │ 2) Ecommerce: pagar la orden   │
 │                        ├───────────────────────────────►│
 │                        │◄──── payment/charge id ────────┤
 │                        │                                │
 │                        │ 3) POST /v3/merchants/{mId}/   │
 │                        │    print_event {orderId}       │
 │                        ├───────────────────────────────►│
 │                        │                                │
 │◄── order confirmado ───┤ estado = CONFIRMED             │
```

### Notas duras de este flujo

1. **El total lo calcula Clover, no nosotros.** El endpoint de *checkout* de atomic orders construye el carrito y devuelve totales e impuestos sin finalizar la orden. Nunca confiar en precios enviados por el cliente. El impuesto en Clover se aplica **a nivel de line item** y las tasas deben existir previamente en el inventario del merchant: no se puede inventar una tasa al vuelo.

2. **`orderType` es obligatorio para que la orden se vea bien.** Se obtiene o se crea con `POST /v3/merchants/{mId}/order_types`. Es específico por merchant, así que se resuelve una vez por sucursal en el onboarding y se cachea en `clover_connections`.

3. **La orden debe usar items reales del inventario de Clover.** Las órdenes atómicas con items ad-hoc o modificadores custom no imprimen bien: Clover no imprime modificadores personalizados si no están ligados a inventario y a modifier groups existentes. Esto refuerza que el catálogo se sincroniza *desde* Clover, nunca al revés.

4. **La impresión no es automática.** Crear la orden por API la hace visible en las apps Orders y Register (no en Clover Dining, que usa un esquema privado), pero para que salga el ticket de cocina hay que llamar `print_event`. Requiere permisos de lectura y escritura de órdenes y que el merchant tenga impresora de órdenes configurada; si no la hay, la solicitud se enruta a la impresora integrada del dispositivo.

5. **Cliente en Clover:** no se puede crear cliente y asignarlo a la orden en una sola llamada. Es crear cliente → crear orden → actualizar orden con `customer.id`. Buscar por email/teléfono antes para no duplicar.

6. **Idempotencia:** cada intento de confirmación lleva `idempotency_key` generada en el cliente. El backend registra `checkout_attempts(key, state)` antes de tocar Clover. Un reintento con la misma key devuelve el resultado previo, jamás crea una segunda orden.

---

## 3. Flujo CLOVER → BACKEND → APP (eventos)

```
CLOVER                        BACKEND                       APP
  │                              │                            │
  │ POST /webhooks/clover        │                            │
  │  X-Clover-Auth: <code>       │                            │
  │  {appId, merchants:{         │                            │
  │    mId:[{objectId:"O:xxx",   │                            │
  │          type:"UPDATE",      │                            │
  │          ts: 1699...}]}}     │                            │
  ├─────────────────────────────►│                            │
  │                              │ 1. valida X-Clover-Auth    │
  │                              │ 2. 200 OK inmediato        │
  │                              │ 3. encola evento (pgmq)    │
  │◄─────────── 200 ─────────────┤                            │
  │                              │                            │
  │        worker: GET objeto    │                            │
  │◄─────────────────────────────┤                            │
  ├─────────────────────────────►│                            │
  │                              │ 4. dedup (mId, objectId,ts)│
  │                              │ 5. mapea a estado nuestro  │
  │                              │ 6. persiste + notifica     │
  │                              ├───── Realtime / FCM ──────►│
```

### Lo crítico del payload

El webhook de Clover **no trae el objeto**, solo `objectId`, `type` (CREATE/UPDATE/DELETE) y `ts`. Siempre hay que hacer un GET posterior. Prefijos de tipo relevantes para nosotros:

| Clave | Evento | Permiso requerido | Uso nuestro |
|---|---|---|---|
| `O` | Órdenes | Read orders | Detectar cambios/cancelaciones hechas en el POS |
| `P` | Pagos | Read payments | Confirmar cobro, detectar reembolsos |
| `I` | Inventory item | Read inventory | Precio, nombre, disponibilidad |
| `IC` | Categoría | Read inventory | Estructura del menú |
| `IG` | Modifier group | Read inventory | Personalización |
| `IM` | Modifier | Read inventory | Personalización |
| `M` | Merchant | Read merchant | Horarios, dirección, moneda |
| `A` | App | Read merchant | **Desinstalación del merchant** → desactivar tienda |
| `C` | Customers | Read customers | Opcional |

**Restricciones que cambian el diseño:**

- El webhook se configura **a nivel de app**, no de merchant: una sola URL recibe eventos de todos los tenants. El ruteo por `mId` es responsabilidad nuestra. Los webhooks tampoco se pueden atar a un dispositivo POS concreto.
- Cada suscripción exige el permiso de lectura correspondiente. **Si cambiamos permisos después de que un merchant instaló la app, ese merchant no los recibe hasta desinstalar y reinstalar.** Por eso hay que definir el set completo de permisos en la Fase 7 y no tocarlo.
- La autenticación del webhook es un código estático en el header `X-Clover-Auth`. Es un secreto compartido, no una firma HMAC por mensaje: **validarlo es necesario pero no suficiente**. Nunca confiar en el contenido del webhook; siempre re-consultar el objeto en Clover antes de actuar.
- No hay garantía de orden ni de entrega exactamente-una-vez. De ahí la deduplicación y la reconciliación (§9).

---

## 4. Flujo de pago

### 4.1 Modelo elegido

Clover Ecommerce ofrece tres caminos: **Hosted Checkout** (página alojada por Clover), **iframe alojado + API/SDK**, y **API pura** (que exige certificación PCI DSS propia y encriptación con la clave pública PAKMS).

**Recomendación: iframe alojado dentro de un WebView de la app, con Hosted Checkout como fallback.** La API pura queda descartada para v1: nos metería en un alcance PCI que no queremos y que no aporta al negocio.

```
APP (RN)                 BACKEND              CLOVER ECOMMERCE
  │                         │                        │
  │ POST /checkout/session  │                        │
  ├────────────────────────►│                        │
  │                         │ crea sesión / entrega  │
  │                         │ PAKMS pública del      │
  │                         │ merchant               │
  │◄─────── url/keys ───────┤                        │
  │                         │                        │
  │ WebView con iframe Clover                        │
  ├──────────────── datos de tarjeta ───────────────►│
  │◄──────────── source token (no PAN) ──────────────┤
  │                         │                        │
  │ POST /checkout/confirm  │                        │
  │   {source, quote_id}    │                        │
  ├────────────────────────►│                        │
  │                         │ crea orden atómica     │
  │                         │ + paga la orden        │
  │                         ├───────────────────────►│
  │                         │◄──── resultado ────────┤
  │◄─── CONFIRMED / FAILED ─┤                        │
```

### 4.2 Reglas no negociables

- El PAN y el CVV **nunca** pasan por nuestro backend, nuestra base de datos ni nuestro código nativo. Solo manejamos tokens.
- Clover exige CVV para tokenizar una tarjeta; para tarjeta guardada se usa el flujo de tarjeta en archivo (vaulted card / customerId), que ya no requiere CVV en los cobros siguientes.
- **Nunca mostrar "Payment successful" hasta tener respuesta autoritativa de Clover.** Estado intermedio explícito: `PAYMENT_PENDING`.
- El iframe soporta botones de Apple Pay y Google Pay: dejar el hueco arquitectónico aunque no se implemente en v1.
- Hosted Checkout tiene una limitación relevante: **no hay endpoint GET para consultar el estado de una sesión de checkout** y las sesiones caducan a los 15 minutos. La ruta oficial para conocer el resultado es el webhook. Si usamos Hosted Checkout, el webhook no es opcional. Su firma es distinta (header `Clover-Signature` con timestamp + payload + secreto), así que hay dos validadores de webhook distintos en el sistema.

### 4.3 Prerrequisito comercial que hay que verificar por merchant

No todo merchant de Clover puede aceptar pagos online: depende de su plan y de su gateway. Existe un endpoint `GET /v3/merchants/{mId}/gateway` que expone la configuración de gateway del merchant. **El onboarding debe verificarlo y bloquear la activación de la tienda si el merchant no está habilitado para ecommerce.** Descubrir esto con un cliente firmado sería caro.

### 4.4 Reembolsos

`RefundService` → Ecommerce API (refunds / voids). La Platform API no reembolsa. El reembolso también puede originarse en el restaurante desde el Dashboard o la app de Refunds; en ese caso lo detectamos por webhook `P` y por `paymentState = CREDITED` en la orden, y actualizamos la app y el loyalty.

---

## 5. Abstracción de pagos por fases

```
PaymentService (interfaz)
├── MockPaymentService          ← Fase 6
├── CloverPaymentService        ← Fases 7–8
└── StripePaymentService        ← futuro, no en roadmap v1
```

Interfaz mínima:

```ts
interface PaymentService {
  createSession(input: SessionInput): Promise<SessionRef>;
  payOrder(input: PayInput): Promise<PaymentResult>;   // idempotente
  getPayment(ref: PaymentRef): Promise<PaymentResult>; // para reconciliación
  refund(input: RefundInput): Promise<RefundResult>;
}
```

`getPayment` es obligatorio en la interfaz desde el día uno: sin él no hay reconciliación posible.

---

## 6. Flujo de pickup (cliente)

```
1. Selecciona restaurante y sucursal      → nuestro backend
2. Ve menú                                 → espejo de Clover
3. Personaliza                             → modifier groups de Clover
4. Elige pickup + horario                  → NUESTRO (Clover no agenda)
5. Paga                                    → Clover Ecommerce
6. Orden creada + print_event              → Clover
7. Confirmación push                       → nuestro
8. Empleado prepara en Clover              → Clover (ticket / Orders app)
9. Marca listo                             → ver §7
10. Push "Your order is ready"             → nuestro
11. Cliente llega, muestra código          → nuestro
12. Empleado entrega                       → Clover (orden ya pagada)
```

**El horario de pickup es dato nuestro.** Clover no tiene agenda de pickup en la API pública. Lo transportamos al restaurante en el `title` y el `note` de la orden, que sí se imprimen. Convención propuesta para el título:

```
title: "APP #1052 · PICKUP 4:30 PM"
note:  "Cliente: María G.\nRecoge: 4:30 PM\nPedido móvil"
```

Es feo, y es lo que hay: es el único canal fiable para meter contexto operativo en el ticket sin construir un sistema paralelo.

**Capacidad y horarios:** las franjas de pickup, el throttling en hora pico y los días festivos son lógica nuestra, configurable por sucursal en el SaaS. Clover expone horarios de servicio del merchant (evento `SH`), que usamos como default y validación.

---

## 7. El problema del estado "LISTO" — decisión requerida

Como se explicó en §0.1, Clover no modela preparación. Tres opciones reales:

### Opción A — Tiempo prometido (sin señal del restaurante)

El cliente elige hora de pickup, recibe push 5 minutos antes. Cero fricción para el empleado, cero desarrollo extra.
**Contra:** si la cocina va tarde, mentimos. En juice bars con tiempos de 3–6 minutos es aceptable; en cocinas más lentas, no.

### Opción B — Señal derivada de Clover

Inferir "en preparación" desde el `print_event` (el ticket se imprimió → cocina lo tiene) y "listo" desde… nada. No existe señal de fin.
**Veredicto:** sirve para `PREPARING`, no resuelve `READY`.

### Opción C — APK companion en el dispositivo Clover ✅ recomendada

Una app Android nativa mínima, publicada en el Clover App Market e instalada en el dispositivo del restaurante. Una sola pantalla: lista de pedidos móviles del día con dos botones, *En preparación* y *Listo*. Al tocar *Listo*, llama a nuestro backend y disparamos el push.

**Esto no viola tu regla fundamental.** El empleado sigue trabajando dentro del ecosistema Clover, en el mismo dispositivo, sin abrir nuestro SaaS ni un navegador. No es un POS, no es un KDS, no gestiona cocina ni cobra: es un interruptor de un bit que Clover no provee.

**Plan recomendado:** v1 sale con Opción A + `PREPARING` derivado de la impresión (Opción B). El APK companion entra como **Fase 9**, antes de Loyalty. Sin él, la promesa "tu pedido está listo" es una estimación, y eso hay que decidirlo con el ojo puesto en el negocio, no en la ingeniería.

### Mapa de estados propuesto

| Estado nuestro | Origen | Visible al cliente |
|---|---|---|
| `DRAFT` | app | carrito |
| `PAYMENT_PENDING` | backend | "Procesando pago…" |
| `PAYMENT_FAILED` | Clover | "No se pudo cobrar" |
| `CONFIRMED` | Clover order + payment OK | "Pedido confirmado" |
| `PREPARING` | `print_event` OK / APK | "En preparación" |
| `READY` | APK companion (o tiempo estimado) | "¡Listo para recoger!" |
| `COMPLETED` | manual / timeout / APK | historial |
| `CANCELED` | webhook `O` DELETE / refund | "Cancelado" |
| `REFUNDED` | webhook `P` / `paymentState=CREDITED` | "Reembolsado" |

---

## 8. Estrategia de sincronización de catálogo

### 8.1 Modelo

Espejo **read-only** en Postgres. La app nunca consulta Clover en línea: latencia y límites de rate lo impiden. El espejo se refresca por webhook y se repara por polling.

```
Clover Inventory ──webhook (I/IC/IG/IM)──► cola ──► worker ──► catalog_items
                 ──polling modifiedTime──►              (por store)
                                                            │
                                                     app_item_overrides
                                                     (destacado, visible
                                                      en app, banner)
                                                            │
                                                            ▼
                                                    vista "menú de la app"
```

### 8.2 Reglas

- **Snapshot inicial** al conectar la sucursal: items, categorías, modifier groups, modifiers, tax rates. Paginado, respetando límites (§13.2) y en horario de baja demanda.
- **Delta por webhook:** el evento trae solo el id → GET del objeto → upsert.
- **Barrido de reparación** cada N minutos con filtros por `modifiedTime` para no re-descargar lo que no cambió (práctica recomendada por Clover para evitar 429). Detecta lo que los webhooks perdieron.
- **Versionado del menú:** cada cambio incrementa `catalog_version` de la tienda. La app cachea por versión; un carrito armado con una versión vieja se re-valida en el quote.
- **Nunca escribimos catálogo en Clover.** Si el restaurante quiere cambiar un precio, lo hace en Clover. Punto.

### 8.3 Disponibilidad e inventario

Clover documenta gestión de disponibilidad de items y alertas de bajo stock, y disponibilidad de modificadores. **Esta parte necesita verificación empírica en sandbox durante la Fase 7** antes de comprometerla: el comportamiento real de los flags de stock y visibilidad varía según cómo el merchant configura su inventario, y muchos juice bars simplemente no llevan control de stock por item.

Política de producto propuesta, independiente de lo anterior:

1. Si Clover marca el item como no disponible → "Currently unavailable" en la app.
2. Además, permitir un **86 rápido por sucursal** desde el SaaS (override nuestro, con expiración automática al cierre del día). Es la válvula de escape cuando el restaurante no mantiene el stock en Clover, que es el caso común.

### 8.4 Lo que NO sincronizamos

Fotos de producto. Clover permite imágenes pero la calidad y consistencia son malas para una app premium. Las imágenes van en Supabase Storage, gestionadas desde el SaaS, ligadas por `clover_item_id`. Es el único punto donde duplicamos deliberadamente, y es una decisión de producto, no un accidente.

---

## 9. Estrategia de reconciliación

Tres reconciliadores, todos idempotentes, todos con reporte:

| Reconciliador | Frecuencia | Compara | Detecta |
|---|---|---|---|
| **Órdenes** | cada 15 min | `orders` nuestras últimas 24 h ↔ `GET /v3/merchants/{mId}/orders` filtrado por `createdTime` | orden perdida, duplicada, cancelada en POS |
| **Pagos** | cada 15 min | `payments` ↔ Ecommerce charges/payments | cobro sin orden, orden sin cobro, monto distinto |
| **Catálogo** | diaria, madrugada | espejo ↔ inventario Clover | items huérfanos, precios desfasados |

**Casos y acción automática:**

| Anomalía | Acción |
|---|---|
| Pago OK, orden no creada en Clover | reintentar creación con la misma idempotency key; si falla 3×, alerta + reembolso automático |
| Orden creada, pago fallido | anular orden en Clover, marcar `PAYMENT_FAILED` |
| Orden duplicada en Clover | alerta manual (no borrar automáticamente: hay dinero de por medio) |
| Monto distinto | congelar, alerta P1 |
| Orden cancelada en el POS | notificar al cliente, disparar reembolso |

Para datos de más de dos meses, Clover recomienda su Export API en lugar de paginar el endpoint de órdenes. Relevante para analytics históricos, no para la reconciliación diaria.

**Los filtros de fecha usan milisegundos desde epoch** y el endpoint de órdenes limita a 1000 registros por request: paginación obligatoria con `limit`/`offset`.

---

## 10. Modelo multi-tenant

### 10.1 Jerarquía

```
platform
  └── restaurant (marca comercial, el que nos paga)
        └── store (sucursal)  ──1:1──  clover_connection (mId)
              ├── catálogo espejo
              ├── horarios y capacidad de pickup
              └── órdenes
```

`tenant_id` = `restaurant_id`. Está en **toda** tabla de negocio, incluso donde sea redundante, para que las políticas RLS sean simples y auditables.

### 10.2 Aislamiento

- RLS en todas las tablas. Sin excepción y sin tablas "temporalmente abiertas".
- El cliente final ve órdenes donde `user_id = auth.uid()`. Nada más.
- El super admin usa un rol separado; el acceso a datos de tenant queda en `admin_audit_log`.
- La `service_role` key vive **solo** en Edge Functions y workers. Nunca en la app, nunca en el SaaS del lado del cliente.
- Tokens de Clover cifrados en reposo (Supabase Vault), nunca devueltos por ninguna API, ni siquiera enmascarados al super admin.

### 10.3 Ciclo de vida de la conexión

```
NOT_CONNECTED → PENDING_AUTH → CONNECTED → [DEGRADED] → REVOKED
```

- `DEGRADED`: el refresh token falla o faltan permisos. La tienda deja de aceptar pedidos nuevos pero las órdenes en curso se completan.
- `REVOKED`: llega webhook `A` de desinstalación. Cierre inmediato de la tienda en la app.

---

## 11. Modelo de base de datos

Solo lo esencial; el DDL completo va en la Fase 2.

### 11.1 Plataforma y tenancy

```sql
restaurants        (id, name, slug, status, subscription_status, created_at)
stores             (id, restaurant_id, name, address, timezone, lat, lng,
                    status, pickup_enabled, delivery_enabled)
store_hours        (id, store_id, weekday, opens_at, closes_at)
store_pickup_slots (id, store_id, slot_minutes, max_orders_per_slot, lead_time_min)
app_settings       (id, restaurant_id, primary_color, logo_url, banner_urls[],
                    features jsonb)
platform_admins    (id, user_id, role)
```

### 11.2 Integración Clover (mapeos, no copias)

```sql
clover_connections (
  id, store_id UNIQUE, merchant_id,            -- mId
  access_token_encrypted, refresh_token_encrypted,
  access_token_expires_at, refresh_token_expires_at,
  granted_permissions text[],
  order_type_id,                                -- cacheado del onboarding
  ecommerce_enabled boolean,                    -- verificado en onboarding
  status, last_sync_at, last_webhook_at, last_error
)

clover_webhook_events (
  id, merchant_id, object_type, object_id, event_type, clover_ts,
  received_at, processed_at, attempts, status, error,
  UNIQUE (merchant_id, object_id, event_type, clover_ts)   -- idempotencia
)

clover_sync_state (id, store_id, entity_type, last_modified_time, last_full_sync_at)
```

### 11.3 Catálogo espejo

```sql
catalog_categories (id, store_id, clover_category_id, name, sort_order, deleted_at)
catalog_items      (id, store_id, clover_item_id, name, price_cents,
                    category_id, available, hidden, clover_modified_time, deleted_at)
catalog_modifier_groups (id, store_id, clover_group_id, name, min_required, max_allowed)
catalog_modifiers  (id, store_id, clover_modifier_id, group_id, name, price_cents, available)
catalog_tax_rates  (id, store_id, clover_tax_rate_id, name, rate)

app_item_overrides (id, store_id, clover_item_id, featured, app_visible,
                    image_url, marketing_copy, sort_order, unavailable_until)
```

`app_item_overrides` es la única tabla donde nosotros mandamos sobre el catálogo, y solo para merchandising, jamás para precio.

### 11.4 Órdenes y pagos

```sql
orders (
  id, tenant_id, store_id, user_id,
  our_order_number,                 -- #1052, visible al cliente
  clover_order_id,                  -- nullable hasta creación
  status, pickup_at, subtotal_cents, tax_cents, tip_cents, total_cents,
  currency, idempotency_key UNIQUE, pickup_code, created_at
)
order_items      (id, order_id, clover_item_id, name_snapshot,
                  unit_price_snapshot_cents, qty, clover_line_item_id)
order_item_modifiers (id, order_item_id, clover_modifier_id,
                      name_snapshot, price_snapshot_cents)

payments (
  id, order_id, provider, provider_payment_id, provider_charge_id,
  amount_cents, status, failure_code, raw_response jsonb, created_at
)
refunds  (id, payment_id, provider_refund_id, amount_cents, reason, status)

checkout_attempts (id, idempotency_key UNIQUE, order_id, state, result jsonb)
reconciliation_findings (id, kind, severity, store_id, order_id, detail jsonb, resolved_at)
```

Los `_snapshot` son deliberados: al mostrar el historial dos meses después, el precio que pagó el cliente debe ser el de ese día, no el actual de Clover. **Esto no es duplicar Clover, es preservar un hecho histórico.**

### 11.5 Cliente, loyalty, promociones, notificaciones

```sql
profiles            (id → auth.users, phone, first_name, last_name, marketing_opt_in)
addresses           (id, user_id, label, line1, city, state, zip, lat, lng)
favorites           (id, user_id, store_id, clover_item_id)

loyalty_accounts     (id, tenant_id, user_id, points_balance, tier)
loyalty_transactions (id, account_id, order_id, delta_points, reason, expires_at)
rewards              (id, tenant_id, name, cost_points, type, value, active)
reward_redemptions   (id, user_id, reward_id, order_id, redeemed_at)

promotions           (id, tenant_id, store_ids[], type, value, code,
                      starts_at, ends_at, max_uses, conditions jsonb)
promotion_uses       (id, promotion_id, user_id, order_id)

notifications        (id, user_id, type, title, body, data jsonb, sent_at, read_at)
push_tokens          (id, user_id, token, platform, last_seen_at)
```

---

## 12. Entidades: qué guardamos y qué no

### Guardamos (nuestro dominio)

Usuario, perfil, direcciones, favoritos, preferencias, push tokens · loyalty completo · promociones propias · configuración de app y branding · horarios y capacidad de pickup · overrides de merchandising e imágenes · orden **nuestra** con snapshot y mapeo a Clover · eventos de webhook y estado de sync · hallazgos de reconciliación.

### NO duplicamos (Clover manda)

Definición de productos, precios y modificadores (solo espejo read-only) · tasas de impuesto · cálculo de totales · la orden operativa · el procesamiento de pago y el estado del dinero · reembolsos · empleados y turnos · impresión y KDS · reportes fiscales y contables.

### Zona gris, decidida a propósito

| Entidad | Decisión | Motivo |
|---|---|---|
| Imágenes de producto | nuestras | calidad visual |
| Descripciones de marketing | nuestras | Clover no tiene el campo con el detalle que queremos |
| Cliente | ambos | el nuestro es el real; se crea espejo en Clover solo para asociarlo a la orden |
| Propina | Clover | va en el pago |
| Descuento por promoción | nuestro cálculo, aplicado como line item discount en Clover | así el ticket y los reportes del restaurante cuadran |

---

## 13. Dependencias de la API de Clover

### 13.1 Endpoints y capacidades sobre los que apoyamos el diseño

| Necesidad | Capacidad de Clover | Verificado |
|---|---|---|
| Autorización del merchant | flujo v2/OAuth (auth code para apps de alta confianza, PKCE para baja confianza), con access token + refresh token expirables | ✅ documentado |
| Catálogo | Inventory API: items, categorías, modifier groups, modifiers, tags | ✅ |
| Crear orden | `POST /v3/merchants/{mId}/atomic_order/orders` | ✅ |
| Calcular totales | `POST /v3/merchants/{mId}/atomic_order/checkouts` | ✅ |
| Tipo de orden | `POST /v3/merchants/{mId}/order_types` | ✅ |
| Imprimir ticket | `POST /v3/merchants/{mId}/print_event` | ✅ |
| Cobrar online | Ecommerce API: tokenización + pagar orden / crear charge | ✅ |
| Reembolsar | Ecommerce API refunds/voids | ✅ |
| Eventos | Webhooks a nivel de app, claves de tipo `A/C/E/I/IC/IG/IM/O/M/P/SH/CA` | ✅ |
| Consultar gateway del merchant | `GET /v3/merchants/{mId}/gateway` | ⚠️ verificar en sandbox |
| Estado de preparación | **no existe** | ❌ |

**Base URLs:** sandbox `apisandbox.dev.clover.com`, producción `api.clover.com` (Norteamérica; hay dominios distintos por región). Toda URL se resuelve por configuración, nunca hardcodeada.

### 13.2 Límites de rate (dimensionan toda la sincronización)

| Nivel | Requests/segundo | Concurrencia |
|---|---|---|
| Por app | 50 | 10 |
| Por token | 16 | 5 |

Ante `429`, la respuesta trae headers `X-RateLimit-*` y, en los límites de concurrencia, `retry-after` en segundos; pedir antes de tiempo **alarga** la espera. Requiere backoff exponencial con jitter.

**Implicación fuerte:** 50 req/s por app es un techo **compartido entre todos los merchants**. Con 200 sucursales, un sync masivo simultáneo nos tira el servicio para todos. El worker de sync debe tener un rate limiter global por app y escalonar merchants, exactamente como recomienda Clover.

### 13.3 Requisitos de plataforma, no de código

- Cuenta de developer global, MFA obligatorio.
- App creada en el Developer Dashboard con permisos declarados: read/write inventory, read/write orders, read/write merchant, read/write customers, read payments, y ecommerce habilitado.
- Aprobación de la app para producción y publicación en el App Market (o app privada aprobada).
- Sandbox con merchant de prueba y, en algún punto, un **Dev Kit** físico o dispositivo real: la impresión y la visualización en las apps del POS no se validan de verdad en emulador.
- El sandbox es más lento y con límites más estrictos que producción; consultas con muchos `expand` anidados devuelven 502 por timeout.

---

## 14. Seguridad

| Capa | Medida |
|---|---|
| App móvil | solo anon key de Supabase + JWT de usuario. Cero secretos de Clover. Certificate pinning opcional en v2. |
| Transporte | HTTPS en todo. Webhook exclusivamente HTTPS con certificado válido (Clover lo exige). |
| Backend | service_role solo en Edge Functions/workers. Secretos en Supabase Vault. |
| Base de datos | RLS en todas las tablas; políticas por `tenant_id` y por `auth.uid()`. |
| Tokens Clover | cifrados en reposo, rotación automática por refresh, nunca expuestos por API ni logs. |
| Webhooks | validar `X-Clover-Auth` (Platform) y `Clover-Signature` (Hosted Checkout) + re-fetch del objeto. |
| Pagos | tokenización de Clover, alcance PCI mínimo, cero datos de tarjeta en nuestro lado. |
| Idempotencia | claves únicas en checkout y en procesamiento de webhooks. |
| Auditoría | `admin_audit_log` para toda acción del super admin sobre datos de tenant. |
| Logs | prohibido loguear tokens, PAN, emails completos o payloads de pago sin redactar. |

---

## 15. Arquitectura de servicios

```
services/
├── catalog/
│   ├── CatalogService.ts          (interfaz)
│   └── CloverCatalogService.ts
├── order/
│   ├── OrderService.ts
│   └── CloverOrderService.ts
├── payment/
│   ├── PaymentService.ts
│   ├── MockPaymentService.ts
│   └── CloverPaymentService.ts
├── inventory/
│   ├── InventoryService.ts
│   └── CloverInventoryService.ts
├── fulfillment/
│   ├── FulfillmentService.ts      ← estados y promesa de pickup (NUESTRO)
│   └── CloverPrintFulfillment.ts  ← print_event
├── notification/
│   ├── NotificationService.ts
│   └── FcmNotificationService.ts
├── loyalty/LoyaltyService.ts
└── clover/
    ├── CloverHttpClient.ts        (auth, retry, backoff, rate limit, logging)
    ├── CloverTokenManager.ts      (refresh, degradación)
    └── CloverWebhookRouter.ts
```

`CloverHttpClient` es la pieza que más rendimiento da: rate limiting global por app, backoff exponencial con `retry-after`, circuit breaker por merchant, y trazas correlacionadas. Todo lo demás pasa por ahí.

---

## 16. Estructura de carpetas (monorepo)

```
mobile-ordering/
├── apps/
│   ├── mobile/                    # Expo + RN + TS
│   │   ├── app/                   # rutas de expo-router (file-based)
│   │   │   └── (tabs)/            # Home · Menu · Orders · Rewards · Profile
│   │   └── src/
│   │       ├── features/          # cart, checkout, loyalty, orders...
│   │       ├── components/
│   │       ├── theme/             # branding dinámico, leído de app_settings
│   │       └── api/
│   └── admin/                     # Next.js + Tailwind (SaaS)
├── packages/
│   ├── shared-types/              # tipos compartidos, contratos de API
│   ├── clover-client/             # cliente tipado de Clover (aislado y testeable)
│   ├── ui/                        # design system compartido
│   └── config/                    # eslint, tsconfig, tailwind preset
├── supabase/
│   ├── migrations/
│   ├── functions/
│   │   ├── catalog/  checkout/  orders/  webhooks-clover/
│   │   ├── oauth/         notifications/  loyalty/
│   └── seed/
├── workers/                       # sync, reconcile, retry, token-refresh
└── docs/
    ├── architecture/  runbooks/  clover-notes/
```

**Corrección (agosto 2026):** una versión anterior de este diagrama mostraba
`src/screens/` y `src/navigation/`, incompatible con expo-router, que es la
dependencia elegida en §17 y exige rutas basadas en archivos bajo `app/`.
Manda expo-router.

**Corrección (septiembre 2026):** este árbol decía `oauth-clover/` y el
diagrama de §1.2 decía `/oauth`. Manda `/oauth`, y no por gusto: el nombre
del directorio de una Edge Function **es** parte de su URL pública, y esa
URL es la que se registra como `redirect_uri` en el Developer Dashboard de
Clover. Renombrarla no es refactorizar: es tener que volver al dashboard, y
mientras tanto ningún merchant puede conectar. Ver `docs/OAUTH-CONEXION.md`.

`packages/clover-client` separado del backend es intencional: permite testear la integración contra el sandbox sin levantar Supabase, y es la frontera que hay que cruzar el día que entre un segundo POS.

---

## 17. Dependencias principales

**Mobile:** expo, expo-router, react-native, typescript, @supabase/supabase-js, @tanstack/react-query, zustand, react-hook-form + zod, expo-notifications, expo-image, react-native-webview (crítico para el iframe de pago), @shopify/flash-list, react-native-reanimated, sentry.

**SaaS:** next, react, tailwindcss, shadcn/ui, @supabase/ssr, @tanstack/react-query, zod, recharts.

**Backend:** supabase-js, zod, pgmq, pg_cron, undici o fetch nativo. Sin ORM pesado: SQL explícito y tipado.

**Tooling:** pnpm workspaces, turborepo, eslint + prettier, vitest, playwright, EAS Build, GitHub Actions.

---

## 18. Riesgos técnicos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | **No existe estado "listo" en Clover** | Alto | APK companion (§7); v1 con tiempo prometido |
| R2 | **Merchant sin ecommerce habilitado** | Alto (bloquea venta) | verificar gateway en onboarding, antes de firmar |
| R3 | Aprobación de app en Clover App Market se alarga | Alto (cronograma) | iniciar el trámite en la Fase 7, no en la 8 |
| R4 | Cambiar permisos post-instalación exige reinstalación del merchant | Alto | congelar el set de permisos antes del primer merchant real |
| R5 | Rate limit de 50 req/s compartido entre todos los tenants | Alto a escala | rate limiter global, sync escalonado, filtros `modifiedTime` |
| R6 | Webhooks sin garantía de entrega ni orden | Medio-alto | dedup + polling de reparación + reconciliación |
| R7 | `X-Clover-Auth` es secreto estático, no firma por mensaje | Medio | re-fetch obligatorio del objeto; nunca actuar por payload |
| R8 | Impresión falla si el merchant no tiene impresora o usa modificadores custom | Medio-alto | checklist de onboarding; fallback a Orders app; alerta si `print_event` no progresa |
| R9 | Catálogos divergentes entre sucursales de la misma marca | Medio | catálogo por store, no por restaurant; alertas de divergencia en el SaaS |
| R10 | Cobrado sin orden creada (dinero sin pedido) | Crítico | idempotencia + reconciliación cada 15 min + reembolso automático |
| R11 | **Política de Apple sobre apps white-label** (una app por cliente puede requerir publicación bajo la cuenta del cliente) | Alto para el modelo comercial | verificar guidelines vigentes de App Store y Play antes de definir el modelo; ver §19 |
| R12 | Órdenes por API no aparecen en Clover Dining | Bajo (juice bars) | descartar merchants que operen con Dining, o validar caso por caso |
| R13 | Sandbox no refleja producción (502, límites, sin hardware) | Medio | Dev Kit físico en Fase 7 |
| R14 | Expiración de tokens y desinstalación silenciosa del merchant | Medio | refresh proactivo, estado `DEGRADED`, webhook `A` |

---

## 19. App por restaurante vs app multi-restaurante

Pediste análisis, no supuestos. Aquí va.

| Criterio | A: una app por restaurante | B: app multi-restaurante |
|---|---|---|
| Percepción de marca | Excelente. Es *su* app. | Pobre. El restaurante se siente inquilino. |
| Precio que soporta | Alto (setup + mensualidad) | Bajo, tiende a comisión |
| Costo de lanzamiento | Alto: build, revisión de tiendas, ASO por cliente | Cero marginal |
| Time to market por cliente | 1–3 semanas (revisión de tiendas) | horas |
| Riesgo de políticas de tienda | **Alto** (ver R11) | Bajo |
| Descubrimiento / cross-sell | Ninguno | Posible |
| Mantenimiento | N builds, N pipelines | 1 |

**Recomendación: A (una app por marca) como producto comercial, con arquitectura B por debajo.**

Los juice bars y cafés en EE. UU. compran "mi app", no "estar en un directorio". Ahí está el precio. Pero eso es una decisión de *empaquetado*, no de código:

- Un solo código base, configuración remota, cero `if (restaurant === 'x')`.
- Build por marca vía perfiles de EAS + variables de entorno (`RESTAURANT_ID`, bundle id, iconos, splash).
- El branding llega del backend, no del build: colores, logo, banners, features. Un cambio de color no requiere release.
- La app arranca con `restaurant_id` fijado en build; la arquitectura permite quitarlo y convertirla en multi-marca sin refactor.

**Advertencia comercial (R11):** Apple ha aplicado históricamente restricciones a apps generadas desde plantillas comercializadas, exigiendo en muchos casos que se publiquen bajo la cuenta de developer del cliente final. Antes de vender el modelo "una app por restaurante", hay que leer las guidelines vigentes y decidir si el cliente publica bajo su propia cuenta (más fricción de onboarding, pero seguro) o bajo la nuestra (más rápido, con riesgo de rechazo). **Esto se define antes de la Fase 14, no durante.**

Como Android va primero, hay margen: Google es considerablemente más permisivo, pero el mismo modelo tiene que sobrevivir a iOS en la Fase 15.

---

## 20. Qué aprovechamos, qué construimos, qué se pospone

### Aprovechamos de Clover
POS y Register · apps Orders · impresión de tickets y KDS del merchant · catálogo, modificadores y categorías · tasas de impuesto y cálculo de totales · procesamiento de pagos y tokenización PCI · reembolsos · reportes operativos y fiscales · empleados y turnos · sincronización a dispositivos.

### Construimos nosotros
Experiencia móvil completa · identidad y perfil del cliente · carrito y personalización · agenda y capacidad de pickup · seguimiento y notificaciones push · loyalty · promociones de app · branding configurable · SaaS de administración · sincronización, colas y reconciliación · analytics de canal móvil.

### Fases posteriores
Delivery (dispatch, zonas, tarifas — no antes de tener pickup sólido) · APK companion de "listo" (Fase 9, aunque puede adelantarse si el negocio lo exige) · QR de pickup con validación en dispositivo · Apple Pay / Google Pay · gift cards (Clover tiene API propia) · multi-marca en una sola app · segundo proveedor de POS · marketing automation.

---

## 21. Fases revisadas

| Fase | Contenido | Cambio respecto a tu plan |
|---|---|---|
| 1 | Arquitectura | este documento |
| 2 | Supabase: esquema, RLS, auth, storage | igual |
| 3 | UI Android **conectada a Supabase** (sin mocks) | **fusionada con la 4** |
| 4 | — | absorbida por la 3 |
| 5 | Sistema de órdenes (carrito, checkout, pickup, tracking) | igual |
| 6 | Pagos mock | igual |
| **6.5** | **Cuenta de developer Clover, app registrada, permisos congelados, sandbox listo** | **NUEVO — adelantado** |
| 7 | Sandbox Clover: OAuth, catálogo, órdenes, print_event, webhooks | + Dev Kit físico |
| **7.5** | **Trámite de aprobación de app en Clover** | **NUEVO — corre en paralelo** |
| 8 | Producción Clover: pagos, reembolsos, reconciliación | igual |
| 9 | **APK companion (estado "listo")** | **NUEVO — antes de loyalty** |
| 10 | Loyalty | era 9 |
| 11 | Promociones | era 10 |
| 12 | Notificaciones | era 11 |
| 13 | SaaS completo | era 12 |
| 14 | Testing y hardening | era 13 |
| 15 | Build de producción Android | era 14 |
| 16 | iOS | era 15 |

**Corrección (agosto 2026):** las fases 3 y 4 se fusionaron. Construir la UI
contra datos mock y después reemplazarlos habría significado escribir dos veces
la capa de datos. Con el esquema y el catálogo reales ya disponibles, la app se
conectó a Supabase desde el primer día.

**Justificación de las fases nuevas:** el registro y la aprobación de la app en Clover son trámites con tiempos externos que no controlamos. Meterlos al final es la forma más común de perder un trimestre. Empezarlos en paralelo a la Fase 6 no cuesta nada y elimina el riesgo R3.

---

## 22. Decisiones que necesito de ti antes de la Fase 2

1. **Estado "listo" (§7):** ¿arrancamos con tiempo prometido, o el APK companion entra en el alcance comprometido desde el inicio?
2. **Modelo de app (§19):** ¿una app por marca desde el día uno, o app multi-restaurante para el piloto y white-label después?
3. **Ecommerce por merchant (§4.3):** ¿tienes ya un merchant real de Clover para verificar la habilitación de pagos online antes de invertir en desarrollo?
4. **Alcance del piloto:** ¿cuántas marcas y cuántas sucursales en el primer lanzamiento? Cambia la agresividad del diseño de rate limiting.
5. **Delivery:** el brief lo menciona como "cuando esté disponible". Confirmo que queda **fuera** de la v1.

---

## 23. Verificación pendiente en sandbox (Fase 7)

No damos nada por cierto sin probarlo. Lista de verificación:

- [ ] Comportamiento real de disponibilidad y stock de items y modificadores
- [ ] `GET /v3/merchants/{mId}/gateway` y cómo determinar habilitación de ecommerce
- [~] Tiempos de vida exactos de access token y refresh token, y comportamiento del refresh.
      **A medias.** El *access* token está medido: ~24 h en sandbox, no los
      30 minutos documentados (2026-09-05, ver `docs/REFRESCO-TOKENS.md`).
      El del *refresh* **sigue sin medir**. Del comportamiento del refresco
      sí se sabe ya una cosa cara: **rotar el App Secret desinstala la app
      del merchant y deja sus refresh tokens inservibles** (2026-09-06, ver
      `docs/OAUTH-CONEXION.md`)
- [ ] Si `print_event` dispara la impresora de cocina o solo la de recibos, y con qué configuración de labels de item
- [ ] Latencia real entre creación de orden por API y su aparición en el dispositivo
- [ ] Comportamiento del pago sobre orden atómica con propina
- [ ] Contenido exacto del ticket impreso: qué campos se ven, dónde cabe la hora de pickup
- [ ] Volumen y latencia real de los webhooks bajo carga
- [ ] Comportamiento del iframe de Clover dentro de un WebView de React Native en Android

---

**Fin del entregable de Fase 1. Esperando aprobación. No avanzo a Fase 2.**
