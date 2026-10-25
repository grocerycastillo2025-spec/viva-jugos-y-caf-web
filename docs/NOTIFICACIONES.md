# Notificaciones push — qué hay que configurar

La parte nativa entra en este build. Lo que decide **cuándo** se manda
cada aviso es servidor y JavaScript, así que eso puede llegar después por
EAS Update sin recompilar.

---

## Lo que hay que hacer ANTES de lanzar el build

Solo hay una cosa que tenga que estar antes de compilar:
**`google-services.json`**, subido a EAS como variable de entorno (paso 2).
Sin él, el APK se instala y funciona, pero el teléfono no puede pedir un
token y no recibirá nunca una notificación. Y eso solo se arregla con
**otro build**.

### 1. Firebase (10 minutos)

1. https://console.firebase.google.com → **Add project**
2. Nombre: `Viva Juice` (o el que quieras). Google Analytics: **no hace falta**
3. Dentro del proyecto, icono de **Android** para añadir una app
4. **Android package name**, exactamente esto, sin espacios:

   ```
   com.vivajuicecoffee.app
   ```

   Tiene que coincidir carácter por carácter con `android.package` de
   `app.json`. Si no coincide, el build falla con un mensaje que lo dice.
5. Apodo y SHA-1: **saltar**. El SHA-1 solo hace falta para el inicio de
   sesión con Google nativo, no para las notificaciones
6. **Download google-services.json**

### 2. Subir el archivo a EAS (no a GitHub)

Aquí está el detalle que costó un build, y conviene entenderlo porque no
es obvio:

> **EAS solo sube al builder lo que está versionado en git.**

El archivo está en `.gitignore` a propósito, así que escribirlo desde un
secreto de GitHub no sirve de nada: existe en el runner mientras se lee la
configuración, se declara en `android.googleServicesFile`, y después **no
viaja**. En la máquina de EAS la ruta apunta a un archivo que no está.

La vía que sí funciona es una **variable de entorno de EAS de tipo
`file`**: EAS guarda el archivo y, en el builder, lo escribe en disco y
deja su ruta en la variable. `app.config.js` lee esa ruta.

**En https://expo.dev**, dentro del proyecto `juicebar-mobile`, sección
**Environment variables** → crear una variable con estos cuatro campos:

| Campo | Valor |
|---|---|
| **Name** | `GOOGLE_SERVICES_JSON` |
| **Type** | **File** — y subes el `google-services.json` |
| **Visibility** | `Sensitive` — **`Secret` no funciona**, ver abajo |
| **Environments** | marcar **preview** y **production** |

El nombre tiene que ser exactamente ese: es el que lee `app.config.js`.
Y los entornos importan: el perfil `preview` de `eas.json` resuelve al
entorno `preview` de EAS, así que una variable que solo esté en
`production` no la ve el build de `preview`.

**`Sensitive` no es una preferencia: con `Secret` el workflow de build se
para.** Una variable `Secret` no la puede leer nadie fuera de los
servidores de EAS, ni el CLI, así que no baja al runner y no se puede
revisar antes de compilar.

Eso importa porque un build son veinte minutos y uno de los quince del
mes: el workflow abre el archivo y comprueba que es un JSON válido y que
el `package_name` es el de esta app. Descubrir en el minuto dieciocho que
era el `google-services.json` de otro proyecto sale caro.

> Antes había una razón más fuerte —la política `runtimeVersion` era
> `fingerprint`, se calculaba en las dos máquinas y el archivo tenía que
> estar en las dos— pero esa política se abandonó porque los dos lados
> nunca dieron el mismo número. Ver
> [`RUNTIME-Y-UPDATES.md`](RUNTIME-Y-UPDATES.md).

Y no se pierde nada por usar `Sensitive`: este archivo **viaja dentro del
APK**, así que cualquiera que lo descargue y lo descomprima lo tiene. No
es una credencial. `Sensitive` lo mantiene fuera de los logs y de la
interfaz, que es la protección que de verdad aplica aquí.

**Borra el secreto `GOOGLE_SERVICES_JSON` de GitHub.** Ya no lo usa
nadie, y un secreto que parece que hace algo y no lo hace es peor que no
tenerlo. Está en Settings → Secrets and variables → Actions.

### Por qué el archivo también se baja al runner

