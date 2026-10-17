// Result shape for server actions, RPC wrappers and worker replies (architecture AR16).

export type ResultCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "UNAUTHENTICATED";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: ResultCode; message: string };
