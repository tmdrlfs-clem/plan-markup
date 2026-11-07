import { PDFDocument } from "@cantoo/pdf-lib";
import { describe, expect, it } from "vitest";

import type { ExportJob } from "@/core/export/from-app";

import { handleExportMessage } from "./export.worker";

const JOB: ExportJob = {
  layers: [],
  pages: [
    {
      pageIndex: 0,
      flatten: [],
      model: {
        calibration: { label: "1:1", unit: "pt", unitsPerPoint: 1, decimals: 2 },
        layers: [],
        markups: [{ id: "m1", subject: "Line", author: "Kim", type: "line", from: [10, 10], to: [100, 100], color: [1, 0, 0] }],
      },
    },
  ],
};

describe("export worker (Story 8.1)", () => {
  it("writes the job onto the PDF and replies with the new bytes", async () => {
    const base = await PDFDocument.create();
    base.addPage([200, 200]);
    const reply = await handleExportMessage({ type: "export", reqId: 3, bytes: await base.save(), job: JOB, date: "2026-11-08T00:00:00Z" });
    expect(reply).toMatchObject({ type: "exported", reqId: 3, annotations: 1, pages: 1 });
    if (reply.type !== "exported") return;
    expect((await PDFDocument.load(reply.bytes)).getPage(0).node.Annots()!.size()).toBe(1);
  });

  it("answers a bad request with an error, never throws", async () => {
    expect(await handleExportMessage(null)).toMatchObject({ type: "error", reqId: null });
    expect(await handleExportMessage({ type: "x", reqId: 1 })).toMatchObject({ type: "error", reqId: 1 });
    expect(await handleExportMessage({ type: "export", reqId: 2, bytes: new Uint8Array([1, 2, 3]), job: JOB })).toMatchObject({ type: "error", reqId: 2 });
    expect(await handleExportMessage({ type: "export", reqId: 4, bytes: new Uint8Array(), job: {} })).toMatchObject({ type: "error", reqId: 4 });
  });

  it("Story 8.3: print lays the pages on the paper, with or without the job", async () => {
    const base = await PDFDocument.create();
    base.addPage([200, 200]);
    const bytes = await base.save();
    const print = { pages: [0], paper: "A4", scale: "fit" };
    const drawn = await handleExportMessage({ type: "print", reqId: 5, bytes, job: JOB, date: "2026-11-08T00:00:00Z", print });
    expect(drawn).toMatchObject({ type: "printed", reqId: 5, sheets: 1, clipped: 0 });
    const plain = await handleExportMessage({ type: "print", reqId: 6, bytes, job: null, date: "2026-11-08T00:00:00Z", print });
    expect(plain).toMatchObject({ type: "printed", reqId: 6, sheets: 1 });
    expect(await handleExportMessage({ type: "print", reqId: 7, bytes, job: null, print: { pages: [0], paper: "B5", scale: "fit" } })).toMatchObject({ type: "error", reqId: 7 });
  });
});
