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
  /** PDF values (dictionaries, arrays, names, numbers, …) parsed in one file. */
  maxPdfNodes: number;
  /** ToolChestItem elements in one file. */
  maxItems: number;
  /** Child elements in one item. */
  maxChildrenPerItem: number;
  /** Child elements in one file. */
  maxChildrenPerFile: number;
  /** Resources elements in one item. */
  maxResourcesPerItem: number;
  /** Resources elements in one file. */
  maxResourcesPerFile: number;
};

export const BTX_LIMITS: Readonly<BtxLimits> = Object.freeze({
  maxFileBytes: 32 * MB,
  maxHexChars: 16 * MB,
  maxInflatedValueBytes: 8 * MB,
  maxInflatedTotalBytes: 128 * MB,
  maxXmlDepth: 16,
  maxPdfDepth: 64,
  // Counts: >= 10x the founder's largest real values (see the spike report).
  maxPdfNodes: 1_000_000,
  maxItems: 1_000,
  maxChildrenPerItem: 64,
  maxChildrenPerFile: 1_000,
  maxResourcesPerItem: 4_096,
  maxResourcesPerFile: 32_768,
});
