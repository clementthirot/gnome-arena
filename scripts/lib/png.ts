// Lecture et écriture PNG minimales (RGBA 8 bits), sans dépendance : node:zlib suffit.
import { deflateSync } from 'node:zlib';
import type { PixelGrid } from '../../src/render/pixels';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(grid: PixelGrid): Buffer {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const raw = Buffer.alloc(height * (1 + width * 4));
  grid.forEach((row, y) => {
    const o = y * (1 + width * 4);
    raw[o] = 0; // filtre "aucun"
    row.forEach((c, x) => {
      if (!c) return;
      const n = parseInt(c.slice(1), 16);
      const p = o + 1 + x * 4;
      raw[p] = (n >> 16) & 255;
      raw[p + 1] = (n >> 8) & 255;
      raw[p + 2] = n & 255;
      raw[p + 3] = 255;
    });
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Dimensions d'un PNG, lues dans son en-tête. */
export function pngSize(file: Buffer): { width: number; height: number } {
  if (file.length < 24 || !file.subarray(0, 8).equals(SIGNATURE) || file.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error("ce n'est pas un PNG valide");
  }
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}
