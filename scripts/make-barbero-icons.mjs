// scripts/make-barbero-icons.mjs — genera los íconos de la PWA del barbero.
//
// El repo solo tenía apple-touch-icon (180) y favicons de 16/32;
// `public/assets/logo.png` es de 400x400, así que no sirve para el 512 que
// Chrome exige para considerar instalable una PWA. En vez de sumar una
// dependencia de imágenes (sharp/jimp) a un repo que no tiene bundler ni
// build, se dibuja la marca ✕ a mano y se codifica el PNG con zlib, que ya
// viene en Node.
//
// Uso: node scripts/make-barbero-icons.mjs
'use strict';
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'barbero');

const INK = [0x0a, 0x0a, 0x0a];   // --ink de la hoja de estilos del sitio
const WHITE = [0xfa, 0xfa, 0xfa]; // --white

// ── CRC32, que PNG exige por chunk ──
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// RGBA de 8 bits (color type 6), sin filtro por scanline (byte 0 al inicio).
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // profundidad
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Distancia de un punto al segmento ab. Se usa para antialiasing por
// cobertura: sin esto la ✕ queda con escalones visibles a 192px.
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// `inset` es la fracción del lado que queda libre a cada costado de la ✕.
// El ícono maskable usa un inset mayor porque Android recorta hasta el 20%
// exterior: la marca tiene que caber en la zona segura central.
function drawIcon(size, inset, strokeRatio) {
  const rgba = Buffer.alloc(size * size * 4);
  const a = inset * size;
  const b = (1 - inset) * size;
  const half = (strokeRatio * size) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const d = Math.min(
        distToSegment(px, py, a, a, b, b),
        distToSegment(px, py, b, a, a, b)
      );
      // Cobertura en el borde: 1 dentro del trazo, 0 fuera, rampa de 1px.
      const cov = Math.max(0, Math.min(1, half + 0.5 - d));
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(INK[c] + (WHITE[c] - INK[c]) * cov);
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, rgba);
}

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', drawIcon(192, 0.28, 0.075)],
  ['icon-512.png', drawIcon(512, 0.28, 0.075)],
  // Zona segura de Android: la marca se achica para sobrevivir al recorte.
  ['icon-maskable-512.png', drawIcon(512, 0.36, 0.062)],
];
for (const [name, buf] of files) {
  writeFileSync(join(OUT, name), buf);
  console.log(name, (buf.length / 1024).toFixed(1) + 'KB');
}
