#!/usr/bin/env node
/**
 * Remata la exportacion web (`expo export --platform web`).
 *
 *   node scripts/web-postbuild.mjs <carpeta-dist>
 *
 * 1. Sustituye `__BASE__` en index.html, el manifest y el service worker
 *    por la ruta base donde se sirve la app. Sale de EXPO_WEB_BASE_URL,
 *    la misma variable que lee app.config.js: "" con dominio propio,
 *    "/viva-jugos-y-caf-web" en GitHub Pages.
 * 2. Copia index.html a 404.html. Es una app de una sola pagina: en
 *    GitHub Pages, abrir directamente /order/123 o recargar en esa ruta
 *    devuelve 404.html, que arranca la app y el router pinta la pantalla.
 * 3. Escribe .nojekyll para que Pages sirva la carpeta `_expo/` (Jekyll
 *    ignora las que empiezan por guion bajo).
 */

import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const raw = (process.env.EXPO_WEB_BASE_URL ?? '').trim().replace(/\/+$/, '');
const base = raw === '' ? '/' : `${raw.startsWith('/') ? '' : '/'}${raw}/`;

const index = path.join(dist, 'index.html');
if (!fs.existsSync(index)) {
  console.error(`[web-postbuild] No existe ${index}. ¿Corrio antes expo export?`);
  process.exit(1);
}

for (const file of ['index.html', 'manifest.webmanifest', 'sw.js']) {
  const p = path.join(dist, file);
  if (!fs.existsSync(p)) continue;
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('__BASE__', base));
}

fs.copyFileSync(index, path.join(dist, '404.html'));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`[web-postbuild] Base "${base}", 404.html y .nojekyll listos en ${dist}`);
