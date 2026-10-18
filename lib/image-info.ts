export type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp";

export type ImageInfo = {
  width: number;
  height: number;
  mimeType: SupportedImageMime;
};

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let i = offset; i < offset + length; i += 1) value += String.fromCharCode(bytes[i]);
  return value;
}

/** Read dimensions from common screenshot formats without native image libraries. */
export function getImageInfo(bytes: Uint8Array): ImageInfo | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    const width = u32be(bytes, 16);
    const height = u32be(bytes, 20);
    return width > 0 && height > 0 ? { width, height, mimeType: "image/png" } : null;
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (offset + 1 < bytes.length && bytes[offset + 1] === 0xff) offset += 1;
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segmentLength = u16be(bytes, offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return null;
      if (startOfFrame.has(marker) && segmentLength >= 7) {
        const height = u16be(bytes, offset + 5);
        const width = u16be(bytes, offset + 7);
        return width > 0 && height > 0 ? { width, height, mimeType: "image/jpeg" } : null;
      }
      offset += 2 + segmentLength;
    }
    return null;
  }

  if (
    bytes.length >= 30 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    const chunk = ascii(bytes, 12, 4);
    let width = 0;
    let height = 0;
    if (chunk === "VP8X") {
      width = 1 + u24le(bytes, 24);
      height = 1 + u24le(bytes, 27);
    } else if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
      width = 1 + (((b2 & 0x3f) << 8) | b1);
      height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6));
    } else if (
      chunk === "VP8 " &&
      bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a
    ) {
      width = u16le(bytes, 26) & 0x3fff;
      height = u16le(bytes, 28) & 0x3fff;
    }
    return width > 0 && height > 0 ? { width, height, mimeType: "image/webp" } : null;
  }

  return null;
}

function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
