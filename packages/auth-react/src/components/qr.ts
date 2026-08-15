import qrcode from 'qrcode-generator';

export type QrMatrix = {
  /** SVG path data (`M x y h1 v1 h-1 z` per dark module), in a `count`x`count` grid. */
  d: string;
  /** Number of modules per side. */
  count: number;
};

/**
 * Encode `value` as a QR matrix and flatten the dark modules into one SVG path.
 * Pure (the encoder is bundled, so nothing is fetched - the TOTP secret never
 * leaves the page). Returns null if the value can't be encoded (e.g. too long),
 * so the caller can fall back to manual entry.
 */
export function qrPath(value: string): QrMatrix | null {
  if (!value) return null;
  try {
    const qr = qrcode(0, 'M'); // typeNumber 0 = auto-fit the smallest version
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { d, count };
  } catch {
    return null;
  }
}
