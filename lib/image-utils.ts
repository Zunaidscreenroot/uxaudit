export type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp";
export type ImageInfo = { mimeType: SupportedImageMime; width: number; height: number };

const JPEG_START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < data.length) {
    while (offset < data.length && data[offset] !== 0xff) offset += 1;
    while (offset < data.length && data[offset] === 0xff) offset += 1;
    if (offset >= data.length) break;
    const marker = data[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > data.length) break;
    const segmentLength = data.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > data.length) break;
    if (JPEG_START_OF_FRAME.has(marker) && segmentLength >= 7) {
      return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 30 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8X" && data.length >= 30) {
    const width = 1 + data[24] + (data[25] << 8) + (data[26] << 16);
    const height = 1 + data[27] + (data[28] << 8) + (data[29] << 16);
    return { width, height };
  }
  if (chunk === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
    const bits = data.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (chunk === "VP8 " && data.length >= 30 && data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
    return {
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff
    };
  }
  return null;
}

export function inspectImage(input: Uint8Array): ImageInfo {
  const data = Buffer.from(input);
  let mimeType: SupportedImageMime | null = null;
  let dimensions: { width: number; height: number } | null = null;

  if (data.length >= 24 && data[0] === 0x89 && data.toString("ascii", 1, 4) === "PNG" &&
      data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) {
    mimeType = "image/png";
    dimensions = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  } else if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    mimeType = "image/jpeg";
    dimensions = jpegDimensions(data);
  } else if (data.length >= 16 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    mimeType = "image/webp";
    dimensions = webpDimensions(data);
  }

  if (!mimeType || !dimensions || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) ||
      dimensions.width < 1 || dimensions.height < 1) {
    throw new Error("The screenshot is not a supported, readable JPEG, PNG, or WebP image.");
  }
  return { mimeType, width: dimensions.width, height: dimensions.height };
}
