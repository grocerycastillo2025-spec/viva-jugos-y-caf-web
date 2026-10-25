# `@juicebar/mobile` — app móvil (Fase 3)

App de cliente de **Viva Juice and Coffee**. Expo + React Native + TypeScript
estricto, dentro del monorepo pnpm + turbo.

En esta fase están: Home, Menu, detalle de producto con modificadores,
carrito local y Profile. El checkout llega en la fase 5.

---

## Arrancar

```bash
# desde la raíz del repo
cp apps/mobile/.env.example apps/mobile/.env.local   # y rellenar
pnpm install
pnpm mobile        # = expo start --tunnel, para abrirlo con Expo Go
```

Las credenciales también se pueden dejar en el `.env.local` de la raíz, que es
donde las pone el paso 4 de `docs/PASO-A-PASO.md`: `scripts/with-env.mjs` lee
los dos archivos y solo propaga las variables `EXPO_PUBLIC_*`.

Comprobaciones:

```bash
pnpm lint && pnpm typecheck && pnpm test

# ¿la app puede leer el menú con la clave publicable? (sin teléfono)
pnpm --filter @juicebar/mobile check:supabase
```

`check:supabase` usa la misma clave que la app, así que también comprueba que
las policies de RLS dejan pasar al rol `anon`. Si el menú sale vacío, lo dice.

`@expo/ngrok` está como devDependency solo para que `pnpm mobile` (que lleva
`--tunnel`) funcione a la primera, sin que Expo pida instalarlo a mano. Es
herramienta de desarrollo: nunca entra en el bundle.

---

## Sacar un APK

El QR de Expo Go sirve para desarrollo. Para instalar la app de verdad en un
telefono hay un workflow de GitHub Actions que compila en los servidores de
EAS: **Actions -> Build Android (EAS) -> Run workflow**, perfil `preview`. El
enlace de descarga del `.apk` queda en el resumen del run.

Secretos que necesita el repositorio (Settings -> Secrets and variables ->
Actions):

| Secreto | De donde sale |
|---|---|
| `EXPO_TOKEN` | expo.dev -> Account settings -> Access tokens |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase -> Project Settings -> API |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | la clave **publicable**, nunca la secreta |

EAS Build compila en maquinas de Expo, asi que las variables del runner no
viajan solas: el workflow las inyecta en el perfil de `eas.json` dentro del
checkout efimero. Los valores nunca quedan versionados y el log solo imprime
los nombres.

Cuando un build falla, el resumen del run muestra **el error real de EAS** y el
enlace al build en expo.dev, donde están los logs de Gradle. No intenta
adivinar la causa: una versión anterior de este workflow buscaba la palabra
`keystore` en el log y anunciaba que faltaba el keystore, pero EAS imprime
`Using Keystore from configuration` en todos los builds, así que cualquier
fallo se anunciaba mal.

## Actualizaciones por aire (EAS Update)

Un cambio de JavaScript o de assets no necesita recompilar: **Actions →
Publicar update (EAS Update) → Run workflow**, eligiendo canal y describiendo
qué cambia. Los teléfonos lo recogen al siguiente arranque.

Un cambio que toca código nativo —una dependencia nueva, el `targetSdk`, un
plugin de config— **sí** necesita build, y además hay que **subir a mano el
`runtimeVersion`** de `app.json` y sellarlo con
`pnpm --filter @juicebar/mobile lock:native`.

No hay que acordarse: un test lo comprueba en cada PR y falla explicando qué
hacer. El detalle, y por qué esto ya no lo calcula EAS solo, está en
[`docs/RUNTIME-Y-UPDATES.md`](../../docs/RUNTIME-Y-UPDATES.md).

| Cambio | Qué hace falta |
|---|---|
| Pantallas, textos, lógica, estilos | `Publicar update` |
| Dependencia nativa, `app.json`, plugins, SDK | subir `runtimeVersion` + `lock:native` + `Build Android (EAS)` |

---

## Reglas de Android que cumple

De `docs/ANDROID-COMPATIBILIDAD.md`:

| Regla | Dónde |
|---|---|
| `targetSdk 36`, `compileSdk 36`, `minSdk 24` vía `expo-build-properties` | `app.json` |
| Sin bloqueo de orientación | `app.json` → `"orientation": "default"` |
| Insets de safe area en todas las pantallas | `src/components/Screen.tsx` |
| Diseño que aguanta tablet | `gridColumns()` en `src/theme.ts` |

Verificable sin compilar nada:

```bash
cd apps/mobile
npx expo config --type introspect | grep -iE "targetSdk|minSdk|compileSdk|orientation:"
```

Notas:

- `edgeToEdgeEnabled` ya no existe como opción. Expo SDK 57 avisa de que
  Android 16 hace el edge-to-edge obligatorio; por eso no está en `app.json` y
  por eso todo el padding superior/lateral sale de `useSafeAreaInsets()`.
- `expo-status-bar` tampoco acepta ya `translucent`, por lo mismo.
- Fecha en el calendario: **junio de 2027, subir a API 37.**

### Dependencias nativas y por qué

La regla del documento es justificar por escrito cada dependencia nativa nueva.
Todas las de abajo salen del propio SDK de Expo, así que se actualizan con él:

