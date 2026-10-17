// توليد أيقونات PNG بدون مكتبات خارجية (PNG يدوي + zlib)
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [14, 122, 95, 255];       // أخضر
const FG = [255, 255, 255, 255];

// رسم قلب: دائرتان + مثلث
function heart(px, py, cx, cy, w, h) {
  const r = w / 4;
  const dy = py - cy;
  const dxL = px - (cx - w / 4);
  const dxR = px - (cx + w / 4);
  const dyC = py - (cy - h / 4);
  if (dxL * dxL + dyC * dyC <= r * r) return true;
  if (dxR * dxR + dyC * dyC <= r * r) return true;
  // مثلث pointed لأسفل
  const top = cy - h / 4 + r * 0.2;
  const bottom = cy + h / 2;
  if (py >= top && py <= bottom) {
    const t = (py - top) / (bottom - top);
    const half = (w / 2) * (1 - t);
    if (Math.abs(px - cx) <= half) return true;
  }
  return false;
}

function makeIcon(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const radius = maskable ? size * 0.5 : size * 0.47;
  const hw = maskable ? size * 0.34 : size * 0.52;
  const hh = maskable ? size * 0.32 : size * 0.48;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius) { buf[i + 3] = 0; continue; }      // خارج الدائرة: شفاف
      let color = BG;
      if (heart(x + 0.5, y + 0.5, cx, cy, hw, hh)) color = FG;
      buf[i] = color[0]; buf[i + 1] = color[1]; buf[i + 2] = color[2]; buf[i + 3] = 255;
    }
  }
  return png(size, size, buf);
}

const out = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), makeIcon(192, false));
fs.writeFileSync(path.join(out, 'icon-512.png'), makeIcon(512, false));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), makeIcon(512, true));
console.log('icons written');