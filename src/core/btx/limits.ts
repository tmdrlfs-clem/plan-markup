// Untrusted-input limits for .btx files (NFR31). One place, so the report and
// the tests quote the same numbers.

const MB = 1024 * 1024;

export type BtxLimits = {
  /** Whole input file, bytes. */
  maxFileBytes: number;
  /** One hex-encoded value, in hex characters. */
  maxHexChars: number;
  /** One inflated value, bytes. */
  maxInflatedValueBytes: number;
  /** Sum of all inflated values of one file, bytes. */
  maxInflatedTotalBytes: number;
  /** XML element nesting. */
  maxXmlDepth: number;
  /** PDF object nesting (dictionaries and arrays). */
  maxPdfDepth: number;
};

export const BTX_LIMITS: Readonly<BtxLimits> = Object.freeze({
  maxFileBytes: 32 * MB,
  maxHexChars: 16 * MB,
  maxInflatedValueBytes: 8 * MB,
  maxInflatedTotalBytes: 128 * MB,
  maxXmlDepth: 16,
  maxPdfDepth: 64,
});
