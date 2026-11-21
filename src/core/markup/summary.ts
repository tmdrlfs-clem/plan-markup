// Markup summary (Bluebeam toolbar set, founder 2026-11-21). Framework-free.
// The Markups list's rows, as shown (its sort and filters), as a CSV file a
// spreadsheet opens: one row a markup, its page, subject, type, date, author,
// colour, layer, device, measurement and text.

import { SUBJECT_NAMES } from "./properties";
import type { MarkupListRow } from "./markup-list";

export const SUMMARY_COLUMNS = ["Page", "Subject", "Type", "Date", "Author", "Colour", "Layer", "Device", "Measurement", "Text"] as const;

/** A CSV field: quoted when it holds a comma, quote or line break; a leading =, +, - or @ is defused (spreadsheet formulas). */
export function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** What a markup says in words: its text, a replacement, a link's address. */
function textOf(row: MarkupListRow): string {
  const m = row.markup;
  if (m.type === "strikethrough" && m.replacement !== undefined) return `${m.text ?? ""} → ${m.replacement}`;
  if (m.type === "link") return m.uri;
  return "text" in m && typeof m.text === "string" ? m.text : "";
}

/** The summary as CSV text (CRLF lines, with a byte-order mark so a spreadsheet reads it as UTF-8). */
export function summaryCsv(rows: readonly MarkupListRow[], author: string): string {
  const lines = [SUMMARY_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [row.page, row.subject, SUBJECT_NAMES[row.type], row.date, author, row.color.toLowerCase(), row.layer, row.device, row.value, textOf(row)].map(csvField).join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** The file name: the drawing's name with " summary.csv". */
export function summaryFileName(drawing: string): string {
  return `${drawing.replace(/\.pdf$/i, "") || "Markups"} summary.csv`;
}
