# `@juicebar/clover-client`

Cliente de Clover, aislado del backend. Se puede probar contra el sandbox
sin levantar Supabase, y es la frontera que habrá que cruzar el día que
entre un segundo POS.

## Qué garantiza por construcción

No por disciplina de quien lo use — por cómo está montado:

- ninguna petición se salta el rate limiter compartido de la app;
- ningún `POST` no idempotente se reintenta;
- ningún error saca un token en el mensaje;
- ninguna url se escribe a mano en el código de negocio;
- no hay un solo método que escriba catálogo, ni que cobre fuera de una
  orden. Hay tests que fallan si alguien añade uno.

## Uso

```ts
import { CloverClient } from '@juicebar/clover-client';

// UNO por proceso. Dos instancias son dos rate limiters que no se hablan,
// cada uno convencido de tener los 50 req/s enteros para él.
const clover = new CloverClient({
  environment: process.env.CLOVER_ENV === 'production' ? 'na-production' : 'sandbox',
  appId: process.env.CLOVER_APP_ID!,
});

const menu = clover.inventory.items(merchantId, accessToken, {
  modifiedSinceMs: ultimaSync,
});
for await (const lote of menu) {
  // 100 como mucho por lote; la paginación ya está resuelta.
}
```

El token va por parámetro en cada llamada, no en el constructor. Es más
verboso y es a propósito: un cliente que guarda el token es un cliente por
merchant, y entonces vuelve el problema de los limitadores que no se hablan.

## Configuración

| Variable | Qué es | Secreto |
|---|---|---|
| `CLOVER_APP_ID` | App Id del Developer Dashboard | no |
| `CLOVER_APP_SECRET` | App Secret. **Solo** lo usa `oauth.exchangeCode`, por parámetro | **sí** |
| `CLOVER_ENV` | `sandbox` o `production` | no |
| `CLOVER_TOKEN_HOST` | Host de tokenización. Opcional: solo para sobrescribir el de la región | no |

Ningún valor de estos vive en el repositorio. El App Secret entra por
variable de entorno del backend, se pasa por parámetro y muere al salir de
la función: este paquete no lo guarda en ningún sitio.

Los ocho hosts —cuatro APIs por dos entornos— vienen por defecto y están
verificados contra la documentación oficial, con la fuente de cada uno en
`docs/CLOVER-ENDPOINTS.md`. `CLOVER_TOKEN_HOST` ya no hace falta para
arrancar en producción; sigue existiendo para sobrescribir un host sin
tocar código, que es lo que pide §13.1 de la arquitectura.

`resolveHosts` **falla al arrancar**, no en la primera petición, si algún
host falta o llega vacío. Es el caso de añadir una región nueva sin
confirmar sus dominios: mandar una petición bien formada al host equivocado
no da un 404, da un 401 que parece "credenciales mal".

## El orden de operaciones de un pedido

No es negociable, y está escrito en `endpoints/orders.ts`:

```
1. tokenizar la tarjeta       ecommerce.tokenizeCard   (en producción: el iframe)
2. totales                    orders.checkout
3. crear la orden             orders.createAtomicOrder
4. pagar LA ORDEN             ecommerce.payOrder
5. imprimir                   orders.print
```

La orden se crea **antes** de cobrar. Al revés queda el peor estado posible:
dinero cobrado y ninguna orden que la cocina pueda ver ni el merchant
reembolsar desde su POS.

Y el paso 5 no es opcional: **una orden creada por API no se imprime sola.**
Aparece en Orders y en Register y ahí se queda. Un pedido pagado que la
cocina nunca vio es el peor fallo de esta plataforma.

Montar esa secuencia con su idempotencia es la Edge Function de la PR 4.
Aquí están las piezas, no la orquestación.

## Alta de una sucursal

Tres llamadas, y solo una es la puerta:

```ts
const readiness = evaluateEcommerceReadiness({
  apiAccessKey: (await clover.ecommerce.apiAccessKey({ merchantId, token })).apiAccessKey,
  gateway: await clover.merchants.gateway({ merchantId, token }),
  paymentConfigs: await clover.merchants.ecommPaymentConfigs({ merchantId, token }),
});
```

`evaluateEcommerceReadiness` es pura: recibe las tres respuestas y
dictamina, sin llamar a nada. Devuelve `blockers` (dejan la sucursal en
`PENDING_SETUP`) y `warnings` (hay que mirarlos, no impiden abrir).

El aviso que importa es el **recargo por tarjeta de crédito**: si el
merchant lo tiene activo, al cliente se le cobra más de lo que le enseña la
app. Ver `docs/CLOVER-ENDPOINTS.md`.

## Tests

```bash
pnpm --filter @juicebar/clover-client test
```

Ninguno toca la red: `fetch`, el reloj y el `sleep` se inyectan. Lo que
comprueban no es que Clover responda, es que nosotros nos comportemos.
