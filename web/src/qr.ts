/**
 * @file A QR code of a short text, such as an address, as one SVG path to draw.
 *
 * The code has a quiet border two modules wide and corrects up to 15% of what a
 * camera misreads. This module alone knows the library that encodes it.
 */

import { encode } from "uqr";

/** A QR code `size` modules square, its dark modules as one path in those units. */
export interface QrCode {
  readonly size: number;
  readonly path: string;
}

export function qrCodeOf(text: string): QrCode {
  const { size, data } = encode(text, { ecc: "M", border: 2 });
  const cells = data.flatMap((row, y) =>
    row.flatMap((dark, x) => (dark ? [`M${String(x)} ${String(y)}h1v1h-1z`] : [])),
  );
  return { size, path: cells.join("") };
}
