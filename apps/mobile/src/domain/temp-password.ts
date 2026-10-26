/** Contraseña temporal fácil de dictar: sin 0/O ni 1/l/I. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function tempPassword(length = 10, random: (n: number) => number = defaultRandom): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[random(ALPHABET.length)] ?? 'x';
  // Siempre con al menos un número.
  return /\d/.test(out) ? out : `${out.slice(0, -1)}7`;
}

function defaultRandom(n: number): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues !== undefined) return (c.getRandomValues(new Uint32Array(1))[0] ?? 0) % n;
  return Math.floor(Math.random() * n);
}
