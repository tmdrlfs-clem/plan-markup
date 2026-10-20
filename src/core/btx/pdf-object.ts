// Tokenizer + parser for the PDF object syntax used in .btx `Raw` and `Data`
// values (framework-free). Objects are plain data (structured-clone friendly):
// no classes, no Map. Revu links objects with names `/BBObjPtr_<ID>` instead of
// indirect references; in value position they become { kind: "ref", ref: ID }.

import { BtxError } from "./errors";
import { BTX_LIMITS } from "./limits";
import { bytesToLatin1 } from "./inflate";

export type PdfName = { kind: "name"; value: string };
export type PdfString = { kind: "string"; bytes: Uint8Array; hex: boolean };
export type PdfRef = { kind: "ref"; ref: string };
/** Entries keep file order; duplicate keys keep the last value. */
export type PdfDict = { kind: "dict"; entries: Array<[string, PdfObject]> };
export type PdfStream = { kind: "stream"; dict: PdfDict; data: Uint8Array };
export type PdfObject =
  | null
  | boolean
  | number
  | PdfName
  | PdfString
  | PdfRef
  | PdfDict
  | PdfStream
  | PdfObject[];

export const REF_PREFIX = "BBObjPtr_";
const REF_NAME = /^BBObjPtr_([A-Z]{16})$/;

export type PdfParseOptions = { maxDepth?: number };

// ---------------------------------------------------------------- helpers

export function pdfName(value: string): PdfName {
  return { kind: "name", value };
}

export function pdfDict(entries: Array<[string, PdfObject]> = []): PdfDict {
  return { kind: "dict", entries };
}

export function isDict(o: PdfObject | undefined): o is PdfDict {
  return typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "dict";
}
export function isStream(o: PdfObject | undefined): o is PdfStream {
  return typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "stream";
}
export function isName(o: PdfObject | undefined): o is PdfName {
  return typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "name";
}
export function isRef(o: PdfObject | undefined): o is PdfRef {
  return typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "ref";
}
export function isPdfString(o: PdfObject | undefined): o is PdfString {
  return typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "string";
}

/** Last value for `key`, or undefined. Accepts a dict or a stream (its dict). */
export function dictGet(d: PdfDict | PdfStream | undefined, key: string): PdfObject | undefined {
  if (!d) return undefined;
  const entries = d.kind === "stream" ? d.dict.entries : d.entries;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]![0] === key) return entries[i]![1];
  }
  return undefined;
}

/** A copy of `d` with `key` set (replacing any existing entry). */
export function dictWith(d: PdfDict, key: string, value: PdfObject): PdfDict {
  const entries = d.entries.filter(([k]) => k !== key);
  entries.push([key, value]);
  return { kind: "dict", entries };
}

/** A copy of `d` without `key`. */
export function dictWithout(d: PdfDict, key: string): PdfDict {
  return { kind: "dict", entries: d.entries.filter(([k]) => k !== key) };
}

export function getNumber(d: PdfDict | PdfStream | undefined, key: string): number | undefined {
  const v = dictGet(d, key);
  return typeof v === "number" ? v : undefined;
}

export function getName(d: PdfDict | PdfStream | undefined, key: string): string | undefined {
  const v = dictGet(d, key);
  return isName(v) ? v.value : undefined;
}

/** Numbers of an array value; undefined when absent or not all numbers. */
export function getNumbers(d: PdfDict | PdfStream | undefined, key: string): number[] | undefined {
  const v = dictGet(d, key);
  if (!Array.isArray(v) || !v.every((x) => typeof x === "number")) return undefined;
  return v as number[];
}

export function getDict(d: PdfDict | PdfStream | undefined, key: string): PdfDict | undefined {
  const v = dictGet(d, key);
  return isDict(v) ? v : undefined;
}

/** Text of a PDF string: UTF-16BE (BOM), UTF-8 (BOM) or PDFDocEncoding (≈ Latin-1). */
export function pdfStringText(s: PdfString): string {
  const b = s.bytes;
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < b.length; i += 2) out += String.fromCharCode((b[i]! << 8) | b[i + 1]!);
    return out;
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(b.subarray(3));
  }
  return bytesToLatin1(b);
}

export function getText(d: PdfDict | PdfStream | undefined, key: string): string | undefined {
  const v = dictGet(d, key);
  return isPdfString(v) ? pdfStringText(v) : undefined;
}

