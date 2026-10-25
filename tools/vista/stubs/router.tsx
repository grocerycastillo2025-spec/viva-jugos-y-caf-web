import { cloneElement, type ReactElement } from 'react';

/**
 * Doble de `expo-router`, FIEL en lo que importa.
 *
 * El de verdad usa el `Slot` de Radix, que fusiona el `style` del padre con
 * el del hijo COMO OBJETO:
 *
 *     overrideProps.style = { ...styleDelSlot, ...styleDelHijo }
 *
 * Si el hijo pasa el `style` como funcion —lo normal en un `Pressable` para
 * pintar el estado pulsado— desparramarla en un objeto da `{}` y el hijo se
 * queda sin un solo estilo. Eso rompio el menu entero y este banco no lo
 * vio, porque el doble anterior clonaba el hijo sin tocarle el estilo: era
 * mas amable que el original, y por eso mentia.
 *
 * Un doble solo sirve si se equivoca igual que aquello a lo que sustituye.
 */
export function Link({
  children,
  asChild,
  style,
}: {
  children: ReactElement;
  asChild?: boolean;
  href?: unknown;
  style?: unknown;
}) {
  if (!asChild) return children;
  const hijo = (children.props ?? {}) as { style?: unknown };
  return cloneElement(children, {
    onPress: () => undefined,
    style: { ...(style as object), ...(hijo.style as object) },
  } as never);
}

export const useRouter = () => ({ push: () => undefined, back: () => undefined });
