# VIVA Jugos y Café — negocio sin Clover y Panel del negocio

Esta app nació como la de Viva Juice and Coffee (Estados Unidos, con
Clover). VIVA Jugos y Café opera en México y **no usa Clover**, así que:

| | Con Clover (juicebar) | VIVA Jugos y Café |
|---|---|---|
| Menú, precios, categorías | Espejo de Clover | Los edita el dueño en `/admin` |
| Pedido | Se crea en el POS | Se crea en la base y llega al panel |
| Cobro | Clover | En el mostrador: efectivo, tarjeta o transferencia |
| Moneda e idioma | USD, inglés | MXN, español (`app.json` → `extra.currency`, `extra.locale`) |

Todo sale de la migración `supabase/migrations/0020_negocio_sin_clover.sql`.

## Quién puede qué

| | Cliente | Empleado (`staff`) | Dueño (`owner`) |
|---|---|---|---|
| Ver el menú y pedir | ✔ | ✔ | ✔ |
| Ver y mover pedidos del negocio | — | ✔ | ✔ |
| Menú, precios, fotos, "agotado" | — | — | ✔ |
| Horario, datos de la sucursal, logo y colores | — | — | ✔ |
| Modo de cobro, fuente del catálogo, estado del negocio | — | — | — (solo plataforma) |

No lo decide la app: lo decide la base con RLS. Las pruebas están en
`supabase/tests/0020_negocio_sin_clover.test.sql` y corren en CI; si alguien
abre un permiso de más, el CI falla.

Nadie se vuelve dueño solo. Registrarse en la app crea una cuenta de
**cliente**; el rol lo da la plataforma con
`app.grant_restaurant_role(correo, restaurante, 'owner' | 'staff')`.

## Puesta en marcha (una sola vez)

1. **Secreto `SUPABASE_DB_URL`** en el repo (Settings → Secrets and
   variables → Actions). Sale de Supabase → Connect → *Session pooler*,
   puerto 5432.
2. **Actions → Base de datos (Supabase) → Run workflow**, con *Dar de alta
   VIVA Jugos y Café* marcado. Aplica las migraciones y crea el negocio
   (MXN, hora de la Ciudad de México, pago en mostrador, 8:00–20:00).
3. La dueña **se registra** en la app web con su correo.
4. Otra vez **Base de datos (Supabase) → Run workflow**, ahora con su correo
   en *Correo del dueño*. Desde ese momento ve en Perfil el botón
   **Panel del negocio**.
5. En el panel: crea las categorías, los productos con su foto y revisa el
   horario y los datos de la sucursal.

Para dar de alta a un empleado, lo mismo que el paso 4 pero en el SQL editor
de Supabase:

```sql
select app.grant_restaurant_role('cajero@correo.com',
       '11111111-1111-4111-8111-111111111111', 'staff');
```

## El panel

`/admin` dentro de la misma app web (en computadora se ve ancho; en el
teléfono, como una pantalla más).

- **Pedidos**: Nuevos, En preparación y Listos para entregar. Se actualiza
  cada 15 s y suena cuando entra uno nuevo (la pestaña tiene que haberse
  tocado una vez; los navegadores no dejan sonar sin eso). Cada botón llama
  a `set_order_status`, que valida la transición en la base.
- **Menú**: categorías (crear, renombrar, ordenar, eliminar) y productos.
  El interruptor de cada fila marca un producto como agotado al momento.
- **Negocio**: datos de la sucursal, horario por día, pausar pedidos, logo
  y colores.

El cliente ve los cambios de estado de su pedido sin recargar (la pantalla
del pedido se revisa cada 20 s mientras está en curso).

## Lo que todavía no está

- **Pago en línea** (Stripe o Mercado Pago). El modo `counter` queda como
  está; para cobrar en la app hace falta la cuenta del negocio con el
  proveedor y una Edge Function que confirme el pago por webhook, nunca
  desde el teléfono.
- **Extras / modificadores** (tamaño, leche, toppings) desde el panel. La
  base y la app del cliente ya los soportan; falta la pantalla para
  editarlos.
- **Promociones y puntos.** Las tablas existen; están apagados en
  `app_settings.features` hasta que tengan pantalla en el panel.
- **Notificaciones push en web.** El cliente sigue su pedido en la pestaña
  Pedidos.

## No usar desde este repo

**Build Android (EAS)** apunta al proyecto de Expo de juicebar
(`app.json` → `extra.eas.projectId`) y firmaría con su llave. Antes de sacar
un APK de VIVA hay que crear su proyecto en Expo y cambiar ese id, el
`android.package` y el `ios.bundleIdentifier`.
