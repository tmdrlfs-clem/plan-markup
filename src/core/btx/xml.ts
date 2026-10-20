// A small, strict XML reader for the .btx shape only (framework-free; DOMParser
// does not exist in Web Workers). It accepts the XML declaration, elements,
// attributes, text and comments. DOCTYPE, ENTITY, CDATA and any other
// processing instruction are rejected (no entity expansion, NFR31). Only the
// five predefined entities and numeric character references are decoded.

import { BtxError } from "./errors";
import { BTX_LIMITS } from "./limits";

export type XmlElement = {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content (entities decoded, not trimmed). */
  text: string;
};

export type XmlReadOptions = { maxDepth?: number };

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_.:-]/;
const PREDEFINED: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function malformed(what: string, pos: number): BtxError {
  return new BtxError("xml-malformed", `XML: ${what} at offset ${pos}`);
}

function forbidden(what: string, pos: number): BtxError {
  return new BtxError("xml-forbidden", `XML: ${what} is not allowed (offset ${pos})`);
}

/** Decodes the predefined entities and numeric character references. */
export function decodeXmlText(raw: string, pos = 0): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&([^;&]*);?/g, (match, body: string, offset: number) => {
    if (!match.endsWith(";")) throw malformed("unterminated entity", pos + offset);
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const digits = hex ? body.slice(2) : body.slice(1);
      const valid = hex ? /^[0-9A-Fa-f]{1,6}$/.test(digits) : /^[0-9]{1,7}$/.test(digits);
      if (!valid) throw malformed("bad character reference", pos + offset);
      const cp = parseInt(digits, hex ? 16 : 10);
      if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        throw malformed("character reference out of range", pos + offset);
      }
      return String.fromCodePoint(cp);
    }
    const ch = PREDEFINED[body];
    if (ch === undefined || !Object.prototype.hasOwnProperty.call(PREDEFINED, body)) {
      throw forbidden("an undeclared entity reference", pos + offset);
    }
    return ch;
  });
}

/** Parses the document and returns its root element. */
export function readXml(input: string, options: XmlReadOptions = {}): XmlElement {
  const maxDepth = options.maxDepth ?? BTX_LIMITS.maxXmlDepth;
  const s = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let i = 0;

  const skipWs = () => {
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
      else break;
    }
  };

  const readName = (): string => {
    const start = i;
    if (i >= s.length || !NAME_START.test(s[i]!)) throw malformed("expected a name", i);
    i++;
    while (i < s.length && NAME_CHAR.test(s[i]!)) i++;
    return s.slice(start, i);
  };

  // Comments, forbidden markup and processing instructions that may appear
  // between elements. Returns true when something was consumed.
  const skipMarkup = (): boolean => {
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end < 0) throw malformed("unterminated comment", i);
      i = end + 3;
      return true;
    }
    if (s.startsWith("<!DOCTYPE", i) || s.startsWith("<!doctype", i)) throw forbidden("DOCTYPE", i);
    if (s.startsWith("<!ENTITY", i)) throw forbidden("ENTITY", i);
    if (s.startsWith("<![CDATA[", i)) throw forbidden("CDATA", i);
    if (s.startsWith("<!", i)) throw forbidden("markup declaration", i);
    if (s.startsWith("<?", i)) throw forbidden("processing instruction", i);
    return false;
  };

  // The XML declaration must be the very first thing (after the BOM).
  if (s.startsWith("<?xml", 0) && /[\s?]/.test(s[5] ?? "")) {
    const end = s.indexOf("?>", 5);
    if (end < 0) throw malformed("unterminated XML declaration", 0);
    i = end + 2;
  }

  const readAttrs = (): Record<string, string> => {
    const attrs = Object.create(null) as Record<string, string>;
    for (;;) {
      const before = i;
      skipWs();
      const c = s[i];
      if (c === ">" || c === "/" || c === undefined) return attrs;
      if (i === before) throw malformed("expected whitespace before attribute", i);
      const name = readName();
      skipWs();
      if (s[i] !== "=") throw malformed("expected '='", i);
      i++;
      skipWs();
      const quote = s[i];
      if (quote !== '"' && quote !== "'") throw malformed("expected a quoted value", i);
      const end = s.indexOf(quote, i + 1);
      if (end < 0) throw malformed("unterminated attribute value", i);
      const raw = s.slice(i + 1, end);
      if (raw.includes("<")) throw malformed("'<' in attribute value", i);
      if (name in attrs) throw malformed("duplicate attribute", i);
      attrs[name] = decodeXmlText(raw, i + 1);
      i = end + 1;
    }
  };

  const readElement = (depth: number): XmlElement => {
    if (depth > maxDepth) {
      throw new BtxError("xml-too-deep", `XML: nesting deeper than ${maxDepth}`);
    }
    if (s[i] !== "<") throw malformed("expected '<'", i);
    i++;
    const name = readName();
    const attrs = readAttrs();
    const el: XmlElement = { name, attrs, children: [], text: "" };
    if (s.startsWith("/>", i)) {
      i += 2;
      return el;
    }
    if (s[i] !== ">") throw malformed("expected '>'", i);
    i++;
    const texts: string[] = [];
    for (;;) {
      const lt = s.indexOf("<", i);
      if (lt < 0) throw malformed("unclosed element", i);
      if (lt > i) {
        const raw = s.slice(i, lt);
        if (raw.includes("]]>")) throw malformed("']]>' in text", i);
        texts.push(decodeXmlText(raw, i));
      }
      i = lt;
      if (s.startsWith("</", i)) {
        i += 2;
        const close = readName();
        if (close !== name) throw malformed("mismatched closing tag", i);
        skipWs();
        if (s[i] !== ">") throw malformed("expected '>'", i);
        i++;
        el.text = texts.join("");
        return el;
      }
      if (skipMarkup()) continue;
      el.children.push(readElement(depth + 1));
    }
  };

  // Prolog: whitespace and comments only.
  for (;;) {
    skipWs();
    if (!skipMarkup()) break;
  }
  if (i >= s.length) throw malformed("no root element", i);
  const root = readElement(1);
  for (;;) {
    skipWs();
    if (i >= s.length) break;
    if (!skipMarkup()) throw malformed("content after the root element", i);
  }
  return root;
}
