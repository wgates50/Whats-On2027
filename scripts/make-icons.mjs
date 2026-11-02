// Generates the PWA icons (no image tools needed): a vermilion tile with a cream "on air" ring.
//   node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const BG = [0xcf, 0x35, 0x17];
const FG = [0xf6, 0xf0, 0xe2];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const S = 4; // supersampling
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const [pr, pg, pb, pa] = pixel((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
        r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0; raw[o + 1] = a ? Math.round(g / a) : 0; raw[o + 2] = a ? Math.round(b / a) : 0; raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// scale: how much of the tile the mark occupies (maskable icons need a smaller mark)
const mark = (scale) => (u, v) => {
  const dx = (u - 0.5) / scale, dy = (v - 0.5) / scale;
  const d = Math.hypot(dx, dy);
  const ring = d >= 0.25 && d <= 0.34;
  const dot = Math.hypot(dx - 0.0, dy - 0.0) <= 0.11;
  return ring || dot;
};
const tile = (rounded, scale) => (u, v) => {
  if (rounded) {
    const r = 0.22, cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
    if (Math.hypot(u - cx, v - cy) > r) return [0, 0, 0, 0];
  }
  return mark(scale)(u, v) ? [...FG, 1] : [...BG, 1];
};

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/icon-192.png", png(192, tile(true, 1)));
writeFileSync("public/icons/icon-512.png", png(512, tile(true, 1)));
writeFileSync("public/icons/icon-maskable-512.png", png(512, tile(false, 0.72)));
writeFileSync("public/icons/apple-touch-icon.png", png(180, tile(false, 0.9)));
writeFileSync(
  "public/icons/icon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#cf3517"/><circle cx="50" cy="50" r="29.5" fill="none" stroke="#f6f0e2" stroke-width="9"/><circle cx="50" cy="50" r="11" fill="#f6f0e2"/></svg>\n`,
);
console.log("icons written to public/icons/");
