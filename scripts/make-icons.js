// Draws the app icons (a loaded barbell) as PNGs with no dependencies.
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const INK = [31, 35, 40];
const BAR = [200, 205, 211];
const PLATES = [
  { color: [212, 50, 44], w: 0.085, h: 0.58 },  // red
  { color: [239, 180, 22], w: 0.07, h: 0.46 },  // yellow
  { color: [46, 107, 208], w: 0.055, h: 0.34 }, // blue
];

function draw(size, { maskable = false } = {}) {
  const SS = 3;
  const N = size * SS;
  const px = new Float32Array(N * N * 3);
  const set = (x, y, c) => { const i = (y * N + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) set(x, y, INK);
  const scale = maskable ? 0.72 : 1; // keep artwork inside the maskable safe zone
  const cx = N / 2, cy = N / 2;
  const rectR = (x0, y0, x1, y1, r, c) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(N, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(N, Math.ceil(x1)); x++) {
        const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
        const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
        if (dx * dx + dy * dy <= r * r) set(x, y, c);
      }
    }
  };
  const S = N * scale;
  rectR(cx - S * 0.46, cy - S * 0.02, cx + S * 0.46, cy + S * 0.02, S * 0.02, BAR);
  let off = 0.07;
  for (const p of PLATES) {
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? cx - S * (off + p.w) : cx + S * off;
      rectR(x0, cy - (S * p.h) / 2, x0 + S * p.w, cy + (S * p.h) / 2, S * 0.02, p.color);
    }
    off += p.w + 0.012;
  }
  // box-filter down to the target size
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * N + (x * SS + sx)) * 3;
        acc[0] += px[i]; acc[1] += px[i + 1]; acc[2] += px[i + 2];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(acc[0] / (SS * SS)); raw[o + 1] = Math.round(acc[1] / (SS * SS)); raw[o + 2] = Math.round(acc[2] / (SS * SS)); raw[o + 3] = 255;
    }
  }
  return png(size, raw);
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function png(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), draw(192));
writeFileSync(new URL('icon-512.png', out), draw(512));
writeFileSync(new URL('icon-maskable-512.png', out), draw(512, { maskable: true }));
writeFileSync(new URL('apple-touch-icon.png', out), draw(180));
writeFileSync(new URL('icon.svg', out), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1F2328"/><rect x="4" y="49" width="92" height="2" rx="1" fill="#C8CDD3"/><g fill="#D4322C"><rect x="7" y="21" width="8.5" height="58" rx="2"/><rect x="84.5" y="21" width="8.5" height="58" rx="2"/></g><g fill="#EFB416"><rect x="16.7" y="27" width="7" height="46" rx="2"/><rect x="76.3" y="27" width="7" height="46" rx="2"/></g><g fill="#2E6BD0"><rect x="25" y="33" width="5.5" height="34" rx="2"/><rect x="69.5" y="33" width="5.5" height="34" rx="2"/></g></svg>`);
console.log('icons written');
