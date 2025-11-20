/**
 * Optimized PGM (Portable Gray Map) Parser for Large Files
 * Supports binary PGM (P5) format with chunked processing
 */

export interface ParsedPGM {
  width: number;
  height: number;
  maxVal: number;
  data: Uint8Array;
}

export interface PGMProcessingOptions {
  chunkSize?: number; // Process PGM in chunks to avoid memory issues
  progressCallback?: (progress: number) => void; // Progress callback for long operations
  quality?: number; // Quality factor for data reduction (1-100)
}

export interface OptimizedPGMResult {
  parsedPGM: ParsedPGM;
  processingTime: number;
  originalSize: number;
  compressedSize: number;
}

/**
 * Parse binary PGM data from ArrayBuffer with optimizations for large files
 * @param buffer ArrayBuffer containing PGM data
 * @param options Optimization options
 * @returns Optimized PGM result with performance metrics
 */
export async function parsePGMOptimized(
  buffer: ArrayBuffer,
  options: PGMProcessingOptions = {}
): Promise<OptimizedPGMResult> {
  const startTime = performance.now();
  const { chunkSize = 65536, progressCallback, quality = 100 } = options;
  const originalSize = buffer.byteLength;

  // Parse header first
  const headerResult = parseHeader(buffer);
  const { width, height, maxVal, dataOffset } = headerResult;

  const totalPixels = width * height;

  // Create optimized data array
  let data: Uint8Array;
  if (quality < 100) {
    // Use reduced resolution for lower quality
    const scaleFactor = Math.sqrt(quality / 100);
    const newWidth = Math.floor(width * scaleFactor);
    const newHeight = Math.floor(height * scaleFactor);
    data = new Uint8Array(newWidth * newHeight);
    await processReducedResolution(
      buffer,
      dataOffset,
      width,
      height,
      newWidth,
      newHeight,
      data,
      progressCallback
    );
  } else {
    // Process full resolution in chunks
    data = await processFullResolution(
      buffer,
      dataOffset,
      totalPixels,
      chunkSize,
      progressCallback
    );
  }

  const processingTime = performance.now() - startTime;

  return {
    parsedPGM: {
      width: quality < 100 ? Math.floor(width * Math.sqrt(quality / 100)) : width,
      height: quality < 100 ? Math.floor(height * Math.sqrt(quality / 100)) : height,
      maxVal,
      data,
    },
    processingTime,
    originalSize,
    compressedSize: data.length,
  };
}

/**
 * Parse PGM header to get metadata
 */
function parseHeader(buffer: ArrayBuffer): {
  width: number;
  height: number;
  maxVal: number;
  dataOffset: number;
} {
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

  return { width, height, maxVal, dataOffset: offset };
}

/**
 * Process full resolution PGM data in chunks
 */
async function processFullResolution(
  buffer: ArrayBuffer,
  dataOffset: number,
  totalPixels: number,
  chunkSize: number,
  progressCallback?: (progress: number) => void
): Promise<Uint8Array> {
  const data = new Uint8Array(totalPixels);
  const sourceData = new Uint8Array(buffer, dataOffset, totalPixels);

  // Process in chunks to avoid blocking the main thread
  for (let i = 0; i < totalPixels; i += chunkSize) {
    const end = Math.min(i + chunkSize, totalPixels);

    // Copy chunk
    data.set(sourceData.subarray(i, end), i);

    // Report progress
    if (progressCallback) {
      progressCallback((end / totalPixels) * 100);
    }

    // Yield control to prevent blocking
    if (i % (chunkSize * 4) === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return data;
}

/**
 * Process PGM data with reduced resolution for better performance
 */
async function processReducedResolution(
  buffer: ArrayBuffer,
  dataOffset: number,
  originalWidth: number,
  originalHeight: number,
  newWidth: number,
  newHeight: number,
  data: Uint8Array,
  progressCallback?: (progress: number) => void
): Promise<void> {
  const sourceData = new Uint8Array(buffer, dataOffset, originalWidth * originalHeight);
  const xScale = originalWidth / newWidth;
  const yScale = originalHeight / newHeight;

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const sourceX = Math.floor(x * xScale);
      const sourceY = Math.floor(y * yScale);
      const sourceIndex = sourceY * originalWidth + sourceX;
      const targetIndex = y * newWidth + x;

      data[targetIndex] = sourceData[sourceIndex];
    }

    // Report progress
    if (progressCallback && y % Math.max(1, Math.floor(newHeight / 20)) === 0) {
      progressCallback((y / newHeight) * 100);
    }

    // Yield control periodically
    if (y % 50 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

/**
 * Compress PGM data using simple run-length encoding
 */
export function compressPGMData(data: Uint8Array): Uint8Array {
  const compressed: number[] = [];
  let i = 0;

  while (i < data.length) {
    const value = data[i];
    let count = 1;

    // Count consecutive identical pixels
    while (i + count < data.length && data[i + count] === value && count < 255) {
      count++;
    }

    compressed.push(value);
    compressed.push(count);
    i += count;
  }

  return new Uint8Array(compressed);
}

/**
 * Decompress PGM data using run-length encoding
 */
export function decompressPGMData(compressed: Uint8Array, expectedLength: number): Uint8Array {
  const data = new Uint8Array(expectedLength);
  let dataIndex = 0;
  let compressedIndex = 0;

  while (dataIndex < expectedLength && compressedIndex < compressed.length) {
    const value = compressed[compressedIndex];
    const count = compressed[compressedIndex + 1];

    for (let i = 0; i < count; i++) {
      if (dataIndex < expectedLength) {
        data[dataIndex++] = value;
      }
    }

    compressedIndex += 2;
  }

  return data;
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

/**
 * Get PGM file info without loading full data
 */
export function getPGMInfo(buffer: ArrayBuffer): {
  width: number;
  height: number;
  maxVal: number;
  estimatedSize: number;
} {
  const header = parseHeader(buffer);
  return {
    ...header,
    estimatedSize: header.width * header.height,
  };
}

// Helper functions
function readString(dataView: DataView, offset: number, length: number): string {
  const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset + offset, length);
  return String.fromCharCode.apply(null, Array.from(bytes));
}

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
