/**
 * Minimal QR code encoder (ISO/IEC 18004): byte mode, error correction level
 * M, versions 1-10 (up to 213 bytes, plenty for a card link). It has no
 * dependencies, so card QR codes are drawn on our own server instead of being
 * sent to a third-party image service. Verified by decoding with OpenCV.
 */

/** [total codewords, EC codewords per block, [block count, data codewords per block][]] for level M. */
const VERSIONS_M: [number, number, [number, number][]][] = [
  [26, 10, [[1, 16]]], [44, 16, [[1, 28]]], [70, 26, [[1, 44]]], [100, 18, [[2, 32]]], [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]], [196, 18, [[4, 31]]], [242, 22, [[2, 38], [2, 39]]], [292, 22, [[3, 36], [2, 37]]], [346, 26, [[4, 43], [1, 44]]],
];
const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= mul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly;
}

function errorCorrection(data: number[], degree: number): number[] {
  const gen = generator(degree);
  const remainder = [...data, ...new Array<number>(degree).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) remainder[i + j] ^= mul(gen[j], factor);
  }
  return remainder.slice(data.length);
}

function bch(value: number, poly: number, bits: number): number {
  const degree = (n: number) => 31 - Math.clz32(n);
  let remainder = value << (degree(poly));
  while (remainder !== 0 && degree(remainder) >= degree(poly)) remainder ^= poly << (degree(remainder) - degree(poly));
  return (value << bits) | remainder;
}

function encodeData(bytes: number[], version: number): number[] {
  const [total, ecPerBlock, groups] = VERSIONS_M[version - 1];
  const dataCodewords = total - ecPerBlock * groups.reduce((sum, [count]) => sum + count, 0);
  const bits: number[] = [];
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, dataCodewords * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  for (let pad = 0; codewords.length < dataCodewords; pad++) codewords.push(pad % 2 ? 0x11 : 0xec);
  // Split into blocks, add error correction, interleave.
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) {
    const data = codewords.slice(offset, offset + size);
    offset += size;
    blocks.push({ data, ec: errorCorrection(data, ecPerBlock) });
  }
  const result: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longest; i++) for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const block of blocks) result.push(block.ec[i]);
  return result;
}

const MASKS: ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (_, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(grid: boolean[][]): number {
  const size = grid.length;
  let score = 0;
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < size; i++) {
    let run = 1;
    for (let j = 1; j < size; j++) {
      const same = pass === 0 ? grid[i][j] === grid[i][j - 1] : grid[j][i] === grid[j - 1][i];
      if (same) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; } else run = 1;
    }
  }
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
    const v = grid[r][c];
    if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
  }
  const patterns = [[true, false, true, true, true, false, true, false, false, false, false], [false, false, false, false, true, false, true, true, true, false, true]];
  for (let r = 0; r < size; r++) for (let c = 0; c + 11 <= size; c++) for (const pattern of patterns) {
    if (pattern.every((bit, k) => grid[r][c + k] === bit)) score += 40;
    if (pattern.every((bit, k) => grid[c + k][r] === bit)) score += 40;
  }
  const dark = grid.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/** Encodes text as a QR matrix (true = dark module). Throws when the text is too long for version 10. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  const version = VERSIONS_M.findIndex(([total, ec, groups], index) => {
    const capacity = total - ec * groups.reduce((sum, [count]) => sum + count, 0);
    return 4 + (index + 1 < 10 ? 8 : 16) + bytes.length * 8 <= capacity * 8;
  }) + 1;
  if (version === 0) throw new Error("Text is too long for this QR encoder.");
  const size = 17 + version * 4;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, value: boolean) => { modules[r][c] = value; reserved[r][c] = true; };

  const finder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const row = top + r, col = left + c;
      if (row < 0 || col < 0 || row >= size || col >= size) continue;
      const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      set(row, col, r >= 0 && r <= 6 && c >= 0 && c <= 6 && ring !== 2);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const centres = ALIGNMENT[version - 1];
  for (const r of centres) for (const c of centres) {
    if ((r === 6 && c === 6) || (r === 6 && c === centres.at(-1)) || (r === centres.at(-1) && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
  }
  set(size - 8, 8, true); // dark module
  // Reserve format areas (written after masking) and version areas.
  for (let i = 0; i < 9; i++) { if (!reserved[8][i]) set(8, i, false); if (!reserved[i][8]) set(i, 8, false); }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false); }
  if (version >= 7) {
    const info = bch(version, 0x1f25, 12);
    for (let i = 0; i < 18; i++) {
      const bit = ((info >>> i) & 1) === 1;
      const a = Math.floor(i / 3), b = size - 11 + (i % 3);
      set(a, b, bit); set(b, a, bit);
    }
  }

  const data = encodeData(bytes, version);
  const bits = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((shift) => ((byte >>> shift) & 1) === 1));
  let index = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (reserved[row][c]) continue;
        modules[row][c] = index < bits.length ? bits[index] : false;
        index++;
      }
    }
    upward = !upward;
  }

  const withMask = (mask: number): boolean[][] => {
    const grid = modules.map((row, r) => row.map((value, c) => (!reserved[r][c] && MASKS[mask](r, c) ? !value : !!value)));
    const format = bch((0b00 << 3) | mask, 0x537, 10) ^ 0x5412;
    const bit = (i: number) => ((format >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) grid[8][i] = bit(14 - i);
    grid[8][7] = bit(8); grid[8][8] = bit(7); grid[7][8] = bit(6);
    for (let i = 9; i <= 14; i++) grid[14 - i][8] = bit(14 - i);
    for (let i = 0; i < 8; i++) grid[size - 1 - i][8] = bit(14 - i);
    for (let i = 7; i < 15; i++) grid[8][size - 15 + i] = bit(14 - i);
    grid[size - 8][8] = true;
    return grid;
  };
  let best = withMask(0);
  let bestScore = penalty(best);
  for (let mask = 1; mask < 8; mask++) {
    const candidate = withMask(mask);
    const score = penalty(candidate);
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}

/** The QR code as a crisp SVG with the standard 4-module quiet zone. */
export function qrSvg(text: string, options: { size?: number; dark?: string; light?: string } = {}): string {
  const matrix = qrMatrix(text);
  const count = matrix.length + 8;
  const path: string[] = [];
  matrix.forEach((row, r) => row.forEach((dark, c) => { if (dark) path.push(`M${c + 4} ${r + 4}h1v1h-1z`); }));
  const size = options.size ?? 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} ${count}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${count}" height="${count}" fill="${options.light ?? "#ffffff"}"/><path d="${path.join("")}" fill="${options.dark ?? "#000000"}"/></svg>`;
}
