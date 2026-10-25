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
| Sumar puntos (QR) y canjear recompensas | ✔ | ✔ | ✔ |
| Validar canjes en el mostrador | — | ✔ | ✔ |
| Configurar puntos, QR y recompensas | — | — | ✔ |
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
- **Historias**: fotos o videos cortos (hasta 50 MB) que salen arriba en la
  pantalla de inicio, como en Instagram. Duran 24 h, 3 días, 7 días o quedan
  *destacadas* (no caducan). Se pueden ligar a un producto: el cliente ve
  el botón *Pedir*. Migración `0022_historias.sql`.
  Al abrir la app el visor sale solo, cada vez (una vez por visita):
  empieza por las que ese teléfono no ha visto y, si ya vio todas, desde
  el principio. Las fotos se precargan y una historia no avanza hasta que su
  foto terminó de cargar.
- **Estadísticas**: ventas, pedidos, ticket promedio, clientes, ventas por
  día, lo más vendido, lo más consultado y las historias más vistas (7, 30 o
  90 días). Las vistas se cuentan una vez por visitante al día, sin datos
  personales. Migración `0023_estadisticas.sql`.
- **Negocio**: datos de la sucursal, horario por día, pausar pedidos, logo,
  colores, **formas de pago** y **equipo**.
  - Formas de pago (`0024_formas_pago.sql`, `0026_pago_liga_transferencia.sql`):
    efectivo y tarjeta en mostrador se prenden y apagan. **Transferencia**
    pide banco, titular y CLABE (se valida el dígito de control); sin CLABE
    ni nota no se le ofrece al cliente. **Mercado Pago** funciona con la
    liga de cobro del negocio (link.mercadopago.com.mx / mpago.la): el
    cliente ve en su pedido el monto y un botón que abre la liga. Los
    pedidos de transferencia y Mercado Pago quedan *Pago por confirmar*
    hasta que el cajero toca **Pago recibido** en Pedidos.
  - **Mercado Pago automático** (`0028_mercadopago_auto.sql`, funciones
    `mp-pago` y `mp-webhook`): con la cuenta conectada, el cliente toca
    *Pagar* en su pedido y se abre Checkout Pro con el **total exacto** del
    pedido (leído de la base). Mercado Pago avisa a `mp-webhook`, que
    consulta el pago a la API con el token del negocio y, si está aprobado,
    es en MXN, apunta a ese pedido y cubre el monto, lo marca pagado solo.
    Una devolución lo desmarca. Para activarlo:
    1. Secreto `MP_ACCESS_TOKEN` en Supabase → Edge Functions → Secrets
       (el de prueba `TEST-…`/de prueba primero; luego el de producción).
    2. Secreto `SUPABASE_ACCESS_TOKEN` en GitHub y correr el workflow
       *Funciones de Mercado Pago* (publica las dos funciones).
    3. Panel → Negocio → Formas de pago → **Probar conexión** y prender
       *Aceptar Mercado Pago*. Stripe, Clip y el
    cobro automático de Mercado Pago (Checkout Pro + webhook) siguen
    pendientes de conectar la cuenta.
  - Equipo (`0025_equipo.sql`): el dueño da acceso de **Dueño** o **Cajero**
    a una cuenta ya registrada (por correo) y lo quita. Nadie se quita a sí
    mismo y siempre queda al menos un dueño. Ya no hace falta SQL para esto.

Menú base: `supabase/seed/viva_menu_base.sql` carga las 4 categorías y 12
productos del menú impreso, con Tamaño (500 ml / 1 litro), Leche y "Crea el
tuyo", más 12 historias destacadas. No duplica nada si se corre otra vez.

El cliente ve los cambios de estado de su pedido sin recargar (la pantalla
del pedido se revisa cada 20 s mientras está en curso).

## Lealtad: puntos por visita con QR

Migración `0021_lealtad_qr.sql`. Pruebas en `supabase/tests/0021_lealtad_qr.test.sql`.

1. **El dueño lo configura** en Panel → Lealtad: activa el programa, puntos
   por visita, horas mínimas entre visitas del mismo cliente y las
   recompensas con su costo en puntos. Activar el programa también muestra
   la pestaña **Puntos** en la app.
2. **El QR del local** tiene dos modos:
   - **Fijo**: se imprime (botón *Imprimir QR*) y se pega en el mostrador.
     Si se filtra una foto, *Generar código nuevo* invalida el anterior.
   - **En pantalla**: cambia cada minuto; se abre en una tablet con *Abrir
     en pantalla completa*. Una foto vieja no sirve.
3. **El cliente escanea** desde la app (Puntos → *Escanear QR del local*) o
   con la cámara del teléfono, que abre la app en la pantalla de visita. Si
   no ha iniciado sesión, se le pide y luego se suma sin volver a escanear.
   Una visita por cliente cada X horas (20 por defecto).
4. **Canje**: con puntos suficientes, el cliente canjea y recibe un código de
   6 letras. En el mostrador, Panel → Lealtad → *Validar canje*. Cada código
   se entrega una sola vez; el cliente puede cancelar un canje no entregado y
   recupera sus puntos.

Los puntos solo los escribe la base (funciones `claim_visit`,
`redeem_reward`, `use_redemption`, `cancel_redemption`). Ni el cliente ni el
panel pueden cambiar un saldo a mano, y el código del QR no se puede leer
desde la app del cliente.

El escáner dentro de la app usa la cámara del navegador (necesita HTTPS, que
GitHub Pages y un dominio propio ya dan). En iPhone conviene escanear desde
la app instalada: la cámara del teléfono abre Safari, que tiene otra sesión.

## Lo que todavía no está

- **Cobro en línea** (Mercado Pago, Stripe o Clip). Los interruptores ya
  están; falta la cuenta del negocio con el proveedor y una Edge Function
  que confirme el pago por webhook, nunca desde el teléfono. Las llaves
  secretas van en los secretos de Supabase, no en este repo.
- **Editar extras / modificadores** desde el panel. El menú base ya trae
  Tamaño y Leche; falta la pantalla para crear grupos nuevos.
- **Promociones** (descuentos por código o por fecha). La tabla existe; falta
  la pantalla en el panel y aplicarlas en el pedido.
- **Escáner en el APK de Android.** Necesita `expo-camera` (dependencia
  nativa). Mientras tanto, en el APK se escanea con la cámara del teléfono.
- **Notificaciones push en web.** El cliente sigue su pedido en la pestaña
  Pedidos.

## No usar desde este repo

**Build Android (EAS)** apunta al proyecto de Expo de juicebar
(`app.json` → `extra.eas.projectId`) y firmaría con su llave. Antes de sacar
un APK de VIVA hay que crear su proyecto en Expo y cambiar ese id, el
`android.package` y el `ios.bundleIdentifier`.