/** Every `ref` id reachable inside `o` (not following refs). */
export function collectRefs(o: PdfObject, out: Set<string> = new Set()): Set<string> {
  const stack: PdfObject[] = [o];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === null || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
    } else if (cur.kind === "ref") {
      out.add(cur.ref);
    } else if (cur.kind === "dict") {
      for (const [, v] of cur.entries) stack.push(v);
    } else if (cur.kind === "stream") {
      stack.push(cur.dict);
    }
  }
  return out;
}

// ---------------------------------------------------------------- lexer

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function malformed(what: string, pos: number): BtxError {
  return new BtxError("pdf-malformed", `PDF object: ${what} at offset ${pos}`);
}

class Parser {
  private pos = 0;
  private readonly b: Uint8Array;
  private readonly maxDepth: number;

  constructor(bytes: Uint8Array, maxDepth: number) {
    this.b = bytes;
    this.maxDepth = maxDepth;
  }

  get offset(): number {
    return this.pos;
  }

  skipWs(): void {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos]!;
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        // % comment to end of line
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }

  atEnd(): boolean {
    this.skipWs();
    return this.pos >= this.b.length;
  }

  private regularRun(): string {
    const start = this.pos;
    while (this.pos < this.b.length) {
      const c = this.b[this.pos]!;
      if (WS.has(c) || DELIM.has(c)) break;
      this.pos++;
    }
    return bytesToLatin1(this.b.subarray(start, this.pos));
  }

  private readName(): string {
    this.pos++; // '/'
    const raw = this.regularRun();
    if (!raw.includes("#")) return raw;
    return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  }

  private readLiteralString(): PdfString {
    const b = this.b;
    const start = this.pos;
    this.pos++; // '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++]!;
      if (c === 0x5c) {
        // backslash
        if (this.pos >= b.length) break;
        const e = b[this.pos++]!;
        switch (e) {
          case 0x6e: out.push(0x0a); break; // n
          case 0x72: out.push(0x0d); break; // r
          case 0x74: out.push(0x09); break; // t
          case 0x62: out.push(0x08); break; // b
          case 0x66: out.push(0x0c); break; // f
          case 0x28: case 0x29: case 0x5c: out.push(e); break;
          case 0x0d:
            if (b[this.pos] === 0x0a) this.pos++;
            break; // line continuation
          case 0x0a:
            break;
          default:
            if (e >= 0x30 && e <= 0x37) {
              let v = e - 0x30;
              for (let k = 0; k < 2; k++) {
                const d = b[this.pos];
                if (d === undefined || d < 0x30 || d > 0x37) break;
                v = v * 8 + (d - 0x30);
                this.pos++;
              }
              out.push(v & 0xff);
            } else {
              out.push(e); // unknown escape: the backslash is ignored
            }
        }
        continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29) {
        depth--;
        if (depth === 0) return { kind: "string", bytes: Uint8Array.from(out), hex: false };
      } else if (c === 0x0d) {
        // EOL inside a literal string reads as LF
        if (b[this.pos] === 0x0a) this.pos++;
        out.push(0x0a);
        continue;
      }
      out.push(c);
    }
    throw malformed("unterminated string", start);
  }

  private readHexString(): PdfString {
    const start = this.pos;
    this.pos++; // '<'
    const digits: number[] = [];
    while (this.pos < this.b.length) {
      const c = this.b[this.pos++]!;
      if (c === 0x3e) {
        if (digits.length % 2 === 1) digits.push(0);
        const bytes = new Uint8Array(digits.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = (digits[2 * i]! << 4) | digits[2 * i + 1]!;
        return { kind: "string", bytes, hex: true };
      }
      if (WS.has(c)) continue;
      const n =
        c >= 0x30 && c <= 0x39 ? c - 0x30
        : c >= 0x41 && c <= 0x46 ? c - 0x37
        : c >= 0x61 && c <= 0x66 ? c - 0x57
        : -1;
      if (n < 0) throw malformed("bad hex string", this.pos - 1);
      digits.push(n);
    }
    throw malformed("unterminated hex string", start);
  }

  private tooDeep(depth: number): void {
    if (depth > this.maxDepth) {
      throw new BtxError("pdf-too-deep", `PDF object nesting deeper than ${this.maxDepth}`);
    }
  }

  /** One object at the current position. Streams are handled by parseValue. */
  readObject(depth: number): PdfObject {
    this.skipWs();
    const b = this.b;
    if (this.pos >= b.length) throw malformed("unexpected end", this.pos);
    const c = b[this.pos]!;
    if (c === 0x2f) {
      const name = this.readName();
      const m = REF_NAME.exec(name);
      return m ? { kind: "ref", ref: m[1]! } : { kind: "name", value: name };
    }
    if (c === 0x28) return this.readLiteralString();
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) return this.readDict(depth + 1);
      return this.readHexString();
    }
    if (c === 0x5b) {
      this.tooDeep(depth + 1);
      const start = this.pos;
      this.pos++;
      const arr: PdfObject[] = [];
      for (;;) {
        this.skipWs();
        if (this.pos >= b.length) throw malformed("unterminated array", start);
        if (b[this.pos] === 0x5d) {
          this.pos++;
          return arr;
        }
        arr.push(this.readObject(depth + 1));
      }
    }
    if (DELIM.has(c)) throw malformed("unexpected delimiter", this.pos);
    const start = this.pos;
    const word = this.regularRun();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    throw malformed("unknown token", start);
  }

  private readDict(depth: number): PdfDict {
    this.tooDeep(depth);
    const start = this.pos;
    this.pos += 2;
    const entries: Array<[string, PdfObject]> = [];
    const index = new Map<string, number>();
    for (;;) {
      this.skipWs();
      if (this.pos >= this.b.length) throw malformed("unterminated dictionary", start);
      if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) {
        this.pos += 2;
        return { kind: "dict", entries };
      }
      if (this.b[this.pos] !== 0x2f) throw malformed("dictionary key is not a name", this.pos);
      const key = this.readName();
      const value = this.readObject(depth);
      const at = index.get(key);
      if (at !== undefined) entries[at] = [key, value];
      else {
        index.set(key, entries.length);
        entries.push([key, value]);
      }
    }
  }

  /** A top-level value: an object, or a dictionary followed by a stream body. */
  parseValue(): PdfObject {
    const obj = this.readObject(0);
    if (!isDict(obj)) return obj;
    const save = this.pos;
    this.skipWs();
    if (!this.startsWith("stream")) {
      this.pos = save;
      return obj;
    }
    this.pos += 6;
    // EOL after the keyword: CRLF or LF (CR alone tolerated).
    if (this.b[this.pos] === 0x0d) this.pos++;
    if (this.b[this.pos] === 0x0a) this.pos++;
    const dataStart = this.pos;
    const data = this.streamData(obj, dataStart);
    return { kind: "stream", dict: obj, data };
  }

  private startsWith(word: string): boolean {
    for (let i = 0; i < word.length; i++) {
      if (this.b[this.pos + i] !== word.charCodeAt(i)) return false;
    }
    return true;
  }

  private findEndstream(from: number): number {
    const b = this.b;
    outer: for (let i = b.length - 9; i >= from; i--) {
      for (let k = 0; k < 9; k++) if (b[i + k] !== "endstream".charCodeAt(k)) continue outer;
      return i;
    }
    return -1;
  }

  private streamData(dict: PdfDict, dataStart: number): Uint8Array {
    const b = this.b;
    const length = getNumber(dict, "Length");
    if (length !== undefined && Number.isInteger(length) && length >= 0 && dataStart + length <= b.length) {
      let p = dataStart + length;
      while (p < b.length && WS.has(b[p]!)) p++;
      this.pos = p;
      if (this.startsWith("endstream")) {
        this.pos += 9;
        return b.slice(dataStart, dataStart + length);
      }
    }
    // Fallback: the last endstream marker, minus one EOL before it.
    const end = this.findEndstream(dataStart);
    if (end < 0) throw malformed("stream without endstream", dataStart);
    let stop = end;
    if (stop > dataStart && b[stop - 1] === 0x0a) stop--;
    if (stop > dataStart && b[stop - 1] === 0x0d) stop--;
    this.pos = end + 9;
    return b.slice(dataStart, stop);
  }
}

/**
 * Parses one PDF object (or dictionary + stream) from `bytes`. Trailing
 * whitespace is allowed; any other trailing content is an error.
 */
export function parsePdfObject(bytes: Uint8Array, options: PdfParseOptions = {}): PdfObject {
  const p = new Parser(bytes, options.maxDepth ?? BTX_LIMITS.maxPdfDepth);
  const value = p.parseValue();
  if (!p.atEnd()) throw malformed("trailing content", p.offset);
  return value;
}
