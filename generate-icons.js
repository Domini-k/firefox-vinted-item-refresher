// Run once: node generate-icons.js
// Creates icons/icon16.png, icons/icon48.png, icons/icon128.png
// No dependencies — uses only Node.js built-ins.

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len  = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t    = Buffer.from(type, 'ascii');
  const crcv = Buffer.alloc(4); crcv.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcv]);
}

function makePNG(size, r, g, b) {
  const sig = Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; ihdrData[9] = 2; // 8-bit RGB

  const row = Buffer.alloc(1 + size * 3);
  row[0] = 0; // filter: None
  for (let i = 0; i < size; i++) { row[1+i*3]=r; row[2+i*3]=g; row[3+i*3]=b; }
  const raw = Buffer.concat(Array(size).fill(row));

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const iconsDir = path.join(__dirname, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// Vinted teal #09B1BA
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), makePNG(size, 0x09, 0xB1, 0xBA));
  console.log(`icons/icon${size}.png created`);
}
