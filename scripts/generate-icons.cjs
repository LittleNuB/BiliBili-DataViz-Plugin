// Generate placeholder extension icons
// Run: node scripts/generate-icons.js
const fs = require('fs');

const ICONS_DIR = 'public/icons';
const SIZES = [16, 32, 48, 128];

// Minimal PNG: pink circle on transparent background
function createPNG(size) {
  const canvas = { width: size, height: size, data: Buffer.alloc(size * size * 4, 0) };
  const cx = size / 2, cy = size / 2, r = size * 0.42;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const idx = (y * size + x) * 4;
        canvas.data[idx] = 0xFB;     // R
        canvas.data[idx + 1] = 0x72; // G
        canvas.data[idx + 2] = 0x99; // B
        canvas.data[idx + 3] = 0xFF; // A
      }
    }
  }
  return canvas;
}

// Minimal PNG encoder (valid PNG with IHDR + IDAT + IEND)
function encodePNG(canvas) {
  const { width, height, data } = canvas;
  const zlib = require('zlib');

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data with filter byte
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // No filter
    data.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw);

  // Build PNG
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, buf) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(buf.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeB, buf]);

    // CRC32
    let crc = 0xFFFFFFFF;
    for (const b of crcData) {
      crc ^= b;
      for (let i = 0; i < 8; i++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;

    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc, 0);

    return Buffer.concat([len, typeB, buf, crcB]);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Generate
fs.mkdirSync(ICONS_DIR, { recursive: true });
for (const size of SIZES) {
  const canvas = createPNG(size);
  const png = encodePNG(canvas);
  fs.writeFileSync(`${ICONS_DIR}/icon${size}.png`, png);
  console.log(`Generated icon${size}.png (${png.length} bytes)`);
}
console.log('Done!');
