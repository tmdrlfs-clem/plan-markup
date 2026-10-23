import { afterEach, describe, expect, it, vi } from "vitest";

const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("pdfjs-dist")>()),
  getDocument: pdfjs.getDocument,
}));

import { PdfjsTileRenderer, ensureParserWorker, openError, pdfjsAssetBase } from "./render-pdfjs";

describe("render-pdfjs helpers", () => {
  it("maps pdf.js open failures to protocol codes", () => {
    const pw = new Error("No password given");
    pw.name = "PasswordException";
    expect(openError(pw).code).toBe("password-required");
    const bad = new Error("Invalid PDF structure.");
    bad.name = "InvalidPDFException";
    expect(openError(bad).code).toBe("invalid-pdf");
    expect(openError("weird").code).toBe("invalid-pdf");
  });

  it("serves the assets from the versioned same-origin copy", () => {
    expect(pdfjsAssetBase("http://localhost:3020")).toBe("http://localhost:3020/pdfjs/6.4.299/");
  });
});

class FakeParserWorker {
  listeners: (() => void)[] = [];
  terminated = false;
  addEventListener(type: string, fn: () => void) {
    if (type === "error") this.listeners.push(fn);
  }
  terminate() {
    this.terminated = true;
  }
  crash() {
    for (const fn of this.listeners) fn();
  }
}

describe("ensureParserWorker", () => {
  it("starts one parser worker, and after it fails rejects its tasks and starts a new one", async () => {
    const created: FakeParserWorker[] = [];
    const ports: unknown[] = [];
    const create = (url: string) => {
      expect(url).toBe("/base/build/pdf.worker.min.mjs");
      const w = new FakeParserWorker();
      created.push(w);
      return w as unknown as Worker;
    };
    const setPort = (p: unknown) => void ports.push(p);
    const first = ensureParserWorker("/base/", create, setPort);
    expect(ensureParserWorker("/base/", create, setPort)).toBe(first);
    expect(created).toHaveLength(1);
    created[0].crash();
    await expect(first.failed).rejects.toMatchObject({ code: "render-failed" });
    expect(created[0].terminated).toBe(true);
    expect(ports).toEqual([created[0], null]);
    const second = ensureParserWorker("/base/", create, setPort);
    expect(second).not.toBe(first);
    expect(created).toHaveLength(2);
    created[1].crash(); // leave no parser behind for the next tests
  });
});

describe("PdfjsTileRenderer.open", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    pdfjs.getDocument.mockReset();
  });

  function fakeTask() {
    let resolve!: (doc: unknown) => void;
    const promise = new Promise((r) => (resolve = r));
    return { promise, destroy: vi.fn(async () => undefined), resolve };
  }
  const doc = { numPages: 1, getPage: async () => ({ rotate: 0, view: [5, 6, 15, 26], userUnit: 1, getViewport: () => ({ width: 10, height: 20 }) }) };

  it("installs the document only if it is still the current task (a close meanwhile wins)", async () => {
    vi.stubGlobal("Worker", FakeParserWorker);
    const renderer = new PdfjsTileRenderer("/base/");
    const a = fakeTask();
    pdfjs.getDocument.mockReturnValueOnce(a);
    const opening = renderer.open(new Uint8Array([1]));
    await renderer.close();
    a.resolve(doc);
    await expect(opening).rejects.toMatchObject({ code: "cancelled" });
    await expect(renderer.render({ page: 1, scale: 1, x: 0, y: 0, width: 1, height: 1, encode: false, content: false }, new AbortController().signal)).rejects.toMatchObject({ code: "out-of-range" });

    const b = fakeTask();
    pdfjs.getDocument.mockReturnValueOnce(b);
    const reopening = renderer.open(new Uint8Array([1]));
    b.resolve(doc);
    await expect(reopening).resolves.toEqual([{ width: 10, height: 20, rotate: 0, view: [5, 6, 15, 26], userUnit: 1 }]);
  });
});
