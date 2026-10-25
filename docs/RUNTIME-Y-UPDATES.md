# `runtimeVersion`: qué llega al teléfono y qué necesita build

## La regla, en una línea

EAS entrega un update al teléfono solo si **el canal y el
`runtimeVersion` coinciden** con los del APK instalado. Si no coinciden,
el update se publica, el run sale verde, y no lo recoge nadie.

## Por qué ya no usamos la política `fingerprint`

Hasta el 1 de septiembre, `app.json` decía:

```json
"runtimeVersion": { "policy": "fingerprint" }
```

Con esa política EAS **calcula** un hash del proyecto nativo, y lo calcula
dos veces: una en el builder cuando compila, otra en el runner de GitHub
cuando publica un update. La idea es buena — un update solo llega a
binarios que tienen el código nativo que ese JavaScript necesita — pero
los dos lados nunca dieron el mismo número:

| Dónde | Número |
|---|---|
| APK compilado en EAS | `53d4021…` |
| Update publicado (leído mal, era la entrada de iOS) | `4159f9e7…` |
| Update publicado (Android, el de verdad) | `238821d…` |

Tres valores del mismo árbol. **Durante una semana ningún update llegó a
ningún teléfono**, y no se veía: cada publicación salía en verde.

Se probaron dos hipótesis, las dos reales y las dos insuficientes:

- que faltara el `google-services.json` en el runner (se arregló, y el
  número siguió sin cuadrar);
- que `eas update` sin `--platform` contara las fuentes de iOS además de
  las de Android — 117 frente a 86 (cierto, y tampoco era la causa: los
  tres updates de la lista, con flag y sin flag, salieron con el mismo
  `238821d`).

**Un mecanismo de seguridad que impide todas las entregas no da
seguridad, da parálisis.** Así que se abandonó.

## Lo que hay ahora

```json
"runtimeVersion": "1.0.0"
```

Una cadena literal en un archivo versionado. El build y el update leen la
**misma** cadena; no hay nada que calcular y nada que pueda divergir entre
máquinas.

## El precio, y cómo se paga

La política calculada protegía de un fallo real: publicar JavaScript que
pide un módulo nativo que el APK instalado no tiene. Eso no da un error de
red — **revienta la app al arrancar, en el teléfono del cliente**. Con un
literal, subirlo es responsabilidad nuestra.

Por eso hay un aviso automático:

- `apps/mobile/src/domain/native-lock.ts` calcula una **firma** de lo
  único que puede cambiar el proyecto nativo en un proyecto Expo
  gestionado: las `dependencies` de `package.json`, los `plugins`, los
  bloques `android` e `ios`, y el propio `runtimeVersion`.
- `apps/mobile/native-lock.json` guarda la firma vigente.
- `apps/mobile/src/__tests__/native-lock.test.ts` las compara. Si el
  proyecto nativo cambió y el `runtimeVersion` no, **falla el test y
  explica qué hacer**. Se ejecuta en `pnpm test`, o sea en cada PR y
  antes de cada publicación.

La firma sale de dos archivos de git, no de `node_modules` ni del sistema
de ficheros: da lo mismo en cualquier máquina, que es justo lo que le
faltaba al fingerprint.

## Cómo subir el runtime (dos o tres veces al año)

Cuando entra una dependencia nativa, un plugin de config, o cambia el
`targetSdk`:

1. subir `expo.runtimeVersion` en `apps/mobile/app.json` — `"1.0.0"` →
   `"1.1.0"`;
2. `pnpm --filter @juicebar/mobile lock:native` para sellar la firma
   nueva;
3. **Actions → Build Android (EAS)**, e instalar el APK;
4. a partir de ahí los updates vuelven a llegar.

El paso 2 se niega a sellar si el paso 1 no se hizo: sellar sin subir el
runtime dejaría a los APK que ya están en la calle recibiendo JavaScript
que no pueden ejecutar.

### La excepción: una dependencia de JavaScript puro

La firma mira las `dependencies` enteras, así que también salta con un
paquete que no trae una línea de código nativo. Para ese caso hay salida:

```bash
pnpm --filter @juicebar/mobile lock:native --solo-js
```

Sella la firma sin tocar el runtime y **no** hace falta build. Antes de
usarlo, mira dentro del paquete: si trae una carpeta `android/`, `ios/` o
un `app.plugin.js`, no es JavaScript puro y el flag está mal usado.

Existe a propósito. Un aviso sin escapatoria se acaba desactivando entero,
y entonces no queda ninguno; con escapatoria, usarla es una decisión
consciente que queda escrita en el commit.

El orden importa. Entre el paso 1 y el paso 3 hay una ventana en la que
los updates ya no le llegan al APK viejo — que es lo correcto — pero
todavía no hay APK nuevo. Publicar en esa ventana no rompe nada: el
workflow de update lo detecta y avisa.

## El guardián del workflow de update

`publish-update.yml` termina comprobando si **algún APK terminado tiene el
runtime del update**. Si ninguno lo tiene, falla el run.

Ese paso acertó cinco veces seguidas mientras yo dudaba de él. Se queda.

## Tabla rápida

| Cambio | Qué hace falta |
|---|---|
| Textos, estilos, pantallas, lógica | Update. No gasta build. |
| Assets (imágenes del bundle) | Update. |
| Dependencia nueva de JS puro | Update. El test salta igual; se sella con `lock:native --solo-js`. |
| Dependencia con código nativo | Subir runtime + `lock:native` + build. |
| Plugin de config nuevo | Subir runtime + `lock:native` + build. |
| `targetSdk`, `minSdk`, permisos | Subir runtime + `lock:native` + build. |
