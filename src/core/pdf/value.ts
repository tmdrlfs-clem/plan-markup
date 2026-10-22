// A small plain-data model of PDF values (framework-free, structured-clone
// friendly) and its conversion to @cantoo/pdf-lib objects. Writers build
// dictionaries as plain data so tests can inspect them without pdf-lib.

import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFString,
  type PDFContext,
  type PDFObject,
  type PDFRef,
} from "@cantoo/pdf-lib";

export type PdfNameValue = { $name: string };
/**
 * A PDF text string: printable ASCII is written as a literal string (dates and
 * ids stay readable for every parser), anything else as UTF-16BE hex with BOM.
 */
export type PdfTextValue = { $text: string };
/** A reference resolved by the caller when the value is converted. */
export type PdfRefValue = { $ref: string };
export type PdfDictValue = { [key: string]: PdfValue | undefined };
export type PdfValue =
  | null
  | boolean
  | number
  | PdfNameValue
  | PdfTextValue
  | PdfRefValue
  | PdfValue[]
  | PdfDictValue;

export const name = (value: string): PdfNameValue => ({ $name: value });
export const text = (value: string): PdfTextValue => ({ $text: value });
export const ref = (id: string): PdfRefValue => ({ $ref: id });

export function isNameValue(v: PdfValue | undefined): v is PdfNameValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as PdfNameValue).$name === "string";
}
export function isTextValue(v: PdfValue | undefined): v is PdfTextValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as PdfTextValue).$text === "string";
}
export function isRefValue(v: PdfValue | undefined): v is PdfRefValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && typeof (v as PdfRefValue).$ref === "string";
}
export function isDictValue(v: PdfValue | undefined): v is PdfDictValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !isNameValue(v) && !isTextValue(v) && !isRefValue(v);
}

export type RefResolver = (id: string) => PDFRef;

const noRefs: RefResolver = (id) => {
  throw new Error(`Unresolved reference ${id}`);
};

/** Converts a plain value to a pdf-lib object. `undefined` dictionary entries are skipped. */
export function toPdfObject(context: PDFContext, v: PdfValue, resolve: RefResolver = noRefs): PDFObject {
  if (v === null) return PDFNull;
  if (typeof v === "boolean") return v ? PDFBool.True : PDFBool.False;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Non-finite number in PDF value");
    return PDFNumber.of(v);
  }
  if (Array.isArray(v)) {
    const arr = PDFArray.withContext(context);
    for (const x of v) arr.push(toPdfObject(context, x, resolve));
    return arr;
  }
  if (isNameValue(v)) return PDFName.of(v.$name);
  if (isTextValue(v)) {
    if (/^[\x20-\x7e]*$/.test(v.$text)) return PDFString.of(v.$text.replace(/[()\\]/g, "\\$&"));
    return PDFHexString.fromText(v.$text);
  }
  if (isRefValue(v)) return resolve(v.$ref);
  return toPdfDict(context, v, resolve);
}

export function toPdfDict(context: PDFContext, v: PdfDictValue, resolve: RefResolver = noRefs): PDFDict {
  const d = PDFDict.withContext(context);
  for (const [k, x] of Object.entries(v)) {
    if (x !== undefined) d.set(PDFName.of(k), toPdfObject(context, x, resolve));
  }
  return d;
}
