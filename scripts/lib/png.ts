// Lecture et écriture PNG minimales (RGBA 8 bits), sans dépendance : node:zlib suffit.
import { deflateSync, inflateSync } from 'node:zlib';
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

/** Image RGBA brute : 4 octets par pixel, ligne par ligne. */
export interface Rgba {
  width: number;
  height: number;
  data: Buffer;
}

function encodeRaw(width: number, height: number, pixel: (x: number, y: number, out: Buffer, at: number) => void): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const o = y * (1 + width * 4);
    raw[o] = 0; // filtre "aucun"
    for (let x = 0; x < width; x++) pixel(x, y, raw, o + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function encodePng(grid: PixelGrid): Buffer {
  return encodeRaw(grid[0]?.length ?? 0, grid.length, (x, y, out, at) => {
    const c = grid[y][x];
    if (!c) return;
    const n = parseInt(c.slice(1), 16);
    out[at] = (n >> 16) & 255;
    out[at + 1] = (n >> 8) & 255;
    out[at + 2] = n & 255;
    out[at + 3] = 255;
  });
}

export function encodeRgba(img: Rgba): Buffer {
  return encodeRaw(img.width, img.height, (x, y, out, at) => img.data.copy(out, at, (y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
}

/** Décode un PNG 8 bits RGBA ou RGB non entrelacé (ce qu'exportent PixelLab et Aseprite). */
export function decodePng(file: Buffer): Rgba {
  const { width, height } = pngSize(file);
  const depth = file[24];
  const colorType = file[25];
  const interlace = file[28];
  if (depth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) {
    throw new Error(`PNG non pris en charge (profondeur ${depth}, type ${colorType}, entrelacement ${interlace}) : exporte-le en RGBA 8 bits`);
  }
  const idat: Buffer[] = [];
  for (let o = 8; o < file.length; ) {
    const len = file.readUInt32BE(o);
    const type = file.toString('ascii', o + 4, o + 8);
    if (type === 'IDAT') idat.push(file.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const lines = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const cur = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? lines[cur + i - bpp] : 0;
      const b = y > 0 ? lines[cur - stride + i] : 0;
      const c = y > 0 && i >= bpp ? lines[cur - stride + i - bpp] : 0;
      let v = raw[src + i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      lines[cur + i] = v & 255;
    }
  }
  if (bpp === 4) return { width, height, data: lines };
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    lines.copy(data, i * 4, i * 3, i * 3 + 3);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

/** Dimensions d'un PNG, lues dans son en-tête. */
export function pngSize(file: Buffer): { width: number; height: number } {
  if (file.length < 24 || !file.subarray(0, 8).equals(SIGNATURE) || file.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error("ce n'est pas un PNG valide");
  }
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) };
}