| Paquete | Por qué |
|---|---|
| `expo-router` | navegación por archivos; las 5 pestañas |
| `react-native-safe-area-context` | los insets son obligatorios en Android 16 |
| `react-native-screens` | lo requiere la navegación nativa |
| `expo-build-properties` | única forma de fijar el target sin tocar Gradle |
| `@react-native-async-storage/async-storage` | sesión de Supabase y carrito entre arranques |
| `@expo/vector-icons` | iconos de la barra de pestañas |
| `react-native-url-polyfill` | `supabase-js` necesita `URL` en Hermes |

Cero SDKs de pago nativos, que es justo lo que el documento pide evitar.

---

## Reglas de arquitectura que cumple

- **La app nunca toca credenciales de Clover.** No hay ni una variable
  `CLOVER_*` en este paquete. El cobro irá por el iframe alojado dentro de un
  WebView, en la fase 5.
- **Solo la clave publicable de Supabase.** `src/domain/keys.ts` clasifica la
  clave al arrancar y lanza si le llega una `sb_secret_...` o un JWT con
  `role: service_role`. Está cubierto por tests.
- **Ningún precio ni producto escrito en el código.** Precio base de
  `menu_items.price_cents`, recargos de `catalog_modifiers.price_cents`,
  obligatoriedad de `catalog_modifier_groups.min_required` / `max_allowed`,
  disponibilidad de `menu_items.is_available`. Que la leche de avena y la de
  coco cuesten +$1.00 es un dato del catálogo, no una constante de la app.
- **El carrito solo muestra subtotal.** Impuestos y total los calcula Clover al
  crear el pedido; inventarlos aquí daría un número que no cuadraría con el
  ticket del restaurante.

---

## Estructura

```
app/                      rutas (expo-router)
  _layout.tsx             providers + stack raíz
  (tabs)/                 Home · Menu · Orders · Rewards · Profile
  item/[id].tsx           detalle con grupos de modificadores
  cart.tsx                carrito (modal)
  store-picker.tsx        selector de sucursal + revisión de precios (modal)
src/
  domain/                 lógica pura y testeada: dinero, modificadores, carrito,
                          claves, branding, errores
  api/                    consultas a Supabase
  state/                  contextos de branding, sucursal, carrito y sesión
  components/             Screen (safe area), DataState, tarjetas, UI compartida
  __tests__/              node:test sobre `src/domain`
```

`src/domain` no importa nada de React Native: son funciones puras que corren
con `node --test --experimental-strip-types`, igual que en
`packages/clover-client`. Por eso los módulos de dominio solo se importan entre
sí con `import type` (Node borra esos imports y no intenta resolverlos).

---

## Marca fija, sucursal elegible

Lo que se fija en el build es la **marca** (`EXPO_PUBLIC_RESTAURANT_ID`), no la
sucursal: §19 del documento de arquitectura describe una app por marca. Las
sucursales salen de la tabla `stores` y las elige el cliente, porque cada una es
un merchant distinto de Clover, con su propio catálogo y sus propios precios
(Variable 6 del addendum).

Al cambiar de sucursal con el carrito lleno se relee de la sucursal destino el
precio de cada producto **y** el recargo de cada modificador, y se muestran las
diferencias antes de aplicar nada. Lo que no existe allí se dice con su nombre;
nunca se elimina en silencio. El puente entre catálogos es `clover_item_id` /
`clover_modifier_id`: los uuid de nuestras tablas son por sucursal.

La lógica vive en `revalidateCart()` (`src/domain/cart.ts`) y está cubierta por
tests con dos catálogos distintos.

## Branding desde la base

Colores, nombre, logo y feature flags salen de `app_settings`, no del build. Un
cambio de color no requiere release. Si `features.loyalty` está en `false`, la
pestaña Rewards desaparece de la barra y de la navegación.

`readableOn()` comprueba el contraste: si el color de marca no llega al mínimo
AA sobre el primario, se sustituye por uno que sí, de modo que una marca con una
paleta pálida no acaba con botones ilegibles.

## Datos que consume

| Pantalla | Origen |
|---|---|
| Todas | `app_settings` (branding y features), `stores` (sucursales) |
| Home | `store_hours`, vista `menu_items` con `featured` |
| Menu | vista `menu_items` agrupada por `category_sort` |
| Detalle | `menu_items` + `catalog_item_modifier_groups` → `catalog_modifier_groups` → `catalog_modifiers` |
| Cambio de sucursal | `menu_items` y `catalog_modifiers` de la sucursal destino |
| Rewards | `loyalty_programs`, `loyalty_accounts`, `rewards` |
| Profile | `profiles` |

## Cuando algo falla

`classifyError()` (`src/domain/errors.ts`) distingue siete casos —falta de
configuración, clave rechazada, permisos, sin red, esquema incompleto, error de
servidor y desconocido— y `<DataState>` los pinta con su título, su explicación
y qué hacer. Una lista vacía **no** es lo mismo que un fallo: el error se
resuelve primero, para que "no hay conexión" nunca se lea como "no hay
productos".

Todas esas lecturas tienen policy pública o de usuario propio en
`supabase/migrations/0004_rls.sql`. Si el menú sale vacío, lo primero que hay
que comprobar es que `supabase/seed/seed_viva.sql` está aplicado y que la vista
`public.menu_items` es legible por el rol `anon`.