El workflow ejecuta `eas env:pull` antes de construir. Deja el archivo en
`apps/mobile/.eas/.env/GOOGLE_SERVICES_JSON` y una línea en `.env.local`
apuntando a él, que es lo que lee `app.config.js`. Con eso, el paso de
revisión previa puede mirarlo.

Al **publicar un update** ya no hace falta: un update solo lleva
JavaScript y assets, y la configuración de Firebase vive en el APK. Ese
paso se quitó de `publish-update.yml`, donde solo podía hacer fallar una
publicación por algo que no la afecta.

### Un mensaje del log que NO es lo que parece

En el log de `eas build` sale siempre esta línea:

```
No environment variables with visibility "Plain text" and "Sensitive"
found for the "preview" environment on EAS.
```

**No significa que falte la variable**, aunque lo parezca. Al evaluar la
configuración en local, el CLI pide las variables sin el contenido de los
ficheros y luego descarta las que no traen valor: una variable de tipo
`file` desaparece siempre de esa lista, exista o no. Está en
`evaluateConfigWithEnvVarsAsync.js` del propio `eas-cli`. En el builder sí
se inyecta.

Para saber de verdad si la variable está, mira el paso **Comprobar la
variable de Firebase en EAS** del workflow, que pregunta por ella
directamente.

### 3. Lanzar el build

Actions → **Build Android (EAS)** → **Run workflow**.

El workflow comprueba **antes de arrancar** que la variable existe en el
entorno de EAS que toca, y **se para** si no está. Avisar y seguir gastaría
uno de los 15 builds del mes en un APK que parece bueno y nunca entrega una
notificación; pararse cuesta treinta segundos.

Si alguna vez quieres el APK igualmente, relanza el workflow marcando la
casilla **`sin_push`**.

Y si la variable existe pero apunta mal, tampoco se cae el build:
`app.config.js` comprueba que el archivo esté antes de declararlo, y en el
peor caso el APK sale sin notificaciones. Antes declaraba una ruta que en
el builder no existía, y eso sí tumbaba el build entero.

---

## Lo que se puede hacer DESPUÉS (no bloquea el build)

Para que Expo pueda **enviar** notificaciones hace falta darle permiso
para hablar con Firebase en tu nombre. Esto vive en los servidores de
Expo, no dentro de la app, así que se puede configurar cuando quieras.

1. Firebase → rueda dentada → **Project settings** → **Service accounts**
2. **Generate new private key** → descarga un `.json`
3. https://expo.dev → proyecto `juicebar-mobile` → **Credentials** →
   **Android** → **FCM V1 service account key** → **Upload**

> **Ese archivo es una clave privada de verdad: no me lo pegues aquí, no
> lo subas al repositorio y no lo pongas en un secreto de GitHub.** Se
> sube directamente a Expo y no tiene que pasar por ningún otro sitio.
> Con él, quien lo tenga puede mandar notificaciones en nombre de Viva.

---

## Resumen de qué necesito de ti

| Qué | Dónde va | ¿Me lo pasas? |
|---|---|---|
| `google-services.json` | Variable `GOOGLE_SERVICES_JSON`, tipo **File**, en expo.dev | No hace falta: lo subes tú |
| Clave del service account de FCM | Subida a expo.dev | **No.** Nunca |
| Nombre del paquete | Ya está en `app.json` | Ya lo tengo |

---

## Qué hace la app hoy

- **No pide permiso al arrancar.** En Android 13+ el diálogo sale una
  sola vez: si el cliente dice que no antes de entender para qué sirve,
  la única vuelta atrás son los Ajustes del sistema. Se pide desde
  **Perfil → Order notifications**
- Al conceder permiso, registra el token en `push_tokens` contra la
  cuenta que tenga la sesión abierta
- Al **cerrar sesión** da de baja el token de ese teléfono, para que el
  aviso del pedido de una persona no acabe en la pantalla de otra
- Tocar una notificación de pedido abre esa pantalla de pedido. El aviso
  llega de un servidor, así que la app **no** acepta una ruta dentro del
  mensaje: solo un tipo conocido y un id que tiene que ser un uuid
- La tarjeta de Perfil dice el estado real, incluido cuando no se puede
  hacer nada: emulador, build sin Firebase, o permiso denegado con
  Android que ya no va a volver a preguntar

## Qué falta, y llega por update

Cuándo se manda cada aviso: pedido confirmado, en preparación, listo para
recoger. Eso es servidor más una plantilla de mensaje, nada nativo.
