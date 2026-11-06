import { describe, expect, it } from "vitest";

import { qrCodeOf } from "./qr";

describe("a QR code of an address", () => {
  it("is the smallest code that holds it, with a border two modules wide", () => {
    const code = qrCodeOf("http://192.168.1.20:8000");

    // Version 2 is 25 modules square; the border adds two on each side.
    expect(code.size).toBe(29);
  });

  it("starts with the dark corner of its top-left finder pattern, inside the border", () => {
    expect(qrCodeOf("http://192.168.1.20:8000").path.startsWith("M2 2h1v1h-1z")).toBe(true);
  });

  it("differs for another address", () => {
    expect(qrCodeOf("http://192.168.1.20:8000").path).not.toBe(
      qrCodeOf("http://192.168.1.21:8000").path,
    );
  });
});
