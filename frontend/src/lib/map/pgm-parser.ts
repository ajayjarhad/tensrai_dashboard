/**
 * Simple PGM (Portable Gray Map) Parser
 * Supports binary PGM (P5) format
 */

export interface ParsedPGM {
  width: number;
  height: number;
  maxVal: number;
  data: Uint8Array;
}

/**
 * Parse binary PGM data from ArrayBuffer
 * @param buffer ArrayBuffer containing PGM data
 * @returns Parsed PGM data
 */
export function parsePGM(buffer: ArrayBuffer): ParsedPGM {
  const dataView = new DataView(buffer);
  let offset = 0;

  // Read magic number (P5)
  const magic = readString(dataView, offset, 2);
  offset += 2;

  if (magic !== 'P5') {
    throw new Error(`Unsupported PGM format: ${magic}. Only P5 (binary) format is supported.`);
  }

  // Skip whitespace
  offset = skipWhitespace(dataView, offset);

  // Read width
  const width = readNumber(dataView, offset);
  offset = skipPastNumber(dataView, offset);
  offset = skipWhitespace(dataView, offset);

  // Read height
  const height = readNumber(dataView, offset);
  offset = skipPastNumber(dataView, offset);
  offset = skipWhitespace(dataView, offset);

  // Read max value
  const maxVal = readNumber(dataView, offset);
  offset = skipPastNumber(dataView, offset);

  // Skip single whitespace before pixel data
  offset = skipWhitespace(dataView, offset);

  // Calculate data size
  const dataSize = width * height;
  const data = new Uint8Array(buffer, offset, dataSize);

  return {
    width,
    height,
    maxVal,
    data,
  };
}

/**
 * Read a string from DataView at given offset
 */
function readString(dataView: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, length);
  return String.fromCharCode.apply(null, Array.from(bytes));
}

/**
 * Skip whitespace characters
 */
function skipWhitespace(dataView: DataView, offset: number): number {
  let currentOffset = offset;
  while (currentOffset < dataView.byteLength) {
    const char = String.fromCharCode(dataView.getUint8(currentOffset));
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      currentOffset++;
    } else {
      break;
    }
  }
  return currentOffset;
}

/**
 * Skip past a number (digits and optional decimal point)
 */
function skipPastNumber(dataView: DataView, offset: number): number {
  let currentOffset = offset;
  while (currentOffset < dataView.byteLength) {
    const char = String.fromCharCode(dataView.getUint8(currentOffset));
    if ((char >= '0' && char <= '9') || char === '.' || char === '-') {
      currentOffset++;
    } else {
      break;
    }
  }
  return currentOffset;
}

/**
 * Read a number from DataView at given offset
 */
function readNumber(dataView: DataView, offset: number): number {
  let numStr = '';
  let currentOffset = offset;

  while (currentOffset < dataView.byteLength) {
    const char = String.fromCharCode(dataView.getUint8(currentOffset));
    if ((char >= '0' && char <= '9') || char === '.' || char === '-') {
      numStr += char;
      currentOffset++;
    } else {
      break;
    }
  }

  return parseInt(numStr, 10);
}

/**
 * Validate PGM data structure
 */
export function validatePGM(parsed: ParsedPGM): boolean {
  return (
    parsed.width > 0 &&
    parsed.height > 0 &&
    parsed.maxVal > 0 &&
    parsed.maxVal <= 255 &&
    parsed.data.length === parsed.width * parsed.height
  );
}
