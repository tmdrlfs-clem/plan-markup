import { describe, expect, it } from "vitest";
import { openError, pdfjsAssetBase } from "./render-pdfjs";

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
