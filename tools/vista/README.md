# Banco de pruebas visual del menú

Pinta los componentes **de verdad** de `apps/mobile` en un navegador y saca
una captura. Sirve para ver una pantalla antes de publicar un update.

## Por qué existe

El 1 de septiembre publiqué un rediseño del menú con `lint`, `typecheck` y
234 tests en verde. En el teléfono no se veía ni un carácter: el texto se
salía por la izquierda, el "+" flotaba pegado al borde y las filas medían
el doble. Ninguna de esas cosas la puede ver un test de dominio, porque no
son lógica: son medidas.

La causa estaba en una rama por ancho de pantalla —`gridColumns(width)`—
que a partir de 500 dp cambiaba la lista a un mosaico de dos columnas.
Ningún aparato mío la ejecutaba nunca; el suyo, sí. Eso es exactamente lo
que este banco hace visible: **pinta la misma pantalla a varios anchos y
te obliga a mirarla.**

## Cómo se usa

```bash
cd tools/vista
npm install          # solo la primera vez
npm run ver          # genera menu-anchos.png
```

La captura sale en `tools/vista/menu-anchos.png`. Ábrela y **míralas
todas**, no solo la del teléfono que tienes tú.

Para cambiar qué se pinta, se edita `entry.tsx`: los productos son los del
seed, con `image_url` a `null` porque ese es el estado normal mientras las
fotos no están subidas.

## Qué es real y qué no

Real: `MenuItemCard`, `ItemPhoto`, `Badge`, el tema, la paleta de marca y
las medidas de `card-metrics.ts`. Es el código que se publica.

Sustituido por un doble en `stubs/`: `expo-router` (el `Link asChild`
clona el hijo, igual que hace el de verdad), `@expo/vector-icons`,
`expo-image` y el contexto de marca. Son hojas del árbol; el fallo vive en
la composición.

## Emula Yoga, no CSS

`react-native-web` traduce los estilos a CSS, y CSS y Yoga no miden igual.
Las dos diferencias que más muerden:

- `flex-shrink` vale **1** en CSS y **0** en Yoga: un hijo de una fila que
  no cabe encoge solo en el navegador, y desborda en el teléfono.
- los hijos de un flex traen `min-width: auto` en CSS y **0** en Yoga: el
  navegador se niega a encoger un texto por debajo de su contenido, y Yoga
  lo encoge hasta cero. Un nombre con `flex: 1` al lado de una etiqueta
  ancha se ve en el navegador y **desaparece** en el teléfono.

`yoga.ts` parchea `StyleSheet.create` para poner `flexShrink: 0` donde el
estilo no dice nada, que es lo que hace Yoga, y los componentes llevan
`minWidth: 0` donde toca para que el navegador no haga trampa. Con
`?yoga=0` en la url se compara con el comportamiento de CSS.

## Lo que aun asi NO puede decirte

Sigue siendo un navegador. Así que:

- si aquí se ve roto, está roto;
- si aquí se ve bien, **casi seguro** está bien, pero no es una prueba.

Para lo segundo no hay sustituto de un teléfono. Este banco reduce la
distancia; no la cierra.

## Fuera del workspace, a propósito

`pnpm-workspace.yaml` no incluye `tools/*`, y este paquete trae su propio
`package.json` con `npm`. No es manía: `esbuild` y `playwright-core` son
herramientas de desarrollo y no tienen por qué aparecer en las
`dependencies` de la app.

Cuando la política de `runtimeVersion` era `fingerprint`, meterlas ahí
habría cambiado el runtime y los updates habrían dejado de llegar a los
teléfonos por haber añadido una herramienta de desarrollo. Hoy el runtime
es un literal, así que el castigo sería más leve —un test pidiendo
explicaciones, ver `docs/RUNTIME-Y-UPDATES.md`— pero la separación sigue
siendo la correcta.
