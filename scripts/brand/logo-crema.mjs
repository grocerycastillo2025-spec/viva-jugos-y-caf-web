/**
 * Saca el logotipo en crema de `assets/brand/viva-logo.png`.
 *
 * El archivo de marca que hay es una composicion fotografica: el logotipo
 * impreso sobre papel crema, rodeado de fruta, hojas y granos de cafe.
 * Sobre el verde de la app eso no se puede poner. Esto recorta la tinta y
 * la devuelve en crema sobre transparente.
 *
 * COMO SEPARA LA TINTA DE LA FOTO
 * Las hojas de la foto son verdes como el logotipo, asi que el color solo
 * no basta. Se combinan tres reglas:
 *   1. el pixel esta cerca de uno de los tres colores de marca (verde,
 *      rojo, naranja) y lejos del papel;
 *   2. su mancha no toca el borde del recorte — ahi solo llega la fruta;
 *   3. y cae dentro del rectangulo que forman las manchas grandes, que
 *      son las letras. Asi se van las esquirlas de hoja sueltas.
 *
 * Es una aproximacion, no el arte original. Si aparece el vectorial de la
 * marca, ese manda y este archivo sobra.
 *
 *   node scripts/brand/logo-crema.mjs
 *
 * Ver docs/MARCA-LOGO.md para que hacer con el resultado.
 */

import fs from 'node:fs';
import { PNG } from 'pngjs';

const src = PNG.sync.read(fs.readFileSync(new URL('../../assets/brand/viva-logo.png', import.meta.url)));
const { width: SW, data: S } = src;
const X0 = 60, Y0 = 285, X1 = 1160, Y1 = 915;
const W = X1 - X0, H = Y1 - Y0;
const px = (x, y) => { const i = ((y + Y0) * SW + (x + X0)) << 2; return [S[i], S[i+1], S[i+2]]; };

// Los tres colores del logotipo, muestreados de la propia imagen.
const TINTAS = [[10, 68, 33], [172, 7, 14], [223, 116, 33]];
const PAPEL = [238, 227, 213];
const d2 = (a, b) => (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
const aTinta = (c) => Math.sqrt(Math.min(...TINTAS.map((t) => d2(c, t))));
const aPapel = (c) => Math.sqrt(d2(c, PAPEL));

// Tinta = cerca de un color de marca Y lejos del papel. Una hoja verde de
// la foto tiene brillos y sombras que la sacan de ese radio; el verde del
// logotipo es plano y siempre cae dentro.
const TOL = 78;
const mask = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const c = px(x, y);
  mask[y*W+x] = aTinta(c) < TOL && aPapel(c) > 70 ? 1 : 0;
}

// Componentes conexas; fuera las que tocan el borde del recorte.
const label = new Int32Array(W * H).fill(-1);
const cola = new Int32Array(W * H);
const comps = [];
for (let s = 0; s < W * H; s++) {
  if (mask[s] === 0 || label[s] !== -1) continue;
  const id = comps.length; let head = 0, tail = 0;
  cola[tail++] = s; label[s] = id;
  const pixeles = []; let borde = false;
  let x0=W,y0=H,x1=0,y1=0;
  while (head < tail) {
    const p = cola[head++]; const x = p % W, y = (p / W) | 0;
    pixeles.push(p);
    if (x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    if (x <= 1 || y <= 1 || x >= W-2 || y >= H-2) borde = true;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x+dx, ny = y+dy;
      if (nx<0||ny<0||nx>=W||ny>=H) continue;
      const q = ny*W+nx;
      if (mask[q] === 1 && label[q] === -1) { label[q] = id; cola[tail++] = q; }
    }
  }
  comps.push({ pixeles, borde, n: pixeles.length, box: [X0+x0, Y0+y0, X0+x1, Y0+y1] });
}

const keep = new Uint8Array(W * H);
// Las piezas grandes son, sin discusion, el logotipo: las letras y las
// hojas. Definen el rectangulo donde puede vivir el resto. Una esquirla
// de hoja que se salvo por no tocar el borde cae fuera de el.
const gordas = comps.filter((c) => !c.borde && c.n >= 800);
const caja = gordas.reduce(
  (a, c) => [Math.min(a[0], c.box[0]), Math.min(a[1], c.box[1]),
             Math.max(a[2], c.box[2]), Math.max(a[3], c.box[3])],
  [1e9, 1e9, 0, 0],
);
const dentro = (c) => c.box[0] >= caja[0] - 8 && c.box[1] >= caja[1] - 8 &&
                      c.box[2] <= caja[2] + 8 && c.box[3] <= caja[3] + 8;
const vivos = comps.filter((c) => !c.borde && c.n >= 60 && dentro(c));
console.log('caja del logotipo:', caja.join(','));
for (const c of vivos) for (const p of c.pixeles) keep[p] = 1;
console.log('piezas conservadas:', vivos.length, ' descartadas por tocar el borde:',
  comps.filter((c) => c.borde && c.n >= 60).length);
for (const c of comps.filter((c) => c.borde && c.n >= 400)) console.log('   fuera:', c.n, c.box.join(','));

// Ensanchar un pixel: los bordes de las letras estan mezclados con el
// papel y quedaron fuera de la mascara. Sin esto el contorno sale dentado.
const ancho = new Uint8Array(keep);
for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++) {
  if (keep[y*W+x]) continue;
  if (keep[(y-1)*W+x] || keep[(y+1)*W+x] || keep[y*W+x-1] || keep[y*W+x+1]) ancho[y*W+x] = 1;
}
keep.set(ancho);

let minx=W,miny=H,maxx=0,maxy=0;
for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (keep[y*W+x]) {
  if(x<minx)minx=x; if(x>maxx)maxx=x; if(y<miny)miny=y; if(y>maxy)maxy=y; }
const M = 20;
minx=Math.max(0,minx-M); miny=Math.max(0,miny-M);
maxx=Math.min(W-1,maxx+M); maxy=Math.min(H-1,maxy+M);
const OW=maxx-minx+1, OH=maxy-miny+1;
console.log('recorte', OW+'x'+OH, `(x ${X0+minx}-${X0+maxx}, y ${Y0+miny}-${Y0+maxy})`);

const CREMA = [245, 240, 230];
const out = new PNG({ width: OW, height: OH });
const prev = new PNG({ width: OW, height: OH });
for (let y=0;y<OH;y++) for (let x=0;x<OW;x++) {
  const sx=x+minx, sy=y+miny;
  const c = px(sx, sy);
  // Alfa gradual con la distancia al papel: bordes limpios, sin dientes.
  const a = keep[sy*W+sx] ? Math.max(0, Math.min(255, Math.round((aPapel(c) - 28) * 255 / 78))) : 0;
  const i = (y*OW+x) << 2;
  out.data[i]=CREMA[0]; out.data[i+1]=CREMA[1]; out.data[i+2]=CREMA[2]; out.data[i+3]=a;
  const mix=(cc,f)=>Math.round((cc*a + f*(255-a))/255);
  prev.data[i]=mix(CREMA[0],0x0E); prev.data[i+1]=mix(CREMA[1],0x4A);
  prev.data[i+2]=mix(CREMA[2],0x2B); prev.data[i+3]=255;
}
fs.writeFileSync(new URL('../../assets/brand/viva-logo-cream.png', import.meta.url), PNG.sync.write(out));
fs.writeFileSync(new URL('../../assets/brand/viva-logo-cream-preview.png', import.meta.url), PNG.sync.write(prev));
console.log('escrito');
