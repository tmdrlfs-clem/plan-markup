// Typed errors for the .btx reader (framework-free). Messages never contain file
// content: they name the limit or the structural problem only (NFR31).

export type BtxErrorCode =
  | "file-too-large"
  | "hex-too-large"
  | "hex-invalid"
  | "inflate-value-too-large"
  | "inflate-total-too-large"
  | "inflate-failed"
  | "xml-forbidden"
  | "xml-too-deep"
  | "xml-malformed"
  | "pdf-too-deep"
  | "pdf-malformed"
  | "structure-invalid";

export class BtxError extends Error {
  readonly code: BtxErrorCode;

  constructor(code: BtxErrorCode, message: string) {
    super(message);
    this.name = "BtxError";
    this.code = code;
  }
}

export function isBtxError(value: unknown): value is BtxError {
  return value instanceof BtxError;
}
